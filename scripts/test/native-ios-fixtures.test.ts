import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as schemas from '../../packages/shared/src/schemas'
import { gateFor } from '../../packages/shared/src/version'
import {
  createSseParser,
  parseSayDelta,
  type SseFrame,
} from '../../fixtures/native-ios/legacy-oracles/planner-util'
import { toWire, type Turn } from '../../fixtures/native-ios/legacy-oracles/planner-transcript'
import { shouldMintAnonymous, type MintInputs } from '../../fixtures/native-ios/legacy-oracles/anon-session-util'
import {
  decideDriveGate,
  migrateV4ToV5,
  missingAudioSeqs,
  orphanStoreNames,
  revisionToken,
} from '../../fixtures/native-ios/legacy-oracles/offline-util'

interface FixtureCase<I, E> {
  id: string
  input: I
  expected: E
}
interface Suite<C> {
  fixtureVersion: number
  clock: string
  cases: C[]
}
const fixtureRoot = resolve(import.meta.dir, '../../fixtures/native-ios')
describe('frozen legacy oracle provenance', () => {
  const provenance = JSON.parse(
    readFileSync(resolve(fixtureRoot, 'legacy-oracles/provenance.json'), 'utf8'),
  ) as { files: { file: string; sha256: string }[] }
  for (const oracle of provenance.files) {
    test(oracle.file, () => {
      const bytes = readFileSync(resolve(fixtureRoot, 'legacy-oracles', oracle.file))
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(oracle.sha256)
    })
  }
})
function load<C>(name: string): Suite<C> {
  const value = JSON.parse(readFileSync(resolve(fixtureRoot, name), 'utf8')) as Suite<C>
  expect(value.fixtureVersion).toBe(1)
  expect(value.cases.length).toBeGreaterThan(0)
  const ids = value.cases.map((c) => (c as { id: string }).id)
  expect(new Set(ids).size).toBe(ids.length)
  return value
}
const jsonValue = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

type VersionUICase = FixtureCase<{
  responses: { version: unknown; bootstrap: unknown; ownedDrives: unknown; proposal?: unknown }
  stream?: { chunks: number[][]; terminal: unknown }
  versionDelayMs: number
}, { gate: 'force' | 'nudge'; laterVisible: boolean }>
describe('native version UI responses use the retained public policy contract', () => {
  for (const c of load<VersionUICase>('contracts/version-policy-ui.json').cases) {
    test(c.id, () => {
      const response = schemas.versionResponse.parse(c.input.responses.version)
      schemas.bootstrap.parse(c.input.responses.bootstrap)
      schemas.driveList.parse(c.input.responses.ownedDrives)
      const policy = response.policies.find(p => p.platform === 'ios')
      expect(policy).toBeDefined()
      expect(gateFor('1.2.0', policy!)).toBe(c.expected.gate)
      expect(c.expected.laterVisible).toBe(c.expected.gate === 'nudge')
      if (c.id === 'version-recommended-delayed-planner') {
        schemas.driveProposal.parse(c.input.responses.proposal)
        const stream = c.input.stream
        if (!stream) throw new Error('Late planner nudge requires a real streamed proposal')
        const parser = createSseParser()
        const frames = stream.chunks.flatMap(chunk => parser.push(Uint8Array.from(chunk)))
        frames.push(...parser.end())
        const terminals = frames.filter(frame => frame.event === 'turn')
        expect(terminals).toHaveLength(1)
        expect(schemas.drivePlanResponse.parse(JSON.parse(terminals[0]!.data)))
          .toEqual(schemas.drivePlanResponse.parse(stream.terminal))
      }
    })
  }
})

type UIFlowCase = FixtureCase<{
  responses?: { bootstrap: unknown; proposal: unknown; createdManifest: unknown; ownedDrives: unknown }
  stream?: { chunks: number[][]; terminal: unknown }
  ownedDrives?: unknown
}, { canonicalDriveId?: string; detailTitle?: string; persistence?: {
  canonicalDriveId: string; localDriveDirectoryIds: string[]; manifestVersion: number
  clipCount: number; audioByteCount: number; audioSHA256: string
  afterStorageCommit: boolean; afterSameRunRelaunch: boolean
} }>

describe('extended native UI fixtures use the current public wire contract', () => {
  const cases = load<UIFlowCase>('contracts/ui-flows.json').cases
  test('create continuity requires real fixture audio and settled canonical persistence', () => {
    const audio = readFileSync(resolve(fixtureRoot, 'contracts/audio/create-continuity.m4a'))
    const selected = cases.filter(c => ['planner-account-retry', 'planner-account-lost-ack'].includes(c.id))
    expect(selected).toHaveLength(2)
    for (const c of selected) {
      if (!c.input.responses || !c.expected.persistence) throw new Error(`Missing persistence contract: ${c.id}`)
      const manifest = schemas.driveManifest.parse(c.input.responses.createdManifest)
      const persistence = c.expected.persistence
      expect(manifest.driveId).toBe(persistence.canonicalDriveId)
      expect(persistence.localDriveDirectoryIds).toEqual([manifest.driveId!])
      expect(persistence.manifestVersion).toBe(5)
      expect(persistence.afterStorageCommit).toBe(true)
      expect(persistence.afterSameRunRelaunch).toBe(true)
      expect(manifest.clips).toHaveLength(persistence.clipCount)
      expect(manifest.clips).toHaveLength(1)
      expect(manifest.clips[0]).toMatchObject({
        contentType: 'audio/mp4', durationMs: 250, subjectKind: 'poi',
        subjectId: '00000003-0000-4000-8000-000000000001',
        url: 'https://fixture.invalid/native-ios/create-continuity.m4a',
      })
      expect(audio.length).toBe(persistence.audioByteCount)
      expect(audio.length).toBeGreaterThan(0)
      expect(createHash('sha256').update(audio).digest('hex')).toBe(persistence.audioSHA256)
    }
    // Actual decoding and Storage writes are covered by native helper/UI runs, not this hash.
  })
  for (const c of cases.filter(c => c.id.startsWith('planner-'))) {
    test(c.id, () => {
      const responses = c.input.responses
      const stream = c.input.stream
      if (!responses || !stream) throw new Error(`Missing required planner payloads: ${c.id}`)
      expect(schemas.bootstrap.parse(responses.bootstrap).regions.length).toBeGreaterThan(0)
      const proposal = schemas.driveProposal.parse(responses.proposal)
      const manifest = schemas.driveManifest.parse(responses.createdManifest)
      schemas.driveList.parse(responses.ownedDrives)
      const parser = createSseParser()
      const frames = stream.chunks.flatMap(chunk => parser.push(Uint8Array.from(chunk)))
      frames.push(...parser.end())
      const terminals = frames.filter(frame => frame.event === 'turn')
      expect(terminals).toHaveLength(1)
      const terminal = schemas.drivePlanResponse.parse(JSON.parse(terminals[0]!.data))
      expect(terminal).toEqual(schemas.drivePlanResponse.parse(stream.terminal))
      expect(terminal.route?.start).toBe(proposal.startId)
      expect(terminal.route?.end).toBe(proposal.endId)
      if (c.id !== 'planner-reset-during-stream') {
        if (!c.expected.canonicalDriveId || !c.expected.detailTitle) {
          throw new Error(`Missing canonical create expectations: ${c.id}`)
        }
        expect(manifest.driveId).toBe(c.expected.canonicalDriveId)
        expect(manifest.label).toBe(c.expected.detailTitle)
      }
    })
  }
  test('landmark geometry uses wire longitude/latitude order and stays on the intended land reference', () => {
    const fixture = cases.find(c => c.id === 'planner-map-landmark')
    if (!fixture?.input.responses) throw new Error('Missing landmark proposal')
    const proposal = schemas.driveProposal.parse(fixture.input.responses.proposal)
    const manifest = schemas.driveManifest.parse(fixture.input.responses.createdManifest)
    expect(proposal.polyline).toHaveLength(4)
    expect(manifest.polyline).toEqual(proposal.polyline)
    expect(proposal.polyline[0]).toEqual([proposal.start.lng, proposal.start.lat])
    expect(proposal.polyline.at(-1)).toEqual([proposal.end.lng, proposal.end.lat])
    // Broad park bounds intentionally independent of the fixture's order metadata.
    // A valid numeric tuple can still decode into an impossible latitude or another continent.
    for (const [longitude, latitude] of proposal.polyline) {
      expect(longitude).toBeGreaterThanOrEqual(-122.49)
      expect(longitude).toBeLessThanOrEqual(-122.46)
      expect(latitude).toBeGreaterThanOrEqual(37.76)
      expect(latitude).toBeLessThanOrEqual(37.78)
    }
    const longitudeSpan = Math.max(...proposal.polyline.map(p => p[0])) - Math.min(...proposal.polyline.map(p => p[0]))
    const latitudeSpan = Math.max(...proposal.polyline.map(p => p[1])) - Math.min(...proposal.polyline.map(p => p[1]))
    expect(longitudeSpan).toBeGreaterThan(0.01)
    expect(latitudeSpan).toBeGreaterThan(0.0005)
  })
  test('recovered account has no server-verified ownership of old local drives', () => {
    const recovery = cases.find(c => c.id === 'corrupt-credentials-recovery')
    if (!recovery) throw new Error('Missing recovery scenario')
    expect(schemas.driveList.parse(recovery.input.ownedDrives).drives).toEqual([])
  })
})

interface DtoCase extends FixtureCase<unknown, { valid: boolean; value?: unknown }> {
  schema: keyof typeof schemas
}
describe('native public DTO goldens against current Zod schemas', () => {
  for (const c of load<DtoCase>('contracts/dto.json').cases) {
    test(c.id, () => {
      const schema = schemas[c.schema]
      if (!schema || typeof schema !== 'object' || !('safeParse' in schema)) {
        throw new Error(`Fixture names a non-schema export: ${c.schema}`)
      }
      const result = schema.safeParse(c.input)
      expect(result.success).toBe(c.expected.valid)
      if (result.success) expect(jsonValue(result.data)).toEqual(c.expected.value)
    })
  }
})

type SseCase = FixtureCase<
  { chunks: number[][]; finish: string },
  {
    frames: SseFrame[]
    deltas: string[]
    outcome: string
    terminal?: schemas.DrivePlanResponse
  }
>
describe('native SSE byte fixtures against frozen shipped parser', () => {
  for (const c of load<SseCase>('contracts/sse.json').cases) {
    test(c.id, () => {
      const parser = createSseParser()
      const frames = c.input.chunks.flatMap((chunk) => parser.push(Uint8Array.from(chunk)))
      // An abort/error does not flush bytes which the socket never delivered as EOF.
      if (c.input.finish === 'eof') frames.push(...parser.end())
      expect(frames).toEqual(c.expected.frames)
      const firstTerminal = frames.findIndex((frame) => frame.event === 'turn')
      const beforeTerminal = firstTerminal < 0 ? frames : frames.slice(0, firstTerminal)
      expect(
        beforeTerminal
          .filter((f) => f.event === 'say')
          .map((f) => parseSayDelta(f.data))
          .filter((d) => d !== null),
      ).toEqual(c.expected.deltas)
      if (c.expected.outcome === 'success') {
        const terminal = frames[firstTerminal]
        expect(terminal).toBeDefined()
        expect(schemas.drivePlanResponse.parse(JSON.parse(terminal!.data))).toEqual(
          c.expected.terminal!,
        )
      }
      // Cancellation, no-retry and failed-transcript removal need real native transport tests.
      // This proves framing/DTO parsing only, not an invented transport clone.
    })
  }
})

for (const c of load<FixtureCase<Turn[], ReturnType<typeof toWire>>>('contracts/transcript.json')
  .cases) {
  test(`native transcript golden: ${c.id}`, () => expect(toWire(c.input)).toEqual(c.expected))
}
for (const c of load<FixtureCase<MintInputs, { mint: boolean }>>('contracts/anonymous-mint.json')
  .cases) {
  test(`native anonymous mint predicate: ${c.id}`, () => {
    expect(shouldMintAnonymous(c.input)).toBe(c.expected.mint)
    // attemptedAfter belongs to the coordinator, not the pure predicate.
  })
}

type ManifestCase = FixtureCase<
  {
    manifest: Record<string, unknown> | null
    verifiedPlacedNames?: string[]
  },
  {
    manifest?: Record<string, unknown>
    availableSeqs?: number[]
    missingSeqs?: number[]
    offlineGate?: ReturnType<typeof decideDriveGate>
    onlineGate?: ReturnType<typeof decideDriveGate>
  }
>
const manifests = load<ManifestCase>('migration/manifests.json')
describe('native manifest goldens against existing pure migration/gate', () => {
  for (const c of manifests.cases) {
    if (c.input.manifest?.version === 4 && c.expected.manifest) {
      test(c.id, () => {
        expect(migrateV4ToV5(c.input.manifest!, new Set(c.input.verifiedPlacedNames))).toEqual(
          c.expected.manifest!,
        )
      })
    }
    if (c.expected.availableSeqs && c.expected.missingSeqs) {
      test(c.id, () => {
        const expectedSeqs = c.input.manifest!.audioSeqs as number[]
        const missing = missingAudioSeqs(expectedSeqs, c.expected.availableSeqs!)
        expect(missing).toEqual(c.expected.missingSeqs!)
        const input = {
          hasAnyLocal: c.expected.availableSeqs!.length > 0,
          missingCount: missing.length,
        }
        expect(decideDriveGate({ ...input, online: false })).toBe(c.expected.offlineGate!)
        expect(decideDriveGate({ ...input, online: true })).toBe(c.expected.onlineGate!)
        // Native tests must derive availability from files; this is not filesystem proof.
      })
    }
  }
  test('captured revision token matches fixed timestamp', () => {
    expect(revisionToken(manifests.clock)).toBe('1789214400000')
  })
})

type GCCase = FixtureCase<
  { inspection: string; busy: string[]; keep: string[]; onDisk: string[] },
  {
    deleteFiles: string[]
  }
>
for (const c of load<GCCase>('migration/gc.json').cases) {
  if (c.input.inspection !== 'complete' || c.input.busy.length || !c.input.keep.length) continue
  test(`native GC candidate golden: ${c.id}`, () => {
    expect(orphanStoreNames(c.input.onDisk, c.input.keep).map((name) => `clips/${name}`)).toEqual(
      c.expected.deleteFiles,
    )
    // Whole-sweep fail-closed guards belong to the IO coordinator, not this pure helper.
  })
}
