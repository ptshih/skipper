import { closeSync, existsSync, lstatSync, openSync, readSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'

export const BANNED_RUNTIME_PATTERNS = [
  /hermes\.framework/i,
  /react\.framework/i,
  /reactcommon\.framework/i,
  /expo\.framework/i,
  /expomodulescore\.framework/i,
  /main\.jsbundle/i,
  /index\.bundle/i,
  /app\.bundle/i,
  /assets\/node_modules/i,
  /assets\/_expo/i,
]

export interface IpaInspectionResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  bundleId: string
  version: string
  buildNumber: string
  minimumOSVersion: string
  teamId: string
  appIdentifier: string
  getTaskAllow: boolean
  codeSignatureValid: boolean
  executableEntitlements: Record<string, any>
  provisioningEntitlements: Record<string, any>
  associatedDomains: string[]
  keychainGroups: string[]
  apiUrl: string
  postHogHost: string
  scannedBinaries: string[]
  hasMapsKey: boolean
  hasPostHogKey: boolean
  hasPrivacyManifest: boolean
  hasBannedRuntimes: boolean
  bannedFilesFound: string[]
  bannedSymbolsFound: string[]
  atsExceptionsFound: string[]
  nativeScanEvidence: string
  frameworks: string[]
  executableUuids: string[]
  dsymUuids: string[]
  dsymUuidMatch: boolean
}

export function checkBannedFiles(relativePaths: string[]): {
  hasBanned: boolean
  banned: string[]
} {
  const banned: string[] = []
  for (const path of relativePaths) {
    for (const pattern of BANNED_RUNTIME_PATTERNS) {
      if (pattern.test(path)) {
        banned.push(path)
        break
      }
    }
  }
  return {
    hasBanned: banned.length > 0,
    banned,
  }
}

export function extractUuidsFromDwarfdumpOutput(output: string): string[] {
  // Output format from dwarfdump --uuid:
  // UUID: 12345678-ABCD-EF01-2345-6789ABCDEF01 (arm64) /path/to/binary
  const regex = /UUID:\s*([0-9A-Fa-f-]+)\s*\(([^)]+)\)/g
  const uuids: string[] = []
  let match: RegExpExecArray | null
  while ((match = regex.exec(output)) !== null) {
    const rawUuid = match[1]
    const arch = match[2]
    if (typeof rawUuid === 'string' && typeof arch === 'string') {
      uuids.push(`${arch.toLowerCase()}:${rawUuid.toUpperCase()}`)
    }
  }
  return uuids.sort()
}

export function matchDsymUuids(execUuids: string[], dsymUuids: string[]): boolean {
  if (execUuids.length === 0 || dsymUuids.length === 0) return false
  const dsymSet = new Set(dsymUuids)
  // Every architecture in the shipped executable binary must be covered by the archive dSYM bundle
  return execUuids.every((u) => dsymSet.has(u))
}

export function validateInspectionFields(
  data: Partial<IpaInspectionResult>,
  expected: {
    expectedVersion?: string
    expectedBuild?: string
    expectedTeamId?: string
    expectedBundleId?: string
    expectedApiUrl?: string
    expectedPostHogHost?: string
    minOsVersion?: string
    requireDsymMatch?: boolean
    requireProductionDistribution?: boolean
    requireSignatureValidity?: boolean
  } = {},
): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  const expectedBundleId = expected.expectedBundleId ?? 'fm.skipper.app'
  const expectedTeamId = expected.expectedTeamId ?? 'L24UJYJ5DK'
  const minOsRequired = expected.minOsVersion ?? '17.0'
  const canonicalApiUrl = expected.expectedApiUrl ?? 'https://api.skipper.fm'

  // 1. Bundle identifier (must not be empty and must match expected)
  if (!data.bundleId || data.bundleId.trim().length === 0) {
    errors.push('Missing bundle identifier (CFBundleIdentifier) in Info.plist')
  } else if (data.bundleId !== expectedBundleId) {
    errors.push(`Bundle identifier mismatch: expected "${expectedBundleId}", got "${data.bundleId}"`)
  }

  // 2. Marketing version
  if (expected.expectedVersion && data.version !== expected.expectedVersion) {
    errors.push(`Marketing version mismatch: expected "${expected.expectedVersion}", got "${data.version}"`)
  }

  // 3. Build number
  if (expected.expectedBuild && String(data.buildNumber) !== String(expected.expectedBuild)) {
    errors.push(`Build number mismatch: expected "${expected.expectedBuild}", got "${data.buildNumber}"`)
  }

  // 4. Team ID (must not be empty and must match expected)
  if (!data.teamId || data.teamId.trim().length === 0) {
    errors.push('Missing team identifier in signed executable entitlements / provisioning profile')
  } else if (data.teamId !== expectedTeamId) {
    errors.push(`Team identifier mismatch: expected "${expectedTeamId}", got "${data.teamId}"`)
  }

  // 5. Application identifier (must not be empty and must match expectedAppId)
  const expectedAppId = `${expectedTeamId}.${expectedBundleId}`
  if (!data.appIdentifier || data.appIdentifier.trim().length === 0) {
    errors.push('Missing application-identifier in signed executable entitlements')
  } else if (data.appIdentifier !== expectedAppId) {
    errors.push(`application-identifier mismatch: expected "${expectedAppId}", got "${data.appIdentifier}"`)
  }

  // 6. Distribution signing: get-task-allow MUST be false for production/App Store/TestFlight
  if (expected.requireProductionDistribution !== false && data.getTaskAllow === true) {
    errors.push('Signed executable has get-task-allow=true; distribution builds must be signed with get-task-allow=false')
  }

  // The first group is Keychain's default when callers omit kSecAttrAccessGroup.
  if (data.keychainGroups?.[0] !== expectedAppId) {
    errors.push(`Missing expected Keychain access group "${expectedAppId}" as the signed default group`)
  }
  if (!data.associatedDomains?.includes('webcredentials:skipper.fm')) {
    errors.push('Missing expected associated domain "webcredentials:skipper.fm" in signed entitlements')
  }

  // 9. Code signature validity
  if (expected.requireSignatureValidity !== false && data.codeSignatureValid !== true) {
    errors.push('Code signature verification failed (codesign --verify returned non-zero)')
  }

  // 10. Minimum OS version
  if (data.minimumOSVersion) {
    const osNum = Number.parseFloat(data.minimumOSVersion)
    const requiredNum = Number.parseFloat(minOsRequired)
    if (Number.isFinite(osNum) && osNum < requiredNum) {
      errors.push(`Minimum OS version too low: requires at least ${minOsRequired}, got ${data.minimumOSVersion}`)
    }
  } else {
    errors.push('Missing MinimumOSVersion in Info.plist')
  }

  // 11. Canonical Production API URL (coordinated with scripts/ios-configure.ts: production origin, no search/hash/subpath)
  let apiUrlValid = false
  if (data.apiUrl) {
    try {
      const parsed = new URL(data.apiUrl)
      const canonical = new URL(canonicalApiUrl)
      apiUrlValid = parsed.origin === canonical.origin &&
        ['', '/'].includes(parsed.pathname) &&
        !parsed.search && !parsed.hash && !parsed.username && !parsed.password
    } catch {
      apiUrlValid = false
    }
  }
  if (!apiUrlValid) {
    errors.push(`Invalid SkipperAPIURL: expected canonical production URL "${canonicalApiUrl}", got "${data.apiUrl}" (development/Tailscale URLs forbidden in production)`)
  }

  // 12. SDK keys
  if (data.hasMapsKey !== true) {
    errors.push('Missing SkipperGoogleMapsAPIKey in production binary')
  }

  if (data.hasPostHogKey !== true) {
    errors.push('Missing SkipperPostHogKey in production binary')
  }

  const expectedHost = expected.expectedPostHogHost ?? 'https://us.i.posthog.com'
  try {
    const actual = new URL(data.postHogHost ?? '')
    const configured = new URL(expectedHost)
    if (actual.protocol !== 'https:' || configured.protocol !== 'https:' || actual.href !== configured.href ||
        actual.username || actual.password || actual.search || actual.hash) throw new Error('Mismatch')
  } catch {
    errors.push('SkipperPostHogHost does not match the frozen production configuration')
  }

  // 13. App Transport Security development exceptions forbidden in production
  if (data.atsExceptionsFound && data.atsExceptionsFound.length > 0) {
    errors.push(`App Transport Security development exceptions forbidden in production IPA: ${data.atsExceptionsFound.join(', ')}`)
  }

  // 14. Banned runtimes (files)
  if (data.hasBannedRuntimes) {
    errors.push(`Found React Native / Expo runtime artifacts in native IPA: ${data.bannedFilesFound?.join(', ')}`)
  }

  // 15. Banned symbols / linkage
  if (data.bannedSymbolsFound && data.bannedSymbolsFound.length > 0) {
    errors.push(`Found React Native / Expo symbols or linked frameworks in Mach-O binary: ${data.bannedSymbolsFound.join(', ')}`)
  }

  // 16. Privacy manifest
  if (data.hasPrivacyManifest === false) {
    errors.push('Missing PrivacyInfo.xcprivacy in application bundle')
  }

  // 17. dSYM UUID match (complete architecture coverage required)
  if (expected.requireDsymMatch) {
    if (!data.dsymUuidMatch) {
      errors.push('Executable Mach-O UUIDs not fully covered by archive dSYM bundle or dSYM missing')
    }
  } else if (data.dsymUuids && data.dsymUuids.length > 0 && !data.dsymUuidMatch) {
    errors.push('Executable Mach-O UUIDs not fully covered by archive dSYM bundle')
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

function getAllFilesRecursive(dir: string, baseDir: string = dir): string[] {
  const files: string[] = []
  if (!existsSync(dir)) return files
  for (const item of readdirSync(dir)) {
    const fullPath = join(dir, item)
    const relPath = fullPath.slice(baseDir.length + 1)
    files.push(relPath)
    if (lstatSync(fullPath).isSymbolicLink()) {
      const target = relative(baseDir, realpathSync(fullPath))
      if (target.startsWith('../') || target === '..') throw new Error('IPA symlink escapes the application bundle')
    } else if (statSync(fullPath).isDirectory()) {
      files.push(...getAllFilesRecursive(fullPath, baseDir))
    }
  }
  return files
}

export type InspectionCommandRunner = (command: string[], options?: { stdin?: Uint8Array }) => {
  exitCode: number; stdout: Buffer; stderr: Buffer
}
export interface InspectionOptions {
  expectedVersion?: string
  expectedBuild?: string
  expectedTeamId?: string
  expectedBundleId?: string
  expectedApiUrl?: string
  expectedPostHogHost?: string
  archivePath?: string
  commandRunner?: InspectionCommandRunner
}

function isMachO(path: string): boolean {
  if (!statSync(path).isFile()) return false
  const descriptor = openSync(path, 'r')
  try {
    const magic = Buffer.alloc(4)
    if (readSync(descriptor, magic, 0, 4, 0) !== 4) return false
    return ['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca'].includes(magic.toString('hex'))
  } finally { closeSync(descriptor) }
}

function profileAllows(pattern: unknown, value: string): boolean {
  if (typeof pattern !== 'string') return false
  return pattern === value || (pattern.endsWith('*') && value.startsWith(pattern.slice(0, -1)))
}

export async function inspectIpa(ipaPath: string, options: InspectionOptions = {}): Promise<IpaInspectionResult> {
  const run: InspectionCommandRunner = options.commandRunner ?? ((cmd, args) => {
    const result = Bun.spawnSync(cmd, args)
    return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }
  })
  const resolvedIpa = resolve(ipaPath)
  if (!existsSync(resolvedIpa)) {
    throw new Error(`IPA not found at path: ${resolvedIpa}`)
  }

  const tmpExtract = await mkdtemp(join(tmpdir(), 'skipper-ipa-inspect-'))

  try {
    // 1. Unzip IPA
    const unzipProc = run(['unzip', '-q', resolvedIpa, '-d', tmpExtract])
    if (unzipProc.exitCode !== 0) {
      throw new Error(`Failed to extract IPA: unzip returned code ${unzipProc.exitCode}`)
    }

    const payloadDir = join(tmpExtract, 'Payload')
    if (!existsSync(payloadDir)) {
      throw new Error('Malformed IPA: no Payload directory found')
    }

    const appEntries = readdirSync(payloadDir).filter((e) => e.endsWith('.app'))
    const appEntry = appEntries[0]
    if (!appEntry || appEntries.length !== 1) {
      throw new Error('Malformed IPA: no .app bundle in Payload')
    }
    const appDir = realpathSync(join(payloadDir, appEntry))

    // 2. Read Info.plist via plutil
    const infoPlistPath = join(appDir, 'Info.plist')
    if (!existsSync(infoPlistPath)) {
      throw new Error('Malformed IPA: no Info.plist in application bundle')
    }
    const plutilProc = run(['plutil', '-convert', 'json', '-o', '-', infoPlistPath])
    if (plutilProc.exitCode !== 0) {
      throw new Error(`Failed to convert Info.plist to JSON via plutil (code ${plutilProc.exitCode})`)
    }
    const infoPlist = JSON.parse(plutilProc.stdout.toString('utf8'))

    const execName = infoPlist.CFBundleExecutable ?? 'Skipper'
    const execPath = join(appDir, execName)

    // 3. Verify code signature validity via codesign
    const csVerifyProc = run(['codesign', '--verify', '--deep', '--strict', '--verbose=2', appDir])
    const codeSignatureValid = csVerifyProc.exitCode === 0

    // 4. Extract actual signed executable entitlements via codesign
    if (!existsSync(execPath)) {
      throw new Error(`Executable binary not found at: ${execPath}`)
    }
    const csProc = run(['codesign', '-d', '--entitlements', '-', '--xml', execPath])
    if (csProc.exitCode !== 0) {
      throw new Error(`Failed to extract signed executable entitlements via codesign (code ${csProc.exitCode}): ${csProc.stderr.toString('utf8')}`)
    }
    const csOut = csProc.stdout.toString('utf8')
    const xmlIndex = csOut.indexOf('<?xml')
    if (xmlIndex === -1) {
      throw new Error('Codesign output did not contain valid XML entitlements')
    }
    const xmlContent = csOut.slice(xmlIndex)
    const plJsonProc = run(['plutil', '-convert', 'json', '-o', '-', '--', '-'], {
      stdin: Buffer.from(xmlContent, 'utf8'),
    })
    if (plJsonProc.exitCode !== 0) {
      throw new Error(`Failed to convert executable entitlements XML to JSON via plutil (code ${plJsonProc.exitCode}): ${plJsonProc.stderr.toString('utf8')}`)
    }
    let executableEntitlements: Record<string, any>
    try {
      executableEntitlements = JSON.parse(plJsonProc.stdout.toString('utf8'))
    } catch (err: any) {
      throw new Error(`Failed to parse executable entitlements JSON: ${err.message}`)
    }

    // 5. Read embedded.mobileprovision via security cms & plutil
    const provPath = join(appDir, 'embedded.mobileprovision')
    let provisioningEntitlements: Record<string, any> = {}
    let provisioningTeamId = ''
    if (existsSync(provPath)) {
      const secProc = run(['security', 'cms', '-D', '-i', provPath])
      if (secProc.exitCode !== 0) {
        throw new Error(`Failed to decode embedded.mobileprovision via security cms (code ${secProc.exitCode})`)
      }
      const entProc = run(['plutil', '-extract', 'Entitlements', 'json', '-o', '-', '--', '-'], {
        stdin: secProc.stdout,
      })
      if (entProc.exitCode !== 0) {
        throw new Error(`Failed to extract Entitlements from mobileprovision via plutil (code ${entProc.exitCode})`)
      }
      try {
        provisioningEntitlements = JSON.parse(entProc.stdout.toString('utf8'))
      } catch (err: any) {
        throw new Error(`Failed to parse provisioning Entitlements JSON: ${err.message}`)
      }

      const teamProc = run(['plutil', '-extract', 'TeamIdentifier', 'json', '-o', '-', '--', '-'], {
        stdin: secProc.stdout,
      })
      if (teamProc.exitCode !== 0) {
        throw new Error(`Failed to extract TeamIdentifier from mobileprovision via plutil (code ${teamProc.exitCode})`)
      }
      try {
        const teamArr = JSON.parse(teamProc.stdout.toString('utf8'))
        if (Array.isArray(teamArr) && typeof teamArr[0] === 'string') {
          provisioningTeamId = teamArr[0]
        }
      } catch (err: any) {
        throw new Error(`Failed to parse provisioning TeamIdentifier JSON: ${err.message}`)
      }
    } else {
      throw new Error('Malformed IPA: missing embedded.mobileprovision in application bundle')
    }

    // 6. File scan for banned runtimes
    const allFiles = getAllFilesRecursive(appDir)
    const bannedCheck = checkBannedFiles(allFiles)

    // Inspect every embedded Mach-O, including extension/framework executables, not just Skipper.
    if (!isMachO(execPath)) throw new Error('Application executable is not a Mach-O binary')
    const binaries = [...new Set(allFiles.map(path => join(appDir, path)).filter(isMachO).map(p => realpathSync(p).toString()))]
    const scannedBinaries: string[] = []
    const bannedSymbolsFound: string[] = []
    for (const binary of binaries) {
      const relativePath = relative(appDir, binary)
      for (const args of [['otool', '-L', binary], ['nm', '-a', binary]]) {
        const scan = run(args)
        if (scan.exitCode !== 0) throw new Error(`${args[0]} failed while inspecting ${relativePath}; native runtime scan is incomplete`)
        const output = scan.stdout.toString('utf8')
        for (const line of output.split('\n')) {
          if (/React(?:Common)?\.framework|hermes|ExpoModules|RCT[A-Z]|_OBJC_(?:META)?CLASS_\$_EXModule|facebook5react/i.test(line)) {
            bannedSymbolsFound.push(`${relativePath}: ${line.trim()}`)
          }
        }
      }
      scannedBinaries.push(relativePath)
    }

    // 8. Frameworks scan
    const frameworksDir = join(appDir, 'Frameworks')
    const frameworks = existsSync(frameworksDir)
      ? readdirSync(frameworksDir).filter((f) => f.endsWith('.framework') || f.endsWith('.dylib'))
      : []

    // 9. Privacy manifest
    const hasPrivacyManifest = existsSync(join(appDir, 'PrivacyInfo.xcprivacy'))

    // 10. ATS exceptions scan
    const atsExceptionsFound: string[] = []
    const ats = infoPlist.NSAppTransportSecurity
    if (ats && typeof ats === 'object') {
      if (ats.NSAllowsArbitraryLoads === true) atsExceptionsFound.push('NSAllowsArbitraryLoads=true')
      if (ats.NSAllowsLocalNetworking === true) atsExceptionsFound.push('NSAllowsLocalNetworking=true')
      if (ats.NSAllowsArbitraryLoadsInWebContent === true) atsExceptionsFound.push('NSAllowsArbitraryLoadsInWebContent=true')
      if (ats.NSExceptionDomains && typeof ats.NSExceptionDomains === 'object') {
        for (const [dom, config] of Object.entries(ats.NSExceptionDomains)) {
          if ((config as any)?.NSExceptionAllowsInsecureHTTPLoads === true) {
            atsExceptionsFound.push(`Insecure HTTP exception for ${dom}`)
          }
        }
      }
    }

    // 11. Binary & dSYM UUIDs
    let executableUuids: string[] = []
    let dsymUuids: string[] = []
    let dsymUuidMatch = false

    if (existsSync(execPath)) {
      const dumpProc = run(['dwarfdump', '--uuid', execPath])
      if (dumpProc.exitCode === 0) {
        executableUuids = extractUuidsFromDwarfdumpOutput(dumpProc.stdout.toString('utf8'))
      }
    }

    if (typeof options.archivePath === 'string' && options.archivePath.length > 0) {
      const archiveDir = options.archivePath
      const dsymPath = join(archiveDir, 'dSYMs', `${execName}.app.dSYM`)
      if (existsSync(dsymPath)) {
        const dsymDumpProc = run(['dwarfdump', '--uuid', dsymPath])
        if (dsymDumpProc.exitCode === 0) {
          dsymUuids = extractUuidsFromDwarfdumpOutput(dsymDumpProc.stdout.toString('utf8'))
          dsymUuidMatch = matchDsymUuids(executableUuids, dsymUuids)
        }
      } else {
        dsymUuidMatch = false
      }
    }

    // Profile permissions authorize a signature; they never substitute for missing signed claims.
    const teamId = typeof executableEntitlements['com.apple.developer.team-identifier'] === 'string'
      ? executableEntitlements['com.apple.developer.team-identifier'] : ''
    const appIdentifier = typeof executableEntitlements['application-identifier'] === 'string'
      ? executableEntitlements['application-identifier'] : ''
    const getTaskAllow = executableEntitlements['get-task-allow'] === true
    const associatedDomainsRaw = executableEntitlements['com.apple.developer.associated-domains']
    const associatedDomains: string[] = Array.isArray(associatedDomainsRaw) ? associatedDomainsRaw.filter((v): v is string => typeof v === 'string') : []
    const groups = executableEntitlements['keychain-access-groups']
    // Apple uses the signed application identifier as the default only when the entitlement is omitted.
    const keychainGroups: string[] = groups === undefined ? (appIdentifier ? [appIdentifier] : [])
      : Array.isArray(groups) && groups.every((v) => typeof v === 'string') ? groups : []
    const profileErrors: string[] = []
    const expectedTeam = options.expectedTeamId ?? 'L24UJYJ5DK'
    if (provisioningTeamId !== expectedTeam || provisioningEntitlements['com.apple.developer.team-identifier'] !== expectedTeam) {
      profileErrors.push('Provisioning profile does not authorize the expected signing team')
    }
    if (!appIdentifier || !profileAllows(provisioningEntitlements['application-identifier'], appIdentifier)) {
      profileErrors.push('Provisioning profile does not authorize the signed application identifier')
    }
    if (provisioningEntitlements['get-task-allow'] !== false) profileErrors.push('Provisioning profile is not a production distribution profile')
    const permittedGroups = provisioningEntitlements['keychain-access-groups']
    if (!Array.isArray(permittedGroups) || keychainGroups.some(group => !permittedGroups.some(pattern => profileAllows(pattern, group)))) {
      profileErrors.push('Provisioning profile does not authorize the signed Keychain groups')
    }
    const permittedDomains = provisioningEntitlements['com.apple.developer.associated-domains']
    if (!Array.isArray(permittedDomains) || associatedDomains.some(domain => !permittedDomains.some(pattern => profileAllows(pattern, domain)))) {
      profileErrors.push('Provisioning profile does not authorize the signed associated domains')
    }
    const nativeScanEvidence = `Scanned ${scannedBinaries.length} Mach-O binaries with otool and nm plus bundle filenames; ${bannedSymbolsFound.length + bannedCheck.banned.length} known React Native, Hermes, or Expo markers found. This is marker inspection, not proof about stripped or obfuscated code.`

    const result: IpaInspectionResult = {
      valid: true,
      errors: [],
      warnings: [],
      bundleId: infoPlist.CFBundleIdentifier ?? '',
      version: infoPlist.CFBundleShortVersionString ?? '',
      buildNumber: String(infoPlist.CFBundleVersion ?? ''),
      minimumOSVersion: infoPlist.MinimumOSVersion ?? '',
      teamId,
      appIdentifier,
      getTaskAllow,
      codeSignatureValid,
      executableEntitlements,
      provisioningEntitlements,
      associatedDomains,
      keychainGroups,
      apiUrl: infoPlist.SkipperAPIURL ?? '',
      postHogHost: infoPlist.SkipperPostHogHost ?? '',
      scannedBinaries,
      hasMapsKey: Boolean(infoPlist.SkipperGoogleMapsAPIKey && infoPlist.SkipperGoogleMapsAPIKey.length > 5),
      hasPostHogKey: Boolean(infoPlist.SkipperPostHogKey && infoPlist.SkipperPostHogKey.length > 5),
      hasPrivacyManifest,
      hasBannedRuntimes: bannedCheck.hasBanned,
      bannedFilesFound: bannedCheck.banned,
      bannedSymbolsFound,
      atsExceptionsFound,
      nativeScanEvidence,
      frameworks,
      executableUuids,
      dsymUuids,
      dsymUuidMatch: options.archivePath ? dsymUuidMatch : false,
    }

    const val = validateInspectionFields(result, {
      ...options,
      requireDsymMatch: Boolean(options.archivePath),
    })
    result.errors = [...val.errors, ...profileErrors]
    result.valid = result.errors.length === 0

    return result
  } finally {
    await rm(tmpExtract, { recursive: true, force: true }).catch(() => {})
  }
}
