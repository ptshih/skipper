import { expect, test } from 'bun:test'
import { resolveSelection, assertReleaseAudit, type SimSubject } from './selection'
import type { DriveSelection } from '@skipper/db/schema'
import { triggerRadiusForKind } from '@skipper/engine'
const subject: SimSubject = { subjectId: 'p', subjectKind: 'poi', name: 'Place', form: 'story',
  durationMs: 1000, key: 'audio.m4a', lat: 39, lng: -120, anchored: true }
const selection = [{ kind: 'narration', seq: 2, subjectId: 'p', subjectKind: 'poi',
  triggerLat: 38, triggerLng: -119 }] as DriveSelection

test('saved coordinates survive corrected anchors; live content and radius resolve', () => {
  const r = resolveSelection(selection, [subject])
  expect(r.stops[0]?.ref).toMatchObject({ seq: 2, lat: 38, lng: -119, durationMs: 1000,
    triggerRadiusM: triggerRadiusForKind(null, true) })
})
test('combined stories preserve sequence and their app radius', () => {
  const r = resolveSelection([{ ...selection[0]!, subjectKind: 'cluster' }],
    [{ ...subject, subjectKind: 'cluster', anchored: false, triggerRadiusM: 420 }])
  expect(r.missing).toEqual([])
  expect(r.stops[0]?.ref.triggerRadiusM).toBe(420)
})
test('legacy poiId and absent frozen geometry fall back to live metadata', () => {
  const r = resolveSelection([{ kind: 'narration', seq: 1, poiId: 'p' }] as DriveSelection, [subject])
  expect(r.stops[0]?.ref.lat).toBe(39)
})
test('missing and invalid subjects are explicit and block release audits', () => {
  const r = resolveSelection(selection, [])
  expect(r.missing[0]).toMatchObject({ seq: 2, subject: 'poi:p' })
  expect(() => assertReleaseAudit(r)).toThrow('unresolved')
  expect(() => assertReleaseAudit(resolveSelection([], []))).toThrow('no playable')
  expect(resolveSelection([{ ...selection[0]!, triggerLat: 999 }], [subject]).missing).toHaveLength(1)
})
test('mixed kinds with the same ID cannot overwrite each other', () => {
  const r = resolveSelection([...selection, { ...selection[0]!, seq: 1, subjectKind: 'cluster' }],
    [subject, { ...subject, subjectKind: 'cluster', name: 'Group' }])
  expect(r.stops.map(s => s.ref.name)).toEqual(['Group', 'Place'])
})
