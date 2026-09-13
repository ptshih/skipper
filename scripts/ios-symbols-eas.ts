#!/usr/bin/env bun
// Preparation is local. executeEasSymbols is the separate, explicitly authorized cloud operation.
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
} from 'node:fs'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import {
  canonical,
  checked,
  defaultRunner,
  ensure,
  hashFile,
  manifestSha256,
  measureDwarf,
  parseUuids,
  safePath,
  sha256,
  validateManifest,
  validateSymbolsReceipt,
  UUID,
  POSTHOG_VERSION,
} from './ios-symbols-eas/worker'
import type {
  CommandRunner,
  SymbolFile,
  SymbolsManifest,
  SymbolsReceipt,
  SymbolSlice,
} from './ios-symbols-eas/worker'
export { canonical, hashFile, manifestSha256, validateManifest, validateSymbolsReceipt }
export type { CommandRunner, SymbolsManifest, SymbolsReceipt, SymbolSlice }

export const EAS_CLI_VERSION = '24.3.0'
export const ARCHIVE_HASH_CONVENTION = 'sha256-canonical-tree-v1'
export const RECEIPT_ARTIFACT_NAME = 'skipper-symbols-receipt'
const support = join(dirname(fileURLToPath(import.meta.url)), 'ios-symbols-eas')
const WORKFLOW_FILE = 'symbols.yml'
const ALLOWED_FILES = [
  '.easignore',
  '.eas/workflows/symbols.yml',
  'app.json',
  'eas.json',
  'package.json',
  'manifest.json',
  'symbols.zip',
  'worker.ts',
  'archive.py',
].sort()

/** Stable content identity: canonical JSON sorted paths, directories, file bytes/mode, safe link text.
 * No mtimes, owner IDs, absolute paths, or directory's own name. See guide for the exact convention.
 */
export async function hashArchive(directory: string): Promise<string> {
  const root = realpathSync(directory)
  ensure(
    lstatSync(directory).isDirectory() && !lstatSync(directory).isSymbolicLink(),
    'Archive must be a real directory',
  )
  const records: Array<Record<string, string | number>> = []
  async function visit(path: string): Promise<void> {
    for (const name of readdirSync(path).sort()) {
      const absolute = join(path, name)
      const entry = relative(root, absolute)
      ensure(safePath(entry), 'Unsafe archive path')
      const stat = lstatSync(absolute)
      if (stat.isDirectory()) {
        records.push({ path: entry, type: 'directory' })
        await visit(absolute)
      } else if (stat.isFile()) {
        records.push({
          path: entry,
          type: 'file',
          size: stat.size,
          executable: stat.mode & 0o111,
          sha256: await hashFile(absolute),
        })
      } else if (stat.isSymbolicLink()) {
        const target = readlinkSync(absolute)
        const resolved = realpathSync(absolute)
        ensure(
          !isAbsolute(target) && (resolved === root || resolved.startsWith(`${root}/`)),
          'Archive link escapes root',
        )
        records.push({ path: entry, type: 'symlink', target })
      } else throw new Error('Special archive entry forbidden')
    }
  }
  await visit(root)
  ensure(records.length > 0, 'Empty archive')
  records.sort((a, b) =>
    String(a.path) < String(b.path) ? -1 : String(a.path) > String(b.path) ? 1 : 0,
  )
  return sha256(canonical({ convention: ARCHIVE_HASH_CONVENTION, entries: records }))
}

export interface PrepareEasSymbolsOptions {
  sourceCommit: string
  version: string
  buildNumber: number
  bundleId: 'fm.skipper.app'
  archivePath: string
  ipaPath: string
  expectedArchiveSha256: string
  expectedIpaSha256: string
  easProjectId: string
  posthogProjectId: string
  posthogHost?: SymbolsManifest['posthogHost']
  stagingDirectory: string
  runner?: CommandRunner
}
export interface PreparedEasSymbols {
  stagingDirectory: string
  manifest: SymbolsManifest
  manifestSha256: string
  stageFiles: SymbolFile[]
}
export interface EasSymbolsReceiptRecord {
  schemaVersion: 1
  workflowRunId: string
  jobId: string
  artifactId: string
  artifactSha256: string
  receipt: SymbolsReceipt
}
export interface AuthenticatedSymbolsVerification {
  verification: 'authenticated-eas-artifact'
  workflowRunId: string
  jobId: string
  artifactId: string
  manifestSha256: string
  receipt: SymbolsReceipt
}
export interface VerifyEasSymbolsOptions {
  runner?: CommandRunner
  /** Test seam. Production fetch must use ONLY the artifact URL returned by authenticated EAS. */
  fetchArtifact?: (url: string) => Promise<Uint8Array>
  cwd?: string
}

function workflow(m: SymbolsManifest): string {
  return `name: symbols-${manifestSha256(m)}
defaults:
  tools:
    node: '22.19.0'
jobs:
  symbols:
    runs_on: macos-medium
    environment: production
    steps:
      - uses: eas/checkout
      - name: Upload and verify every DWARF slice
        run: node --experimental-strip-types worker.ts
      - uses: eas/upload_artifact
        if: \${{ always() }}
        with:
          type: other
          name: ${RECEIPT_ARTIFACT_NAME}
          path: |
            receipt.json
            failure.json
      - name: Remove temporary symbols and readbacks
        if: \${{ always() }}
        run: node --experimental-strip-types worker.ts --cleanup
`
}

/** Bind immutable run snapshots; the reusable Workflow.name can be null or change later. */
export function validateEasRunIdentity(run: any, runId: string, m: SymbolsManifest): void {
  const revision = run.workflowRevision
  const yaml = workflow(m)
  const blobSha = createHash('sha1')
    .update(`blob ${Buffer.byteLength(yaml)}\0`)
    .update(yaml)
    .digest('hex')
  ensure(
    run.id === runId &&
      run.name === `symbols-${manifestSha256(m)}` &&
      UUID.test(run.workflow?.id?.toUpperCase()) &&
      run.workflow?.app?.id === m.easProjectId &&
      run.workflow?.fileName === WORKFLOW_FILE &&
      UUID.test(revision?.id?.toUpperCase()) &&
      revision?.yamlConfig === yaml &&
      revision?.blobSha === blobSha &&
      revision?.workflow?.id === run.workflow.id &&
      revision?.workflow?.app?.id === m.easProjectId &&
      revision?.workflow?.fileName === WORKFLOW_FILE,
    'EAS immutable workflow identity mismatch',
  )
}
function staticStageFiles(m: SymbolsManifest): Record<string, string> {
  return {
    '.easignore': `# Explicit minimal upload allowlist; assertPreparedStage also rejects extra local files.\n*\n!.eas/\n!.eas/workflows/\n${ALLOWED_FILES.map((path) => `!${path}`).join('\n')}\n`,
    '.eas/workflows/symbols.yml': workflow(m),
    'app.json': `${canonical({ expo: { name: 'Skipper Symbols', slug: 'skipper', extra: { eas: { projectId: m.easProjectId } } } })}\n`,
    'eas.json': `${canonical({ cli: { version: EAS_CLI_VERSION } })}\n`,
    'package.json': `${canonical({ name: 'skipper-symbols-only', private: true, type: 'module', version: '1.0.0' })}\n`,
    'manifest.json': `${canonical(m)}\n`,
  }
}
async function enumerateFiles(directory: string): Promise<SymbolFile[]> {
  ensure(
    lstatSync(directory).isDirectory() && !lstatSync(directory).isSymbolicLink(),
    'Expected ordinary source directory',
  )
  const files: SymbolFile[] = []
  async function visit(path: string): Promise<void> {
    for (const name of readdirSync(path).sort()) {
      const absolute = join(path, name)
      const stat = lstatSync(absolute)
      ensure(!stat.isSymbolicLink(), 'Staged links forbidden')
      if (stat.isDirectory()) await visit(absolute)
      else {
        ensure(stat.isFile(), 'Staged special file forbidden')
        files.push({
          path: relative(directory, absolute),
          size: stat.size,
          sha256: await hashFile(absolute),
        })
      }
    }
  }
  await visit(directory)
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

async function plist(path: string, runner: CommandRunner): Promise<Record<string, any>> {
  return JSON.parse(await checked(runner, ['python3', join(support, 'archive.py'), 'plist', path]))
}
function appDirectory(parent: string): string {
  const matches = readdirSync(parent).filter((name) => name.endsWith('.app'))
  ensure(matches.length === 1, 'Expected exactly one app')
  const path = join(parent, matches[0]!)
  ensure(lstatSync(path).isDirectory(), 'App must be a directory')
  return path
}
async function appIdentity(
  path: string,
  options: PrepareEasSymbolsOptions,
  runner: CommandRunner,
): Promise<Array<{ uuid: string; architecture: string }>> {
  const info = await plist(join(path, 'Info.plist'), runner)
  ensure(
    info.CFBundleIdentifier === options.bundleId &&
      info.CFBundleShortVersionString === options.version &&
      String(info.CFBundleVersion) === String(options.buildNumber),
    'App version/build/bundle identity mismatch',
  )
  ensure(
    typeof info.CFBundleExecutable === 'string' &&
      safePath(info.CFBundleExecutable) &&
      !info.CFBundleExecutable.includes('/'),
    'Unsafe app executable',
  )
  return parseUuids(
    await checked(runner, ['xcrun', 'dwarfdump', '--uuid', join(path, info.CFBundleExecutable)]),
  )
}

export async function prepareEasSymbols(
  options: PrepareEasSymbolsOptions,
): Promise<PreparedEasSymbols> {
  const runner = options.runner ?? defaultRunner
  const archive = resolve(options.archivePath)
  const ipa = resolve(options.ipaPath)
  const stage = resolve(options.stagingDirectory)
  ensure(archive.endsWith('.xcarchive') && ipa.endsWith('.ipa'), 'Expected xcarchive and IPA')
  ensure(
    !stage.startsWith(`${archive}/`) && stage !== archive && !archive.startsWith(`${stage}/`),
    'Stage must be separate from archive',
  )
  const archiveSha256 = await hashArchive(archive)
  const ipaSha256 = await hashFile(ipa)
  ensure(
    archiveSha256 === options.expectedArchiveSha256 && ipaSha256 === options.expectedIpaSha256,
    'Archive/IPA hash mismatch',
  )
  const properties = (await plist(join(archive, 'Info.plist'), runner)).ApplicationProperties
  ensure(
    properties?.CFBundleIdentifier === options.bundleId &&
      properties.CFBundleShortVersionString === options.version &&
      String(properties.CFBundleVersion) === String(options.buildNumber),
    'Archive identity mismatch',
  )
  const archiveUuids = await appIdentity(
    appDirectory(join(archive, 'Products', 'Applications')),
    options,
    runner,
  )
  const temporary = await mkdtemp(join(tmpdir(), 'skipper-symbols-'))
  try {
    const unpacked = join(temporary, 'ipa')
    await checked(runner, ['python3', join(support, 'archive.py'), 'unpack', ipa, unpacked])
    const ipaUuids = await appIdentity(appDirectory(join(unpacked, 'Payload')), options, runner)
    ensure(canonical(ipaUuids) === canonical(archiveUuids), 'IPA/archive executable UUID mismatch')
    const symbols = join(temporary, 'symbols')
    await mkdir(symbols)
    await mkdir(join(temporary, 'thin'))
    const slices: SymbolSlice[] = []
    const dsymDirectory = join(archive, 'dSYMs')
    const bundles = readdirSync(dsymDirectory).sort()
    ensure(
      bundles.length > 0 && bundles.every((name) => name.endsWith('.dSYM') && safePath(name)),
      'Missing/unexpected dSYM bundles',
    )
    for (const bundle of bundles) {
      const source = join(dsymDirectory, bundle)
      const files = await enumerateFiles(source)
      const uploadFile = (path: string) =>
        /^(Contents\/Info\.plist|Contents\/Resources\/DWARF\/[^/]+)$/.test(path)
      const relocationFile = (path: string) =>
        /^Contents\/Resources\/Relocations\/[a-z0-9_]+\/[^/]+\.yml$/.test(path)
      ensure(
        files.every((f) => safePath(f.path) && (uploadFile(f.path) || relocationFile(f.path))),
        'Unexpected content in dSYM bundle',
      )
      // Apple emits relocation maps alongside DWARF. Validate them as ordinary local files,
      // but PostHog needs only the UUID-addressed DWARF; keep relocation/source paths off EAS.
      for (const file of files.filter((f) => uploadFile(f.path))) {
        const target = join(symbols, bundle, file.path)
        await mkdir(dirname(target), { recursive: true })
        await copyFile(join(source, file.path), target)
        if (file.path.startsWith('Contents/Resources/DWARF/')) {
          slices.push(
            ...(await measureDwarf(target, join(temporary, 'thin'), runner)).map((s) => ({
              ...s,
              dwarfPath: `${bundle}/${file.path}`,
            })),
          )
        }
      }
    }
    ensure(
      archiveUuids.every((u) =>
        slices.some((s) => s.uuid === u.uuid && s.architecture === u.architecture),
      ),
      'Missing app dSYM architecture',
    )
    const zip = join(temporary, 'symbols.zip')
    await checked(runner, ['python3', join(support, 'archive.py'), 'pack', symbols, zip])
    const manifest: SymbolsManifest = {
      schemaVersion: 1,
      sourceCommit: options.sourceCommit,
      bundleId: options.bundleId,
      version: options.version,
      buildNumber: options.buildNumber,
      archiveSha256,
      ipaSha256,
      symbolsZipSha256: await hashFile(zip),
      easProjectId: options.easProjectId,
      posthogProjectId: options.posthogProjectId,
      posthogHost: options.posthogHost ?? 'https://us.posthog.com',
      posthogCliVersion: POSTHOG_VERSION,
      supportSha256: {
        worker: await hashFile(join(support, 'worker.ts')),
        archive: await hashFile(join(support, 'archive.py')),
      },
      files: await enumerateFiles(symbols),
      slices: slices.sort((a, b) => a.uuid.localeCompare(b.uuid)),
    }
    validateManifest(manifest)
    // Catch concurrent release artifact edits while preparing; never authorize mixed snapshots.
    ensure(
      (await hashArchive(archive)) === archiveSha256 && (await hashFile(ipa)) === ipaSha256,
      'Release artifacts changed during preparation',
    )
    await mkdir(stage, { mode: 0o700 })
    await mkdir(join(stage, '.eas', 'workflows'), { recursive: true })
    for (const [name, contents] of Object.entries(staticStageFiles(manifest)))
      await writeFile(join(stage, name), contents, { flag: 'wx', mode: 0o600 })
    for (const name of ['worker.ts', 'archive.py'])
      await copyFile(join(support, name), join(stage, name))
    await copyFile(zip, join(stage, 'symbols.zip'))
    const prepared = {
      stagingDirectory: stage,
      manifest,
      manifestSha256: manifestSha256(manifest),
      stageFiles: await enumerateFiles(stage),
    }
    await assertPreparedStage(prepared)
    return prepared
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

export async function assertPreparedStage(prepared: PreparedEasSymbols): Promise<void> {
  const { manifest: m, stagingDirectory: directory } = prepared
  validateManifest(m)
  ensure(
    isAbsolute(directory) && realpathSync(directory) === directory,
    'Stage must be an absolute real path',
  )
  ensure(prepared.manifestSha256 === manifestSha256(m), 'Prepared manifest mismatch')
  const actual = await enumerateFiles(directory)
  ensure(
    canonical(actual.map((f) => f.path)) === canonical(ALLOWED_FILES),
    'Stage upload allowlist violation',
  )
  ensure(canonical(actual) === canonical(prepared.stageFiles), 'Stage content changed')
  for (const [name, contents] of Object.entries(staticStageFiles(m)))
    ensure(
      readFileSync(join(directory, name), 'utf8') === contents,
      'Generated stage configuration changed',
    )
  ensure(
    (await hashFile(join(directory, 'worker.ts'))) === m.supportSha256.worker &&
      (await hashFile(join(directory, 'archive.py'))) === m.supportSha256.archive &&
      (await hashFile(join(directory, 'symbols.zip'))) === m.symbolsZipSha256,
    'Stage artifact mismatch',
  )
  ensure(
    m.supportSha256.worker === (await hashFile(join(support, 'worker.ts'))) &&
      m.supportSha256.archive === (await hashFile(join(support, 'archive.py'))),
    'Stage must use reviewed worker source',
  )
  // Revalidate the ZIP centrally before cloud submission, including all bytes and traversal rules.
  const temporary = await mkdtemp(join(tmpdir(), 'skipper-symbols-audit-'))
  try {
    await checked(defaultRunner, [
      'python3',
      join(support, 'archive.py'),
      'unpack',
      join(directory, 'symbols.zip'),
      join(temporary, 'symbols'),
      join(directory, 'manifest.json'),
    ])
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

const eas = ['npx', '--yes', `eas-cli@${EAS_CLI_VERSION}`]
async function fetchArtifactDefault(url: string): Promise<Uint8Array> {
  // This URL comes only from authenticated workflow:view, never from an input flag/manifest.
  const parsed = new URL(url)
  ensure(
    parsed.protocol === 'https:' && !parsed.username && !parsed.password,
    'Invalid EAS artifact URL',
  )
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(60000) })
  ensure(
    response.ok && Number(response.headers.get('content-length') ?? '0') <= 1024 * 1024,
    'Cannot retrieve EAS receipt artifact',
  )
  const chunks: Uint8Array[] = []
  let size = 0
  ensure(response.body, 'Empty EAS artifact')
  for await (const chunk of response.body) {
    size += chunk.length
    ensure(size <= 1024 * 1024, 'EAS receipt artifact too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}
async function authenticatedArtifact(
  runId: string,
  m: SymbolsManifest,
  options: VerifyEasSymbolsOptions,
): Promise<{ jobId: string; artifactId: string; artifactSha256: string; receipt: SymbolsReceipt }> {
  ensure(UUID.test(runId.toUpperCase()), 'Invalid EAS workflow run ID')
  const runner = options.runner ?? defaultRunner
  const run = JSON.parse(
    await checked(
      runner,
      [...eas, 'workflow:view', runId, '--json', '--non-interactive'],
      options.cwd,
      options.cwd ? { EAS_NO_VCS: '1', EAS_PROJECT_ROOT: resolve(options.cwd) } : undefined,
    ),
  )
  ensure(
    run.id === runId &&
      run.status === 'SUCCESS' &&
      Array.isArray(run.errors) &&
      run.errors.length === 0,
    'EAS workflow has not completed successfully',
  )
  ensure(
    run.workflow?.app?.id === m.easProjectId && run.workflow?.fileName === WORKFLOW_FILE,
    'EAS workflow/project identity mismatch',
  )
  const identity = JSON.parse(
    await checked(
      runner,
      [
        'npx',
        '--yes',
        '--package',
        `eas-cli@${EAS_CLI_VERSION}`,
        '--',
        'node',
        join(support, 'eas-run-identity.cjs'),
        runId,
        sha256(workflow(m)),
      ],
      options.cwd,
      options.cwd ? { EAS_NO_VCS: '1', EAS_PROJECT_ROOT: resolve(options.cwd) } : undefined,
    ),
  )
  validateEasRunIdentity(identity, runId, m)
  ensure(
    identity.status === 'SUCCESS' && identity.workflow.id === run.workflow.id,
    'EAS workflow snapshots disagree',
  )
  ensure(Array.isArray(run.jobs) && run.jobs.length === 1, 'Unexpected EAS jobs')
  const job = run.jobs[0]
  ensure(
    job.key === 'symbols' &&
      job.status === 'SUCCESS' &&
      job.errors?.length === 0 &&
      UUID.test(job.id?.toUpperCase()),
    'EAS symbols job not successful',
  )
  const artifacts = job.artifacts?.filter((a: any) => a.name === RECEIPT_ARTIFACT_NAME)
  ensure(
    artifacts?.length === 1 && UUID.test(artifacts[0].id?.toUpperCase()),
    'Missing/ambiguous EAS receipt artifact',
  )
  const artifact = artifacts[0]
  ensure(
    typeof artifact.downloadUrl === 'string' && artifact.downloadUrl.startsWith('https://'),
    'Missing EAS artifact download',
  )
  const bytes = await (options.fetchArtifact ?? fetchArtifactDefault)(artifact.downloadUrl)
  ensure(bytes.length > 0 && bytes.length <= 1024 * 1024, 'Invalid EAS artifact size')
  const temporary = await mkdtemp(join(tmpdir(), 'skipper-symbols-receipt-'))
  let receipt: SymbolsReceipt
  try {
    const artifactPath = join(temporary, 'artifact')
    await writeFile(artifactPath, bytes)
    receipt = JSON.parse(
      await checked(defaultRunner, [
        'python3',
        join(support, 'archive.py'),
        'receipt',
        artifactPath,
      ]),
    )
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
  validateSymbolsReceipt(receipt, m)
  return { jobId: job.id, artifactId: artifact.id, artifactSha256: sha256(bytes), receipt }
}

/** Authenticated EAS read-only verification. A locally authored status or offline check cannot pass it. */
export async function verifyEasSymbolsReceipt(
  receiptPath: string,
  expected: SymbolsManifest,
  options: VerifyEasSymbolsOptions = {},
): Promise<AuthenticatedSymbolsVerification> {
  const record: EasSymbolsReceiptRecord = JSON.parse(readFileSync(receiptPath, 'utf8'))
  ensure(record.schemaVersion === 1, 'Unknown EAS receipt record')
  validateSymbolsReceipt(record.receipt, expected)
  const actual = await authenticatedArtifact(record.workflowRunId, expected, options)
  ensure(
    actual.jobId === record.jobId &&
      actual.artifactId === record.artifactId &&
      actual.artifactSha256 === record.artifactSha256 &&
      canonical(actual.receipt) === canonical(record.receipt),
    'Local receipt differs from authenticated EAS artifact',
  )
  return {
    verification: 'authenticated-eas-artifact',
    workflowRunId: record.workflowRunId,
    jobId: actual.jobId,
    artifactId: actual.artifactId,
    manifestSha256: manifestSha256(expected),
    receipt: actual.receipt,
  }
}

export async function executeEasSymbols(
  prepared: PreparedEasSymbols,
  options: VerifyEasSymbolsOptions & { receiptPath: string },
): Promise<AuthenticatedSymbolsVerification> {
  await assertPreparedStage(prepared)
  const receiptPath = resolve(options.receiptPath)
  ensure(
    !receiptPath.startsWith(`${prepared.stagingDirectory}/`),
    'Receipt must be stored outside upload stage',
  )
  ensure(
    !existsSync(receiptPath) && !existsSync(`${receiptPath}.run.json`),
    'Receipt/run record already exists; do not duplicate cloud work',
  )
  const result = await (options.runner ?? defaultRunner)(
    [...eas, 'workflow:run', WORKFLOW_FILE, '--non-interactive', '--wait', '--json'],
    {
      cwd: prepared.stagingDirectory,
      env: { EAS_NO_VCS: '1', EAS_PROJECT_ROOT: prepared.stagingDirectory },
    },
  )
  // Preserve server-issued run IDs even when --wait fails/cancels/aborts. Never persist bearer URLs.
  let run: { id?: string } = {}
  try {
    run = JSON.parse(result.stdout)
  } catch {
    /* A CLI failure may not emit JSON. */
  }
  if (run.id && UUID.test(run.id.toUpperCase()))
    await writeFile(
      `${receiptPath}.run.json`,
      `${canonical({ schemaVersion: 1, workflowRunId: run.id, exitCode: result.exitCode, manifestSha256: prepared.manifestSha256 })}\n`,
      { flag: 'wx', mode: 0o600 },
    )
  const labels: Record<number, string> = { 11: 'failed', 12: 'canceled', 13: 'wait aborted' }
  ensure(
    result.exitCode === 0,
    `EAS workflow ${labels[result.exitCode] ?? 'command failed'} (exit ${result.exitCode}); retain stage and release artifacts`,
  )
  ensure(run.id, 'EAS returned no workflow run ID; no successful receipt produced')
  const actual = await authenticatedArtifact(run.id, prepared.manifest, {
    ...options,
    cwd: prepared.stagingDirectory,
  })
  const record: EasSymbolsReceiptRecord = { schemaVersion: 1, workflowRunId: run.id, ...actual }
  await writeFile(receiptPath, `${canonical(record)}\n`, { flag: 'wx', mode: 0o600 })
  return {
    verification: 'authenticated-eas-artifact',
    workflowRunId: run.id,
    jobId: actual.jobId,
    artifactId: actual.artifactId,
    manifestSha256: prepared.manifestSha256,
    receipt: actual.receipt,
  }
}

if (import.meta.main) {
  console.error(
    'Library API only: prepareEasSymbols locally; executeEasSymbols requires separately authorized cloud execution. See docs/guides/native-ios-symbols.md.',
  )
  process.exitCode = 1
}
