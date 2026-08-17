// ASC review-state sweep — the read-only "what does Apple think right now" check, promoted from a
// 2026-08-17 scratch script because every review round needs it (docs/guides/app-store-submission.md
// §14c calls it "the sweep to re-run next time"; §15 used it to prove a Resolution Center reply
// alone does not requeue a submission).
//
//   bun run asc:state                          read-only sweep (default)
//   bun run asc:state -- --set-demo-creds      preview the demo-credential write
//   bun run asc:state -- --set-demo-creds --apply   PATCH demo name+password from env, read back
//
// What the sweep prints, and why each line earns its place:
//   • reviewSubmissions + their items — THE honest signal. The version-level state drifts with
//     founder clicks (§14c observed REJECTED → READY_FOR_REVIEW in twelve minutes, read-only);
//     the submission state does not. An item state of REMOVED is what a withdrawn version looks like.
//   • appStoreVersions — the drifting state, printed for the diff against the submission.
//   • appStoreReviewDetail — demo account name, whether the "password" field matches
//     REVIEW_OTP_CODE (⚠ since 2026-08-17 that field carries the FIXED sign-in code — §15d; the
//     account is passwordless and the code is its one credential), and the notes length.
//
// `--set-demo-creds` exists for the two recurring moments §15d predicts: the code rotates, or a
// reviewer deletes the demo account (deletion is self-healing via re-sign-in, after which nothing
// needs this — but a rotated REVIEW_OTP_CODE must be pushed here or ASC shows a dead code).
//
// ⚠ Self-contained ES256 JWT, deliberately — the same knowing duplication asc-metadata.ts and
// pull-testflight-feedback.ts already share, kept because each script must run alone under dotenvx.
// ⚠ appStoreReviewDetail hangs off the VERSION, not the app (the app-level relationship 404s), and
// reviewSubmissions filter by app. Both cost a false alarm once; see §14c's PATH_ERROR note.
import { existsSync, readFileSync } from 'node:fs'

const BASE = 'https://api.appstoreconnect.apple.com'

const argv = process.argv.slice(2)
const SET_DEMO = argv.includes('--set-demo-creds')
const APPLY = argv.includes('--apply')

const keyId = process.env.ASC_KEY_ID
const issuerId = process.env.ASC_ISSUER_ID
const appId = process.env.ASC_APP_ID
const keyPath = process.env.ASC_API_KEY_PATH ?? (keyId ? `keys/AuthKey_${keyId}.p8` : undefined)

function die(msg: string): never {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}
if (!keyId || !issuerId || !appId) die('Set ASC_KEY_ID, ASC_ISSUER_ID and ASC_APP_ID (dotenvx does this).')
if (!keyPath || !existsSync(keyPath)) die(`Private key not found at "${keyPath}".`)

let cachedKey: CryptoKey | null = null
async function jwt(): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  cachedKey ??= await crypto.subtle.importKey(
    'pkcs8',
    Buffer.from(
      readFileSync(keyPath!, 'utf8')
        .replace(/-----BEGIN PRIVATE KEY-----/, '')
        .replace(/-----END PRIVATE KEY-----/, '')
        .replace(/\s+/g, ''),
      'base64',
    ),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const head = b64({ alg: 'ES256', kid: keyId, typ: 'JWT' })
  const body = b64({ iss: issuerId, iat: now, exp: now + 60 * 20, aud: 'appstoreconnect-v1' })
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    cachedKey!,
    new TextEncoder().encode(`${head}.${body}`),
  )
  return `${head}.${body}.${Buffer.from(new Uint8Array(sig)).toString('base64url')}`
}

async function asc(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await jwt()}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 204) return {}
  const text = await res.text()
  if (!res.ok) die(`ASC ${res.status} ${method} ${path}\n${text.slice(0, 600)}`)
  return text ? JSON.parse(text) : {}
}

// ── the sweep ────────────────────────────────────────────────────────────────────────────────────
console.log('\nREVIEW SUBMISSIONS (the honest state)')
const subs = await asc('GET', `/v1/reviewSubmissions?filter[app]=${appId}&limit=5`)
for (const s of subs.data ?? []) {
  console.log(`  ${s.id.slice(0, 8)}  ${s.attributes.state}  submitted ${s.attributes.submittedDate ?? '—'}`)
  const items = await asc('GET', `/v1/reviewSubmissions/${s.id}/items?limit=5`)
  for (const it of items.data ?? []) console.log(`    item ${it.attributes.state}`)
}

console.log('\nVERSIONS (drifts with UI clicks — diff against the submission above)')
const versions = await asc('GET', `/v1/apps/${appId}/appStoreVersions?limit=3`)
for (const v of versions.data ?? []) {
  console.log(`  ${v.attributes.versionString}  ${v.attributes.appStoreState}`)
}

const version = versions.data?.[0]
if (!version) die('no appStoreVersion at all')

// The build, because a resubmit that silently swaps it re-opens §9's screenshots and §10's notes
// (both verified against ONE commit) — §14c lists this check for exactly that reason.
const build = (await asc('GET', `/v1/appStoreVersions/${version.id}/build`)).data
console.log(
  build
    ? `\nBUILD on ${version.attributes.versionString}: ${build.attributes.version} (${build.attributes.processingState}${build.attributes.expired ? ', EXPIRED' : ''})`
    : `\nBUILD on ${version.attributes.versionString}: ⚠ NONE ATTACHED`,
)

const detail = (await asc('GET', `/v1/appStoreVersions/${version.id}/appStoreReviewDetail`)).data
const a = detail.attributes
const code = process.env.REVIEW_OTP_CODE
const pwState =
  a.demoAccountPassword == null
    ? 'UNSET'
    : code
      ? a.demoAccountPassword === code
        ? 'matches REVIEW_OTP_CODE ✓'
        : '⚠ set but does NOT match REVIEW_OTP_CODE'
      : 'set (REVIEW_OTP_CODE absent locally, cannot compare)'
console.log(`\nAPP REVIEW INFORMATION (on ${version.attributes.versionString})`)
console.log(`  demo account   ${a.demoAccountName ?? '—'}  required=${a.demoAccountRequired}`)
console.log(`  demo password  ${pwState}`)
console.log(`  notes          ${a.notes?.length ?? 0} chars`)

// ── the one write, opt-in and previewed ──────────────────────────────────────────────────────────
if (SET_DEMO) {
  if (!code) die('--set-demo-creds needs REVIEW_OTP_CODE in env (dotenvx provides it).')
  console.log(`\n--set-demo-creds: review@skipper.fm / <REVIEW_OTP_CODE> on ${version.attributes.versionString}`)
  if (!APPLY) {
    console.log('  PREVIEW ONLY — re-run with --apply to write.')
  } else {
    await asc('PATCH', `/v1/appStoreReviewDetails/${detail.id}`, {
      data: {
        type: 'appStoreReviewDetails',
        id: detail.id,
        attributes: {
          demoAccountName: 'review@skipper.fm',
          demoAccountPassword: code,
          demoAccountRequired: true,
        },
      },
    })
    const after = (await asc('GET', `/v1/appStoreVersions/${version.id}/appStoreReviewDetail`)).data.attributes
    const ok = after.demoAccountName === 'review@skipper.fm' && after.demoAccountPassword === code
    if (!ok) die('read-back does not match what was written — check ASC by hand')
    console.log('  ✓ written and read back')
  }
}
console.log('')
