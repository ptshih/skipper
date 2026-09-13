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
    `<plist version="1.0"><dict><key>ApplicationProperties</key><dict>${plist(info).split('<dict>')[1]!.split('</plist>')[0]}</dict></plist>`,
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
function runView(m: SymbolsManifest) {
  return {
    id: runId,
    status: 'SUCCESS',
    errors: [],
    workflow: {
      name: `symbols-${manifestSha256(m)}`,
      fileName: 'symbols.yml',
      app: { id: projectId },
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
  test.skipIf(process.platform !== 'darwin')(
    'real local generated dSYM bundle prepares both architectures and excludes relocation metadata',
    async () => {
      const root = await temporary()
      await file(join(root, 'tiny.c'), 'int main(void) { return 0; }\n')
      const dwarfs: string[] = []
      for (const architecture of ['arm64', 'x86_64']) {
        for (const cmd of [
          [
            'xcrun',
            'clang',
            '-g',
            '-arch',
            architecture,
            '-mmacosx-version-min=13.0',
            '-c',
            'tiny.c',
            '-o',
            `${architecture}.o`,
          ],
          [
            'xcrun',
            'clang',
            '-arch',
            architecture,
            '-mmacosx-version-min=13.0',
            `${architecture}.o`,
            '-o',
            architecture,
          ],
          ['xcrun', 'dsymutil', architecture, '-o', `${architecture}.dSYM`],
        ]) {
          const result = await defaultRunner(cmd, { cwd: root })
          expect(result.exitCode, result.stderr).toBe(0)
        }
        dwarfs.push(
          join(root, `${architecture}.dSYM`, 'Contents', 'Resources', 'DWARF', architecture),
        )
      }
      const fat = join(root, 'fat-dwarf')
      expect(
        (await defaultRunner(['xcrun', 'lipo', '-create', ...dwarfs, '-output', fat])).exitCode,
      ).toBe(0)
      const measured = await measureDwarf(fat, root, defaultRunner)
      expect(measured.map((s) => s.architecture).sort()).toEqual(['arm64', 'x86_64'])
      expect(measured.map((s) => s.sha256).sort()).toEqual(
        (await Promise.all(dwarfs.map(hashFile))).sort(),
      )
      expect(measured.every((s) => s.size > 0 && s.sha256 !== sha256(readFileSync(fat)))).toBe(true)
      const binaryPath = join(root, 'Skipper')
      const bundlePath = join(root, 'Skipper.app.dSYM')
      for (const cmd of [
        [
          'xcrun',
          'lipo',
          '-create',
          join(root, 'arm64'),
          join(root, 'x86_64'),
          '-output',
          binaryPath,
        ],
        ['xcrun', 'dsymutil', binaryPath, '-o', bundlePath],
      ]) {
        const result = await defaultRunner(cmd)
        expect(result.exitCode, result.stderr).toBe(0)
      }
      // Current Apple tools generate these themselves; no reconstructed relocation fixture.
      for (const architecture of ['aarch64', 'x86_64']) {
        expect(
          existsSync(
            join(bundlePath, 'Contents', 'Resources', 'Relocations', architecture, 'Skipper.yml'),
          ),
        ).toBe(true)
      }
      const { prepared } = await fixture({ binaryPath, bundlePath })
      expect(prepared.manifest.slices.map((s) => s.architecture).sort()).toEqual([
        'arm64',
        'x86_64',
      ])
      expect(prepared.manifest.files.map((f) => f.path)).toEqual([
        'Skipper.app.dSYM/Contents/Info.plist',
        'Skipper.app.dSYM/Contents/Resources/DWARF/Skipper',
      ])
      await assertPreparedStage(prepared)
      const relocationPath = join(
        bundlePath,
        'Contents',
        'Resources',
        'Relocations',
        'aarch64',
        'Skipper.yml',
      )
      await rm(relocationPath)
      await symlink('../../DWARF/Skipper', relocationPath)
      await expect(fixture({ binaryPath, bundlePath })).rejects.toThrow('links forbidden')
    },
    30000,
  )
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
        await expect(run).rejects.toThrow()
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
      return ok(
        JSON.stringify(cmd.includes('workflow:run') ? { id: runId } : runView(prepared.manifest)),
      )
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
      const view = runView(prepared.manifest)
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
        runner: async () => ok(JSON.stringify(runView(prepared.manifest))),
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
