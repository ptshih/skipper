// Standalone Node 22 worker: only built-ins so the EAS stage needs no app runtime/dependencies.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  closeSync,
  createReadStream,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
} from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const POSTHOG_VERSION = '0.9.1'
export const MAX_SLICE_BYTES = 99 * 1024 * 1024 // Leave >1 MiB for ZIP overhead below CLI's 100 MiB skip.
export type CommandRunner = (
  command: string[],
  options?: {
    cwd?: string
    env?: Record<string, string>
    logPath?: string
  },
) => Promise<{ exitCode: number; stdout: string; stderr: string }>
export interface SymbolSlice {
  uuid: string
  architecture: string
  dwarfPath: string
  sha256: string
  size: number
}
export interface SymbolFile {
  path: string
  sha256: string
  size: number
}
export interface SymbolsManifest {
  schemaVersion: 1
  sourceCommit: string
  bundleId: 'fm.skipper.app'
  version: string
  buildNumber: number
  archiveSha256: string
  ipaSha256: string
  symbolsZipSha256: string
  easProjectId: string
  posthogProjectId: string
  posthogHost: 'https://us.posthog.com' | 'https://eu.posthog.com'
  posthogCliVersion: typeof POSTHOG_VERSION
  supportSha256: { worker: string; archive: string }
  files: SymbolFile[]
  slices: SymbolSlice[]
}
export interface UploadEvidence {
  command: string[]
  exitCode: 0
  processedUuids: string[]
  uploadedCount: number
  release: { name: string; version: string; build: string }
  // Only selected nonsecret CLI messages, preserved verbatim for offline re-parsing.
  messages: string[]
}
export interface SymbolsReceipt {
  schemaVersion: 1
  manifestSha256: string
  manifest: SymbolsManifest
  upload: UploadEvidence
  readbacks: Array<{
    uuid: string
    architecture: string
    sha256: string
    size: number
    command: string[]
    exitCode: 0
  }>
}

const WORKER_FAILURE_PHASES = {
  PLATFORM_UNSUPPORTED: 'preflight',
  MANIFEST_INVALID: 'preflight',
  WORKER_SOURCE_MISMATCH: 'preflight',
  SYMBOL_ARCHIVE_MISMATCH: 'preflight',
  SECRET_MISSING: 'preflight',
  PROJECT_MISMATCH: 'preflight',
  HOST_MISMATCH: 'preflight',
  ARCHIVE_EXTRACTION_FAILED: 'extract',
  DWARF_MEASUREMENT_FAILED: 'measure',
  DWARF_MANIFEST_MISMATCH: 'measure',
  UPLOAD_COMMAND_FAILED: 'upload',
  UPLOAD_EVIDENCE_INVALID: 'upload',
  READBACK_DIRECTORY_FAILED: 'readback',
  READBACK_COMMAND_FAILED: 'readback',
  READBACK_PATH_INVALID: 'readback',
  READBACK_MEASUREMENT_FAILED: 'readback',
  READBACK_SLICE_MISMATCH: 'readback',
  RECEIPT_INVALID: 'receipt',
  RECEIPT_WRITE_FAILED: 'receipt',
  UNKNOWN_WORKER_FAILURE: 'unknown',
} as const
type WorkerFailureCode = keyof typeof WORKER_FAILURE_PHASES
class SymbolsWorkerError extends Error {
  readonly code: WorkerFailureCode
  constructor(code: WorkerFailureCode) {
    super(code)
    this.code = code
  }
}
export function workerFailureRecord(error: unknown) {
  // Never serialize exceptions, CLI output, paths, environment, or caller-authored error fields.
  const code =
    error instanceof SymbolsWorkerError && Object.hasOwn(WORKER_FAILURE_PHASES, error.code)
      ? error.code
      : 'UNKNOWN_WORKER_FAILURE'
  return {
    schemaVersion: 1,
    phase: WORKER_FAILURE_PHASES[code],
    code,
    error: 'Symbol upload/readback did not complete; no verified receipt produced.',
  }
}

export const SHA = /^[a-f0-9]{64}$/
export const UUID = /^[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}$/
export function ensure(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}
export function sha256(bytes: string | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`
  return JSON.stringify(value)
}
export function manifestSha256(manifest: SymbolsManifest): string {
  return sha256(canonical(manifest))
}
export async function hashFile(path: string): Promise<string> {
  ensure(lstatSync(path).isFile(), 'Expected regular file')
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
export const defaultRunner: CommandRunner = (command, options) =>
  new Promise((resolveResult) => {
    const child = spawn(command[0]!, command.slice(1), {
      cwd: options?.cwd,
      env: { ...process.env, ...options?.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = '',
      stderr = '',
      overflow = false
    const collect = (value: Buffer, kind: 'stdout' | 'stderr') => {
      if (kind === 'stdout') stdout += value.toString('utf8')
      else stderr += value.toString('utf8')
      if (stdout.length + stderr.length > 16 * 1024 * 1024) {
        overflow = true
        child.kill()
      }
    }
    child.stdout.on('data', (value: Buffer) => collect(value, 'stdout'))
    child.stderr.on('data', (value: Buffer) => collect(value, 'stderr'))
    child.on('error', () => resolveResult({ exitCode: 1, stdout: '', stderr: '' }))
    // Wait for pipes to close, including buffered bytes, before accepting command completion.
    child.on('close', (code) =>
      resolveResult({ exitCode: overflow ? 1 : (code ?? 1), stdout, stderr }),
    )
  })
export async function checked(
  runner: CommandRunner,
  cmd: string[],
  cwd?: string,
  env?: Record<string, string>,
): Promise<string> {
  const result = await runner(cmd, { cwd, env })
  ensure(result.exitCode === 0, `Command failed: ${cmd[0]} (exit ${result.exitCode})`)
  return result.stdout
}
export function safePath(path: string): boolean {
  return (
    !!path &&
    !/[\\:\x00-\x1f]/.test(path) &&
    path.split('/').every((part) => !!part && part !== '.' && part !== '..')
  )
}
export function validateManifest(m: SymbolsManifest): void {
  ensure(m?.schemaVersion === 1 && /^[a-f0-9]{40}$/.test(m.sourceCommit), 'Invalid source identity')
  ensure(
    m.bundleId === 'fm.skipper.app' &&
      /^\d+\.\d+(?:\.\d+)?$/.test(m.version) &&
      Number.isSafeInteger(m.buildNumber) &&
      m.buildNumber > 0,
    'Invalid release identity',
  )
  ensure(
    UUID.test(m.easProjectId.toUpperCase()) && /^[1-9]\d*$/.test(m.posthogProjectId),
    'Invalid project identity',
  )
  ensure(
    ['https://us.posthog.com', 'https://eu.posthog.com'].includes(m.posthogHost),
    'Unsupported PostHog host',
  )
  ensure(m.posthogCliVersion === POSTHOG_VERSION, 'Unexpected PostHog CLI')
  ensure(
    [
      m.archiveSha256,
      m.ipaSha256,
      m.symbolsZipSha256,
      m.supportSha256?.worker,
      m.supportSha256?.archive,
    ].every((h) => SHA.test(h)),
    'Invalid manifest hash',
  )
  ensure(
    Array.isArray(m.files) && m.files.length > 0 && m.files.length < 50000,
    'Empty symbol files',
  )
  ensure(
    new Set(m.files.map((f) => f.path.toLowerCase())).size === m.files.length,
    'Duplicate symbol file',
  )
  for (const f of m.files)
    ensure(
      safePath(f.path) &&
        /^[^/]+\.dSYM\/Contents\/(Info\.plist|Resources\/DWARF\/[^/]+)$/.test(f.path) &&
        SHA.test(f.sha256) &&
        Number.isSafeInteger(f.size) &&
        f.size > 0,
      'Invalid symbol file',
    )
  ensure(Array.isArray(m.slices) && m.slices.length > 0, 'Empty symbol slices')
  ensure(new Set(m.slices.map((s) => s.uuid)).size === m.slices.length, 'Duplicate UUID')
  for (const s of m.slices) {
    ensure(
      UUID.test(s.uuid) &&
        /^[a-z0-9_]+$/.test(s.architecture) &&
        SHA.test(s.sha256) &&
        Number.isSafeInteger(s.size) &&
        s.size > 0 &&
        s.size <= MAX_SLICE_BYTES,
      'Invalid or oversized DWARF slice',
    )
    ensure(
      m.files.some((f) => f.path === s.dwarfPath && f.path.includes('/Resources/DWARF/')),
      'Missing DWARF file',
    )
  }
  ensure(
    m.files
      .filter((f) => f.path.includes('/Resources/DWARF/'))
      .every((f) => m.slices.some((s) => s.dwarfPath === f.path)),
    'Unmeasured DWARF file',
  )
}
export function uploadCommand(m: SymbolsManifest, directory: string): string[] {
  return [
    'npx',
    '--yes',
    `@posthog/cli@${POSTHOG_VERSION}`,
    '--dry-run=false',
    'dsym',
    'upload',
    '--directory',
    directory,
    '--release-name',
    m.bundleId,
    '--release-version',
    m.version,
    '--build',
    String(m.buildNumber),
  ]
}
export function downloadCommand(uuid: string, directory: string): string[] {
  return [
    'npx',
    '--yes',
    `@posthog/cli@${POSTHOG_VERSION}`,
    '--dry-run=false',
    'symbol-sets',
    'download',
    '--ref',
    uuid,
    '--output',
    directory,
  ]
}

export function parseUploadEvidence(
  result: { exitCode: number; stdout: string; stderr: string },
  m: SymbolsManifest,
): UploadEvidence {
  ensure(result.exitCode === 0, 'PostHog upload failed')
  const output = `${result.stdout}\n${result.stderr}`.replace(/\x1b\[[0-9;]*m/g, '')
  // Tagged 0.9.1 has success exits for empty/oversized bundles and a release-less retry.
  ensure(
    !/WARN|ERROR|Skipping symbol set|No dSYM|Failed to process|release.?id.?mismatch|without release|fallback|falling back/i.test(
      output,
    ),
    'PostHog skipped symbols or release association',
  )
  const messages = output.split('\n').flatMap((line) => {
    const match = line.match(
      /(?:Release name: |Release version: |Build: |UUIDs: |Uploading \d+ dSYM\(s\)|dSYM upload complete).*/,
    )
    return match ? [match[0].trim()] : []
  })
  const uuids = messages
    .filter((s) => s.startsWith('UUIDs: '))
    .flatMap((s) => {
      const match = s.match(/^UUIDs: ([A-Fa-f0-9, -]+) \((\d+)\)$/)
      ensure(match, 'Invalid PostHog UUID evidence')
      const ids = match[1]!.split(', ').map((id) => id.toUpperCase())
      ensure(ids.length === Number(match[2]), 'PostHog UUID count mismatch')
      return ids
    })
    .sort()
  ensure(
    canonical(uuids) === canonical(m.slices.map((s) => s.uuid).sort()),
    'PostHog did not process every expected UUID',
  )
  ensure(
    messages.filter((s) => s === `Uploading ${uuids.length} dSYM(s)...`).length === 1 &&
      messages.filter((s) => s === 'dSYM upload complete').length === 1,
    'Missing complete upload evidence',
  )
  for (const expected of [
    `Release name: ${m.bundleId}`,
    `Release version: ${m.version}`,
    `Build: ${m.buildNumber}`,
  ])
    ensure(
      messages.filter((s) => s === expected).length === 1,
      'Missing intended release association',
    )
  return {
    command: uploadCommand(m, 'symbols'),
    exitCode: 0,
    processedUuids: uuids,
    uploadedCount: uuids.length,
    release: { name: m.bundleId, version: m.version, build: String(m.buildNumber) },
    messages,
  }
}

/** Offline only: never evidence that a cloud run actually occurred. */
export function validateSymbolsReceipt(receipt: SymbolsReceipt, expected: SymbolsManifest): void {
  validateManifest(expected)
  ensure(
    receipt?.schemaVersion === 1 &&
      receipt.manifestSha256 === manifestSha256(expected) &&
      canonical(receipt.manifest) === canonical(expected),
    'Receipt manifest identity mismatch',
  )
  const parsed = parseUploadEvidence(
    {
      exitCode: receipt.upload?.exitCode,
      stdout: receipt.upload?.messages?.join('\n'),
      stderr: '',
    },
    expected,
  )
  ensure(canonical(parsed) === canonical(receipt.upload), 'Receipt upload evidence mismatch')
  ensure(
    Array.isArray(receipt.readbacks) && receipt.readbacks.length === expected.slices.length,
    'Incomplete symbol readback',
  )
  const actual = [...receipt.readbacks].sort((a, b) => a.uuid.localeCompare(b.uuid))
  const wanted = expected.slices
    .map((s) => ({
      uuid: s.uuid,
      architecture: s.architecture,
      sha256: s.sha256,
      size: s.size,
      command: downloadCommand(s.uuid, 'readback'),
      exitCode: 0,
    }))
    .sort((a, b) => a.uuid.localeCompare(b.uuid))
  ensure(canonical(actual) === canonical(wanted), 'DWARF readback mismatch')
}

export function parseUuids(output: string): Array<{ uuid: string; architecture: string }> {
  const entries = output
    .trim()
    .split('\n')
    .map((line) => {
      const match = line.match(/^UUID: ([a-fA-F0-9-]+) \(([a-z0-9_]+)\) .+$/)
      ensure(match && UUID.test(match[1]!.toUpperCase()), 'Invalid dwarfdump output')
      return { uuid: match[1]!.toUpperCase(), architecture: match[2]! }
    })
  ensure(
    entries.length > 0 && new Set(entries.map((x) => x.uuid)).size === entries.length,
    'Empty/duplicate DWARF UUID',
  )
  return entries.sort((a, b) => a.uuid.localeCompare(b.uuid))
}
export async function measureDwarf(
  path: string,
  outputDirectory: string,
  runner: CommandRunner,
): Promise<Array<Omit<SymbolSlice, 'dwarfPath'>>> {
  ensure(lstatSync(path).isFile(), 'DWARF must be a regular file')
  const header = Buffer.alloc(4)
  const descriptor = openSync(path, 'r')
  try {
    ensure(readSync(descriptor, header, 0, 4, 0) === 4, 'Truncated DWARF')
  } finally {
    closeSync(descriptor)
  }
  const fat = ['cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca'].includes(header.toString('hex'))
  const uuids = parseUuids(await checked(runner, ['xcrun', 'dwarfdump', '--uuid', path]))
  const result: Array<Omit<SymbolSlice, 'dwarfPath'>> = []
  for (const entry of uuids) {
    let thin = path
    if (fat || uuids.length > 1) {
      thin = join(outputDirectory, entry.uuid)
      await checked(runner, ['xcrun', 'lipo', path, '-thin', entry.architecture, '-output', thin])
    }
    ensure(
      canonical(parseUuids(await checked(runner, ['xcrun', 'dwarfdump', '--uuid', thin]))) ===
        canonical([entry]),
      'Thin slice UUID mismatch',
    )
    const size = statSync(thin).size
    ensure(size > 0 && size <= MAX_SLICE_BYTES, 'Empty/oversized DWARF slice')
    result.push({ ...entry, size, sha256: await hashFile(thin) })
  }
  return result
}
export async function runSymbolsWorker(
  directory: string,
  runner: CommandRunner = defaultRunner,
  environment = process.env,
): Promise<SymbolsReceipt> {
  const state: { code: WorkerFailureCode } = { code: 'PLATFORM_UNSUPPORTED' }
  try {
    return await runSymbolsWorkerImpl(directory, runner, environment, state)
  } catch {
    // Capture the fixed gate that failed, never the untrusted underlying exception or its cause.
    throw new SymbolsWorkerError(state.code)
  }
}
async function runSymbolsWorkerImpl(
  directory: string,
  runner: CommandRunner,
  environment: NodeJS.ProcessEnv,
  state: { code: WorkerFailureCode },
): Promise<SymbolsReceipt> {
  ensure(process.platform === 'darwin', 'dSYM upload requires macOS')
  const root = resolve(directory)
  state.code = 'MANIFEST_INVALID'
  const m: SymbolsManifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))
  validateManifest(m)
  state.code = 'WORKER_SOURCE_MISMATCH'
  ensure(
    (await hashFile(join(root, 'worker.ts'))) === m.supportSha256.worker &&
      (await hashFile(join(root, 'archive.py'))) === m.supportSha256.archive,
    'Worker source mismatch',
  )
  state.code = 'SYMBOL_ARCHIVE_MISMATCH'
  ensure(
    (await hashFile(join(root, 'symbols.zip'))) === m.symbolsZipSha256,
    'Symbol archive hash mismatch',
  )
  state.code = 'SECRET_MISSING'
  ensure(environment.POSTHOG_CLI_API_KEY, 'Missing EAS secret')
  state.code = 'PROJECT_MISMATCH'
  ensure(
    (environment.POSTHOG_CLI_PROJECT_ID ?? environment.POSTHOG_CLI_ENV_ID) === m.posthogProjectId,
    'Wrong PostHog project',
  )
  state.code = 'HOST_MISMATCH'
  ensure(
    !environment.POSTHOG_CLI_HOST || environment.POSTHOG_CLI_HOST === m.posthogHost,
    'PostHog host mismatch',
  )
  state.code = 'ARCHIVE_EXTRACTION_FAILED'
  await checked(
    runner,
    ['python3', 'archive.py', 'unpack', 'symbols.zip', 'symbols', 'manifest.json'],
    root,
  )
  state.code = 'DWARF_MEASUREMENT_FAILED'
  await mkdir(join(root, 'thin'))
  const measured: SymbolSlice[] = []
  for (const path of [...new Set(m.slices.map((s) => s.dwarfPath))]) {
    measured.push(
      ...(await measureDwarf(join(root, 'symbols', path), join(root, 'thin'), runner)).map((s) => ({
        ...s,
        dwarfPath: path,
      })),
    )
  }
  state.code = 'DWARF_MANIFEST_MISMATCH'
  ensure(
    canonical(measured.sort((a, b) => a.uuid.localeCompare(b.uuid))) ===
      canonical([...m.slices].sort((a, b) => a.uuid.localeCompare(b.uuid))),
    'Extracted DWARF differs from manifest',
  )
  const env = {
    RUST_LOG: 'info',
    NO_COLOR: '1',
    POSTHOG_CLI_HOST: m.posthogHost,
    POSTHOG_CLI_PROJECT_ID: m.posthogProjectId,
  }
  state.code = 'UPLOAD_COMMAND_FAILED'
  const uploadResult = await runner(uploadCommand(m, 'symbols'), { cwd: root, env })
  ensure(uploadResult.exitCode === 0, 'Upload command failed')
  state.code = 'UPLOAD_EVIDENCE_INVALID'
  const upload = parseUploadEvidence(uploadResult, m)
  const readbacks: SymbolsReceipt['readbacks'] = []
  state.code = 'READBACK_DIRECTORY_FAILED'
  await mkdir(join(root, 'readback'))
  for (const slice of m.slices) {
    state.code = 'READBACK_COMMAND_FAILED'
    await checked(runner, downloadCommand(slice.uuid, 'readback'), root, env)
    state.code = 'READBACK_PATH_INVALID'
    const path = join(root, 'readback', slice.uuid, 'dwarf')
    ensure(realpathSync(path) === path && lstatSync(path).isFile(), 'Unsafe symbol readback path')
    state.code = 'READBACK_MEASUREMENT_FAILED'
    const measuredReadback = await measureDwarf(path, join(root, 'thin'), runner)
    state.code = 'READBACK_SLICE_MISMATCH'
    ensure(
      measuredReadback.length === 1 &&
        canonical(measuredReadback[0]) ===
          canonical({
            uuid: slice.uuid,
            architecture: slice.architecture,
            sha256: slice.sha256,
            size: slice.size,
          }),
      'Downloaded DWARF slice mismatch',
    )
    readbacks.push({
      ...measuredReadback[0]!,
      command: downloadCommand(slice.uuid, 'readback'),
      exitCode: 0,
    })
  }
  const receipt: SymbolsReceipt = {
    schemaVersion: 1,
    manifestSha256: manifestSha256(m),
    manifest: m,
    upload,
    readbacks,
  }
  state.code = 'RECEIPT_INVALID'
  validateSymbolsReceipt(receipt, m)
  state.code = 'RECEIPT_WRITE_FAILED'
  await writeFile(join(root, 'receipt.json'), `${canonical(receipt)}\n`, {
    flag: 'wx',
    mode: 0o600,
  })
  return receipt
}

async function cleanup(directory: string): Promise<void> {
  for (const name of ['symbols', 'thin', 'readback', 'symbols.zip', 'manifest.json'])
    await rm(join(directory, name), { recursive: true, force: true })
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = process.cwd()
  if (process.argv[2] === '--cleanup') await cleanup(directory)
  else {
    try {
      await runSymbolsWorker(directory)
      console.log('All expected dSYM slices uploaded and read back.')
    } catch (error) {
      // Never publish CLI output: npm/HTTP errors may contain credentials. Failure is not a receipt.
      const failure = workerFailureRecord(error)
      await writeFile(join(directory, 'failure.json'), JSON.stringify(failure)).catch(() => {
        console.error('Symbol failure record could not be written.')
      })
      console.error(
        `Symbol verification failed [${failure.phase}/${failure.code}]. No verified receipt produced.`,
      )
      process.exitCode = 1
    }
  }
}
