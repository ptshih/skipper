#!/usr/bin/env bun
// READ-ONLY / VERIFICATION: App Store Connect build query and readiness monitor.
// Run from the repo root:
//   dotenvx run -f .env.development --quiet -- bun .claude/skills/testflight/asc-builds.ts
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────
// An exit code from an upload tool (eas, altool, etc.) only means the binary reached Apple's ingestion
// endpoint. Apple then processes it for 5-15 minutes and can reject it (missing entitlements, missing
// export compliance, bad provisioning, etc.). Only App Store Connect reporting `processingState=VALID`
// and `internalBuildState=IN_BETA_TESTING` proves a tester can actually install the build.
//
// Writes nothing, spends nothing. Auth uses the ASC API key (ASC_KEY_ID / ASC_ISSUER_ID / ASC_APP_ID
// + keys/AuthKey_<KEYID>.p8 or ASC_API_KEY_PATH).
//
// Numeric build ordering: ASC's `version` is a string attribute, and `sort=-version` can order lexically
// rather than numerically. Build numbers are parsed and compared as integers.
//
// Flags:
//   (no args)             List 5 recent builds and App Store versions (table view)
//   --latest-build        Print only the highest numeric build number found on ASC
//   --json                Output recent builds as JSON
//   --wait                Wait until a build reaches VALID + IN_BETA_TESTING
//     --version <v>       Expected marketing version (e.g. 1.2.0)
//     --build <b>         Expected build number (e.g. 27)
//     --timeout <s>       Max seconds to wait (default: 1200)
//     --interval <s>      Poll interval in seconds (default: 20)
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

export const ASC_BASE_URL = 'https://api.appstoreconnect.apple.com'
export const ASC_AUDIENCE = 'appstoreconnect-v1'

export interface AscBuildInfo {
  id: string
  buildVersion: string
  preReleaseVersion?: string
  processingState: string
  internalBuildState?: string
  externalBuildState?: string
  expired?: boolean
  usesNonExemptEncryption?: boolean | null
  uploadedDate?: string
  raw?: any
}

export interface AscAuthConfig {
  keyId: string
  issuerId: string
  keyPath: string
  appId: string
}

export function readAscConfigFromEnv(env: Record<string, string | undefined> = process.env): AscAuthConfig {
  const keyId = env.ASC_KEY_ID
  const issuerId = env.ASC_ISSUER_ID
  const rawKeyPath = env.ASC_API_KEY_PATH ?? (keyId ? `keys/AuthKey_${keyId}.p8` : undefined)
  const keyPath = rawKeyPath ? resolve(rawKeyPath) : undefined
  const appId = env.ASC_APP_ID

  if (!keyId || !issuerId || !appId) {
    throw new Error('Missing ASC_KEY_ID / ASC_ISSUER_ID / ASC_APP_ID — run under `dotenvx run -f .env.development`.')
  }
  if (!keyPath || !existsSync(keyPath)) {
    throw new Error(`Private key not found at "${keyPath}". The .p8 lives in keys/ (gitignored); get it from a teammate.`)
  }

  return { keyId, issuerId, keyPath, appId }
}

export async function generateAscJwt(keyId: string, issuerId: string, pemKey: string): Promise<string> {
  const der = Buffer.from(
    pemKey
      .replace(/-----BEGIN PRIVATE KEY-----/, '')
      .replace(/-----END PRIVATE KEY-----/, '')
      .replace(/\s+/g, ''),
    'base64',
  )
  const key = await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
  const now = Math.floor(Date.now() / 1000)
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const head = b64({ alg: 'ES256', kid: keyId, typ: 'JWT' })
  const body = b64({ iss: issuerId, iat: now, exp: now + 1200, aud: ASC_AUDIENCE })
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(`${head}.${body}`),
  )
  return `${head}.${body}.${Buffer.from(new Uint8Array(sig)).toString('base64url')}`
}

export function parseAscBuilds(apiResponse: any): AscBuildInfo[] {
  const inc = new Map<string, any>((apiResponse.included ?? []).map((i: any) => [`${i.type}:${i.id}`, i]))
  const results: AscBuildInfo[] = []

  for (const b of apiResponse.data ?? []) {
    const a = b.attributes ?? {}
    const pre = inc.get(`preReleaseVersions:${b.relationships?.preReleaseVersion?.data?.id}`)
    const bbd = inc.get(`buildBetaDetails:${b.relationships?.buildBetaDetail?.data?.id}`)
    results.push({
      id: b.id,
      buildVersion: a.version ?? '',
      preReleaseVersion: pre?.attributes?.version,
      processingState: a.processingState ?? 'UNKNOWN',
      internalBuildState: bbd?.attributes?.internalBuildState,
      externalBuildState: bbd?.attributes?.externalBuildState,
      expired: a.expired,
      usesNonExemptEncryption: a.usesNonExemptEncryption,
      uploadedDate: a.uploadedDate,
      raw: b,
    })
  }

  return results
}

export function extractNumericBuildNumbers(builds: AscBuildInfo[]): number[] {
  const numbers: number[] = []
  for (const b of builds) {
    const n = Number(b.buildVersion)
    if (/^[1-9]\d*$/.test(b.buildVersion) && Number.isSafeInteger(n)) {
      numbers.push(n)
    }
  }
  return numbers.sort((a, b) => b - a)
}

export function getLatestBuildNumber(builds: AscBuildInfo[]): number {
  const nums = extractNumericBuildNumbers(builds)
  return nums[0] ?? 0
}

export function evaluateBuildReadiness(
  build: AscBuildInfo,
  options: { expectedVersion?: string } | string = {},
): {
  isReady: boolean
  isTerminalFailure: boolean
  reason: string
} {
  const expectedVer = typeof options === 'string' ? options : options.expectedVersion
  if (expectedVer) {
    if (!build.preReleaseVersion) {
      return {
        isReady: false,
        isTerminalFailure: false,
        reason: `Build marketing version is not yet resolved in App Store Connect (waiting for "${expectedVer}")`,
      }
    }
    if (build.preReleaseVersion !== expectedVer) {
      return {
        isReady: false,
        isTerminalFailure: true,
        reason: `Build marketing version mismatch in App Store Connect: expected "${expectedVer}", got "${build.preReleaseVersion}"`,
      }
    }
  }

  const state = (build.processingState || '').toUpperCase()

  if (state === 'FAILED' || state === 'INVALID') {
    return {
      isReady: false,
      isTerminalFailure: true,
      reason: `Build processing failed in App Store Connect with state: ${state}`,
    }
  }

  if (build.expired === true) {
    return {
      isReady: false,
      isTerminalFailure: true,
      reason: 'Build is marked expired in App Store Connect',
    }
  }

  if (state === 'PROCESSING') {
    return {
      isReady: false,
      isTerminalFailure: false,
      reason: 'Build is still processing in App Store Connect',
    }
  }

  if (state === 'VALID') {
    const internal = build.internalBuildState
    if (internal === 'IN_BETA_TESTING') {
      if (build.usesNonExemptEncryption === null || build.usesNonExemptEncryption === undefined) {
        return {
          isReady: false,
          isTerminalFailure: false,
          reason: 'Build is VALID but export compliance / encryption status is still pending',
        }
      }
      return {
        isReady: true,
        isTerminalFailure: false,
        reason: 'Build is VALID, encryption answered, and internal testers can install (IN_BETA_TESTING)',
      }
    }
    return {
      isReady: false,
      isTerminalFailure: false,
      reason: `Build is VALID but internal build state is "${internal ?? 'none'}" (waiting for IN_BETA_TESTING)`,
    }
  }

  return {
    isReady: false,
    isTerminalFailure: false,
    reason: `Build processing state is "${state}" (waiting for VALID)`,
  }
}

export async function fetchAscBuilds(
  appIdOrOptions: string | { appId: string; token: string; limit?: number; fetchFn?: typeof fetch; maxPages?: number },
  tokenArg?: string,
  optionsArg: { limit?: number; fetchFn?: typeof fetch; maxPages?: number } = {},
): Promise<AscBuildInfo[]> {
  let appId: string
  let token: string
  let options: { limit?: number; fetchFn?: typeof fetch; maxPages?: number }

  if (typeof appIdOrOptions === 'object' && appIdOrOptions !== null) {
    appId = appIdOrOptions.appId
    token = appIdOrOptions.token
    options = appIdOrOptions
  } else {
    appId = appIdOrOptions
    token = tokenArg ?? ''
    options = optionsArg
  }

  const limit = options.limit ?? 50
  const maxPages = options.maxPages ?? 100
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) throw new Error('Invalid ASC pagination limit')
  const fetcher = options.fetchFn ?? fetch
  let nextUrl: string | undefined = `${ASC_BASE_URL}/v1/builds?filter[app]=${appId}&limit=${limit}&sort=-version&include=preReleaseVersion,buildBetaDetail`

  const allBuilds: AscBuildInfo[] = []
  let pagesFetched = 0
  const visited = new Set<string>()

  while (nextUrl && pagesFetched < maxPages) {
    const url = new URL(nextUrl, ASC_BASE_URL)
    if (url.origin !== ASC_BASE_URL || url.pathname !== '/v1/builds' || url.username || url.password) {
      throw new Error('ASC returned an untrusted build pagination URL')
    }
    if (visited.has(url.href)) throw new Error('ASC build pagination repeated a page; maximum build is unknown')
    visited.add(url.href)
    const res: Response = await fetcher(nextUrl, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 400)
      throw new Error(`ASC fetch error (${res.status}): ${detail}`)
    }

    const json: any = await res.json()
    const pageBuilds = parseAscBuilds(json)
    allBuilds.push(...pageBuilds)
    pagesFetched++

    nextUrl = typeof json.links?.next === 'string' && json.links.next.length > 0 ? json.links.next : undefined
  }

  if (nextUrl) throw new Error(`ASC build enumeration exceeded ${maxPages} pages; maximum build is unknown`)

  return allBuilds
}

export async function fetchAppStoreVersions(
  appId: string,
  token: string,
  options: { limit?: number; fetchFn?: typeof fetch } = {},
): Promise<Array<{ versionString: string; appStoreState: string }>> {
  const limit = options.limit ?? 5
  const fetcher = options.fetchFn ?? fetch
  const url = `${ASC_BASE_URL}/v1/apps/${appId}/appStoreVersions?limit=${limit}`

  const res = await fetcher(url, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 400)
    throw new Error(`ASC appStoreVersions error (${res.status}): ${detail}`)
  }

  const json = (await res.json()) as any
  return (json.data ?? []).map((v: any) => ({
    versionString: v.attributes?.versionString ?? '',
    appStoreState: v.attributes?.appStoreState ?? '',
  }))
}

export async function waitForBuildReadiness(options: {
  appId: string
  token: string
  expectedBuild: string | number
  expectedVersion?: string
  timeoutSeconds?: number
  pollIntervalSeconds?: number
  fetchFn?: typeof fetch
  logger?: (msg: string) => void
  sleepFn?: (ms: number) => Promise<void>
}): Promise<AscBuildInfo> {
  const targetBuildStr = String(options.expectedBuild)
  const timeoutMs = (options.timeoutSeconds ?? 1200) * 1000
  const pollIntervalMs = (options.pollIntervalSeconds ?? 20) * 1000
  const logger = options.logger ?? ((msg: string) => console.log(msg))
  const sleeper = options.sleepFn ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  const startTime = Date.now()

  logger(`Waiting for build ${options.expectedVersion ?? ''} (${targetBuildStr}) in ASC... (timeout: ${Math.round(timeoutMs / 1000)}s)`)

  while (true) {
    const elapsedSeconds = Math.round((Date.now() - startTime) / 1000)
    if (Date.now() - startTime > timeoutMs) {
      throw new Error(`Timed out after ${elapsedSeconds}s waiting for build ${targetBuildStr} to reach VALID and IN_BETA_TESTING`)
    }

    const builds = await fetchAscBuilds(options.appId, options.token, { fetchFn: options.fetchFn })
    const match = builds.find((b) => {
      const matchBuild = b.buildVersion === targetBuildStr
      if (!matchBuild) return false
      if (options.expectedVersion) {
        return b.preReleaseVersion === options.expectedVersion
      }
      return true
    })

    if (!match) {
      logger(`[${elapsedSeconds}s] Build ${targetBuildStr} not yet listed on App Store Connect (Apple ingestion queued)...`)
      await sleeper(pollIntervalMs)
      continue
    }

    const evalResult = evaluateBuildReadiness(match, { expectedVersion: options.expectedVersion })
    if (evalResult.isTerminalFailure) {
      throw new Error(`Build ${targetBuildStr} terminated in failure: ${evalResult.reason}`)
    }

    if (evalResult.isReady) {
      logger(`[${elapsedSeconds}s] Build ${targetBuildStr} is ready: ${evalResult.reason}`)
      return match
    }

    logger(`[${elapsedSeconds}s] Build ${targetBuildStr} state: ${evalResult.reason}`)
    await sleeper(pollIntervalMs)
  }
}

// ── CLI Execution ──────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const has = (flag: string) => argv.includes(`--${flag}`)
  const getFlag = (flag: string): string | undefined => {
    const idx = argv.indexOf(`--${flag}`)
    return idx >= 0 ? argv[idx + 1] : undefined
  }

  const isWait = has('wait')
  const isLatestBuild = has('latest-build')
  const isJson = has('json')
  const expectedVersion = getFlag('version')
  const expectedBuild = getFlag('build')
  const timeoutSec = getFlag('timeout') ? Number.parseInt(getFlag('timeout')!, 10) : 1200
  const intervalSec = getFlag('interval') ? Number.parseInt(getFlag('interval')!, 10) : 20

  const config = readAscConfigFromEnv()
  const pem = readFileSync(config.keyPath, 'utf8')
  const token = await generateAscJwt(config.keyId, config.issuerId, pem)

  if (isWait) {
    if (!expectedBuild) {
      console.error('Error: --wait requires --build <number>')
      process.exit(1)
    }
    try {
      await waitForBuildReadiness({
        appId: config.appId,
        token,
        expectedBuild,
        expectedVersion,
        timeoutSeconds: timeoutSec,
        pollIntervalSeconds: intervalSec,
      })
      process.exit(0)
    } catch (err: any) {
      console.error(`\n✗ ${err.message}\n`)
      process.exit(1)
    }
  }

  const builds = await fetchAscBuilds(config.appId, token, { limit: 15 })

  if (isLatestBuild) {
    const latest = getLatestBuildNumber(builds)
    console.log(latest)
    process.exit(0)
  }

  if (isJson) {
    console.log(JSON.stringify(builds, null, 2))
    process.exit(0)
  }

  console.log('\n=== Recent ASC builds ===')
  for (const b of builds.slice(0, 8)) {
    console.log(
      [
        `  ${b.preReleaseVersion ?? '?'} (${b.buildVersion})`,
        `processing=${b.processingState}`,
        `internal=${b.internalBuildState ?? '—'}`,
        `external=${b.externalBuildState ?? '—'}`,
        `expired=${b.expired}`,
        `encryption=${b.usesNonExemptEncryption}`,
        `uploaded=${b.uploadedDate}`,
      ].join('  '),
    )
  }
  if (builds.length === 0) {
    console.log('  (none — a just-uploaded build is not listed until Apple starts processing)')
  }

  try {
    const versions = await fetchAppStoreVersions(config.appId, token, { limit: 3 })
    console.log('\n=== App Store version records ===')
    for (const v of versions) {
      console.log(`  ${v.versionString}  state=${v.appStoreState}`)
    }
    console.log()
  } catch (e: any) {
    console.log(`  (could not fetch App Store versions: ${e.message})`)
  }
}

if (import.meta.main) {
  await main()
}
