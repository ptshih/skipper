#!/usr/bin/env bun
// Native iOS release automation: archive, export, inspect, symbol upload, validate, upload, and verify.
//
// Usage:
//   dotenvx run -f .env.development -- bun scripts/ios-release.ts [options]
//
// Safe default:
//   Prepares and inspects the release package (.ipa) in .scratch/releases/<version>-<build>/
//   Does NOT upload without the explicit `--upload` flag.
//
// Flags:
//   --upload                  Explicitly validate and upload the inspected IPA to App Store Connect via altool
//   --version <v>             Marketing version override (default: reads from Xcode project)
//   --build-number <b>        Build number override (default: fresh numeric max from ASC + 1)
//   --skip-preconditions      Skip running `bun run check` and `bun run ios:check`
//   --skip-posthog            Skip PostHog dSYM symbol upload
//   --symbols-eas             Upload and verify symbols through the macOS EAS workflow before delivery
//   --eas-project-id <uuid>    EAS project (or SKIPPER_EAS_PROJECT_ID)
//   --posthog-project-id <id>  PostHog project (or POSTHOG_CLI_PROJECT_ID)
//   --inspect-only <ipa>      Run standalone inspection on an existing IPA
//   --output-dir <dir>        Custom directory for release artifacts
//   --export-options <plist>  Custom export options plist (default: scripts/ios-export-options.plist)
//   --dry-run                 Preview commands without executing external tools
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, rmSync } from 'node:fs'
import { chmod, copyFile, cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { NATIVE_CONFIG_KEYS, readNativeLocalConfiguration } from './ios-configure'
import {
  ARCHIVE_HASH_CONVENTION, executeEasSymbols, hashArchive, manifestSha256, prepareEasSymbols, verifyEasSymbolsReceipt,
  type AuthenticatedSymbolsVerification,
} from './ios-symbols-eas'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import {
  fetchAscBuilds,
  generateAscJwt,
  getLatestBuildNumber,
  readAscConfigFromEnv,
  waitForBuildReadiness,
  type AscAuthConfig,
  type AscBuildInfo,
} from '../.claude/skills/testflight/asc-builds'
import {
  inspectIpa,
  type IpaInspectionResult,
} from './ios-release-inspect'

export const DEFAULT_TEAM_ID = 'L24UJYJ5DK'
export const DEFAULT_BUNDLE_ID = 'fm.skipper.app'
export const DEFAULT_APP_ID = '6778946770'

export type CommandRunner = (
  cmd: string[],
  options?: { cwd?: string; env?: Record<string, string>; logPath?: string },
) => Promise<{ exitCode: number; stdout: string; stderr: string }>

export interface ReleaseOptions {
  upload?: boolean
  version?: string
  buildNumber?: number
  skipPreconditions?: boolean
  skipPosthog?: boolean
  symbolsEas?: boolean
  easProjectId?: string
  posthogProjectId?: string
  inspectOnly?: string
  outputDir?: string
  exportOptionsPlist?: string
  dryRun?: boolean
  requireClean?: boolean
  sourceCommit?: string
  repositoryRoot?: string
  environment?: Record<string, string | undefined>
  runner?: CommandRunner
  inspector?: (ipaPath: string, options?: any) => Promise<IpaInspectionResult>
  authConfig?: AscAuthConfig
  ascFetchFn?: typeof fetch
  symbolsAdapter?: {
    prepare: typeof prepareEasSymbols
    execute: typeof executeEasSymbols
    verify: typeof verifyEasSymbolsReceipt
  }
}

export interface ReleaseMetadata {
  version: string
  buildNumber: number
  gitCommit: string
  gitDirty: boolean
  dirtyFiles: string[]
  sourceContentHash?: string
  configurationHash?: string
  exportOptionsHash?: string
  archiveSha256?: string
  symbolsReceiptPath?: string
  symbolsVerification?: Pick<AuthenticatedSymbolsVerification, 'verification' | 'workflowRunId' | 'jobId' | 'artifactId' | 'manifestSha256'>
  checksPassed?: boolean
  nativeCheckResults?: Array<{ path: string; sha256: string }>
  ipaPath?: string
  ipaSha256?: string
  ipaSizeBytes?: number
  inspection?: IpaInspectionResult
  posthogSymbolStatus?: 'uploaded' | 'pending_verification' | 'skipped_no_keys' | 'skipped_flag'
  uploadedAt?: string
  deliveryUuid?: string
  deliveryReceiptError?: string
  ascVerificationError?: string
  ascProcessingState?: string
  ascInternalState?: string
}

export function parseCliArgs(argv: string[]): ReleaseOptions {
  if (argv.some(value => value === '--symbols-receipt' || value.startsWith('--symbols-receipt='))) {
    throw new Error('--symbols-receipt resume is unsupported: use --symbols-eas with the archive and IPA created in this execution')
  }
  const has = (flag: string) => argv.includes(`--${flag}`)
  const getFlag = (flag: string): string | undefined => {
    const idx = argv.indexOf(`--${flag}`)
    return idx >= 0 ? argv[idx + 1] : undefined
  }

  const buildNumStr = getFlag('build-number')
  let buildNumber: number | undefined
  if (buildNumStr !== undefined) {
    const trimmed = buildNumStr.trim()
    if (!/^[1-9]\d*$/.test(trimmed)) {
      throw new Error(`Invalid --build-number: "${buildNumStr}". Must be a strict positive integer (e.g. 27). Decimals, trailing text, zero, and negative values are rejected.`)
    }
    buildNumber = Number(trimmed)
    if (!Number.isSafeInteger(buildNumber)) throw new Error('Invalid --build-number: exceeds safe integer range')
  }

  return {
    upload: has('upload'),
    version: getFlag('version'),
    buildNumber,
    skipPreconditions: has('skip-preconditions'),
    skipPosthog: has('skip-posthog'),
    symbolsEas: has('symbols-eas'),
    easProjectId: getFlag('eas-project-id'),
    posthogProjectId: getFlag('posthog-project-id'),
    inspectOnly: getFlag('inspect-only') ?? getFlag('inspect'),
    outputDir: getFlag('output-dir'),
    exportOptionsPlist: getFlag('export-options'),
    dryRun: has('dry-run'),
    requireClean: has('require-clean'),
    sourceCommit: getFlag('source-commit'),
  }
}

export function redactSecrets(text: string, sensitiveValues: (string | undefined)[] = []): string {
  let result = text
  for (const s of sensitiveValues) {
    if (s && s.length >= 4) {
      result = result.replaceAll(s, '[REDACTED]')
    }
  }
  result = result.replace(/-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+ PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
  result = result.replace(/Bearer\s+[A-Za-z0-9-_.]+/gi, 'Bearer [REDACTED]')
  result = result.replace(/(--api-key|--api-issuer|-authenticationKeyID|-authenticationKeyIssuerID)\s+[^\s]+/g, '$1 [REDACTED]')
  result = result.replace(/(POSTHOG_CLI_API_KEY|ASC_API_KEY)=([^\s]+)/gi, '$1=[REDACTED]')
  return result
}

export function validateExportOptionsPlist(
  plistPath: string,
  expectedTeamId: string = DEFAULT_TEAM_ID,
): { valid: boolean; errors: string[]; parsed?: Record<string, any> } {
  const resolvedPlist = resolve(plistPath)
  if (!existsSync(resolvedPlist)) {
    return { valid: false, errors: [`Export options plist not found: ${resolvedPlist}`] }
  }

  let parsed: Record<string, any>
  const tmpJsonPath = join(tmpdir(), `export-plist-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
  try {
    execFileSync('plutil', ['-convert', 'json', '-o', tmpJsonPath, resolvedPlist], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const rawJson = readFileSync(tmpJsonPath, 'utf8')
    parsed = JSON.parse(rawJson)
  } catch (err: any) {
    const errText = err.stderr ? String(err.stderr).trim() : err.message
    return {
      valid: false,
      errors: [`Failed to parse export options plist via plutil: ${errText}`],
    }
  } finally {
    if (existsSync(tmpJsonPath)) {
      try {
        rmSync(tmpJsonPath)
      } catch {}
    }
  }

  const errors: string[] = []

  // Destination check: MUST NOT be upload (prevents bypassing post-export inspection)
  const destination = parsed.destination
  if (destination !== 'export') {
    errors.push(`Disallowed destination "${destination}" in export options plist. Only "export" is permitted to prevent premature uninspected uploads.`)
  }

  // Method check: must be app-store-connect or app-store
  const method = parsed.method
  if (method !== 'app-store-connect' && method !== 'app-store') {
    errors.push(`Invalid distribution method "${method}". Must be "app-store-connect" or "app-store".`)
  }

  // Team ID check
  const teamID = parsed.teamID
  if (teamID !== expectedTeamId) {
    errors.push(`Invalid teamID "${teamID}" in export options plist. Expected "${expectedTeamId}".`)
  }

  // manageAppVersionAndBuildNumber check: must be false
  if (parsed.manageAppVersionAndBuildNumber !== false) {
    errors.push('manageAppVersionAndBuildNumber must be false to prevent Apple from mutating release build numbers.')
  }

  return {
    valid: errors.length === 0,
    errors,
    parsed,
  }
}

export async function computeSourceBuildInputsHash(rootDir: string = resolve(import.meta.dir, '..')): Promise<{
  hash: string; fileCount: number; files: string[]
}> {
  const root = resolve(rootDir)
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root }).toString().split('\0').filter(Boolean)
  // Generated configuration is a build input too. Never omit it from recorded provenance.
  for (const path of ['.scratch/ios/Release.xcconfig', '.scratch/ios/Debug.xcconfig',
    '.scratch/ios/frozen/Release.xcconfig', '.scratch/ios/frozen/export-options.plist']) {
    if (existsSync(resolve(root, path))) files.push(path)
  }
  files.sort()
  const hasher = createHash('sha256')
  for (const path of files) {
    const full = resolve(root, path)
    const content = lstatSync(full).isSymbolicLink() ? readlinkSync(full) : readFileSync(full)
    hasher.update(`${path}:${createHash('sha256').update(content).digest('hex')}\n`)
  }
  return { hash: hasher.digest('hex'), fileCount: files.length, files }
}

export function getGitProvenance(rootDir: string): {
  gitCommit: string
  dirtyFiles: string[]
  isClean: boolean
} {
  let gitCommit = 'unknown'
  try {
    const revProc = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: rootDir })
    if (revProc.exitCode === 0) {
      gitCommit = revProc.stdout.toString('utf8').trim()
    }
  } catch {}

  const dirtyFiles: string[] = []
  try {
    const statusProc = Bun.spawnSync(['git', 'status', '--porcelain', '--untracked-files=no'], { cwd: rootDir })
    if (statusProc.exitCode === 0) {
      const lines = statusProc.stdout.toString('utf8').split('\n').map((l) => l.trim()).filter(Boolean)
      for (const l of lines) {
        dirtyFiles.push(l)
      }
    }
  } catch {}

  return {
    gitCommit,
    dirtyFiles,
    isClean: dirtyFiles.length === 0,
  }
}

export function readProjectMarketingVersion(projectPbxprojContent: string): string {
  const match = projectPbxprojContent.match(/MARKETING_VERSION = ([^;]+);/)
  if (!match || !match[1]) {
    throw new Error('Unable to parse MARKETING_VERSION from Xcode project')
  }
  return match[1].trim()
}

export function computeNextBuildNumber(ascBuilds: AscBuildInfo[], projectVersionNumber?: number): number {
  const ascLatest = getLatestBuildNumber(ascBuilds)
  const base = Math.max(ascLatest, projectVersionNumber ?? 0)
  return base + 1
}

export function computeSha256(filePath: string): string {
  const content = readFileSync(filePath)
  return createHash('sha256').update(content).digest('hex')
}

export function buildArchiveCommandArgs(options: {
  projectPath: string
  scheme: string
  configuration: string
  destination: string
  archivePath: string
  derivedDataPath: string
  clonedSourcePackagesPath: string
  marketingVersion: string
  buildNumber: number
  authConfig?: AscAuthConfig
  configurationFile?: string
}): string[] {
  const args = [
    'archive',
    '-project', options.projectPath,
    '-scheme', options.scheme,
    '-configuration', options.configuration,
    '-destination', options.destination,
    '-archivePath', options.archivePath,
    '-derivedDataPath', options.derivedDataPath,
    '-clonedSourcePackagesDirPath', options.clonedSourcePackagesPath,
    `MARKETING_VERSION=${options.marketingVersion}`,
    `CURRENT_PROJECT_VERSION=${options.buildNumber}`,
  ]

  if (options.configurationFile) args.push('-xcconfig', options.configurationFile)

  if (options.authConfig) {
    args.push(
      '-allowProvisioningUpdates',
      '-authenticationKeyPath', options.authConfig.keyPath,
      '-authenticationKeyID', options.authConfig.keyId,
      '-authenticationKeyIssuerID', options.authConfig.issuerId,
    )
  }

  return args
}

export function buildExportCommandArgs(options: {
  archivePath: string
  exportPath: string
  exportOptionsPlist: string
  authConfig?: AscAuthConfig
}): string[] {
  const args = [
    '-exportArchive',
    '-archivePath', options.archivePath,
    '-exportPath', options.exportPath,
    '-exportOptionsPlist', options.exportOptionsPlist,
  ]

  if (options.authConfig) {
    args.push(
      '-allowProvisioningUpdates',
      '-authenticationKeyPath', options.authConfig.keyPath,
      '-authenticationKeyID', options.authConfig.keyId,
      '-authenticationKeyIssuerID', options.authConfig.issuerId,
    )
  }

  return args
}

export function buildAltoolValidateArgs(options: {
  ipaPath: string
  authConfig: AscAuthConfig
}): string[] {
  return [
    'altool',
    '--validate-app', options.ipaPath,
    '--api-key', options.authConfig.keyId,
    '--api-issuer', options.authConfig.issuerId,
    '--p8-file-path', options.authConfig.keyPath,
    '--output-format', 'json',
  ]
}

export function buildAltoolUploadArgs(options: {
  ipaPath: string
  authConfig: AscAuthConfig
}): string[] {
  return [
    'altool',
    '--upload-package', options.ipaPath,
    '--api-key', options.authConfig.keyId,
    '--api-issuer', options.authConfig.issuerId,
    '--p8-file-path', options.authConfig.keyPath,
    '--output-format', 'json',
  ]
}

export const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

export function extractDeliveryUuid(stdout: string, stderr: string = ''): string {
  let jsonUuid: string | undefined

  // 1. Validate structured JSON details.delivery-uuid (from altool --output-format json)
  const trimmed = stdout.trim()
  const looksLikeJson = trimmed.startsWith('{') || (trimmed.includes('{') && trimmed.includes('delivery-uuid'))
  if (looksLikeJson) {
    let parsed: any
    try {
      parsed = JSON.parse(trimmed)
    } catch (err: any) {
      throw new Error(`Malformed Apple delivery JSON in stdout: ${err.message}`)
    }
    const raw = parsed?.details?.['delivery-uuid'] ?? parsed?.['delivery-uuid'] ?? parsed?.details?.deliveryUuid
    if (raw !== undefined) {
      if (typeof raw === 'string' && UUID_REGEX.test(raw.trim())) {
        jsonUuid = raw.trim().toLowerCase()
      } else {
        throw new Error(`Malformed Apple delivery UUID in JSON output: ${JSON.stringify(raw)}`)
      }
    }
  }

  // 2. Validate supported plaintext format in stdout and stderr
  const textUuids = new Set<string>()
  for (const stream of [stdout, stderr]) {
    const matches = stream.matchAll(/Delivery UUID:\s*(\S+)/gi)
    for (const match of matches) {
      const candidate = match[1]?.trim()
      if (candidate) {
        if (UUID_REGEX.test(candidate)) {
          textUuids.add(candidate.toLowerCase())
        } else {
          throw new Error(`Malformed Apple delivery UUID in plaintext output: "${candidate}"`)
        }
      }
    }
  }

  // 3. Reject conflicting receipt claims
  if (jsonUuid && textUuids.size > 0 && !textUuids.has(jsonUuid)) {
    throw new Error(`Conflicting Apple delivery UUID claims: JSON reported "${jsonUuid}" but plaintext reported "${Array.from(textUuids).join(', ')}"`)
  }
  if (textUuids.size > 1) {
    throw new Error(`Conflicting Apple delivery UUID claims in plaintext output: ${Array.from(textUuids).join(', ')}`)
  }

  const finalUuid = jsonUuid ?? Array.from(textUuids)[0]
  if (!finalUuid || finalUuid === 'unknown') {
    throw new Error('Could not extract valid Apple delivery UUID from altool output')
  }

  return finalUuid
}

export function buildPosthogUploadArgs(options: {
  dsymDirectory: string
  releaseName: string
  releaseVersion: string
  buildNumber: number
}): string[] {
  return [
    'dsym',
    'upload',
    '--directory', options.dsymDirectory,
    '--release-name', options.releaseName,
    '--release-version', options.releaseVersion,
    '--build', String(options.buildNumber),
    '--skip-release-on-fail',
  ]
}

export async function defaultRunCommand(
  cmd: string[],
  options: { cwd?: string; env?: Record<string, string>; logPath?: string } = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, {
    cwd: options.cwd,
    // Captured release environments are complete snapshots. Merging ambient variables here
    // would resurrect XCODE_XCCONFIG_FILE and caller-relative native config paths.
    env: options.env ?? process.env,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const [stdoutBuf, stderrBuf] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).arrayBuffer(),
  ])
  const exitCode = await proc.exited
  const stdout = Buffer.from(stdoutBuf).toString('utf8')
  const stderr = Buffer.from(stderrBuf).toString('utf8')

  if (options.logPath) {
    const sensitive = Object.entries({ ...process.env, ...options.env })
      .filter(([key]) => /KEY|TOKEN|SECRET|PASSWORD/.test(key)).map(([, value]) => value)
    const redactedCmd = redactSecrets(cmd.join(' '), sensitive)
    const redactedStdout = redactSecrets(stdout, sensitive)
    const redactedStderr = redactSecrets(stderr, sensitive)
    await writeFile(
      options.logPath,
      `Command: ${redactedCmd}\nExit code: ${exitCode}\n\nSTDOUT:\n${redactedStdout}\n\nSTDERR:\n${redactedStderr}`,
    )
  }

  return { exitCode, stdout, stderr }
}

/** Resolve ignored native settings before entering the checkout; explicit empty env values stay empty. */
export async function captureReleaseEnvironment(root: string, environment: Record<string, string | undefined>): Promise<Record<string, string>> {
  const result = Object.fromEntries(Object.entries(environment).filter((entry): entry is [string, string] => entry[1] !== undefined))
  const local = await readNativeLocalConfiguration(root, environment)
  for (const key of NATIVE_CONFIG_KEYS) {
    const value = environment[key] ?? local[key]
    if (value !== undefined) result[key] = value
  }
  // The checkout must consume the captured values, never re-open a caller-relative mutable file.
  delete result.SKIPPER_IOS_CONFIG_PATH
  delete result.XCODE_XCCONFIG_FILE
  if (result.ASC_KEY_ID) result.ASC_API_KEY_PATH = resolve(root, result.ASC_API_KEY_PATH ?? `keys/AuthKey_${result.ASC_KEY_ID}.p8`)
  return result
}

function readFrozenConfiguration(path: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = line.match(/^(SKIPPER_[A-Z_]+) = (.*)$/)
    if (match?.[1] && match[2] !== undefined) values[match[1]] = match[2].replaceAll('/$()/', '//')
  }
  for (const key of ['SKIPPER_API_URL', 'SKIPPER_GOOGLE_MAPS_API_KEY', 'SKIPPER_POSTHOG_KEY', 'SKIPPER_POSTHOG_HOST']) {
    if (!values[key] || values[key].includes('$(')) throw new Error(`Frozen release configuration is missing or unresolved: ${key}`)
  }
  return values
}

async function retainNativeCheckResults(checkoutRoot: string, outputDir: string, previousNames: Set<string>) {
  const directory = resolve(checkoutRoot, '.scratch/ios')
  const bundles: NonNullable<ReleaseMetadata['nativeCheckResults']> = []
  const failedBundles: string[] = []
  // This is the filename contract of ios-check.ts, captured around this invocation only.
  // Never preserve the surrounding scratch tree, pre-existing results, links, or special files.
  for (const name of readdirSync(directory).sort()) {
    if (!/^Test-\d+\.xcresult$/.test(name) || previousNames.has(name)) continue
    const source = join(directory, name)
    const relativePath = `native-test-results/${name}`
    const destination = resolve(outputDir, relativePath)
    let copyStarted = false
    try {
      if (!lstatSync(source).isDirectory() || lstatSync(source).isSymbolicLink()) throw new Error('Not a real result directory')
      await mkdir(resolve(outputDir, 'native-test-results'), { recursive: true, mode: 0o700 })
      if (existsSync(destination)) throw new Error('Result destination already exists')
      copyStarted = true
      await cp(source, destination, { recursive: true, dereference: false, force: false, errorOnExist: true,
        filter: path => {
          const entry = lstatSync(path)
          if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) throw new Error('Unsafe result entry')
          return true
        } })
      const sha256 = await hashArchive(source)
      if (await hashArchive(destination) !== sha256) throw new Error('Result changed while retaining evidence')
      bundles.push({ path: relativePath, sha256 })
    } catch {
      // Remove only this incomplete owned copy; report its name without tool output or credentials.
      if (copyStarted) rmSync(destination, { recursive: true, force: true })
      failedBundles.push(name)
    }
  }
  return { bundles, failedBundles }
}

export async function runReleasePipeline(options: Partial<ReleaseOptions> = {}): Promise<void> {
  const root = resolve(options.repositoryRoot ?? resolve(import.meta.dir, '..'))
  const runCommand = options.runner ?? defaultRunCommand
  if (options.inspectOnly) {
    const result = await inspectIpa(resolve(root, options.inspectOnly))
    console.log(JSON.stringify(result, null, 2))
    if (!result.valid) throw new Error(`IPA inspection failed: ${result.errors.join('; ')}`)
    return
  }
  if (options.dryRun) {
    console.log('[DRY RUN PREVIEW] No commands, credentials, checks, archives, or uploads executed.')
    console.log(`Source: ${options.sourceCommit ?? '(explicit --source-commit <full SHA> required)'}`)
    console.log('Execution requires: isolated committed source → frozen dependency install → production config → checks → signed archive → frozen export → inspection → symbols → optional Apple upload → ASC readiness.')
    return
  }
  if (!options.sourceCommit || !/^[a-f0-9]{40}$/i.test(options.sourceCommit)) {
    throw new Error('Release requires --source-commit <full committed SHA>; shared working-tree builds are forbidden.')
  }
  const commit = execFileSync('git', ['rev-parse', '--verify', `${options.sourceCommit}^{commit}`], { cwd: root }).toString().trim()
  if (commit !== options.sourceCommit.toLowerCase()) throw new Error('Source commit did not resolve to the requested SHA')
  if (options.upload && (options.skipPosthog || options.skipPreconditions)) {
    throw new Error('Upload requires verified checks and PostHog symbols; --skip-posthog and --skip-preconditions are prepare-only.')
  }
  if (options.symbolsEas && options.skipPosthog) throw new Error('--symbols-eas cannot be combined with --skip-posthog')
  if (options.upload && !options.symbolsEas) throw new Error('Upload currently requires --symbols-eas for authenticated symbol-content verification')
  if (options.buildNumber !== undefined && (!Number.isSafeInteger(options.buildNumber) || options.buildNumber < 1)) {
    throw new Error('Build number must be a strict positive safe integer')
  }
  const environment = await captureReleaseEnvironment(root, options.environment ?? process.env)
  const easProjectId = options.easProjectId ?? environment.SKIPPER_EAS_PROJECT_ID
  const posthogProjectId = options.posthogProjectId ?? environment.POSTHOG_CLI_PROJECT_ID
  if (options.symbolsEas && (!easProjectId || !posthogProjectId)) {
    throw new Error('--symbols-eas requires --eas-project-id / SKIPPER_EAS_PROJECT_ID and --posthog-project-id / POSTHOG_CLI_PROJECT_ID')
  }
  const suppliedAuth = options.authConfig ?? readAscConfigFromEnv(environment)
  const authConfig = { ...suppliedAuth, keyPath: resolve(root, suppliedAuth.keyPath) }
  if (authConfig.appId !== DEFAULT_APP_ID) throw new Error('ASC app does not match the production Skipper app')
  const token = await generateAscJwt(authConfig.keyId, authConfig.issuerId, readFileSync(authConfig.keyPath, 'utf8'))
  // Even an explicit override requires a complete, successful fresh lookup.
  const builds = await fetchAscBuilds(authConfig.appId, token, { limit: 200, fetchFn: options.ascFetchFn })
  const latest = getLatestBuildNumber(builds)
  const buildNumber = options.buildNumber ?? latest + 1
  if (!Number.isSafeInteger(buildNumber)) throw new Error('Next ASC build number exceeds safe integer range')
  if (buildNumber <= latest) throw new Error(`Requested --build-number ${buildNumber} has already been consumed in App Store Connect (latest ${latest}).`)

  const worktreeParent = await mkdtemp(join(tmpdir(), 'skipper-native-release-'))
  const effectiveRoot = join(worktreeParent, 'source')
  let createdWorktree = false
  try {
    execFileSync('git', ['worktree', 'add', '--detach', effectiveRoot, commit], { cwd: root, stdio: 'pipe' })
    createdWorktree = true
    environment.SKIPPER_IOS_DERIVED_DATA = resolve(effectiveRoot, '.scratch/ios/DerivedData')
    const projectPath = resolve(effectiveRoot, 'apps/ios/Skipper.xcodeproj')
    const version = options.version ?? readProjectMarketingVersion(readFileSync(join(projectPath, 'project.pbxproj'), 'utf8'))
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Marketing version must contain three numeric components')
    const outputDir = resolve(root, options.outputDir ?? `.scratch/releases/${version}-${buildNumber}`)
    if (existsSync(outputDir) && readdirSync(outputDir).length) throw new Error('Release output directory must be empty; refusing stale artifacts')
    await mkdir(outputDir, { recursive: true })
    const command = async (cmd: string[], logName: string): Promise<void> => {
      const result = await runCommand(cmd, { cwd: effectiveRoot, env: environment, logPath: resolve(outputDir, `${logName}.log`) })
      if (result.exitCode !== 0) throw new Error(`${logName} failed (exit ${result.exitCode}). See ${outputDir}/${logName}.log`)
    }
    // Read the selected plist ONCE into the private snapshot, then validate those exact bytes.
    const frozenDirectory = resolve(effectiveRoot, '.scratch/ios/frozen')
    await mkdir(frozenDirectory, { recursive: true, mode: 0o700 })
    const exportPlistPath = join(frozenDirectory, 'export-options.plist')
    const selectedPlist = options.exportOptionsPlist ? resolve(root, options.exportOptionsPlist) : resolve(effectiveRoot, 'scripts/ios-export-options.plist')
    await writeFile(exportPlistPath, readFileSync(selectedPlist), { mode: 0o400 })
    const exportValidation = validateExportOptionsPlist(exportPlistPath)
    if (!exportValidation.valid) throw new Error(`Export options plist validation failed: ${exportValidation.errors.join('; ')}`)
    const exportOptionsHash = computeSha256(exportPlistPath)

    await command(['bun', 'install', '--frozen-lockfile'], 'dependency-install')
    await command(['bun', 'scripts/ios-configure.ts', '--release'], 'ios-configure')
    await command(['bun', 'scripts/ios-configure.ts'], 'ios-configure-debug')
    const configurationFile = join(frozenDirectory, 'Release.xcconfig')
    await writeFile(configurationFile, readFileSync(resolve(effectiveRoot, '.scratch/ios/Release.xcconfig')), { mode: 0o400 })
    const productionConfig = readFrozenConfiguration(configurationFile)
    const configurationHash = computeSha256(configurationFile)
    await chmod(frozenDirectory, 0o500)
    const provenance = getGitProvenance(effectiveRoot)
    if (provenance.gitCommit !== commit || !provenance.isClean) throw new Error('Dependency/configuration preparation modified committed source inputs')
    const source = await computeSourceBuildInputsHash(effectiveRoot)
    const verifyInputs = async () => {
      if ((await computeSourceBuildInputsHash(effectiveRoot)).hash !== source.hash) throw new Error('Prepared release inputs changed; refusing to continue')
      if (computeSha256(exportPlistPath) !== exportOptionsHash || computeSha256(configurationFile) !== configurationHash) throw new Error('Frozen release configuration or export options changed')
    }
    await writeFile(resolve(outputDir, 'snapshot.json'), JSON.stringify({ version, buildNumber, gitCommit: commit,
      gitDirty: false, dirtyFiles: [], sourceContentHash: source.hash, sourceFileCount: source.fileCount,
      configurationHash, exportOptionsHash, timestamp: new Date().toISOString() }, null, 2))
    let nativeCheckResults: ReleaseMetadata['nativeCheckResults']
    if (!options.skipPreconditions) {
      await command(['bun', 'run', 'check'], 'root-check')
      const previousNames = new Set(readdirSync(resolve(effectiveRoot, '.scratch/ios')))
      let commandExitCode: number | null = null
      let commandError: unknown
      try {
        const result = await runCommand(['bun', 'run', 'ios:check'], {
          cwd: effectiveRoot, env: environment, logPath: resolve(outputDir, 'ios-check.log'),
        })
        commandExitCode = result.exitCode
      } catch (error) { commandError = error }
      // Xcode can produce its most useful result bundle on failure. Preserve it before rethrowing
      // and before the outer finally removes this invocation's detached checkout.
      const retained = await retainNativeCheckResults(effectiveRoot, outputDir, previousNames)
      nativeCheckResults = retained.bundles
      await writeFile(resolve(outputDir, 'native-check-evidence.json'), JSON.stringify({
        schemaVersion: 1, sourceCommit: commit, sourceContentHash: source.hash, configurationHash, exportOptionsHash,
        command: ['bun', 'run', 'ios:check'], commandExitCode,
        retentionStatus: retained.failedBundles.length ? 'failed' : 'complete',
        hashConvention: ARCHIVE_HASH_CONVENTION, bundles: retained.bundles, failedBundles: retained.failedBundles,
      }, null, 2))
      console.log(`Native check evidence: ${retained.bundles.length} result bundle(s) retained; see ${resolve(outputDir, 'native-check-evidence.json')}`)
      if (commandError) throw commandError
      if (commandExitCode !== 0) throw new Error(`ios-check failed (exit ${commandExitCode ?? 'unknown'}). See ${outputDir}/ios-check.log and native-check-evidence.json`)
      if (retained.failedBundles.length) throw new Error('Native check result retention failed; see native-check-evidence.json')
    }
    await verifyInputs()
    const archivePath = resolve(outputDir, 'Skipper.xcarchive')
    await command(['xcodebuild', ...buildArchiveCommandArgs({ projectPath, scheme: 'Skipper', configuration: 'Release',
      destination: 'generic/platform=iOS', archivePath, derivedDataPath: resolve(effectiveRoot, '.scratch/ios/DerivedData'),
      clonedSourcePackagesPath: resolve(effectiveRoot, '.scratch/ios/SourcePackages'), marketingVersion: version,
      buildNumber, authConfig, configurationFile })], 'xcodebuild archive')
    await verifyInputs()
    const dsymDirectory = resolve(archivePath, 'dSYMs')
    if (!existsSync(resolve(dsymDirectory, 'Skipper.app.dSYM'))) throw new Error('Archive missing dSYM bundle')
    await command(['xcodebuild', ...buildExportCommandArgs({ archivePath, exportPath: outputDir, exportOptionsPlist: exportPlistPath, authConfig })], 'export')
    await verifyInputs()
    const ipaPath = resolve(outputDir, `skipper-${version}-${buildNumber}.ipa`)
    await copyFile(resolve(outputDir, 'Skipper.ipa'), ipaPath)
    const ipaSha256 = computeSha256(ipaPath)
    const verifyIpa = () => { if (computeSha256(ipaPath) !== ipaSha256) throw new Error('Inspected IPA changed before delivery') }
    await writeFile(resolve(outputDir, 'ipa-sha256.txt'), `${ipaSha256}  ${basename(ipaPath)}\n`)
    const inspection = await (options.inspector ?? inspectIpa)(ipaPath, { expectedVersion: version, expectedBuild: String(buildNumber),
      expectedTeamId: DEFAULT_TEAM_ID, expectedBundleId: DEFAULT_BUNDLE_ID, expectedApiUrl: productionConfig.SKIPPER_API_URL,
      expectedPostHogHost: productionConfig.SKIPPER_POSTHOG_HOST, archivePath })
    await writeFile(resolve(outputDir, 'inspection.json'), JSON.stringify(inspection, null, 2))
    if (!inspection.valid) throw new Error(`IPA inspection failed: ${inspection.errors.join('; ')}`)
    verifyIpa()
    const archiveSha256 = await hashArchive(archivePath)
    const verifyArtifacts = async () => {
      verifyIpa()
      if (await hashArchive(archivePath) !== archiveSha256) throw new Error('Inspected archive changed before delivery')
    }
    let posthogSymbolStatus: ReleaseMetadata['posthogSymbolStatus'] = 'skipped_flag'
    let symbolsReceiptPath: string | undefined
    let symbolsVerification: ReleaseMetadata['symbolsVerification']
    if (options.symbolsEas) {
      const adapter = options.symbolsAdapter ?? { prepare: prepareEasSymbols, execute: executeEasSymbols, verify: verifyEasSymbolsReceipt }
      // Subcommands inherit only the captured environment, including when the adapter supplies its
      // own cwd or overrides. Never restore the ambient configuration paths removed at capture.
      const symbolsRunner: CommandRunner = (cmd, args = {}) => runCommand(cmd, {
        ...args, cwd: args.cwd ?? effectiveRoot, env: { ...environment, ...args.env },
      })
      const ingestionHost = new URL(productionConfig.SKIPPER_POSTHOG_HOST!).hostname
      const posthogHost = ['eu.i.posthog.com', 'eu.posthog.com'].includes(ingestionHost) ? 'https://eu.posthog.com'
        : ['us.i.posthog.com', 'us.posthog.com'].includes(ingestionHost) ? 'https://us.posthog.com' : undefined
      if (!posthogHost) throw new Error('EAS symbols require a recognized production PostHog region')
      const prepared = await adapter.prepare({ sourceCommit: commit, version, buildNumber, bundleId: DEFAULT_BUNDLE_ID,
        archivePath, ipaPath, expectedArchiveSha256: archiveSha256, expectedIpaSha256: ipaSha256,
        easProjectId: easProjectId!, posthogProjectId: posthogProjectId!, posthogHost,
        stagingDirectory: resolve(outputDir, 'symbols-stage'), runner: symbolsRunner })
      const expectedManifest = structuredClone(prepared.manifest)
      const expectedManifestSha256 = manifestSha256(expectedManifest)
      if (prepared.manifestSha256 !== expectedManifestSha256 || expectedManifest.sourceCommit !== commit ||
        expectedManifest.version !== version || expectedManifest.buildNumber !== buildNumber ||
        expectedManifest.bundleId !== DEFAULT_BUNDLE_ID || expectedManifest.archiveSha256 !== archiveSha256 ||
        expectedManifest.ipaSha256 !== ipaSha256 || expectedManifest.easProjectId !== easProjectId ||
        expectedManifest.posthogProjectId !== posthogProjectId || expectedManifest.posthogHost !== posthogHost) {
        throw new Error('Prepared symbols manifest does not identify this release and its exact artifacts')
      }
      await verifyArtifacts()
      symbolsReceiptPath = resolve(outputDir, 'symbols-receipt.json')
      await adapter.execute(prepared, { receiptPath: symbolsReceiptPath, runner: symbolsRunner, cwd: prepared.stagingDirectory })
      // A locally supplied status/receipt is not proof. Re-read authenticated EAS workflow/artifact evidence.
      const verified = await adapter.verify(symbolsReceiptPath, expectedManifest, { runner: symbolsRunner, cwd: prepared.stagingDirectory })
      if (verified.verification !== 'authenticated-eas-artifact' || verified.manifestSha256 !== expectedManifestSha256) {
        throw new Error('EAS symbols verification does not match the prepared artifact manifest')
      }
      await verifyArtifacts()
      symbolsVerification = { verification: verified.verification, workflowRunId: verified.workflowRunId,
        jobId: verified.jobId, artifactId: verified.artifactId, manifestSha256: verified.manifestSha256 }
      posthogSymbolStatus = 'uploaded'
    } else if (!options.skipPosthog) {
      if (!environment.POSTHOG_CLI_API_KEY || !environment.POSTHOG_CLI_PROJECT_ID) {
        posthogSymbolStatus = 'skipped_no_keys'
        if (options.upload) throw new Error('Upload requires verified PostHog symbols; symbol credentials are missing')
      } else {
        await command(['bunx', '--no-install', '@posthog/cli', ...buildPosthogUploadArgs({ dsymDirectory,
          releaseName: DEFAULT_BUNDLE_ID, releaseVersion: version, buildNumber })], 'PostHog dSYM upload')
        // CLI 0 can mean empty, skipped, oversized, or failed-processing symbol sets.
        // A separate UUID/content + release-association receipt must establish completion.
        posthogSymbolStatus = 'pending_verification'
      }
    }
    const metadata: ReleaseMetadata = { version, buildNumber, gitCommit: commit, gitDirty: false, dirtyFiles: [],
      sourceContentHash: source.hash, configurationHash, exportOptionsHash, checksPassed: !options.skipPreconditions, nativeCheckResults,
      ipaPath, ipaSha256, archiveSha256, inspection, posthogSymbolStatus, symbolsReceiptPath, symbolsVerification }
    if (!options.upload) {
      await writeReleaseRecord(outputDir, metadata)
      console.log(`Prepared and inspected ${ipaPath}. Symbols: ${posthogSymbolStatus}; Apple upload not requested.`)
      return
    }
    if (metadata.posthogSymbolStatus !== 'uploaded') throw new Error('PostHog symbol verification is required before Apple upload')
    await verifyArtifacts()
    await command(['xcrun', ...buildAltoolValidateArgs({ ipaPath, authConfig })], 'apple-validate')
    await verifyArtifacts()
    const upload = await runCommand(['xcrun', ...buildAltoolUploadArgs({ ipaPath, authConfig })], {
      cwd: effectiveRoot, env: environment, logPath: resolve(outputDir, 'apple-upload.log') })
    if (upload.exitCode !== 0) throw new Error(`altool upload failed (exit ${upload.exitCode})`)
    metadata.uploadedAt = new Date().toISOString()

    let receiptError: Error | null = null
    try {
      metadata.deliveryUuid = extractDeliveryUuid(upload.stdout, upload.stderr)
    } catch (err: any) {
      receiptError = err instanceof Error ? err : new Error(String(err))
      metadata.deliveryReceiptError = receiptError.message
    }

    let ascError: Error | null = null
    try {
      const freshToken = await generateAscJwt(authConfig.keyId, authConfig.issuerId, readFileSync(authConfig.keyPath, 'utf8'))
      const ready = await waitForBuildReadiness({ appId: authConfig.appId, token: freshToken,
        expectedBuild: buildNumber, expectedVersion: version, fetchFn: options.ascFetchFn })
      metadata.ascProcessingState = ready.processingState
      metadata.ascInternalState = ready.internalBuildState
    } catch (err: any) {
      ascError = err instanceof Error ? err : new Error(String(err))
      metadata.ascVerificationError = ascError.message
        .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, '[REDACTED_TOKEN]')
        .replace(/[A-Za-z0-9-_]{20,}\.[A-Za-z0-9-_]{20,}\.[A-Za-z0-9-_]{20,}/g, '[REDACTED_JWT]')
    }

    await writeReleaseRecord(outputDir, metadata)

    if (receiptError && ascError) {
      const ascDiag = metadata.ascVerificationError ?? 'ASC verification failed'
      throw new Error(`Apple upload completed but receipt verification failed: ${receiptError.message}; ASC readiness check also failed: ${ascDiag}`)
    }
    if (receiptError) {
      throw new Error(`Apple upload completed but receipt verification failed: ${receiptError.message}`)
    }
    if (ascError) {
      throw ascError
    }
    if (!metadata.deliveryUuid || metadata.deliveryUuid === 'unknown') {
      throw new Error('ASC is ready but Apple delivery receipt is missing; release record remains unverified')
    }
    console.log(`Release ${version} (${buildNumber}) shipped to TestFlight with verified symbols and ASC readiness.`)
  } finally {
    const frozen = resolve(effectiveRoot, '.scratch/ios/frozen')
    if (existsSync(frozen)) await chmod(frozen, 0o700)
    if (createdWorktree) execFileSync('git', ['worktree', 'remove', '--force', effectiveRoot], { cwd: root, stdio: 'pipe' })
    rmSync(worktreeParent, { recursive: true, force: true })
  }
}

export function formatReleaseRecord(meta: ReleaseMetadata): string {
  const isShipped = Boolean(
    meta.uploadedAt &&
    meta.deliveryUuid &&
    meta.deliveryUuid !== 'unknown' &&
    !meta.deliveryReceiptError &&
    !meta.ascVerificationError &&
    meta.ascProcessingState === 'VALID' &&
    meta.ascInternalState === 'IN_BETA_TESTING' &&
    meta.posthogSymbolStatus === 'uploaded' &&
    meta.symbolsVerification?.verification === 'authenticated-eas-artifact' &&
    meta.checksPassed === true
  )

  const status = isShipped
    ? 'SHIPPED TO TESTFLIGHT'
    : meta.uploadedAt ? 'UPLOADED — RELEASE VERIFICATION INCOMPLETE' : 'PREPARED / INSPECTED (SAFE DEFAULT - NOT UPLOADED)'

  const symbolStatusText = meta.posthogSymbolStatus === 'uploaded'
    ? 'UPLOADED'
    : meta.posthogSymbolStatus === 'pending_verification'
    ? 'PENDING (CLI returned; remote UUID/content and release association not verified)'
    : meta.posthogSymbolStatus === 'skipped_no_keys'
    ? 'SKIPPED (Missing POSTHOG_CLI_API_KEY / POSTHOG_CLI_PROJECT_ID credentials)'
    : 'SKIPPED (--skip-posthog flag)'

  return `# Native iOS Release Record: ${meta.version} (${meta.buildNumber})

- **Status**: ${status}
- **Date**: ${new Date().toISOString()}
${meta.uploadedAt ? `- **Uploaded At**: \`${meta.uploadedAt}\`` : ''}
- **Marketing Version**: \`${meta.version}\`
- **Build Number**: \`${meta.buildNumber}\`
- **Source Commit**: \`${meta.gitCommit}\`${meta.gitDirty ? ' (working tree dirty at build snapshot)' : ''}
${meta.sourceContentHash ? `- **Source Content Hash (SHA-256)**: \`${meta.sourceContentHash}\`` : ''}
${meta.ipaSha256 ? `- **IPA SHA-256**: \`${meta.ipaSha256}\`` : ''}
${meta.archiveSha256 ? `- **Archive SHA-256 (${ARCHIVE_HASH_CONVENTION})**: \`${meta.archiveSha256}\`` : ''}
- **PostHog Debugging Symbols**: ${symbolStatusText}
- **Required Checks**: ${meta.checksPassed ? 'PASSED' : 'SKIPPED / UNVERIFIED'}
${meta.nativeCheckResults ? `- **Native XCTest Evidence**: \`native-check-evidence.json\` (${meta.nativeCheckResults.length} retained bundle(s))
${meta.nativeCheckResults.map(bundle => `- **Result Bundle**: \`${bundle.path}\` (SHA-256 \`${bundle.sha256}\`)`).join('\n')}` : ''}
${meta.configurationHash ? `- **Frozen Configuration SHA-256**: \`${meta.configurationHash}\`` : ''}
${meta.exportOptionsHash ? `- **Frozen Export Options SHA-256**: \`${meta.exportOptionsHash}\`` : ''}
${meta.symbolsVerification ? `- **Authenticated Symbols Workflow**: \`${meta.symbolsVerification.workflowRunId}\` (job \`${meta.symbolsVerification.jobId}\`, artifact \`${meta.symbolsVerification.artifactId}\`)
- **Symbols Manifest SHA-256**: \`${meta.symbolsVerification.manifestSha256}\`
- **Symbols Receipt**: \`${meta.symbolsReceiptPath}\`` : ''}
${meta.deliveryReceiptError ? `- **Apple Delivery Receipt**: FAILED (${meta.deliveryReceiptError})` : meta.deliveryUuid ? `- **Apple Delivery UUID**: \`${meta.deliveryUuid}\`` : ''}
${meta.ascVerificationError ? `- **ASC Readiness Query**: FAILED (${meta.ascVerificationError})` : ''}
${meta.ascProcessingState ? `- **ASC Processing State**: \`${meta.ascProcessingState}\`` : ''}
${meta.ascInternalState ? `- **ASC Internal State**: \`${meta.ascInternalState}\`` : ''}

## Pre-Release Inspection
${meta.inspection ? `
- **Bundle ID**: \`${meta.inspection.bundleId}\`
- **Team ID**: \`${meta.inspection.teamId}\`
- **Minimum OS**: \`${meta.inspection.minimumOSVersion}\`
- **Code Signature**: ${meta.inspection.codeSignatureValid ? 'VALID' : 'INVALID'}
- **Native Frameworks**: ${(meta.inspection.frameworks ?? []).join(', ') || 'Embedded'}
- **React Native / Expo Scan**: ${meta.inspection.nativeScanEvidence}
- **Privacy Manifest**: \`PrivacyInfo.xcprivacy\` verified
- **dSYM UUID Verification**: ${meta.inspection.dsymUuidMatch ? 'MATCHED (all executable architectures covered)' : 'UNVERIFIED'}
` : 'Not inspected.'}

## Artifacts in this Release Folder
- \`snapshot.json\`: Source repository state
- \`ipa-sha256.txt\`: Checksum
- \`inspection.json\`: Detailed inspection results
- Log files: \`ios-configure.log\`, \`root-check.log\`, \`ios-check.log\`, \`archive.log\`, \`export.log\`
`
}

async function writeReleaseRecord(dir: string, meta: ReleaseMetadata): Promise<void> {
  const md = formatReleaseRecord(meta)
  await writeFile(resolve(dir, 'release-record.md'), md)
}

if (import.meta.main) {
  runReleasePipeline(parseCliArgs(process.argv.slice(2))).catch((err) => {
    console.error(`\n✗ Release pipeline error: ${err.message}\n`)
    process.exit(1)
  })
}
