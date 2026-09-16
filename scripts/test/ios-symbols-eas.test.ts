import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  truncate,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import {
  assertPreparedStage,
  canonical,
  executeEasSymbols,
  hashArchive,
  hashFile,
  manifestSha256,
  prepareEasSymbols,
  RECEIPT_ARTIFACT_NAME,
  validateSymbolsReceipt,
  validateEasRunIdentity,
  verifyEasSymbolsReceipt,
} from '../ios-symbols-eas'
import type { EasSymbolsReceiptRecord, PreparedEasSymbols } from '../ios-symbols-eas'
import {
  defaultRunner,
  downloadCommand,
  MAX_SLICE_BYTES,
  measureDwarf,
  parseUploadEvidence,
  runSymbolsWorker,
  sha256,
  uploadCommand,
  validateManifest,
  workerFailureRecord,
} from '../ios-symbols-eas/worker'
import type { CommandRunner, SymbolsManifest, SymbolsReceipt } from '../ios-symbols-eas/worker'

const roots: string[] = []
const archiveScript = resolve('scripts/ios-symbols-eas/archive.py')
const arm = '11111111-1111-4111-8111-111111111111'
const x86 = '22222222-2222-4222-8222-222222222222'
const runId = '33333333-3333-4333-8333-333333333333'
const jobId = '44444444-4444-4444-8444-444444444444'
const artifactId = '55555555-5555-4555-8555-555555555555'
const projectId = 'dd556bd3-5c16-430e-8b1f-cfdeb410f26d'
const armBytes = Buffer.from('ARM synthetic DWARF bytes')
const x86Bytes = Buffer.from('X86 synthetic DWARF bytes')
const fatBytes = Buffer.concat([Buffer.from('cafebabe', 'hex'), armBytes, x86Bytes])
const ok = (stdout = '') => ({ exitCode: 0, stdout, stderr: '' })
async function temporary(): Promise<string> {
  const path = realpathSync(await mkdtemp(join(tmpdir(), 'skipper-symbols-test-')))
  roots.push(path)
  return path
}
afterAll(async () => {
  for (const path of roots) await rm(path, { recursive: true, force: true })
})
async function file(path: string, content: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content)
}
async function python(code: string, args: string[]): Promise<void> {
  const result = await defaultRunner(['python3', '-c', code, ...args])
  expect(result.exitCode, result.stderr).toBe(0)
}
const plist = (properties: Record<string, string>) =>
  `<?xml version="1.0"?><plist version="1.0"><dict>${Object.entries(properties)
    .map(([k, v]) => `<key>${k}</key><string>${v}</string>`)
    .join('')}</dict></plist>`

const localRunner: CommandRunner = async (cmd, options) => {
  if (cmd[0] !== 'xcrun') return defaultRunner(cmd, options)
  if (cmd[1] === 'dwarfdump') {
    const path = cmd[3]!
    const bytes = readFileSync(path)
    const values =
      bytes.subarray(0, 4).toString('hex') === 'cafebabe'
        ? [
            [arm, 'arm64'],
            [x86, 'x86_64'],
          ]
        : [
            [
              bytes.toString().startsWith('X86') ? x86 : arm,
              bytes.toString().startsWith('X86') ? 'x86_64' : 'arm64',
            ],
          ]
    return ok(values.map(([uuid, arch]) => `UUID: ${uuid} (${arch}) ${path}`).join('\n'))
  }
  if (cmd[1] === 'lipo') {
    await writeFile(cmd[6]!, cmd[4] === 'arm64' ? armBytes : x86Bytes)
    return ok()
  }
  throw new Error('Unexpected local command')
}

async function fixture(native?: { binaryPath: string; bundlePath: string }): Promise<{
  root: string
  prepared: PreparedEasSymbols
  archive: string
  ipa: string
}> {
  const root = await temporary()
  const archive = join(root, 'Skipper.xcarchive')
  const info = {
    CFBundleIdentifier: 'fm.skipper.app',
    CFBundleShortVersionString: '1.2.0',
    CFBundleVersion: '27',
    CFBundleExecutable: 'Skipper',
  }
  const app = join(archive, 'Products', 'Applications', 'Skipper.app')
  await file(join(app, 'Info.plist'), plist(info))
  await file(join(app, 'Skipper'), native ? readFileSync(native.binaryPath) : fatBytes)
  await file(
    join(archive, 'Info.plist'),
    `<plist version="1.0"><dict><key>CreationDate</key><date>2026-09-12T23:00:00Z</date><key>ArchiveVersion</key><integer>2</integer><key>ApplicationProperties</key><dict>${plist(info).split('<dict>')[1]!.split('</plist>')[0]}</dict></plist>`,
  )
  if (native) {
    await mkdir(join(archive, 'dSYMs'), { recursive: true })
    await cp(native.bundlePath, join(archive, 'dSYMs', 'Skipper.app.dSYM'), { recursive: true })
  } else {
    await file(join(archive, 'dSYMs', 'Skipper.app.dSYM', 'Contents', 'Info.plist'), plist(info))
    await file(
      join(archive, 'dSYMs', 'Skipper.app.dSYM', 'Contents', 'Resources', 'DWARF', 'Skipper'),
      fatBytes,
    )
  }
  const ipaRoot = join(root, 'ipa-input')
  await mkdir(join(ipaRoot, 'Payload'), { recursive: true })
  await cp(app, join(ipaRoot, 'Payload', 'Skipper.app'), { recursive: true })
  const ipa = join(root, 'Skipper.ipa')
  expect((await defaultRunner(['python3', archiveScript, 'pack', ipaRoot, ipa])).exitCode).toBe(0)
  const prepared = await prepareEasSymbols({
    sourceCommit: 'a'.repeat(40),
    version: '1.2.0',
    buildNumber: 27,
    bundleId: 'fm.skipper.app',
    archivePath: archive,
    ipaPath: ipa,
    expectedArchiveSha256: await hashArchive(archive),
    expectedIpaSha256: await hashFile(ipa),
    easProjectId: projectId,
    posthogProjectId: '1234',
    stagingDirectory: join(root, 'stage'),
    runner: native ? defaultRunner : localRunner,
  })
  return { root, prepared, archive, ipa }
}
function uploadOutput(m: SymbolsManifest): string {
  return [
    `INFO Release name: ${m.bundleId}`,
    `INFO Release version: ${m.version}`,
    `INFO Build: ${m.buildNumber}`,
    `INFO UUIDs: ${m.slices.map((s) => s.uuid).join(', ')} (${m.slices.length})`,
    `INFO Uploading ${m.slices.length} dSYM(s)...`,
    'INFO dSYM upload complete',
  ].join('\n')
}
function structuralReceipt(m: SymbolsManifest): SymbolsReceipt {
  return {
    schemaVersion: 1,
    manifestSha256: manifestSha256(m),
    manifest: m,
    upload: parseUploadEvidence(ok(uploadOutput(m)), m),
    readbacks: m.slices.map((s) => ({
      uuid: s.uuid,
      architecture: s.architecture,
      sha256: s.sha256,
      size: s.size,
      command: downloadCommand(s.uuid, 'readback'),
      exitCode: 0,
    })),
  }
}
function runView(prepared: PreparedEasSymbols) {
  const m = prepared.manifest
  const yaml = readFileSync(join(prepared.stagingDirectory, '.eas/workflows/symbols.yml'), 'utf8')
  const workflowIdentity = {
    id: '66666666-6666-4666-8666-666666666666',
    fileName: 'symbols.yml',
    app: { id: projectId },
  }
  return {
    id: runId,
    name: `symbols-${manifestSha256(m)}`,
    status: 'SUCCESS',
    errors: [],
    workflow: {
      ...workflowIdentity,
      name: null,
    },
    workflowRevision: {
      id: '77777777-7777-4777-8777-777777777777',
      yamlConfig: yaml,
      blobSha: createHash('sha1')
        .update(`blob ${Buffer.byteLength(yaml)}\0`)
        .update(yaml)
        .digest('hex'),
      workflow: { ...workflowIdentity },
    },
    jobs: [
      {
        id: jobId,
        key: 'symbols',
        status: 'SUCCESS',
        errors: [],
        artifacts: [
          {
            id: artifactId,
            name: RECEIPT_ARTIFACT_NAME,
            downloadUrl: 'https://eas-artifact.invalid/opaque',
          },
        ],
      },
    ],
  }
}

describe('archive and minimal upload boundary', () => {
  for (const format of ['XML', 'BINARY']) {
    test(`real Python ${format} plist dates retain their type and JSON identity primitives`, async () => {
      const root = await temporary()
      const path = join(root, 'Info.plist')
      await python(
        `import datetime,plistlib,sys
value={'CreationDate':datetime.datetime(2026,9,12,23), 'ApplicationProperties':{'CFBundleIdentifier':'fm.skipper.app','CFBundleShortVersionString':'1.2.0','CFBundleVersion':27}, 'Nested':[datetime.datetime(2026,9,12,23),True,2.5,'2026-09-12T23:00:00Z']}
with open(sys.argv[1],'wb') as f: plistlib.dump(value,f,fmt=getattr(plistlib,'FMT_'+sys.argv[2]))`,
        [path, format],
      )
      const result = await defaultRunner(['python3', archiveScript, 'plist', path])
      expect(result.exitCode, result.stderr).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual({
        CreationDate: { $plistDate: '2026-09-12T23:00:00Z' },
        ApplicationProperties: {
          CFBundleIdentifier: 'fm.skipper.app',
          CFBundleShortVersionString: '1.2.0',
          CFBundleVersion: 27,
        },
        Nested: [{ $plistDate: '2026-09-12T23:00:00Z' }, true, 2.5, '2026-09-12T23:00:00Z'],
      })
    })
    test(`rejects ${format} date identity even when expected version is its ISO string`, async () => {
      // fixture() performs full preparation through real Python with Xcode's CreationDate.
      const { archive, ipa, root } = await fixture()
      await python(
        `import datetime,plistlib,sys
with open(sys.argv[1],'rb') as f: value=plistlib.load(f)
value['ApplicationProperties']['CFBundleShortVersionString']=datetime.datetime(2026,9,12,23)
with open(sys.argv[1],'wb') as f: plistlib.dump(value,f,fmt=getattr(plistlib,'FMT_'+sys.argv[2]))`,
        [join(archive, 'Info.plist'), format],
      )
      const stage = join(root, 'date-identity-stage')
      await expect(
        prepareEasSymbols({
          sourceCommit: 'a'.repeat(40),
          version: '2026-09-12T23:00:00Z',
          buildNumber: 27,
          bundleId: 'fm.skipper.app',
          archivePath: archive,
          ipaPath: ipa,
          expectedArchiveSha256: await hashArchive(archive),
          expectedIpaSha256: await hashFile(ipa),
          easProjectId: projectId,
          posthogProjectId: '1234',
          stagingDirectory: stage,
          runner: localRunner,
        }),
      ).rejects.toThrow('Archive identity mismatch')
      expect(existsSync(stage)).toBe(false)
    }, 15000)
  }
  for (const kind of ['data', 'uid']) {
    test(`does not stringify unsupported plist ${kind}; errors stay sanitized`, async () => {
      const root = await temporary()
      const path = join(root, 'Info.plist')
      await python(
        `import plistlib,sys
value=b'synthetic-private-value' if sys.argv[2]=='data' else plistlib.UID(7)
with open(sys.argv[1],'wb') as f: plistlib.dump({'CFBundleIdentifier':value},f,fmt=plistlib.FMT_BINARY)`,
        [path, kind],
      )
      const result = await defaultRunner(['python3', archiveScript, 'plist', path])
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe('Archive validation/operation failed\n')
    })
  }
  test('deterministic content hash ignores dates/root names, binds permissions and link targets', async () => {
    const root = await temporary()
    await file(join(root, 'a', 'file'), 'content')
    const first = await hashArchive(join(root, 'a'))
    await utimes(join(root, 'a', 'file'), 100, 200)
    await cp(join(root, 'a'), join(root, 'b'), { recursive: true })
    expect(await hashArchive(join(root, 'b'))).toBe(first)
    await chmod(join(root, 'b', 'file'), 0o755)
    expect(await hashArchive(join(root, 'b'))).not.toBe(first)
    await symlink('../../outside', join(root, 'b', 'escape'))
    await expect(hashArchive(join(root, 'b'))).rejects.toThrow()
  })
  for (const kind of [
    'traversal',
    'absolute',
    'backslash',
    'symlink',
    'duplicate',
    'parent-file',
  ]) {
    test(`rejects ${kind} ZIP before creating extraction destination`, async () => {
      const root = await temporary()
      const zip = join(root, 'unsafe.zip')
      await python(
        `import zipfile,sys,stat
z=zipfile.ZipFile(sys.argv[1],'w'); kind=sys.argv[2]
name={'traversal':'../escape','absolute':'/escape','backslash':'dir\\\\escape'}.get(kind,'entry')
i=zipfile.ZipInfo(name); i.external_attr=((stat.S_IFLNK if kind=='symlink' else stat.S_IFREG)|0o644)<<16
z.writestr(i,b'bytes')
if kind=='duplicate': z.writestr(name,b'again')
if kind=='parent-file': z.writestr('entry/child',b'child')
z.close()`,
        [zip, kind],
      )
      const result = await defaultRunner([
        'python3',
        archiveScript,
        'unpack',
        zip,
        join(root, 'out'),
      ])
      expect(result.exitCode).not.toBe(0)
      expect(existsSync(join(root, 'out'))).toBe(false)
    })
  }
  test('prepares both thin hashes and only the allowlisted public stage', async () => {
    const { prepared } = await fixture()
    expect(prepared.manifest.slices.map((s) => s.sha256)).toEqual([
      sha256(armBytes),
      sha256(x86Bytes),
    ])
    expect(prepared.manifest.slices.every((s) => s.sha256 !== sha256(fatBytes))).toBe(true)
    expect(prepared.stageFiles.map((f) => f.path)).toEqual([
      '.eas/workflows/symbols.yml',
      '.easignore',
      'app.json',
      'archive.py',
      'eas.json',
      'manifest.json',
      'package.json',
      'symbols.zip',
      'worker.ts',
    ])
    const workflow = readFileSync(
      join(prepared.stagingDirectory, '.eas/workflows/symbols.yml'),
      'utf8',
    )
    expect(workflow).toContain('runs_on: macos-medium')
    expect(workflow).toContain('environment: production')
    expect(workflow).toContain('type: other')
    expect(workflow.match(/always\(\)/g)?.length).toBe(2)
    expect(workflow).not.toContain('type: build')
    await assertPreparedStage(prepared)
    await file(join(prepared.stagingDirectory, '.env'), 'synthetic-secret')
    await expect(assertPreparedStage(prepared)).rejects.toThrow('allowlist')
  })
  test('fails changed ZIP hash and changed archive/IPA identity before cloud', async () => {
    const { prepared, archive, ipa, root } = await fixture()
    await file(join(prepared.stagingDirectory, 'symbols.zip'), 'tampered')
    await expect(assertPreparedStage(prepared)).rejects.toThrow('changed')
    await expect(
      prepareEasSymbols({
        sourceCommit: 'a'.repeat(40),
        version: '1.2.0',
        buildNumber: 27,
        bundleId: 'fm.skipper.app',
        archivePath: archive,
        ipaPath: ipa,
        expectedArchiveSha256: 'b'.repeat(64),
        expectedIpaSha256: await hashFile(ipa),
        easProjectId: projectId,
        posthogProjectId: '1234',
        stagingDirectory: join(root, 'second'),
        runner: localRunner,
      }),
    ).rejects.toThrow('hash mismatch')
  })
  test('rehashed ZIP with unexpected bytes still fails the expected file manifest', async () => {
    const { prepared, root } = await fixture()
    const extracted = join(root, 'unpacked')
    expect(
      (
        await defaultRunner([
          'python3',
          archiveScript,
          'unpack',
          join(prepared.stagingDirectory, 'symbols.zip'),
          extracted,
          join(prepared.stagingDirectory, 'manifest.json'),
        ])
      ).exitCode,
    ).toBe(0)
    await file(join(extracted, prepared.manifest.slices[0]!.dwarfPath), 'different bytes')
    const zip = join(root, 'tampered.zip')
    await defaultRunner(['python3', archiveScript, 'pack', extracted, zip])
    expect(
      (
        await defaultRunner([
          'python3',
          archiveScript,
          'unpack',
          zip,
          join(root, 'bad-out'),
          join(prepared.stagingDirectory, 'manifest.json'),
        ])
      ).exitCode,
    ).not.toBe(0)
    expect(existsSync(join(root, 'bad-out'))).toBe(false)
  })
})

describe('PostHog completion and readback', () => {
  test('failure diagnostics ignore arbitrary exception fields and secret-bearing messages', () => {
    const error = Object.assign(new Error('synthetic-secret https://private.invalid/token'), {
      code: 'UPLOAD_COMMAND_FAILED',
      phase: 'upload',
      stack: 'synthetic-secret',
    })
    expect(workerFailureRecord(error)).toEqual({
      schemaVersion: 1,
      phase: 'unknown',
      code: 'UNKNOWN_WORKER_FAILURE',
      error: 'Symbol upload/readback did not complete; no verified receipt produced.',
    })
  })
  for (const code of [
    'MANIFEST_INVALID',
    'WORKER_SOURCE_MISMATCH',
    'SYMBOL_ARCHIVE_MISMATCH',
    'SECRET_MISSING',
    'PROJECT_MISMATCH',
    'HOST_MISMATCH',
    'ARCHIVE_EXTRACTION_FAILED',
    'DWARF_MEASUREMENT_FAILED',
    'DWARF_MANIFEST_MISMATCH',
    'UPLOAD_COMMAND_FAILED',
    'UPLOAD_EVIDENCE_INVALID',
  ] as const) {
    test(`worker reports only fixed diagnostic ${code}`, async () => {
      const { prepared } = await fixture()
      const root = prepared.stagingDirectory
      const m = structuredClone(prepared.manifest)
      if (code === 'MANIFEST_INVALID')
        await file(join(root, 'manifest.json'), 'synthetic-secret invalid JSON')
      if (code === 'WORKER_SOURCE_MISMATCH')
        await file(join(root, 'worker.ts'), 'synthetic-secret changed source')
      if (code === 'SYMBOL_ARCHIVE_MISMATCH')
        await file(join(root, 'symbols.zip'), 'synthetic-secret corrupt ZIP')
      if (code === 'DWARF_MANIFEST_MISMATCH') {
        m.slices[0]!.sha256 = 'f'.repeat(64)
        await file(join(root, 'manifest.json'), JSON.stringify(m))
      }
      let uploads = 0
      const runner: CommandRunner = async (cmd, options) => {
        if (
          (code === 'ARCHIVE_EXTRACTION_FAILED' && cmd[0] === 'python3') ||
          (code === 'DWARF_MEASUREMENT_FAILED' && cmd[0] === 'xcrun')
        )
          throw new Error('synthetic-secret command exception')
        if (cmd[0] !== 'npx') return localRunner(cmd, options)
        expect(cmd.includes('upload')).toBe(true)
        uploads++
        if (code === 'UPLOAD_COMMAND_FAILED')
          return {
            exitCode: 1,
            stdout: 'synthetic-secret',
            stderr: 'https://private.invalid/token',
          }
        return ok('synthetic-secret invalid upload evidence')
      }
      let caught: unknown
      try {
        await runSymbolsWorker(root, runner, {
          POSTHOG_CLI_API_KEY: code === 'SECRET_MISSING' ? '' : 'synthetic-secret',
          POSTHOG_CLI_PROJECT_ID: code === 'PROJECT_MISMATCH' ? '5678' : '1234',
          ...(code === 'HOST_MISMATCH' ? { POSTHOG_CLI_HOST: 'https://eu.posthog.com' } : {}),
        })
      } catch (error) {
        caught = error
      }
      const diagnostic = workerFailureRecord(caught)
      expect(diagnostic.code).toBe(code)
      expect(JSON.stringify(diagnostic)).not.toContain('synthetic-secret')
      expect(JSON.stringify(diagnostic)).not.toContain('private.invalid')
      expect(existsSync(join(root, 'receipt.json'))).toBe(false)
      expect(uploads).toBe(code.startsWith('UPLOAD_') ? 1 : 0)
    }, 15000)
  }
  test('actual worker CLI writes a fixed phase/code failure without exception contents', async () => {
    const root = await temporary()
    await file(join(root, 'manifest.json'), 'synthetic-secret invalid JSON')
    await cp(resolve('scripts/ios-symbols-eas/worker.ts'), join(root, 'worker.ts'))
    const result = await defaultRunner([process.execPath, '--no-env-file', 'worker.ts'], {
      cwd: root,
    })
    expect(result.exitCode).toBe(1)
    const diagnostic = JSON.parse(readFileSync(join(root, 'failure.json'), 'utf8'))
    expect(diagnostic.code).toBe('MANIFEST_INVALID')
    expect(diagnostic.phase).toBe('preflight')
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe(
      'Symbol verification failed [preflight/MANIFEST_INVALID]. No verified receipt produced.\n',
    )
    expect(JSON.stringify(diagnostic)).not.toContain('synthetic-secret')
    expect(existsSync(join(root, 'receipt.json'))).toBe(false)
  })
  test('rejects zero bundles, oversized skip, partial processing, nonzero exit and release fallback', async () => {
    const {
      prepared: { manifest: m },
    } = await fixture()
    for (const tail of [
      'WARN Skipping symbol set with id: UUID, file too large',
      'WARN Release ID mismatch detected. Retrying upload without release IDs...',
      'WARN Failed to process dSYM',
    ]) {
      expect(() => parseUploadEvidence(ok(`${uploadOutput(m)}\n${tail}`), m)).toThrow()
    }
    expect(() => parseUploadEvidence(ok('No dSYM bundles found in symbols'), m)).toThrow()
    expect(() => parseUploadEvidence({ ...ok(uploadOutput(m)), exitCode: 1 }, m)).toThrow()
    expect(() => parseUploadEvidence(ok(uploadOutput(m).replace(x86, arm)), m)).toThrow(
      'every expected UUID',
    )
    expect(() =>
      parseUploadEvidence(ok(uploadOutput(m).replace('Build: 27', 'Build: 26')), m),
    ).toThrow('release')
    expect(uploadCommand(m, 'symbols')).toEqual([
      'npx',
      '--yes',
      '@posthog/cli@0.9.1',
      '--dry-run=false',
      'dsym',
      'upload',
      '--directory',
      'symbols',
      '--release-name',
      'fm.skipper.app',
      '--release-version',
      '1.2.0',
      '--build',
      '27',
    ])
  })
  test('rejects empty/oversized thin slice before any PostHog call', async () => {
    const root = await temporary()
    const dwarf = join(root, 'dwarf')
    await file(dwarf, armBytes)
    await truncate(dwarf, MAX_SLICE_BYTES + 1)
    await expect(measureDwarf(dwarf, root, localRunner)).rejects.toThrow('oversized')
    await truncate(dwarf, 0)
    await expect(measureDwarf(dwarf, root, localRunner)).rejects.toThrow('Truncated')
  })
  for (const behavior of ['success', 'wrong-bytes', 'read-permission-denied']) {
    test(`worker ${behavior}: actual ZIP/files with injected cloud runner`, async () => {
      const { prepared } = await fixture()
      const calls: string[][] = []
      const runner: CommandRunner = async (cmd, options) => {
        if (cmd[0] !== 'npx') return localRunner(cmd, options)
        calls.push(cmd)
        if (cmd.includes('upload')) return ok(uploadOutput(prepared.manifest))
        if (behavior === 'read-permission-denied')
          return { exitCode: 1, stdout: '', stderr: 'synthetic read forbidden' }
        const uuid = cmd[cmd.indexOf('--ref') + 1]!
        await file(
          join(options!.cwd!, 'readback', uuid, 'dwarf'),
          behavior === 'wrong-bytes'
            ? Buffer.from('ARM wrong bytes')
            : uuid === arm
              ? armBytes
              : x86Bytes,
        )
        return ok()
      }
      const run = runSymbolsWorker(prepared.stagingDirectory, runner, {
        POSTHOG_CLI_API_KEY: 'synthetic-not-a-token',
        POSTHOG_CLI_PROJECT_ID: '1234',
      })
      if (behavior === 'success') {
        const receipt = await run
        expect(receipt.readbacks.length).toBe(2)
        validateSymbolsReceipt(receipt, prepared.manifest)
        expect(calls.length).toBe(3)
      } else {
        const error = await run.catch((error: unknown) => error)
        const diagnostic = workerFailureRecord(error)
        expect(diagnostic.code).toBe(
          behavior === 'wrong-bytes' ? 'READBACK_SLICE_MISMATCH' : 'READBACK_COMMAND_FAILED',
        )
        expect(diagnostic.phase).toBe('readback')
        expect(JSON.stringify(diagnostic)).not.toContain('synthetic read forbidden')
        expect(existsSync(join(prepared.stagingDirectory, 'receipt.json'))).toBe(false)
      }
    })
  }
  test('offline validation binds every release/artifact field and does not authenticate', async () => {
    const {
      prepared: { manifest: m },
    } = await fixture()
    const receipt = structuralReceipt(m)
    validateSymbolsReceipt(receipt, m)
    for (const [key, value] of Object.entries({
      archiveSha256: 'c'.repeat(64),
      ipaSha256: 'd'.repeat(64),
      sourceCommit: 'e'.repeat(40),
      version: '1.2.1',
      buildNumber: 28,
    })) {
      expect(() => validateSymbolsReceipt(receipt, { ...m, [key]: value })).toThrow(
        'identity mismatch',
      )
    }
    expect(() =>
      validateSymbolsReceipt({ ...receipt, readbacks: receipt.readbacks.slice(0, 1) }, m),
    ).toThrow('Incomplete')
    expect(() =>
      validateSymbolsReceipt(
        { ...receipt, readbacks: receipt.readbacks.map((s) => ({ ...s, sha256: 'f'.repeat(64) })) },
        m,
      ),
    ).toThrow('readback mismatch')
    expect(() => validateManifest({ ...m, slices: [] })).toThrow('Empty')
  })
})

describe('authenticated EAS proof', () => {
  test('portable helper discovers only the exact pinned EAS package on npm PATH', async () => {
    const { findPinnedEas } = require('../ios-symbols-eas/eas-run-identity.cjs')
    const root = await temporary()
    const bins: string[] = []
    for (const version of ['25.0.0', '24.3.0']) {
      const base = join(root, version, 'node_modules', 'eas-cli')
      const bin = join(root, version, 'node_modules', '.bin')
      await file(join(base, 'bin', 'run'), '#!/usr/bin/env node\n')
      await file(join(base, 'package.json'), JSON.stringify({ name: 'eas-cli', version }))
      await mkdir(bin, { recursive: true })
      await symlink('../eas-cli/bin/run', join(bin, 'eas'))
      bins.push(bin)
    }
    expect(findPinnedEas(bins.join(':'))).toBe(join(root, '24.3.0', 'node_modules', 'eas-cli'))
    expect(() => findPinnedEas(bins[0])).toThrow('Pinned EAS CLI unavailable')
    expect(() => findPinnedEas('.')).toThrow('Pinned EAS CLI unavailable')
  })
  test('query helper uses fresh exact-run query and never returns unexpected YAML or server errors', async () => {
    const { queryRunIdentity, QUERY } = require('../ios-symbols-eas/eas-run-identity.cjs')
    const fixture = JSON.parse(
      readFileSync(resolve('scripts/ios-symbols-eas/fixtures/eas-run-identity.json'), 'utf8'),
    )
    const expectedSha = sha256(fixture.run.workflowRevision.yamlConfig)
    let args: unknown[] = []
    let response: any = { data: { workflowRuns: { byId: fixture.run } } }
    const client = {
      query: (...values: unknown[]) => {
        args = values
        return { toPromise: async () => response }
      },
    }
    const value = await queryRunIdentity(client, fixture.run.id, expectedSha)
    expect(args).toEqual([
      QUERY,
      { id: fixture.run.id },
      { requestPolicy: 'network-only', noRetry: true },
    ])
    validateEasRunIdentity(value, fixture.run.id, fixture.manifest)
    expect(value.workflow.name).toBeUndefined()
    response = { error: { message: 'synthetic-secret GraphQL failure' } }
    await expect(queryRunIdentity(client, fixture.run.id, expectedSha)).rejects.toThrow(
      'EAS identity query failed',
    )
    response = { data: { workflowRuns: { byId: structuredClone(fixture.run) } } }
    response.data.workflowRuns.byId.workflowRevision.yamlConfig = 'synthetic-secret unexpected YAML'
    await expect(queryRunIdentity(client, fixture.run.id, expectedSha)).rejects.toThrow(
      'EAS identity query failed',
    )
  })
  test('actual EAS fixture binds run name and immutable revision despite null workflow name', () => {
    const fixture = JSON.parse(
      readFileSync(resolve('scripts/ios-symbols-eas/fixtures/eas-run-identity.json'), 'utf8'),
    )
    expect(fixture.run.workflow.name).toBeNull()
    expect(fixture.run.status).toBe('FAILURE')
    validateEasRunIdentity(fixture.run, fixture.run.id, fixture.manifest)
    for (const mutate of [
      (run: any) => {
        delete run.name
        run.workflow.name = `symbols-${manifestSha256(fixture.manifest)}`
      },
      (run: any) => {
        run.workflowRevision.yamlConfig += '\n'
      },
      (run: any) => {
        run.workflowRevision.blobSha = 'f'.repeat(40)
      },
      (run: any) => {
        run.workflowRevision.workflow.id = runId
      },
      (run: any) => {
        run.workflowRevision.workflow.app.id = runId
      },
      (run: any) => {
        run.workflowRevision.workflow.fileName = 'different.yml'
      },
      (run: any) => {
        run.workflow.latestRevision = run.workflowRevision
        delete run.workflowRevision
      },
    ]) {
      const changed = structuredClone(fixture.run)
      mutate(changed)
      expect(() => validateEasRunIdentity(changed, fixture.run.id, fixture.manifest)).toThrow(
        'immutable workflow identity mismatch',
      )
    }
  })
  test('accepts bounded EAS tar receipt and rejects link/traversal archive artifacts', async () => {
    const root = await temporary()
    const source = join(root, 'receipt.json')
    await file(source, '{"schemaVersion":1}')
    for (const name of ['receipt.json', '../receipt.json', 'link']) {
      const artifact = join(
        root,
        `${name === 'receipt.json' ? 'good' : name === 'link' ? 'link' : 'traversal'}.tar.gz`,
      )
      await python(
        `import io,tarfile,sys
data=open(sys.argv[1],'rb').read()
with tarfile.open(sys.argv[2],'w:gz') as t:
 i=tarfile.TarInfo(sys.argv[3]); i.size=len(data)
 if sys.argv[3]=='link': i.type=tarfile.SYMTYPE; i.linkname='receipt.json'
 t.addfile(i,io.BytesIO(data))`,
        [source, artifact, name],
      )
      const result = await defaultRunner(['python3', archiveScript, 'receipt', artifact])
      expect(result.exitCode).toBe(name === 'receipt.json' ? 0 : 1)
      if (name === 'receipt.json') expect(JSON.parse(result.stdout)).toEqual({ schemaVersion: 1 })
    }
  })
  test('execute then fresh verify checks remote run+job+artifact; never relies on CLI0', async () => {
    const { prepared, root } = await fixture()
    const receipt = structuralReceipt(prepared.manifest)
    const bytes = Buffer.from(canonical(receipt))
    const calls: Array<{ cmd: string[]; options: any }> = []
    const runner: CommandRunner = async (cmd, options) => {
      calls.push({ cmd, options })
      return ok(JSON.stringify(cmd.includes('workflow:run') ? { id: runId } : runView(prepared)))
    }
    const receiptPath = join(root, 'receipt-record.json')
    const fetchArtifact = async (url: string) => {
      expect(url).toBe('https://eas-artifact.invalid/opaque')
      return bytes
    }
    const result = await executeEasSymbols(prepared, { receiptPath, runner, fetchArtifact })
    expect(result.verification).toBe('authenticated-eas-artifact')
    await verifyEasSymbolsReceipt(receiptPath, prepared.manifest, {
      runner,
      fetchArtifact,
      cwd: prepared.stagingDirectory,
    })
    expect(calls.filter((c) => c.cmd.includes('workflow:run')).length).toBe(1)
    expect(calls.filter((c) => c.cmd.includes('workflow:view')).length).toBe(2)
    expect(
      calls.filter((c) => c.cmd.some((arg) => arg.endsWith('/eas-run-identity.cjs'))).length,
    ).toBe(2)
    expect(calls[0]!.options.env).toEqual({
      EAS_NO_VCS: '1',
      EAS_PROJECT_ROOT: prepared.stagingDirectory,
    })
    expect(calls[0]!.cmd).not.toContain('--ref')
    expect(calls[0]!.cmd).not.toContain('-F')
    expect(readFileSync(receiptPath, 'utf8')).not.toContain('eas-artifact.invalid')
  })
  test('caller-authored receipt cannot pass absent authenticated success and exact readback', async () => {
    const { prepared, root } = await fixture()
    const receipt = structuralReceipt(prepared.manifest)
    const bytes = Buffer.from(canonical(receipt))
    const record: EasSymbolsReceiptRecord = {
      schemaVersion: 1,
      workflowRunId: runId,
      jobId,
      artifactId,
      artifactSha256: sha256(bytes),
      receipt,
    }
    const receiptPath = join(root, 'record.json')
    await file(receiptPath, canonical(record))
    for (const mutate of [
      (view: any) => {
        view.status = 'IN_PROGRESS'
      },
      (view: any) => {
        view.jobs[0].status = 'FAILURE'
      },
      (view: any) => {
        view.workflow.app.id = runId
      },
      (view: any) => {
        view.jobs[0].artifacts = []
      },
    ]) {
      const view = runView(prepared)
      mutate(view)
      await expect(
        verifyEasSymbolsReceipt(receiptPath, prepared.manifest, {
          runner: async () => ok(JSON.stringify(view)),
          fetchArtifact: async () => bytes,
        }),
      ).rejects.toThrow()
    }
    const wrongReceipt = structuredClone(receipt)
    wrongReceipt.readbacks[0]!.sha256 = 'f'.repeat(64)
    await expect(
      verifyEasSymbolsReceipt(receiptPath, prepared.manifest, {
        runner: async () => ok(JSON.stringify(runView(prepared))),
        fetchArtifact: async () => Buffer.from(canonical(wrongReceipt)),
      }),
    ).rejects.toThrow('readback mismatch')
    await expect(
      verifyEasSymbolsReceipt(receiptPath, prepared.manifest, {
        runner: async () => ({ exitCode: 1, stdout: '', stderr: 'unauthenticated' }),
      }),
    ).rejects.toThrow('Command failed')
  })
  for (const exitCode of [11, 12, 13]) {
    test(`EAS --wait ${exitCode} keeps stage/run reference and produces no receipt`, async () => {
      const { root, prepared } = await fixture()
      const receiptPath = join(root, 'record.json')
      await expect(
        executeEasSymbols(prepared, {
          receiptPath,
          runner: async () => ({ exitCode, stdout: JSON.stringify({ id: runId }), stderr: '' }),
        }),
      ).rejects.toThrow(`exit ${exitCode}`)
      expect(existsSync(receiptPath)).toBe(false)
      expect(JSON.parse(readFileSync(`${receiptPath}.run.json`, 'utf8')).workflowRunId).toBe(runId)
      expect(existsSync(join(prepared.stagingDirectory, 'symbols.zip'))).toBe(true)
    }, 15000) // Includes real ZIP/plist subprocesses; QA saw setup exceed Bun's 5s under load.
  }
})
