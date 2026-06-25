#!/usr/bin/env bun
// Pull ALL TestFlight tester feedback (screenshots + written comments, optionally crash reports) for
// an app out of App Store Connect and onto disk, so it can be read/triaged locally — e.g. handed to
// Claude Code, which renders the screenshots and reads the comment markdown.
//
// WHY a script: App Store Connect's web UI downloads ONE feedback item at a time — there is NO bulk
// "select all" export (Apple Developer Forums thread 130157). This is the "grab everything" path: the
// OFFICIAL JWT-authed App Store Connect API (`/v1/apps/{id}/betaFeedbackScreenshotSubmissions`, shipped
// WWDC25). It is NOT the old private `iris/v1/betaFeedbacks` endpoint that needed a `fastlane spaceauth`
// web-session cookie — that hack predates the official API and can't use a JWT.
//
// Read-only: hits Apple's API and downloads presigned screenshot URLs. Spends NO GCP credits and writes
// NOTHING back to Apple, so unlike the paid studio pipeline it does NOT need a founder "go".
//
// ── One-time setup ──────────────────────────────────────────────────────────────────────────────────
//   1. App Store Connect → Users and Access → Integrations → App Store Connect API → Team Keys →
//      generate a key with role App Manager (or Admin). You get an Issuer ID, a Key ID, and a ONE-TIME
//      `.p8` download (Apple won't show it again).
//   2. Drop the file in keys/ (gitignored): keys/AuthKey_<KEYID>.p8
//   3. Tell the script who you are, either via dotenvx (`dotenvx set ASC_KEY_ID … -f .env.development`)
//      or plain exported env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_APP_ID. (.p8 path defaults to
//      keys/AuthKey_<KEYID>.p8.) Once these are set the pull is a single no-arg command.
//
// ── Run ─────────────────────────────────────────────────────────────────────────────────────────────
//   bun run tf:feedback                  # pull EVERYTHING (screenshots+comments+crashes) for ASC_APP_ID
//   bun run tf:feedback -- --list-apps   # list apps + numeric ids
//   bun run tf:feedback -- --app <id>    # override the app id; --no-crashes for screenshots only
//
// Auth = an ES256 JWT signed with the .p8 via Web Crypto — crypto.subtle's ECDSA signature is already
// raw r‖s (JOSE format), so no `jsonwebtoken`/`jose` dependency is needed. Tokens last 20 min (Apple's
// ceiling). Screenshot URLs are presigned with a short `expirationDate`, fetched WITHOUT the JWT and
// promptly — so don't sit on a half-finished run.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'https://api.appstoreconnect.apple.com'
const AUD = 'appstoreconnect-v1'

// ── args ──────────────────────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const has = (name: string) => argv.includes(`--${name}`)

if (has('help')) {
  console.log(
    [
      'Pull TestFlight tester feedback (screenshots + comments + crashes) → disk.',
      '',
      'Usage:',
      '  bun run tf:feedback                  # pull EVERYTHING for ASC_APP_ID → ./testflight-feedback/',
      '  bun run tf:feedback -- --list-apps   # list apps + numeric ids',
      '  bun run tf:feedback -- --app <id>    # override the app',
      '  bun run tf:feedback -- --no-crashes  # screenshots only',
      '',
      'Auth (one-time, see header comment):',
      '  ASC_KEY_ID / ASC_ISSUER_ID / ASC_APP_ID  (env or dotenvx) + keys/AuthKey_<KEYID>.p8',
      '  override with --key-id, --issuer-id, --key <p8 path>, --app, --out',
    ].join('\n'),
  )
  process.exit(0)
}

const keyId = flag('key-id') ?? process.env.ASC_KEY_ID
const issuerId = flag('issuer-id') ?? process.env.ASC_ISSUER_ID
const keyPath = flag('key') ?? process.env.ASC_API_KEY_PATH ?? (keyId ? `keys/AuthKey_${keyId}.p8` : undefined)
const appId = flag('app') ?? process.env.ASC_APP_ID
const outDir = flag('out') ?? './testflight-feedback'

function die(msg: string): never {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}

if (!keyId || !issuerId) {
  die(
    'Missing credentials. Set ASC_KEY_ID and ASC_ISSUER_ID (env or `dotenvx set … -f .env.development`),\n' +
      '  generate the key at App Store Connect → Users and Access → Integrations → App Store Connect API.\n' +
      '  See the header comment in this file for the full one-time setup.',
  )
}
if (!keyPath || !existsSync(keyPath)) {
  die(`Private key not found at "${keyPath}". Drop the .p8 in keys/ (gitignored) or pass --key <path>.`)
}

// ── auth: ES256 JWT via Web Crypto (raw r‖s sig = JOSE, no dep) ──────────────────────────────────────
async function importP8(pem: string): Promise<CryptoKey> {
  const der = Buffer.from(
    pem.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s+/g, ''),
    'base64',
  )
  return crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
}

let cachedKey: CryptoKey | null = null
let token = ''
let tokenIat = 0
async function jwt(): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  if (token && now - tokenIat < 60 * 18) return token // reuse until ~2 min before the 20-min ceiling
  cachedKey ??= await importP8(readFileSync(keyPath!, 'utf8'))
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const head = b64({ alg: 'ES256', kid: keyId, typ: 'JWT' })
  const body = b64({ iss: issuerId, iat: now, exp: now + 60 * 20, aud: AUD })
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    cachedKey,
    new TextEncoder().encode(`${head}.${body}`),
  )
  token = `${head}.${body}.${Buffer.from(new Uint8Array(sig)).toString('base64url')}`
  tokenIat = now
  return token
}

// ── API: GET with bearer + light retry on 429/5xx ───────────────────────────────────────────────────
async function ascGet(pathOrUrl: string): Promise<any> {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${BASE}${pathOrUrl}`
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${await jwt()}` } })
    if (res.ok) return res.json()
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt))
      continue
    }
    const detail = (await res.text()).slice(0, 600)
    if (res.status === 401 || res.status === 403) {
      die(
        `App Store Connect returned ${res.status} (auth/permission).\n` +
          '  → Check ASC_ISSUER_ID + ASC_KEY_ID match the .p8, and the key role can see this app\n' +
          `  → (App Manager/Admin). Response: ${detail}`,
      )
    }
    die(`ASC ${res.status} ${url}\n${detail}`)
  }
}

// Walk `links.next` until exhausted; merge each page's `included` so we can name testers/builds.
async function listAll(path: string): Promise<{ data: any[]; included: any[] }> {
  const data: any[] = []
  const included: any[] = []
  let next: string | null = path
  while (next) {
    const page = await ascGet(next)
    data.push(...(page.data ?? []))
    included.push(...(page.included ?? []))
    next = page.links?.next ?? null
  }
  return { data, included }
}

const ts = () => new Date().toISOString().slice(0, 16).replace('T', ' ')

// ── --list-apps ─────────────────────────────────────────────────────────────────────────────────────
async function listApps() {
  const { data } = await listAll('/v1/apps?fields[apps]=name,bundleId,sku&limit=200')
  if (!data.length) return console.log('No apps visible to this API key.')
  console.log('\nApps visible to this key (use the id with --app):\n')
  for (const a of data) {
    console.log(`  ${a.id}  ${a.attributes?.name ?? '?'}  (${a.attributes?.bundleId ?? '?'})`)
  }
  console.log('')
}

// ── download presigned screenshot bytes (no auth header) ────────────────────────────────────────────
async function download(url: string, dest: string) {
  const res = await fetch(url)
  if (!res.ok) {
    console.warn(`  ! screenshot ${res.status} — skipped (presigned URL may have expired): ${dest}`)
    return false
  }
  const ext = (res.headers.get('content-type') ?? '').includes('jpeg') ? 'jpg' : 'png'
  const path = `${dest}.${ext}`
  writeFileSync(path, Buffer.from(await res.arrayBuffer()))
  return path
}

function indexBy(included: any[]) {
  const map = new Map<string, any>()
  for (const r of included) map.set(`${r.type}:${r.id}`, r)
  const testerName = (rel: any) => {
    const r = rel?.tester?.data && map.get(`betaTesters:${rel.tester.data.id}`)
    if (!r) return undefined
    const n = [r.attributes?.firstName, r.attributes?.lastName].filter(Boolean).join(' ').trim()
    return n || r.attributes?.email
  }
  const buildVer = (rel: any) => {
    const r = rel?.build?.data && map.get(`builds:${rel.build.data.id}`)
    return r?.attributes?.version
  }
  return { testerName, buildVer }
}

// ── pull screenshot feedback ────────────────────────────────────────────────────────────────────────
async function pullScreenshots(appId: string) {
  console.log(`→ Fetching screenshot feedback for app ${appId} …`)
  const { data, included } = await listAll(
    `/v1/apps/${appId}/betaFeedbackScreenshotSubmissions?limit=200&sort=-createdDate&include=build,tester`,
  )
  const { testerName, buildVer } = indexBy(included)
  console.log(`  ${data.length} feedback item(s).`)

  mkdirSync(join(outDir, 'screenshots'), { recursive: true })
  const records: any[] = []
  const md: string[] = [`# TestFlight screenshot feedback — app ${appId}`, `_Pulled ${ts()} · ${data.length} item(s)_`, '']

  for (const s of data) {
    const a = s.attributes ?? {}
    const tester = testerName(s.relationships) ?? a.email ?? 'unknown tester'
    const build = buildVer(s.relationships)
    const shots = a.screenshots ?? []
    const dir = join(outDir, 'screenshots', s.id)
    const images: string[] = []
    if (shots.length) mkdirSync(dir, { recursive: true })
    for (let i = 0; i < shots.length; i++) {
      const p = await download(shots[i].url, join(dir, `${i + 1}`))
      if (p) images.push(p)
    }
    records.push({ id: s.id, ...a, tester, build, images })

    md.push(`## ${a.createdDate?.slice(0, 16).replace('T', ' ') ?? '?'} — ${tester}`)
    md.push(
      `**Device:** ${a.deviceModel ?? '?'} · **OS:** ${a.osVersion ?? '?'}` +
        (build ? ` · **Build:** ${build}` : '') +
        (a.locale ? ` · ${a.locale}` : ''),
    )
    md.push('')
    md.push(a.comment ? `> ${a.comment.replace(/\n/g, '\n> ')}` : '_(no written comment)_')
    md.push('')
    for (const img of images) md.push(`![screenshot](${img.replace(`${outDir}/`, '')})`)
    md.push('', '---', '')
  }

  writeFileSync(join(outDir, 'feedback.json'), JSON.stringify(records, null, 2))
  writeFileSync(join(outDir, 'feedback.md'), md.join('\n'))
  const imgCount = records.reduce((n, r) => n + r.images.length, 0)
  console.log(`  ✓ ${data.length} item(s), ${imgCount} screenshot(s) → ${outDir}/feedback.md`)
}

// ── pull crash feedback (metadata + comment + symbolicated log text) ─────────────────────────────────
async function pullCrashes(appId: string) {
  console.log(`→ Fetching crash feedback for app ${appId} …`)
  const { data, included } = await listAll(
    `/v1/apps/${appId}/betaFeedbackCrashSubmissions?limit=200&sort=-createdDate&include=build,tester`,
  )
  const { testerName, buildVer } = indexBy(included)
  console.log(`  ${data.length} crash item(s).`)
  if (!data.length) return

  mkdirSync(join(outDir, 'crashes'), { recursive: true })
  const records: any[] = []
  const md: string[] = [`# TestFlight crash feedback — app ${appId}`, `_Pulled ${ts()} · ${data.length} item(s)_`, '']

  for (const c of data) {
    const a = c.attributes ?? {}
    const tester = testerName(c.relationships) ?? a.email ?? 'unknown tester'
    const build = buildVer(c.relationships)
    let logText = ''
    try {
      const log = await ascGet(`/v1/betaFeedbackCrashSubmissions/${c.id}/crashLog`)
      logText = log.data?.attributes?.logText ?? ''
      if (logText) writeFileSync(join(outDir, 'crashes', `${c.id}.crash`), logText)
    } catch {
      // a crash submission can lack a downloadable log; keep the metadata regardless
    }
    records.push({ id: c.id, ...a, tester, build, hasLog: Boolean(logText) })

    md.push(`## ${a.createdDate?.slice(0, 16).replace('T', ' ') ?? '?'} — ${tester}`)
    md.push(`**Device:** ${a.deviceModel ?? '?'} · **OS:** ${a.osVersion ?? '?'}` + (build ? ` · **Build:** ${build}` : ''))
    md.push('')
    md.push(a.comment ? `> ${a.comment.replace(/\n/g, '\n> ')}` : '_(no written comment)_')
    if (logText) md.push('', `Crash log: \`crashes/${c.id}.crash\``)
    md.push('', '---', '')
  }

  writeFileSync(join(outDir, 'crashes.json'), JSON.stringify(records, null, 2))
  writeFileSync(join(outDir, 'crashes.md'), md.join('\n'))
  console.log(`  ✓ ${data.length} crash(es) → ${outDir}/crashes.md`)
}

// ── main ────────────────────────────────────────────────────────────────────────────────────────────
if (has('list-apps')) {
  await listApps()
} else {
  if (!appId) die('No app id. Run with --list-apps to find it, then pass --app <id> (or set ASC_APP_ID).')
  mkdirSync(outDir, { recursive: true })
  await pullScreenshots(appId)
  if (!has('no-crashes')) await pullCrashes(appId)
  console.log(`\nDone. Point Claude Code at:  ${outDir}\n`)
}
