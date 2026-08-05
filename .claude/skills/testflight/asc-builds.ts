#!/usr/bin/env bun
// READ-ONLY: what does App Store Connect actually think of our recent builds?
// Run from the repo root:
//   dotenvx run -f .env.development --quiet -- bun .claude/skills/testflight/asc-builds.ts
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────
// `eas build --auto-submit` exits 0 once the binary is UPLOADED. Apple then processes it for 5-10
// minutes and can still reject it, long after the CLI has gone home — so the CLI's exit code cannot
// answer "can a tester install this?". Only ASC can. This is the read-back that closes that gap, and
// it is the whole point of the testflight skill's Phase 4.
//
// Writes nothing, spends nothing. Auth reuses the ASC API key already set up for `tf:feedback`
// (ASC_KEY_ID / ASC_ISSUER_ID / ASC_APP_ID + keys/AuthKey_<KEYID>.p8), and the ES256-JWT-via-Web-Crypto
// approach is lifted from scripts/pull-testflight-feedback.ts deliberately — one auth pattern for ASC,
// not two that drift.
//
// The states you are reading:
//   processing=VALID              Apple accepted the binary (PROCESSING = still deciding; FAILED/INVALID = it did not)
//   internal=IN_BETA_TESTING      internal testers can install it NOW — this is the one that means "shipped"
//   encryption=false              export compliance already answered, so no manual gate is waiting
import { readFileSync, existsSync } from 'node:fs'

const BASE = 'https://api.appstoreconnect.apple.com'
const AUD = 'appstoreconnect-v1'

const keyId = process.env.ASC_KEY_ID
const issuerId = process.env.ASC_ISSUER_ID
const keyPath = process.env.ASC_API_KEY_PATH ?? (keyId ? `keys/AuthKey_${keyId}.p8` : undefined)
const appId = process.env.ASC_APP_ID

function die(msg: string): never {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}

if (!keyId || !issuerId || !appId) {
  die('Missing ASC_KEY_ID / ASC_ISSUER_ID / ASC_APP_ID — run under `dotenvx run -f .env.development`.')
}
if (!keyPath || !existsSync(keyPath)) {
  die(`Private key not found at "${keyPath}". The .p8 lives in keys/ (gitignored); get it from a teammate.`)
}

async function jwt(): Promise<string> {
  const pem = readFileSync(keyPath!, 'utf8')
  const der = Buffer.from(
    pem.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s+/g, ''),
    'base64',
  )
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const now = Math.floor(Date.now() / 1000)
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const head = b64({ alg: 'ES256', kid: keyId, typ: 'JWT' })
  const body = b64({ iss: issuerId, iat: now, exp: now + 600, aud: AUD })
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(`${head}.${body}`),
  )
  return `${head}.${body}.${Buffer.from(new Uint8Array(sig)).toString('base64url')}`
}

const token = await jwt()

async function get(path: string): Promise<any> {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 400)
    if (res.status === 401 || res.status === 403) {
      die(`ASC ${res.status} (auth/permission) — check ASC_ISSUER_ID + ASC_KEY_ID match the .p8.\n  ${detail}`)
    }
    die(`ASC ${res.status} ${path}\n${detail}`)
  }
  return res.json()
}

// ASC's `version` is a STRING attribute, and whether `sort=-version` orders it lexicographically or
// numerically has not been tested here — every build in the window has been two digits, which cannot
// tell the two apart. Read the build NUMBERS off the rows; do not infer "newest" from position.
const builds = await get(
  `/v1/builds?filter[app]=${appId}&limit=5&sort=-version&include=preReleaseVersion,buildBetaDetail`,
)
const inc = new Map<string, any>((builds.included ?? []).map((i: any) => [`${i.type}:${i.id}`, i]))

console.log('\n=== Recent ASC builds ===')
for (const b of builds.data ?? []) {
  const a = b.attributes
  const pre = inc.get(`preReleaseVersions:${b.relationships?.preReleaseVersion?.data?.id}`)
  const bbd = inc.get(`buildBetaDetails:${b.relationships?.buildBetaDetail?.data?.id}`)
  console.log(
    [
      `  ${pre?.attributes?.version ?? '?'} (${a.version})`,
      `processing=${a.processingState}`,
      `internal=${bbd?.attributes?.internalBuildState ?? '—'}`,
      `external=${bbd?.attributes?.externalBuildState ?? '—'}`,
      `expired=${a.expired}`,
      `encryption=${a.usesNonExemptEncryption}`,
      `uploaded=${a.uploadedDate}`,
    ].join('  '),
  )
}
if ((builds.data ?? []).length === 0) console.log('  (none — a just-uploaded build is not listed until Apple starts processing)')

const vers = await get(`/v1/apps/${appId}/appStoreVersions?limit=3`)
console.log('\n=== App Store version records ===')
for (const v of vers.data ?? []) {
  console.log(`  ${v.attributes.versionString}  state=${v.attributes.appStoreState}`)
}
console.log()
