import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import {
  hashArchive, hashFile, manifestSha256,
  type AuthenticatedSymbolsVerification, type PreparedEasSymbols, type SymbolsManifest,
} from '../ios-symbols-eas'
import {
  evaluateBuildReadiness,
  extractNumericBuildNumbers,
  fetchAscBuilds,
  getLatestBuildNumber,
  waitForBuildReadiness,
  type AscBuildInfo,
} from '../../.claude/skills/testflight/asc-builds'
import {
  inspectIpa,
  type InspectionCommandRunner,
  checkBannedFiles,
  extractUuidsFromDwarfdumpOutput,
  matchDsymUuids,
  validateInspectionFields,
} from '../ios-release-inspect'
import {
  buildAltoolUploadArgs,
  buildAltoolValidateArgs,
  buildArchiveCommandArgs,
  buildExportCommandArgs,
  buildPosthogUploadArgs,
  computeNextBuildNumber,
  captureReleaseEnvironment,
  defaultRunCommand,
  computeSourceBuildInputsHash,
  formatReleaseRecord,
  parseCliArgs,
  readProjectMarketingVersion,
  redactSecrets,
  runReleasePipeline,
  validateExportOptionsPlist,
  DEFAULT_APP_ID,
  DEFAULT_BUNDLE_ID,
  DEFAULT_TEAM_ID,
  type CommandRunner,
  type ReleaseMetadata,
  type ReleaseOptions,
} from '../ios-release'

describe('CLI argument parsing and safety defaults', () => {
  test('default mode is safe prepare (upload is false)', () => {
    const opts = parseCliArgs([])
    expect(opts.upload).toBe(false)
    expect(opts.dryRun).toBe(false)
    expect(opts.skipPreconditions).toBe(false)
    expect(opts.skipPosthog).toBe(false)
  })

  test('--upload enables submission', () => {
    const opts = parseCliArgs(['--upload'])
    expect(opts.upload).toBe(true)
  })

  test('parses in-process symbols workflow and refuses stale receipt resume', () => {
    const opts = parseCliArgs(['--symbols-eas', '--eas-project-id', 'project', '--posthog-project-id', '42'])
    expect(opts.symbolsEas).toBe(true)
    expect(opts.easProjectId).toBe('project')
    expect(opts.posthogProjectId).toBe('42')
    expect(() => parseCliArgs(['--symbols-receipt', 'old.json'])).toThrow(/resume is unsupported/)
    expect(() => parseCliArgs(['--symbols-receipt=old.json'])).toThrow(/resume is unsupported/)
  })

  test('parses version and numeric build number overrides', () => {
    const opts = parseCliArgs(['--version', '1.3.0', '--build-number', '42'])
    expect(opts.version).toBe('1.3.0')
    expect(opts.buildNumber).toBe(42)
  })

  test('rejects non-numeric or negative build numbers', () => {
    expect(() => parseCliArgs(['--build-number', 'abc'])).toThrow(/Invalid --build-number/)
    expect(() => parseCliArgs(['--build-number', '-5'])).toThrow(/Invalid --build-number/)
    expect(() => parseCliArgs(['--build-number', '0'])).toThrow(/Invalid --build-number/)
    expect(() => parseCliArgs(['--build-number', '27oops'])).toThrow(/Invalid --build-number/)
    expect(() => parseCliArgs(['--build-number', '27.9'])).toThrow(/Invalid --build-number/)
    expect(() => parseCliArgs(['--build-number', '1e3'])).toThrow(/Invalid --build-number/)
  })

  test('parses helper flags', () => {
    const opts = parseCliArgs(['--skip-preconditions', '--skip-posthog', '--dry-run', '--output-dir', '/tmp/out'])
    expect(opts.skipPreconditions).toBe(true)
    expect(opts.skipPosthog).toBe(true)
    expect(opts.dryRun).toBe(true)
    expect(opts.outputDir).toBe('/tmp/out')
  })
})

describe('Project version extraction and build number calculations', () => {
  test('extracts MARKETING_VERSION from pbxproj content', () => {
    const mockPbx = `
      00000000000000000000001D = {
        buildSettings = {
          MARKETING_VERSION = 1.2.0;
          CURRENT_PROJECT_VERSION = 26;
        };
      };
    `
    expect(readProjectMarketingVersion(mockPbx)).toBe('1.2.0')
  })

  test('extractNumericBuildNumbers sorts numerically, not lexically', () => {
    const mockBuilds: AscBuildInfo[] = [
      { id: '1', buildVersion: '9', processingState: 'VALID' },
      { id: '2', buildVersion: '26', processingState: 'VALID' },
      { id: '3', buildVersion: '10', processingState: 'VALID' },
      { id: '4', buildVersion: '2', processingState: 'VALID' },
      { id: '5', buildVersion: '25', processingState: 'VALID' },
      { id: '6', buildVersion: 'invalid', processingState: 'VALID' },
    ]

    const numbers = extractNumericBuildNumbers(mockBuilds)
    // Lexical sort would put "9" ahead of "26", but numeric must sort descending: 26, 25, 10, 9, 2
    expect(numbers).toEqual([26, 25, 10, 9, 2])
    expect(getLatestBuildNumber(mockBuilds)).toBe(26)
  })

  test('computeNextBuildNumber increments highest known ASC build', () => {
    const mockBuilds: AscBuildInfo[] = [
      { id: '1', buildVersion: '26', processingState: 'VALID' },
      { id: '2', buildVersion: '25', processingState: 'VALID' },
    ]
    expect(computeNextBuildNumber(mockBuilds, 20)).toBe(27)
    // If project has higher version than ASC, use project + 1
    expect(computeNextBuildNumber(mockBuilds, 30)).toBe(31)
  })
})

describe('ASC build readiness evaluation', () => {
  test('fails immediately on terminal states (FAILED, INVALID, expired)', () => {
    const failed = evaluateBuildReadiness({
      id: 'b1',
      buildVersion: '27',
      processingState: 'FAILED',
    })
    expect(failed.isTerminalFailure).toBe(true)
    expect(failed.isReady).toBe(false)

    const invalid = evaluateBuildReadiness({
      id: 'b2',
      buildVersion: '27',
      processingState: 'INVALID',
    })
    expect(invalid.isTerminalFailure).toBe(true)
    expect(invalid.isReady).toBe(false)

    const expired = evaluateBuildReadiness({
      id: 'b3',
      buildVersion: '27',
      processingState: 'VALID',
      expired: true,
    })
    expect(expired.isTerminalFailure).toBe(true)
    expect(expired.isReady).toBe(false)
  })

  test('reports not ready while still processing', () => {
    const processing = evaluateBuildReadiness({
      id: 'b1',
      buildVersion: '27',
      processingState: 'PROCESSING',
    })
    expect(processing.isTerminalFailure).toBe(false)
    expect(processing.isReady).toBe(false)
  })

  test('reports not ready if VALID but internal state is not IN_BETA_TESTING', () => {
    const validPendingBeta = evaluateBuildReadiness({
      id: 'b1',
      buildVersion: '27',
      processingState: 'VALID',
      internalBuildState: 'PROCESSING',
      usesNonExemptEncryption: false,
    })
    expect(validPendingBeta.isTerminalFailure).toBe(false)
    expect(validPendingBeta.isReady).toBe(false)
  })

  test('reports not ready if export compliance is null', () => {
    const missingCompliance = evaluateBuildReadiness({
      id: 'b1',
      buildVersion: '27',
      processingState: 'VALID',
      internalBuildState: 'IN_BETA_TESTING',
      usesNonExemptEncryption: null,
    })
    expect(missingCompliance.isTerminalFailure).toBe(false)
    expect(missingCompliance.isReady).toBe(false)
  })

  test('reports ready when VALID, IN_BETA_TESTING, and encryption is answered', () => {
    const ready = evaluateBuildReadiness({
      id: 'b1',
      buildVersion: '27',
      processingState: 'VALID',
      internalBuildState: 'IN_BETA_TESTING',
      usesNonExemptEncryption: false,
    })
    expect(ready.isTerminalFailure).toBe(false)
    expect(ready.isReady).toBe(true)
  })

  test('strictly enforces marketing version equality when expectedVersion is provided', () => {
    const baseBuild: AscBuildInfo = {
      id: 'b1',
      buildVersion: '27',
      processingState: 'VALID',
      internalBuildState: 'IN_BETA_TESTING',
      usesNonExemptEncryption: false,
      preReleaseVersion: '1.1.0',
    }

    // Mismatched version
    const mismatch = evaluateBuildReadiness(baseBuild, '1.2.0')
    expect(mismatch.isReady).toBe(false)
    expect(mismatch.reason.toLowerCase()).toContain('marketing version mismatch')

    // Missing version
    const missingVer = evaluateBuildReadiness({ ...baseBuild, preReleaseVersion: undefined }, '1.2.0')
    expect(missingVer.isReady).toBe(false)
    expect(missingVer.reason).toContain('Build marketing version is not yet resolved')

    // Matching version
    const matching = evaluateBuildReadiness({ ...baseBuild, preReleaseVersion: '1.2.0' }, '1.2.0')
    expect(matching.isReady).toBe(true)
  })
})

describe('ASC wait loop simulation', () => {
  test('returns build when ready', async () => {
    const mockFetch = async () =>
      new Response(JSON.stringify({
        data: [{
          id: 'b1',
          type: 'builds',
          attributes: {
            version: '27',
            processingState: 'VALID',
            usesNonExemptEncryption: false,
          },
          relationships: {
            preReleaseVersion: { data: { id: 'pre1' } },
            buildBetaDetail: { data: { id: 'bbd1' } },
          },
        }],
        included: [
          { type: 'preReleaseVersions', id: 'pre1', attributes: { version: '1.2.0' } },
          { type: 'buildBetaDetails', id: 'bbd1', attributes: { internalBuildState: 'IN_BETA_TESTING' } },
        ],
      }))

    const result = await waitForBuildReadiness({
      appId: DEFAULT_APP_ID,
      token: 'mock-token',
      expectedBuild: '27',
      expectedVersion: '1.2.0',
      timeoutSeconds: 5,
      pollIntervalSeconds: 0,
      fetchFn: mockFetch as any,
      sleepFn: async () => {},
      logger: () => {},
    })

    expect(result.buildVersion).toBe('27')
    expect(result.processingState).toBe('VALID')
    expect(result.internalBuildState).toBe('IN_BETA_TESTING')
  })

  test('aborts immediately on terminal failure in ASC', async () => {
    const mockFetch = async () =>
      new Response(JSON.stringify({
        data: [{
          id: 'b1',
          type: 'builds',
          attributes: {
            version: '27',
            processingState: 'FAILED',
          },
        }],
      }))

    expect(
      waitForBuildReadiness({
        appId: DEFAULT_APP_ID,
        token: 'mock-token',
        expectedBuild: '27',
        timeoutSeconds: 5,
        pollIntervalSeconds: 0,
        fetchFn: mockFetch as any,
        sleepFn: async () => {},
        logger: () => {},
      }),
    ).rejects.toThrow(/Build 27 terminated in failure/)
  })

  test('times out if build never appears or settles', async () => {
    const mockFetch = async () =>
      new Response(JSON.stringify({
        data: [],
      }))

    expect(
      waitForBuildReadiness({
        appId: DEFAULT_APP_ID,
        token: 'mock-token',
        expectedBuild: '99',
        timeoutSeconds: 0.1,
        pollIntervalSeconds: 0.05,
        fetchFn: mockFetch as any,
        sleepFn: async (ms) => new Promise((res) => setTimeout(res, ms)),
        logger: () => {},
      }),
    ).rejects.toThrow(/Timed out/)
  })
})

describe('Command argument generation and signing safety', () => {
  const authConfig = {
    keyId: 'KEY123',
    issuerId: 'ISS123',
    keyPath: '/keys/AuthKey_KEY123.p8',
    appId: DEFAULT_APP_ID,
  }

  test('buildArchiveCommandArgs configures generic iOS, Release, exact versions, and NO disabled signing', () => {
    const args = buildArchiveCommandArgs({
      projectPath: 'apps/ios/Skipper.xcodeproj',
      scheme: 'Skipper',
      configuration: 'Release',
      destination: 'generic/platform=iOS',
      archivePath: '/tmp/Skipper.xcarchive',
      derivedDataPath: '/tmp/DerivedData',
      clonedSourcePackagesPath: '/tmp/SourcePackages',
      marketingVersion: '1.2.0',
      buildNumber: 27,
      authConfig,
    })

    expect(args).toContain('archive')
    expect(args).toContain('generic/platform=iOS')
    expect(args).toContain('Release')
    expect(args).toContain('MARKETING_VERSION=1.2.0')
    expect(args).toContain('CURRENT_PROJECT_VERSION=27')
    expect(args).toContain('-allowProvisioningUpdates')
    expect(args).toContain('-authenticationKeyPath')
    // CODE_SIGNING_ALLOWED=NO must NEVER be in archive args!
    expect(args.join(' ')).not.toContain('CODE_SIGNING_ALLOWED=NO')
  })

  test('buildExportCommandArgs includes exportArchive and plist', () => {
    const args = buildExportCommandArgs({
      archivePath: '/tmp/Skipper.xcarchive',
      exportPath: '/tmp/export',
      exportOptionsPlist: 'scripts/ios-export-options.plist',
      authConfig,
    })

    expect(args).toContain('-exportArchive')
    expect(args).toContain('-exportOptionsPlist')
    expect(args).toContain('scripts/ios-export-options.plist')
    expect(args).toContain('-allowProvisioningUpdates')
  })

  test('buildAltoolValidateArgs and buildAltoolUploadArgs use json and api key auth', () => {
    const valArgs = buildAltoolValidateArgs({
      ipaPath: '/tmp/app.ipa',
      authConfig,
    })
    expect(valArgs).toEqual([
      'altool',
      '--validate-app', '/tmp/app.ipa',
      '--api-key', 'KEY123',
      '--api-issuer', 'ISS123',
      '--p8-file-path', '/keys/AuthKey_KEY123.p8',
      '--output-format', 'json',
    ])

    const upArgs = buildAltoolUploadArgs({
      ipaPath: '/tmp/app.ipa',
      authConfig,
    })
    expect(upArgs).toEqual([
      'altool',
      '--upload-package', '/tmp/app.ipa',
      '--api-key', 'KEY123',
      '--api-issuer', 'ISS123',
      '--p8-file-path', '/keys/AuthKey_KEY123.p8',
      '--output-format', 'json',
    ])
  })

  test('buildPosthogUploadArgs configures dSYM upload without accepting conflicting content', () => {
    const posthogArgs = buildPosthogUploadArgs({
      dsymDirectory: '/tmp/dSYMs',
      releaseName: DEFAULT_BUNDLE_ID,
      releaseVersion: '1.2.0',
      buildNumber: 27,
    })

    expect(posthogArgs).toEqual([
      'dsym',
      'upload',
      '--directory', '/tmp/dSYMs',
      '--release-name', 'fm.skipper.app',
      '--release-version', '1.2.0',
      '--build', '27',
      '--skip-release-on-fail',
    ])
  })
})

describe('Export options plist integrity', () => {
  test('scripts/ios-export-options.plist exists and contains required keys', () => {
    const plistPath = resolve(import.meta.dir, '../ios-export-options.plist')
    expect(existsSync(plistPath)).toBe(true)
    const content = readFileSync(plistPath, 'utf8')

    expect(content).toContain('<key>destination</key>')
    expect(content).toContain('<string>export</string>')
    expect(content).toContain('<key>method</key>')
    expect(content).toContain('<string>app-store-connect</string>')
    expect(content).toContain('<key>teamID</key>')
    expect(content).toContain(`<string>${DEFAULT_TEAM_ID}</string>`)
    expect(content).toContain('<key>manageAppVersionAndBuildNumber</key>')
    expect(content).toContain('<false/>')
    expect(content).toContain('<key>testFlightInternalTestingOnly</key>')
    expect(content).toContain('<false/>')
    expect(content).toContain('<key>uploadSymbols</key>')
    expect(content).toContain('<true/>')
  })
})

describe('IPA inspection and React Native / Expo runtime ban', () => {
  test('checkBannedFiles catches Hermes, React, and Expo runtime artifacts', () => {
    const dirtyFiles = [
      'Skipper',
      'Frameworks/GoogleMaps.framework',
      'Frameworks/hermes.framework/hermes',
      'main.jsbundle',
      'assets/node_modules/expo/index.js',
    ]

    const result = checkBannedFiles(dirtyFiles)
    expect(result.hasBanned).toBe(true)
    expect(result.banned).toContain('Frameworks/hermes.framework/hermes')
    expect(result.banned).toContain('main.jsbundle')
    expect(result.banned).toContain('assets/node_modules/expo/index.js')
  })

  test('checkBannedFiles returns clean for pure native files', () => {
    const cleanFiles = [
      'Skipper',
      'Info.plist',
      'embedded.mobileprovision',
      'PrivacyInfo.xcprivacy',
      'Frameworks/GoogleMaps.framework',
      'Frameworks/GoogleMapsCore.framework',
      'Frameworks/PostHog.framework',
      'Assets.car',
    ]

    const result = checkBannedFiles(cleanFiles)
    expect(result.hasBanned).toBe(false)
    expect(result.banned).toEqual([])
  })

  test('extractUuidsFromDwarfdumpOutput and matchDsymUuids', () => {
    const mockDump = `
UUID: 11111111-2222-3333-4444-555555555555 (arm64) /path/to/Skipper
UUID: AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE (arm64e) /path/to/Skipper
    `
    const uuids = extractUuidsFromDwarfdumpOutput(mockDump)
    expect(uuids).toContain('arm64:11111111-2222-3333-4444-555555555555')
    expect(uuids).toContain('arm64e:AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE')

    const partialDsymUuids = ['arm64:11111111-2222-3333-4444-555555555555']
    // Incomplete architecture coverage must fail (review finding 2)
    expect(matchDsymUuids(uuids, partialDsymUuids)).toBe(false)

    const completeDsymUuids = [
      'arm64:11111111-2222-3333-4444-555555555555',
      'arm64e:AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE',
    ]
    expect(matchDsymUuids(uuids, completeDsymUuids)).toBe(true)

    const nonMatching = ['arm64:99999999-9999-9999-9999-999999999999']
    expect(matchDsymUuids(uuids, nonMatching)).toBe(false)
  })

  test('validateInspectionFields enforces strict production and identity rules', () => {
    const validData = {
      bundleId: DEFAULT_BUNDLE_ID,
      version: '1.2.0',
      buildNumber: '27',
      teamId: DEFAULT_TEAM_ID,
      appIdentifier: `${DEFAULT_TEAM_ID}.${DEFAULT_BUNDLE_ID}`,
      minimumOSVersion: '17.0',
      apiUrl: 'https://api.skipper.fm',
      hasMapsKey: true,
      hasPostHogKey: true,
      postHogHost: 'https://us.i.posthog.com',
      keychainGroups: [`${DEFAULT_TEAM_ID}.${DEFAULT_BUNDLE_ID}`],
      associatedDomains: ['webcredentials:skipper.fm'],
      codeSignatureValid: true,
      hasPrivacyManifest: true,
      hasBannedRuntimes: false,
      bannedFilesFound: [],
      dsymUuids: ['arm64:UUID1'],
      dsymUuidMatch: true,
    }

    const validCheck = validateInspectionFields(validData, {
      expectedVersion: '1.2.0',
      expectedBuild: '27',
      expectedTeamId: DEFAULT_TEAM_ID,
      expectedBundleId: DEFAULT_BUNDLE_ID,
      minOsVersion: '17.0',
    })
    expect(validCheck.valid).toBe(true)
    expect(validCheck.errors).toEqual([])

    // Test violations:
    // 1. Wrong Team ID (e.g. old native AYA5T52A22)
    const badTeam = { ...validData, teamId: 'AYA5T52A22' }
    expect(validateInspectionFields(badTeam).valid).toBe(false)

    // 2. Minimum OS below 17.0
    const badOs = { ...validData, minimumOSVersion: '16.4' }
    expect(validateInspectionFields(badOs).valid).toBe(false)

    // 3. HTTP instead of HTTPS API URL
    const badApi = { ...validData, apiUrl: 'http://api.skipper.fm' }
    expect(validateInspectionFields(badApi).valid).toBe(false)

    // 4. Missing Maps or PostHog key
    const missingMaps = { ...validData, hasMapsKey: false }
    expect(validateInspectionFields(missingMaps).valid).toBe(false)

    // 5. Banned runtimes present
    const banned = {
      ...validData,
      hasBannedRuntimes: true,
      bannedFilesFound: ['Frameworks/hermes.framework'],
    }
    const bannedCheck = validateInspectionFields(banned)
    expect(bannedCheck.valid).toBe(false)
    expect(bannedCheck.errors.some((e) => e.includes('React Native / Expo'))).toBe(true)

    // 6. dSYM mismatch
    const dsymMismatch = { ...validData, dsymUuidMatch: false }
    expect(validateInspectionFields(dsymMismatch).valid).toBe(false)

    // 7. Empty identity strings (must be strictly rejected)
    const emptyTeam = { ...validData, teamId: '' }
    const emptyTeamCheck = validateInspectionFields(emptyTeam)
    expect(emptyTeamCheck.valid).toBe(false)
    expect(emptyTeamCheck.errors.some((e) => e.includes('Missing team identifier'))).toBe(true)

    const emptyAppId = { ...validData, appIdentifier: '' }
    const emptyAppIdCheck = validateInspectionFields(emptyAppId)
    expect(emptyAppIdCheck.valid).toBe(false)
    expect(emptyAppIdCheck.errors.some((e) => e.includes('Missing application-identifier'))).toBe(true)

    const emptyBundle = { ...validData, bundleId: '' }
    const emptyBundleCheck = validateInspectionFields(emptyBundle)
    expect(emptyBundleCheck.valid).toBe(false)
    expect(emptyBundleCheck.errors.some((e) => e.includes('Missing bundle identifier'))).toBe(true)

    // 8. Debug signing (get-task-allow: true) must be rejected for release distribution
    const debugSigned = { ...validData, getTaskAllow: true }
    const debugSignedCheck = validateInspectionFields(debugSigned)
    expect(debugSignedCheck.valid).toBe(false)
    expect(debugSignedCheck.errors.some((e) => e.includes('get-task-allow=true'))).toBe(true)

    // 9. Missing dSYM when requireDsymMatch is true (even if dsymUuids array is empty)
    const missingDsym = { ...validData, dsymUuidMatch: false, dsymUuids: [] }
    const missingDsymCheck = validateInspectionFields(missingDsym, { requireDsymMatch: true })
    expect(missingDsymCheck.valid).toBe(false)
    expect(missingDsymCheck.errors.some((e) => e.includes('dSYM missing') || e.includes('dSYM'))).toBe(true)

    // 10. Canonical API URL coordination (validates https://api.skipper.fm, rejects subpaths, queries, staging, http)
    expect(validateInspectionFields({ ...validData, apiUrl: 'https://api.skipper.fm' }).valid).toBe(true)
    expect(validateInspectionFields({ ...validData, apiUrl: 'https://api.skipper.fm/' }).valid).toBe(true)
    for (const badUrl of ['https://staging.invalid', 'https://api.skipper.fm/other', 'https://api.skipper.fm?target=other', 'http://api.skipper.fm']) {
      const badCheck = validateInspectionFields({ ...validData, apiUrl: badUrl })
      expect(badCheck.valid).toBe(false)
      expect(badCheck.errors.some((e) => e.includes('Invalid SkipperAPIURL'))).toBe(true)
    }

    // 11. Keychain access group missing expected app ID
    const badKeychain = { ...validData, keychainGroups: ['UNEXPECTED.app.group'] }
    const badKeychainCheck = validateInspectionFields(badKeychain)
    expect(badKeychainCheck.valid).toBe(false)
    expect(badKeychainCheck.errors.some((e) => e.includes('Missing expected Keychain access group'))).toBe(true)

    // 12. Associated domains missing webcredentials:skipper.fm
    const badDomains = { ...validData, associatedDomains: ['applinks:skipper.fm'] }
    const badDomainsCheck = validateInspectionFields(badDomains)
    expect(badDomainsCheck.valid).toBe(false)
    expect(badDomainsCheck.errors.some((e) => e.includes('Missing expected associated domain'))).toBe(true)

    // 13. App Transport Security development exceptions forbidden in production
    const badAts = { ...validData, atsExceptionsFound: ['NSAllowsArbitraryLoads = true'] }
    const badAtsCheck = validateInspectionFields(badAts)
    expect(badAtsCheck.valid).toBe(false)
    expect(badAtsCheck.errors.some((e) => e.includes('App Transport Security development exceptions forbidden'))).toBe(true)

    // 14. Code signature invalid
    const invalidSig = { ...validData, codeSignatureValid: false }
    const invalidSigCheck = validateInspectionFields(invalidSig)
    expect(invalidSigCheck.valid).toBe(false)
    expect(invalidSigCheck.errors.some((e) => e.includes('Code signature verification failed'))).toBe(true)

    // 15. Mach-O banned symbols or static linkage detected
    const bannedMachO = { ...validData, bannedSymbolsFound: ['_RCTBridgeModuleName'] }
    const bannedMachOCheck = validateInspectionFields(bannedMachO)
    expect(bannedMachOCheck.valid).toBe(false)
    expect(bannedMachOCheck.errors.some((e) => e.includes('Found React Native / Expo symbols'))).toBe(true)
  })
})

describe('Release record status truthfulness and receipt safety', () => {
  test('dry-run or un-uploaded metadata never outputs SHIPPED TO TESTFLIGHT or fabricated ASC state', () => {
    const unuploadedMeta: ReleaseMetadata = {
      version: '1.2.0',
      buildNumber: 27,
      gitCommit: 'abc1234567890abcdef',
      gitDirty: false,
      dirtyFiles: [],
      uploadedAt: undefined,
      deliveryUuid: undefined,
      ascProcessingState: undefined,
      ascInternalState: undefined,
    }

    const record = formatReleaseRecord(unuploadedMeta)
    expect(record).toContain('- **Status**: PREPARED / INSPECTED (SAFE DEFAULT - NOT UPLOADED)')
    expect(record).not.toContain('SHIPPED TO TESTFLIGHT')
    expect(record).not.toContain('ASC Processing State')
    expect(record).not.toContain('ASC Internal State')
  })

  test('partial or unverified upload metadata is not marked SHIPPED TO TESTFLIGHT', () => {
    const partialMeta: ReleaseMetadata = {
      version: '1.2.0',
      buildNumber: 27,
      gitCommit: 'abc1234567890abcdef',
      gitDirty: false,
      dirtyFiles: [],
      uploadedAt: '2026-09-12T14:00:00Z',
      deliveryUuid: 'd9b9a9c9-1234-5678-90ab-cdef12345678',
      ascProcessingState: 'PROCESSING',
      ascInternalState: 'PROCESSING',
    }

    const record = formatReleaseRecord(partialMeta)
    expect(record).toContain('- **Status**: UPLOADED — RELEASE VERIFICATION INCOMPLETE')
    expect(record).not.toContain('SHIPPED TO TESTFLIGHT')
  })

  test('only fully verified ASC builds (VALID + IN_BETA_TESTING) are marked SHIPPED TO TESTFLIGHT', () => {
    const verifiedMeta: ReleaseMetadata = {
      version: '1.2.0',
      buildNumber: 27,
      gitCommit: 'abc1234567890abcdef',
      gitDirty: false,
      dirtyFiles: [],
      uploadedAt: '2026-09-12T14:00:00Z',
      deliveryUuid: 'd9b9a9c9-1234-5678-90ab-cdef12345678',
      ascProcessingState: 'VALID',
      ascInternalState: 'IN_BETA_TESTING',
      posthogSymbolStatus: 'uploaded',
      symbolsVerification: { verification: 'authenticated-eas-artifact', workflowRunId: 'workflow',
        jobId: 'job', artifactId: 'artifact', manifestSha256: 'a'.repeat(64) },
      checksPassed: true,
    }

    const record = formatReleaseRecord(verifiedMeta)
    expect(record).toContain('- **Status**: SHIPPED TO TESTFLIGHT')
    expect(record).toContain('- **Apple Delivery UUID**: `d9b9a9c9-1234-5678-90ab-cdef12345678`')
    expect(record).toContain('- **ASC Processing State**: `VALID`')
    expect(record).toContain('- **ASC Internal State**: `IN_BETA_TESTING`')
  })
})

describe('Dry-run execution preview safety', () => {
  test('dry-run with --upload outputs preview plan and mutates no filesystem state', async () => {
    const testDir = `/tmp/skipper-test-dryrun-nonexistent-${Date.now()}`
    try {
      await runReleasePipeline({
        version: '1.2.0',
        buildNumber: 999,
        outputDir: testDir,
        dryRun: true,
        upload: true,
        skipPreconditions: true,
        skipPosthog: true,
      })

      // Verify that the output directory was NOT created
      expect(existsSync(testDir)).toBe(false)
    } finally {
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true })
      }
    }
  })
})

describe('Export options plist validation and side-door prevention', () => {
  test('canonical scripts/ios-export-options.plist is valid and strictly export-only', () => {
    const canonicalPath = resolve(import.meta.dir, '../ios-export-options.plist')
    const result = validateExportOptionsPlist(canonicalPath, DEFAULT_TEAM_ID)
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.parsed?.destination).toBe('export')
    expect(result.parsed?.method).toBe('app-store-connect')
    expect(result.parsed?.teamID).toBe(DEFAULT_TEAM_ID)
    expect(result.parsed?.manageAppVersionAndBuildNumber).toBe(false)
  })

  test('rejects non-existent plist path', () => {
    const result = validateExportOptionsPlist('/tmp/nonexistent-plist-12345.plist')
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('Export options plist not found')
  })

  test('strictly rejects plist with destination=upload (prevents pre-inspection upload side-door)', () => {
    const tmpPlist = `/tmp/test-upload-plist-${Date.now()}.plist`
    const badContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>destination</key>
  <string>upload</string>
  <key>method</key>
  <string>app-store-connect</string>
  <key>teamID</key>
  <string>${DEFAULT_TEAM_ID}</string>
  <key>manageAppVersionAndBuildNumber</key>
  <false/>
</dict>
</plist>`
    writeFileSync(tmpPlist, badContent, 'utf8')
    try {
      const result = validateExportOptionsPlist(tmpPlist, DEFAULT_TEAM_ID)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('Disallowed destination "upload"'))).toBe(true)
    } finally {
      if (existsSync(tmpPlist)) rmSync(tmpPlist, { force: true })
    }
  })

  test('strictly rejects plist with manageAppVersionAndBuildNumber=true (prevents Apple build mutation)', () => {
    const tmpPlist = `/tmp/test-autobuild-plist-${Date.now()}.plist`
    const badContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>destination</key>
  <string>export</string>
  <key>method</key>
  <string>app-store-connect</string>
  <key>teamID</key>
  <string>${DEFAULT_TEAM_ID}</string>
  <key>manageAppVersionAndBuildNumber</key>
  <true/>
</dict>
</plist>`
    writeFileSync(tmpPlist, badContent, 'utf8')
    try {
      const result = validateExportOptionsPlist(tmpPlist, DEFAULT_TEAM_ID)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('manageAppVersionAndBuildNumber must be false'))).toBe(true)
    } finally {
      if (existsSync(tmpPlist)) rmSync(tmpPlist, { force: true })
    }
  })

  test('strictly rejects plist with non-ASC method (e.g. development)', () => {
    const tmpPlist = `/tmp/test-method-plist-${Date.now()}.plist`
    const badContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>destination</key>
  <string>export</string>
  <key>method</key>
  <string>development</string>
  <key>teamID</key>
  <string>${DEFAULT_TEAM_ID}</string>
  <key>manageAppVersionAndBuildNumber</key>
  <false/>
</dict>
</plist>`
    writeFileSync(tmpPlist, badContent, 'utf8')
    try {
      const result = validateExportOptionsPlist(tmpPlist, DEFAULT_TEAM_ID)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('Invalid distribution method "development"'))).toBe(true)
    } finally {
      if (existsSync(tmpPlist)) rmSync(tmpPlist, { force: true })
    }
  })

  test('strictly rejects plist with mismatched teamID', () => {
    const tmpPlist = `/tmp/test-team-plist-${Date.now()}.plist`
    const badContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>destination</key>
  <string>export</string>
  <key>method</key>
  <string>app-store-connect</string>
  <key>teamID</key>
  <string>AYA5T52A22</string>
  <key>manageAppVersionAndBuildNumber</key>
  <false/>
</dict>
</plist>`
    writeFileSync(tmpPlist, badContent, 'utf8')
    try {
      const result = validateExportOptionsPlist(tmpPlist, DEFAULT_TEAM_ID)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('Invalid teamID "AYA5T52A22"'))).toBe(true)
    } finally {
      if (existsSync(tmpPlist)) rmSync(tmpPlist, { force: true })
    }
  })
})

describe('ASC build pagination and multi-page fetching', () => {
  test('follows links.next across multiple pages and aggregates builds', async () => {
    let callCount = 0
    const mockFetch = async (_url: string) => {
      callCount++
      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            data: [
              { id: 'b2', type: 'builds', attributes: { version: '28', processingState: 'VALID' } },
            ],
            links: {
              next: 'https://api.appstoreconnect.apple.com/v1/builds?cursor=page2',
            },
          }),
        )
      } else {
        return new Response(
          JSON.stringify({
            data: [
              { id: 'b1', type: 'builds', attributes: { version: '27', processingState: 'VALID' } },
            ],
            links: {},
          }),
        )
      }
    }

    const builds = await fetchAscBuilds({
      appId: DEFAULT_APP_ID,
      token: 'mock-jwt',
      maxPages: 3,
      fetchFn: mockFetch as any,
    })

    expect(builds).toHaveLength(2)
    expect(builds[0]!.buildVersion).toBe('28')
    expect(builds[1]!.buildVersion).toBe('27')
    expect(callCount).toBe(2)
  })
})

describe('Secret redaction in subprocess logs and outputs', () => {
  test('redacts private keys, bearer tokens, and API key flags', () => {
    const raw = `
      Executing xcodebuild with -authenticationKeyID ABC123DEF4 -authenticationKeyIssuerID 1111-2222
      Authorization: Bearer eyJhbGciOiES256.xyz.secret
      --api-key KEY999 --api-issuer ISS888
      -----BEGIN EC PRIVATE KEY-----
      MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgSECRETKEYCONTENT
      -----END EC PRIVATE KEY-----
      POSTHOG_CLI_API_KEY=phc_supersecrettoken
    `
    const redacted = redactSecrets(raw, [
      'ABC123DEF4',
      '1111-2222',
      'KEY999',
      'ISS888',
      'phc_supersecrettoken',
    ])
    expect(redacted).not.toContain('ABC123DEF4')
    expect(redacted).not.toContain('1111-2222')
    expect(redacted).not.toContain('eyJhbGciOiES256.xyz.secret')
    expect(redacted).not.toContain('KEY999')
    expect(redacted).not.toContain('ISS888')
    expect(redacted).not.toContain('SECRETKEYCONTENT')
    expect(redacted).not.toContain('phc_supersecrettoken')
    expect(redacted).toContain('[REDACTED]')
    expect(redacted).toContain('[REDACTED PRIVATE KEY]')
  })
})

describe('Source build inputs content hashing', () => {
  test('computes deterministic SHA-256 hash across tracked build inputs', async () => {
    const res1 = await computeSourceBuildInputsHash()
    const res2 = await computeSourceBuildInputsHash()
    expect(res1.hash).toMatch(/^[a-f0-9]{64}$/)
    expect(res1.hash).toBe(res2.hash)
    expect(res1.fileCount).toBeGreaterThan(0)
  })
})

describe('Pipeline safety: build number consumption and export validation integration', () => {
  test('throws immediately if custom export options plist has disallowed upload destination', async () => {
    const fixture = releaseFixture()
    const badPlist = `/tmp/test-pipeline-upload-${Date.now()}.plist`
    writeFileSync(badPlist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>destination</key><string>upload</string>
  <key>method</key><string>app-store-connect</string>
  <key>teamID</key><string>${DEFAULT_TEAM_ID}</string>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>`, 'utf8')

    try {
      expect(
        runReleasePipeline({
          ...fixture.options,
          version: '1.2.0',
          buildNumber: 100,
          exportOptionsPlist: badPlist,
          dryRun: false,
          upload: false,
          skipPreconditions: true,
          skipPosthog: true,
        }),
      ).rejects.toThrow(/Export options plist validation failed/)
    } finally {
      if (existsSync(badPlist)) rmSync(badPlist, { force: true })
    }
  })

  test('rejects consumed build number lower than or equal to latest ASC build', async () => {
    const fixture = releaseFixture()
    const { generateKeyPairSync } = await import('node:crypto')
    const { privateKey } = generateKeyPairSync('ec', {
      namedCurve: 'P-256',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })

    const tmpKey = `/tmp/test-p8-${Date.now()}.p8`
    writeFileSync(tmpKey, privateKey, 'utf8')

    const mockAuthConfig = {
      keyId: 'MOCKKEY123',
      issuerId: '00000000-0000-0000-0000-000000000000',
      keyPath: tmpKey,
      appId: DEFAULT_APP_ID,
    }

    const mockAscFetch = async () =>
      new Response(
        JSON.stringify({
          data: [{ id: 'b50', type: 'builds', attributes: { version: '50', processingState: 'VALID' } }],
          links: {},
        }),
      )

    try {
      expect(
        runReleasePipeline({
          ...fixture.options,
          version: '1.2.0',
          buildNumber: 45, // lower than latest 50
          authConfig: mockAuthConfig,
          ascFetchFn: mockAscFetch as any,
          dryRun: false,
          skipPreconditions: true,
          skipPosthog: true,
        }),
      ).rejects.toThrow(/has already been consumed in App Store Connect/)
    } finally {
      if (existsSync(tmpKey)) rmSync(tmpKey, { force: true })
    }
  })

  test('injected CommandRunner failure halts archive step fail-closed', async () => {
    const fixture = releaseFixture()
    const testDir = `/tmp/skipper-test-runner-fail-${Date.now()}`
    const mockRunner: CommandRunner = async (cmd, runOptions) => {
      if (cmd[0] === 'xcodebuild' && cmd[1] === 'archive') {
        return { exitCode: 65, stdout: '', stderr: 'Mock archive failure: code signing error' }
      }
      return fixture.runner(cmd, runOptions)
    }

    try {
      expect(
        runReleasePipeline({
          ...fixture.options,
          version: '1.2.0',
          buildNumber: 999,
          outputDir: testDir,
          runner: mockRunner,
          dryRun: false,
          upload: false,
          skipPreconditions: true,
          skipPosthog: true,
        }),
      ).rejects.toThrow(/xcodebuild archive failed \(exit 65\)/)
    } finally {
      if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true })
    }
  })

  test('injected CommandRunner failure in PostHog symbol upload halts pipeline fail-closed', async () => {
    const fixture = releaseFixture()
    const testDir = `/tmp/skipper-test-runner-posthog-${Date.now()}`
    const mockRunner: CommandRunner = async (cmd, runOptions) => {
      // Mock successful archive & export by creating mock xcarchive and ipa
      if (cmd[0] === 'xcodebuild' && cmd[1] === 'archive') {
        const dsymDir = resolve(testDir, 'Skipper.xcarchive/dSYMs/Skipper.app.dSYM')
        mkdirSync(dsymDir, { recursive: true })
        writeFileSync(resolve(dsymDir, 'dummy'), 'dummy')
        return { exitCode: 0, stdout: '', stderr: '' }
      }
      if (cmd[0] === 'xcodebuild' && cmd[1] === '-exportArchive') {
        const ipaFile = resolve(testDir, 'Skipper.ipa')
        writeFileSync(ipaFile, 'mock-ipa')
        return { exitCode: 0, stdout: '', stderr: '' }
      }
      if (cmd[0] === 'bunx' && cmd.includes('@posthog/cli')) {
        return { exitCode: 1, stdout: '', stderr: 'PostHog API key unauthorized' }
      }
      return fixture.runner(cmd, runOptions)
    }

    // Set temporary POSTHOG_CLI_API_KEY and POSTHOG_CLI_PROJECT_ID so pipeline attempts upload
    const prevKey = process.env.POSTHOG_CLI_API_KEY
    const prevProject = process.env.POSTHOG_CLI_PROJECT_ID
    process.env.POSTHOG_CLI_API_KEY = 'mock-posthog-key'
    process.env.POSTHOG_CLI_PROJECT_ID = 'mock-posthog-project'

    try {
      expect(
        runReleasePipeline({
          ...fixture.options,
          version: '1.2.0',
          buildNumber: 999,
          outputDir: testDir,
          runner: mockRunner,
          dryRun: false,
          upload: false,
          skipPreconditions: true,
          skipPosthog: false, // Must not skip PostHog
          environment: { ...fixture.options.environment, POSTHOG_CLI_API_KEY: 'mock-posthog-key', POSTHOG_CLI_PROJECT_ID: 'mock-posthog-project' },
          inspector: (async () => ({ valid: true, errors: [] } as any)),
        }),
      ).rejects.toThrow(/PostHog dSYM upload failed/)
    } finally {
      if (prevKey !== undefined) {
        process.env.POSTHOG_CLI_API_KEY = prevKey
      } else {
        delete process.env.POSTHOG_CLI_API_KEY
      }
      if (prevProject !== undefined) {
        process.env.POSTHOG_CLI_PROJECT_ID = prevProject
      } else {
        delete process.env.POSTHOG_CLI_PROJECT_ID
      }
      if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true })
    }
  })
})



// The signing boundary is simulated; zip/plist parsing, isolated git checkout, frozen Bun install,
// configuration generation, hashing, and the real IPA inspector all execute against local fixtures.
const fixtureRoots: string[] = []
afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function put(path: string, value: string | Buffer) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, value)
}
function xml(value: unknown): Buffer {
  const result = Bun.spawnSync(['plutil', '-convert', 'xml1', '-o', '-', '--', '-'], { stdin: Buffer.from(JSON.stringify(value)), stdout: 'pipe', stderr: 'pipe' })
  if (result.exitCode !== 0) throw new Error(`Fixture plist encoding failed (exit ${result.exitCode})`)
  return result.stdout
}
const fixtureAppId = `${DEFAULT_TEAM_ID}.${DEFAULT_BUNDLE_ID}`
const fixtureSigned = {
  'application-identifier': fixtureAppId,
  'com.apple.developer.team-identifier': DEFAULT_TEAM_ID,
  'get-task-allow': false,
  'keychain-access-groups': [fixtureAppId],
  'com.apple.developer.associated-domains': ['webcredentials:skipper.fm'],
}
function inspectionFixture(options: {
  signed?: Record<string, any>; profile?: Record<string, any>; host?: string;
  embeddedRuntime?: boolean; failTool?: string; omitGroups?: boolean;
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'skipper-ipa-fixture-'))
  fixtureRoots.push(root)
  const app = join(root, 'Payload/Skipper.app')
  const info = { CFBundleIdentifier: DEFAULT_BUNDLE_ID, CFBundleExecutable: 'Skipper',
    CFBundleShortVersionString: '1.2.0', CFBundleVersion: '999', MinimumOSVersion: '17.0',
    SkipperAPIURL: 'https://api.skipper.fm', SkipperPostHogHost: options.host ?? 'https://us.i.posthog.com',
    SkipperGoogleMapsAPIKey: 'fixture-maps-key', SkipperPostHogKey: 'fixture-posthog-key' }
  put(join(app, 'Info.plist'), xml(info))
  put(join(app, 'Skipper'), Buffer.from('cffaedfe00000000', 'hex'))
  put(join(app, 'embedded.mobileprovision'), 'signing boundary fixture')
  put(join(app, 'PrivacyInfo.xcprivacy'), xml({ NSPrivacyTracking: false }))
  put(join(app, 'Frameworks/Innocent.framework/Innocent'), Buffer.from('cffaedfe00000000', 'hex'))
  const ipa = join(root, 'Skipper.ipa')
  execFileSync('zip', ['-qr', ipa, 'Payload'], { cwd: root })
  const archive = join(root, 'Skipper.xcarchive')
  mkdirSync(join(archive, 'dSYMs/Skipper.app.dSYM'), { recursive: true })
  const signed = { ...(options.signed ?? fixtureSigned) }
  if (options.omitGroups) delete signed['keychain-access-groups']
  const profile = options.profile ?? { ...fixtureSigned, 'keychain-access-groups': [`${DEFAULT_TEAM_ID}.*`], 'com.apple.developer.associated-domains': ['*'] }
  const commands: string[][] = []
  const runner: InspectionCommandRunner = (cmd, args) => {
    commands.push(cmd)
    if (cmd[0] === options.failTool) return { exitCode: 1, stdout: Buffer.from(''), stderr: Buffer.from('fixture failure') }
    let output: Buffer | undefined
    if (cmd[0] === 'codesign') output = cmd.includes('--verify') ? Buffer.from('') : xml(signed)
    if (cmd[0] === 'security') output = xml({ Entitlements: profile, TeamIdentifier: [DEFAULT_TEAM_ID] })
    if (cmd[0] === 'otool') output = Buffer.from('/usr/lib/libSystem.B.dylib')
    if (cmd[0] === 'nm') output = Buffer.from(options.embeddedRuntime && cmd.at(-1)?.endsWith('/Innocent') ? '_OBJC_CLASS_$_RCTBridge' : '_main')
    if (cmd[0] === 'dwarfdump') output = Buffer.from('UUID: 11111111-2222-3333-4444-555555555555 (arm64) fixture')
    if (output !== undefined) return { exitCode: 0, stdout: output, stderr: Buffer.from('') }
    const result = Bun.spawnSync(cmd, args)
    return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }
  }
  return { root, ipa, archive, runner, commands }
}
function releaseFixture() {
  const root = mkdtempSync(join(tmpdir(), 'skipper-release-fixture-'))
  fixtureRoots.push(root)
  const git = (args: string[]) => {
    const result = Bun.spawnSync(['git', ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
    if (result.exitCode !== 0) throw new Error(`Fixture git failed: ${result.stderr.toString()}`)
    return result.stdout.toString().trim()
  }
  git(['init', '-q'])
  put(join(root, '.gitignore'), 'node_modules/\n.scratch/\nkeys/\napps/mobile/.env\n')
  put(join(root, 'package.json'), JSON.stringify({ name: 'release-fixture', private: true, version: '1.0.0',
    dependencies: { 'release-fixture-dependency': 'file:./fixture-dependency' },
    scripts: { check: `bun -e "import value from 'release-fixture-dependency'; if(value !== 42) throw new Error('missing prepared dependency')"` } }))
  put(join(root, 'fixture-dependency/package.json'), JSON.stringify({ name: 'release-fixture-dependency', version: '1.0.0', type: 'module', main: 'index.js' }))
  put(join(root, 'fixture-dependency/index.js'), 'export default 42\n')
  put(join(root, 'scripts/ios-configure.ts'), readFileSync(resolve(import.meta.dir, '../ios-configure.ts')))
  put(join(root, 'scripts/ios-export-options.plist'), readFileSync(resolve(import.meta.dir, '../ios-export-options.plist')))
  put(join(root, 'apps/ios/Skipper.xcodeproj/project.pbxproj'), 'MARKETING_VERSION = 1.2.0;\n')
  put(join(root, 'apps/ios/source.swift'), 'committed native source\n')
  execFileSync('bun', ['install', '--lockfile-only', '--ignore-scripts'], { cwd: root, stdio: 'pipe' })
  git(['add', '--', '.gitignore', 'package.json', 'bun.lock', 'fixture-dependency', 'scripts', 'apps/ios'])
  git(['-c', 'user.name=Release Fixture', '-c', 'user.email=release-fixture@example.invalid', 'commit', '-qm', 'fixture'])
  const sourceCommit = git(['rev-parse', 'HEAD'])
  put(join(root, '.scratch/ios/client-config.json'), JSON.stringify({ SKIPPER_API_URL: 'https://api.skipper.fm', SKIPPER_GOOGLE_MAPS_API_KEY: 'fixture-maps-key', SKIPPER_POSTHOG_KEY: 'fixture-posthog-key', SKIPPER_POSTHOG_HOST: 'https://us.i.posthog.com' }))
  const keys = generateKeyPairSync('ec', { namedCurve: 'P-256', privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })
  put(join(root, 'keys/AuthKey_FIXTURE.p8'), keys.privateKey)
  const calls: Array<{ cmd: string[]; cwd?: string }> = []
  const runner: CommandRunner = async (cmd, args) => {
    calls.push({ cmd, cwd: args?.cwd })
    if (cmd[0] === 'bun' && (cmd[1] === 'install' || cmd[1] === 'scripts/ios-configure.ts' || cmd[2] === 'check')) {
      const process = Bun.spawnSync(cmd, { cwd: args?.cwd, env: args?.env ?? globalThis.process.env })
      return { exitCode: process.exitCode, stdout: process.stdout.toString(), stderr: process.stderr.toString() }
    }
    if (cmd[0] === 'xcodebuild' && cmd[1] === 'archive') {
      const archive = cmd[cmd.indexOf('-archivePath') + 1]!
      mkdirSync(join(archive, 'dSYMs/Skipper.app.dSYM'), { recursive: true })
    }
    if (cmd[0] === 'xcodebuild' && cmd[1] === '-exportArchive') {
      const exported = inspectionFixture()
      put(join(cmd[cmd.indexOf('-exportPath') + 1]!, 'Skipper.ipa'), readFileSync(exported.ipa))
    }
    if (cmd[0] === 'xcrun') throw new Error('Real Apple actions are forbidden in release fixtures')
    return { exitCode: 0, stdout: '', stderr: '' }
  }
  const options: ReleaseOptions = {
    repositoryRoot: root, sourceCommit, outputDir: join(root, '.scratch/output'), buildNumber: 999,
    authConfig: { keyId: 'FIXTURE', issuerId: '00000000-0000-0000-0000-000000000000', appId: DEFAULT_APP_ID, keyPath: 'keys/AuthKey_FIXTURE.p8' },
    environment: { PATH: process.env.PATH },
    ascFetchFn: (async () => new Response(JSON.stringify({ data: [{ id: '50', attributes: { version: '50' } }] }))) as unknown as typeof fetch,
    runner, skipPosthog: true,
    inspector: async (ipa, args) => inspectIpa(ipa, { ...args, commandRunner: inspectionFixture().runner }),
  }
  return { root, options, runner, calls }
}

describe('Native release independent blocker regressions', () => {
  test('actual child receives captured environment without resurrecting ambient build overrides', async () => {
    const f = releaseFixture()
    put(join(f.root, 'config/custom.json'), JSON.stringify({ SKIPPER_API_URL: 'https://api.skipper.fm' }))
    const previousPath = process.env.SKIPPER_IOS_CONFIG_PATH
    const previousXcode = process.env.XCODE_XCCONFIG_FILE
    process.env.SKIPPER_IOS_CONFIG_PATH = 'config/custom.json'
    process.env.XCODE_XCCONFIG_FILE = '/ambient-must-not-reach-child.xcconfig'
    try {
      const environment = await captureReleaseEnvironment(f.root, { ...process.env, RELEASE_TEST_MARKER: 'captured' })
      const child = await defaultRunCommand(['bun', '-e', 'console.log(JSON.stringify({ config: process.env.SKIPPER_IOS_CONFIG_PATH ?? null, xcode: process.env.XCODE_XCCONFIG_FILE ?? null, marker: process.env.RELEASE_TEST_MARKER }))'], { env: environment })
      expect(child.exitCode).toBe(0)
      expect(JSON.parse(child.stdout)).toEqual({ config: null, xcode: null, marker: 'captured' })
    } finally {
      if (previousPath === undefined) delete process.env.SKIPPER_IOS_CONFIG_PATH
      else process.env.SKIPPER_IOS_CONFIG_PATH = previousPath
      if (previousXcode === undefined) delete process.env.XCODE_XCCONFIG_FILE
      else process.env.XCODE_XCCONFIG_FILE = previousXcode
    }
  })
  test('captures caller-relative native configuration once with explicit environment precedence', async () => {
    const f = releaseFixture()
    put(join(f.root, 'config/custom.json'), JSON.stringify({ SKIPPER_API_URL: 'https://api.skipper.fm', SKIPPER_GOOGLE_MAPS_API_KEY: 'local-maps', SKIPPER_POSTHOG_KEY: 'local-posthog' }))
    const result = await captureReleaseEnvironment(f.root, { SKIPPER_IOS_CONFIG_PATH: 'config/custom.json', SKIPPER_GOOGLE_MAPS_API_KEY: '', SKIPPER_POSTHOG_KEY: 'explicit-posthog' })
    expect(result.SKIPPER_GOOGLE_MAPS_API_KEY).toBe('')
    expect(result.SKIPPER_POSTHOG_KEY).toBe('explicit-posthog')
    expect(result.SKIPPER_API_URL).toBe('https://api.skipper.fm')
    expect(result.SKIPPER_IOS_CONFIG_PATH).toBeUndefined()
  })
  test('CLI success alone records pending symbols and cannot establish release completion', async () => {
    const f = releaseFixture()
    await runReleasePipeline({ ...f.options, skipPosthog: false,
      environment: { ...f.options.environment, POSTHOG_CLI_API_KEY: 'fixture-token', POSTHOG_CLI_PROJECT_ID: 'fixture-project' } })
    const record = readFileSync(join(f.options.outputDir!, 'release-record.md'), 'utf8')
    expect(record).toContain('PENDING (CLI returned; remote UUID/content and release association not verified)')
    expect(record).not.toContain('SHIPPED TO TESTFLIGHT')
  })
  test('default enumeration finds numeric maximum beyond five lexically ordered pages', async () => {
    let page = 0
    const fake = (async () => {
      page++
      return new Response(JSON.stringify({ data: [{ id: String(page), attributes: { version: page === 7 ? '1000' : String(9 - page) } }],
        links: { next: page < 7 ? `https://api.appstoreconnect.apple.com/v1/builds?cursor=${page}` : null } }))
    }) as unknown as typeof fetch
    expect(getLatestBuildNumber(await fetchAscBuilds('fixture', 'fixture-token', { fetchFn: fake }))).toBe(1000)
    expect(page).toBe(7)
  })
  test('requires an explicit committed SHA before touching any shared build inputs', async () => {
    await expect(runReleasePipeline({ buildNumber: 999, runner: async () => { throw new Error('must not run') } })).rejects.toThrow(/source-commit/)
  })
  test('actual isolated pipeline prepares dependencies, preserves key path/public config, and ignores shared transient edits', async () => {
    const f = releaseFixture()
    put(join(f.root, 'apps/ios/Skipper.xcodeproj/project.pbxproj'), 'MARKETING_VERSION = 9.9.9;')
    put(join(f.root, '.scratch/ios/Release.xcconfig'), 'SKIPPER_API_URL = https://wrong.invalid')
    const runner: CommandRunner = async (cmd, options) => {
      expect(options?.cwd).not.toBe(f.root)
      if (cmd[1] === 'archive') {
        expect(cmd).toContain('MARKETING_VERSION=1.2.0')
        expect(cmd[cmd.indexOf('-authenticationKeyPath') + 1]).toBe(join(f.root, 'keys/AuthKey_FIXTURE.p8'))
        expect(readFileSync(join(options!.cwd!, 'apps/ios/source.swift'), 'utf8')).toBe('committed native source\n')
        const config = readFileSync(cmd[cmd.indexOf('-xcconfig') + 1]!, 'utf8')
        expect(config).toContain('SKIPPER_GOOGLE_MAPS_API_KEY = fixture-maps-key')
        expect(config).not.toContain('wrong.invalid')
      }
      return f.runner(cmd, options)
    }
    await runReleasePipeline({ ...f.options, runner })
    const sequence = f.calls.map(call => call.cmd.join(' '))
    expect(sequence.findIndex(cmd => cmd.startsWith('bun install --frozen-lockfile'))).toBeLessThan(sequence.indexOf('bun run check'))
    expect(sequence).toContain('bun run check')
    const snapshot = JSON.parse(readFileSync(join(f.options.outputDir!, 'snapshot.json'), 'utf8'))
    expect(snapshot.gitCommit).toBe(f.options.sourceCommit)
    expect(snapshot.version).toBe('1.2.0')
    expect(snapshot.configurationHash).toHaveLength(64)
  })
  test('changing caller export plist to upload during checks cannot change frozen export destination', async () => {
    const f = releaseFixture()
    const custom = join(f.root, 'custom.plist')
    put(custom, readFileSync(resolve(import.meta.dir, '../ios-export-options.plist')))
    const runner: CommandRunner = async (cmd, args) => {
      if (cmd[2] === 'check') put(custom, xml({ destination: 'upload' }))
      if (cmd[1] === '-exportArchive') {
        const captured = cmd[cmd.indexOf('-exportOptionsPlist') + 1]!
        expect(captured).not.toBe(custom)
        expect(validateExportOptionsPlist(captured).valid).toBe(true)
        expect(validateExportOptionsPlist(captured).parsed?.destination).toBe('export')
      }
      return f.runner(cmd, args)
    }
    await runReleasePipeline({ ...f.options, exportOptionsPlist: custom, runner })
  })
  test('mutating generated release config during checks prevents archive', async () => {
    const f = releaseFixture()
    const runner: CommandRunner = async (cmd, args) => {
      const result = await f.runner(cmd, args)
      if (cmd[2] === 'check') put(join(args!.cwd!, '.scratch/ios/Release.xcconfig'), 'changed configuration')
      return result
    }
    await expect(runReleasePipeline({ ...f.options, runner })).rejects.toThrow(/Prepared release inputs changed/)
    expect(f.calls.some(call => call.cmd[1] === 'archive')).toBe(false)
  })
  test('failed fresh ASC lookup cannot be bypassed by an explicit build override', async () => {
    const f = releaseFixture()
    await expect(runReleasePipeline({ ...f.options, ascFetchFn: (async () => new Response('unavailable', { status: 503 })) as unknown as typeof fetch })).rejects.toThrow(/ASC fetch error/)
    expect(f.calls).toHaveLength(0)
  })
  test('pagination limit fails closed when another page remains', async () => {
    let calls = 0
    const fake = (async () => new Response(JSON.stringify({ data: [], links: { next: `https://api.appstoreconnect.apple.com/v1/builds?cursor=${++calls}` } }))) as unknown as typeof fetch
    await expect(fetchAscBuilds('fixture', 'fixture-token', { maxPages: 2, fetchFn: fake })).rejects.toThrow(/enumeration exceeded/)
    expect(calls).toBe(2)
  })
  test('stored and requested build numbers reject suffixes, fractions, exponents, and unsafe integers', () => {
    const builds = ['27oops', '27.9', '1e3', '0', '-1', '9007199254740993', '28'].map(buildVersion => ({ id: buildVersion, buildVersion, processingState: 'VALID' }))
    expect(extractNumericBuildNumbers(builds)).toEqual([28])
    expect(() => parseCliArgs(['--build-number', '9007199254740993'])).toThrow(/safe integer/)
  })
  test('upload cannot bypass symbols and a skipped-symbol receipt is never shipped', async () => {
    const f = releaseFixture()
    await expect(runReleasePipeline({ ...f.options, upload: true })).rejects.toThrow(/Upload requires verified checks and PostHog symbols/)
    const receipt = formatReleaseRecord({ version: '1.2.0', buildNumber: 999, gitCommit: f.options.sourceCommit!, gitDirty: false, dirtyFiles: [],
      uploadedAt: 'fixture', deliveryUuid: 'receipt', ascProcessingState: 'VALID', ascInternalState: 'IN_BETA_TESTING', checksPassed: true, posthogSymbolStatus: 'skipped_flag' })
    expect(receipt).not.toContain('SHIPPED TO TESTFLIGHT')
    expect(receipt).toContain('VERIFICATION INCOMPLETE')
  })
  test('actual inspector rejects empty signed entitlements even when profile grants everything', async () => {
    const f = inspectionFixture({ signed: {} })
    const result = await inspectIpa(f.ipa, { commandRunner: f.runner, archivePath: f.archive })
    expect(result.valid).toBe(false)
    expect(result.teamId).toBe('')
    expect(result.appIdentifier).toBe('')
    expect(result.associatedDomains).toEqual([])
  })
  test('actual inspector derives omitted default Keychain group only from signed app identifier', async () => {
    const f = inspectionFixture({ omitGroups: true })
    const result = await inspectIpa(f.ipa, { commandRunner: f.runner, archivePath: f.archive })
    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
    expect(result.keychainGroups).toEqual([fixtureAppId])
  })
  test('actual inspector rejects wrong default group and domain substring spoofing', async () => {
    const f = inspectionFixture({ signed: { ...fixtureSigned, 'keychain-access-groups': [`${DEFAULT_TEAM_ID}.other`, fixtureAppId],
      'com.apple.developer.associated-domains': ['webcredentials:skipper.fm.evil.invalid'] } })
    const result = await inspectIpa(f.ipa, { commandRunner: f.runner, archivePath: f.archive })
    expect(result.valid).toBe(false)
    expect(result.errors.some(error => error.includes('signed default group'))).toBe(true)
    expect(result.errors.some(error => error.includes('associated domain'))).toBe(true)
  })
  test('actual inspector checks profile authorization separately from correct signed entitlements', async () => {
    const f = inspectionFixture({ profile: { ...fixtureSigned, 'application-identifier': 'OTHER.app' } })
    const result = await inspectIpa(f.ipa, { commandRunner: f.runner, archivePath: f.archive })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Provisioning profile does not authorize the signed application identifier')
  })
  test('actual inspector catches runtime in innocently named embedded Mach-O', async () => {
    const f = inspectionFixture({ embeddedRuntime: true })
    const result = await inspectIpa(f.ipa, { commandRunner: f.runner, archivePath: f.archive })
    expect(result.valid).toBe(false)
    expect(result.scannedBinaries).toContain('Frameworks/Innocent.framework/Innocent')
    expect(result.bannedSymbolsFound.some(marker => marker.includes('RCTBridge'))).toBe(true)
  })
  test('actual inspector fails closed if otool or nm fails', async () => {
    for (const failTool of ['otool', 'nm']) {
      const f = inspectionFixture({ failTool })
      await expect(inspectIpa(f.ipa, { commandRunner: f.runner, archivePath: f.archive })).rejects.toThrow(/native runtime scan is incomplete/)
    }
  })
  test('actual inspector rejects mismatched bundled PostHog host', async () => {
    const f = inspectionFixture({ host: 'https://telemetry-staging.invalid' })
    const result = await inspectIpa(f.ipa, { commandRunner: f.runner, archivePath: f.archive, expectedPostHogHost: 'https://us.i.posthog.com' })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('SkipperPostHogHost does not match the frozen production configuration')
  })
})

// The EAS/Apple boundaries below are simulated. The enclosing release still uses the real local
// checkout, dependency preparation, configuration capture, export inspection, and artifact hashing.
function symbolsReleaseFixture() {
  const fixture = releaseFixture()
  const stages: string[] = []
  let prepared: PreparedEasSymbols
  const verification = (manifest: SymbolsManifest): AuthenticatedSymbolsVerification => ({
    verification: 'authenticated-eas-artifact', workflowRunId: 'fixture-workflow', jobId: 'fixture-job',
    artifactId: 'fixture-artifact', manifestSha256: manifestSha256(manifest),
    receipt: { schemaVersion: 1, manifestSha256: manifestSha256(manifest), manifest,
      upload: { command: ['fixture-only'], exitCode: 0, processedUuids: [], uploadedCount: 0,
        release: { name: manifest.bundleId, version: manifest.version, build: String(manifest.buildNumber) }, messages: [] }, readbacks: [] },
  })
  const adapter: NonNullable<ReleaseOptions['symbolsAdapter']> = {
    prepare: async input => {
      stages.push('prepare')
      expect(input.expectedArchiveSha256).toBe(await hashArchive(input.archivePath))
      expect(input.expectedIpaSha256).toBe(await hashFile(input.ipaPath))
      expect(input.sourceCommit).toBe(fixture.options.sourceCommit!)
      expect(input.version).toBe('1.2.0')
      expect(input.buildNumber).toBe(999)
      expect(input.posthogHost).toBe('https://us.posthog.com')
      const manifest: SymbolsManifest = { schemaVersion: 1, sourceCommit: input.sourceCommit, version: input.version,
        buildNumber: input.buildNumber, bundleId: input.bundleId, archiveSha256: input.expectedArchiveSha256,
        ipaSha256: input.expectedIpaSha256, easProjectId: input.easProjectId, posthogProjectId: input.posthogProjectId,
        posthogHost: input.posthogHost!, posthogCliVersion: '0.9.1', symbolsZipSha256: 'a'.repeat(64),
        supportSha256: { worker: 'b'.repeat(64), archive: 'c'.repeat(64) }, files: [], slices: [] }
      prepared = { manifest, stagingDirectory: input.stagingDirectory, manifestSha256: manifestSha256(manifest), stageFiles: [] }
      return prepared
    },
    execute: async (input, options) => {
      stages.push('execute')
      expect(input).toBe(prepared)
      put(options.receiptPath, JSON.stringify(verification(input.manifest)))
      return verification(input.manifest)
    },
    verify: async (path, manifest) => {
      stages.push('fresh-verify')
      expect(JSON.parse(readFileSync(path, 'utf8')).manifestSha256).toBe(manifestSha256(manifest))
      return verification(manifest)
    },
  }
  const options: ReleaseOptions = { ...fixture.options, symbolsEas: true, skipPosthog: false,
    easProjectId: '00000000-0000-0000-0000-000000000001', posthogProjectId: '42', symbolsAdapter: adapter }
  return { ...fixture, options, adapter, stages, verification }
}

describe('In-process EAS symbols release integration', () => {
  test('binds exact artifacts to fresh verification before Apple and records authenticated references', async () => {
    const f = symbolsReleaseFixture()
    let ascCalls = 0
    const ascFetchFn = (async () => {
      if (++ascCalls === 1) return new Response(JSON.stringify({ data: [{ id: '50', attributes: { version: '50' } }] }))
      return new Response(JSON.stringify({ data: [{ id: '999', attributes: { version: '999', processingState: 'VALID', usesNonExemptEncryption: false },
        relationships: { preReleaseVersion: { data: { id: 'version' } }, buildBetaDetail: { data: { id: 'beta' } } } }],
        included: [{ type: 'preReleaseVersions', id: 'version', attributes: { version: '1.2.0' } },
          { type: 'buildBetaDetails', id: 'beta', attributes: { internalBuildState: 'IN_BETA_TESTING' } }] }))
    }) as unknown as typeof fetch
    const runner: CommandRunner = async (cmd, options) => {
      if (cmd[0] !== 'xcrun') return f.runner(cmd, options)
      expect(f.stages.slice(0, 3)).toEqual(['prepare', 'execute', 'fresh-verify'])
      f.stages.push(cmd.includes('--upload-package') ? 'apple-upload' : 'apple-validate')
      return { exitCode: 0, stdout: 'Delivery UUID: 11111111-2222-3333-4444-555555555555', stderr: '' }
    }
    await runReleasePipeline({ ...f.options, upload: true, runner, ascFetchFn })
    expect(f.stages).toEqual(['prepare', 'execute', 'fresh-verify', 'apple-validate', 'apple-upload'])
    expect(ascCalls).toBe(2)
    const record = readFileSync(join(f.options.outputDir!, 'release-record.md'), 'utf8')
    expect(record).toContain('SHIPPED TO TESTFLIGHT')
    expect(record).toContain('fixture-workflow')
    expect(record).toContain('fixture-artifact')
    expect(record).toContain(await hashArchive(join(f.options.outputDir!, 'Skipper.xcarchive')))
    expect(record).toContain(await hashFile(join(f.options.outputDir!, 'skipper-1.2.0-999.ipa')))
    expect(existsSync(join(f.options.outputDir!, 'symbols-receipt.json'))).toBe(true)
  })

  test('successful workflow return cannot bypass failed fresh authenticated verification', async () => {
    const f = symbolsReleaseFixture()
    f.adapter.verify = async () => { f.stages.push('fresh-verify'); throw new Error('authenticated artifact unavailable') }
    await expect(runReleasePipeline({ ...f.options, upload: true })).rejects.toThrow(/authenticated artifact unavailable/)
    expect(f.stages).toEqual(['prepare', 'execute', 'fresh-verify'])
    expect(f.calls.some(call => call.cmd[0] === 'xcrun')).toBe(false)
    expect(existsSync(join(f.options.outputDir!, 'release-record.md'))).toBe(false)
  })

  test('fresh verification for a different manifest cannot authorize Apple delivery', async () => {
    const f = symbolsReleaseFixture()
    f.adapter.verify = async (_path, manifest) => ({ ...f.verification(manifest), manifestSha256: 'f'.repeat(64) })
    await expect(runReleasePipeline({ ...f.options, upload: true })).rejects.toThrow(/verification does not match/)
    expect(f.calls.some(call => call.cmd[0] === 'xcrun')).toBe(false)
  })

  test('a prepare result for a different IPA is rejected before starting a cloud workflow', async () => {
    const f = symbolsReleaseFixture()
    const original = f.adapter.prepare
    f.adapter.prepare = async input => {
      const prepared = await original(input)
      prepared.manifest.ipaSha256 = 'f'.repeat(64)
      prepared.manifestSha256 = manifestSha256(prepared.manifest)
      return prepared
    }
    await expect(runReleasePipeline({ ...f.options, upload: true })).rejects.toThrow(/does not identify this release/)
    expect(f.stages).toEqual(['prepare'])
  })

  for (const artifact of ['archive', 'ipa'] as const) {
    test(`changing ${artifact} during symbols verification prevents Apple delivery`, async () => {
      const f = symbolsReleaseFixture()
      const original = f.adapter.verify
      f.adapter.verify = async (...args) => {
        const verified = await original(...args)
        put(join(f.options.outputDir!, artifact === 'archive' ? 'Skipper.xcarchive/dSYMs/changed' : 'skipper-1.2.0-999.ipa'), 'changed bytes')
        return verified
      }
      await expect(runReleasePipeline({ ...f.options, upload: true })).rejects.toThrow(/changed before delivery/)
      expect(f.calls.some(call => call.cmd[0] === 'xcrun')).toBe(false)
    })
  }

  test('upload requires in-process authenticated symbols and a status-only receipt is incomplete', async () => {
    const f = symbolsReleaseFixture()
    await expect(runReleasePipeline({ ...f.options, upload: true, symbolsEas: false })).rejects.toThrow(/requires --symbols-eas/)
    const record = formatReleaseRecord({ version: '1.2.0', buildNumber: 999, gitCommit: f.options.sourceCommit!, gitDirty: false,
      dirtyFiles: [], uploadedAt: 'fixture', deliveryUuid: 'fixture', ascProcessingState: 'VALID', ascInternalState: 'IN_BETA_TESTING',
      checksPassed: true, posthogSymbolStatus: 'uploaded' })
    expect(record).not.toContain('SHIPPED TO TESTFLIGHT')
    expect(record).toContain('VERIFICATION INCOMPLETE')
  })
})

describe('Release-run XCTest evidence retention', () => {
  for (const exitCode of [0, 65]) {
    test(`retains new native result bytes and provenance after checkout cleanup when ios-check exits ${exitCode}`, async () => {
      const f = releaseFixture()
      let checkout = ''
      const runner: CommandRunner = async (cmd, args) => {
        const result = await f.runner(cmd, args)
        if (cmd[0] === 'bun' && cmd[2] === 'check') {
          // Evidence left before the ios-check invocation and unrelated scratch data are excluded.
          put(join(args!.cwd!, '.scratch/ios/Test-1000.xcresult/Info.plist'), 'older evidence')
          put(join(args!.cwd!, '.scratch/ios/private.txt'), 'fixture secret outside the bundle')
        }
        if (cmd[0] === 'bun' && cmd[2] === 'ios:check') {
          checkout = args!.cwd!
          put(join(checkout, '.scratch/ios/Test-2000.xcresult/Info.plist'), 'fixture XCTest metadata')
          put(join(checkout, '.scratch/ios/Test-2000.xcresult/Data/result'), 'exact result bytes')
          return { ...result, exitCode }
        }
        return result
      }
      if (exitCode) await expect(runReleasePipeline({ ...f.options, runner })).rejects.toThrow(/ios-check failed \(exit 65\)/)
      else await runReleasePipeline({ ...f.options, runner })
      expect(checkout).not.toBe('')
      expect(existsSync(checkout)).toBe(false)
      const evidence = JSON.parse(readFileSync(join(f.options.outputDir!, 'native-check-evidence.json'), 'utf8'))
      const snapshot = JSON.parse(readFileSync(join(f.options.outputDir!, 'snapshot.json'), 'utf8'))
      expect(evidence.sourceCommit).toBe(f.options.sourceCommit!)
      expect(evidence.sourceContentHash).toBe(snapshot.sourceContentHash)
      expect(evidence.configurationHash).toBe(snapshot.configurationHash)
      expect(evidence.commandExitCode).toBe(exitCode)
      expect(evidence.retentionStatus).toBe('complete')
      expect(evidence.bundles).toHaveLength(1)
      const bundle = join(f.options.outputDir!, evidence.bundles[0].path)
      expect(readFileSync(join(bundle, 'Data/result'), 'utf8')).toBe('exact result bytes')
      expect(await hashArchive(bundle)).toBe(evidence.bundles[0].sha256)
      expect(existsSync(join(f.options.outputDir!, 'native-test-results/Test-1000.xcresult'))).toBe(false)
      expect(existsSync(join(f.options.outputDir!, 'native-test-results/private.txt'))).toBe(false)
      if (exitCode) {
        expect(f.calls.some(call => call.cmd[1] === 'archive')).toBe(false)
        expect(existsSync(join(f.options.outputDir!, 'release-record.md'))).toBe(false)
      } else {
        const record = readFileSync(join(f.options.outputDir!, 'release-record.md'), 'utf8')
        expect(record).toContain('native-test-results/Test-2000.xcresult')
        expect(record).toContain(evidence.bundles[0].sha256)
      }
    })
  }

  test('a failed check before Xcode creates a bundle records no fabricated result path', async () => {
    const f = releaseFixture()
    const runner: CommandRunner = async (cmd, args) => {
      if (cmd[0] === 'bun' && cmd[2] === 'ios:check') return { exitCode: 70, stdout: '', stderr: 'fixture build failure' }
      return f.runner(cmd, args)
    }
    await expect(runReleasePipeline({ ...f.options, runner })).rejects.toThrow(/ios-check failed \(exit 70\)/)
    const evidence = JSON.parse(readFileSync(join(f.options.outputDir!, 'native-check-evidence.json'), 'utf8'))
    expect(evidence.commandExitCode).toBe(70)
    expect(evidence.bundles).toEqual([])
    expect(existsSync(join(f.options.outputDir!, 'native-test-results'))).toBe(false)
  })

  test('a result bundle cannot copy a symlink target from outside its evidence directory', async () => {
    const f = releaseFixture()
    put(join(f.root, 'private-fixture.txt'), 'must not be copied')
    const runner: CommandRunner = async (cmd, args) => {
      if (cmd[0] === 'bun' && cmd[2] === 'ios:check') {
        const bundle = join(args!.cwd!, '.scratch/ios/Test-2000.xcresult')
        put(join(bundle, 'Info.plist'), 'fixture result')
        symlinkSync(join(f.root, 'private-fixture.txt'), join(bundle, 'outside'))
      }
      return f.runner(cmd, args)
    }
    await expect(runReleasePipeline({ ...f.options, runner })).rejects.toThrow(/result retention failed/)
    const evidence = JSON.parse(readFileSync(join(f.options.outputDir!, 'native-check-evidence.json'), 'utf8'))
    expect(evidence.commandExitCode).toBe(0)
    expect(evidence.retentionStatus).toBe('failed')
    expect(evidence.bundles).toEqual([])
    expect(evidence.failedBundles).toEqual(['Test-2000.xcresult'])
    expect(existsSync(join(f.options.outputDir!, 'native-test-results/Test-2000.xcresult'))).toBe(false)
    expect(readFileSync(join(f.root, 'private-fixture.txt'), 'utf8')).toBe('must not be copied')
    expect(f.calls.some(call => call.cmd[1] === 'archive')).toBe(false)
  })
})
