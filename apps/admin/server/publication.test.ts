import { expect, test } from 'bun:test'
import { reviewQueues, structuralBlockers, clipFingerprint, type PublicationClip, type PublicationSnapshot } from './publication'
const clip = (id: string, cluster = false, lat = 37): PublicationClip => ({
  narration: { id, poi_id: cluster ? null : id, cluster_id: cluster ? id : null, script: 'A story',
    audio_url: `${id}.m4a`, audio_duration_ms: 1000, attribution: [], updated_at: '2026-09-09', facts_hash: null },
  members: [{ id, name: id, lat, lng: -120, speakable_lat: null, speakable_lng: null, excluded_reason: null, facts_hash: null }],
  cluster: cluster ? { title: id } : null, findings: [],
})
test('reel is deterministic, deduplicated, and includes both subject kinds even with many clusters', () => {
  const clips = Array.from({ length: 20 }, (_, i) => clip(`c${i}`, true, 30 + i))
  clips.push(clip('solo'))
  const ids = (c: PublicationClip[]) => reviewQueues(c).filter(i => i.queue === 'reel').map(i => i.clip.narration.id).sort()
  expect(ids(clips)).toHaveLength(12)
  expect(ids(clips)).toContain('solo')
  expect(ids([...clips].reverse())).toEqual(ids(clips))
})
test('flagged clips outside reel require extra review; empty corpus terminates', () => {
  const clips = [clip('a'), clip('b')]
  clips[1]!.findings = [{ pass: false, withheld: false, dimension: 'diversity', findings: ['Repetition'] }]
  expect(reviewQueues(clips, 1).find(i => i.clip.narration.id === 'b')?.queue).toBe('flagged')
  expect(reviewQueues([])).toEqual([])
})
test('fingerprints change for audio, membership, and corrected geography', () => {
  const a = clip('a'); const b = structuredClone(a)
  b.narration.audio_url = 'new.m4a'; expect(clipFingerprint(a)).not.toBe(clipFingerprint(b))
  const c = structuredClone(a); c.members.push(clip('b').members[0]!)
  expect(clipFingerprint(a)).not.toBe(clipFingerprint(c))
  const d = structuredClone(a); d.members[0]!.speakable_lat = 38
  expect(clipFingerprint(a)).not.toBe(clipFingerprint(d))
})
test('initial readiness needs endpoints and evidence; unknown TTS failures stay hard', () => {
  const a = clip('a'); a.findings = [{ pass: false, withheld: false, dimension: 'tts', findings: ['tail failure'] }]
  const blockers = structuralBlockers({ region: { slug: 'test', bbox: '-121,36,-119,38', released_at: null },
    clips: [a], endpoints: [], evidence: [] })
  expect(blockers.some(b => b.includes('endpoints'))).toBe(true)
  expect(blockers.some(b => b.includes('generation gate'))).toBe(true)
  expect(blockers.some(b => b.includes('route evidence'))).toBe(true)
})

const snapshot = (): PublicationSnapshot => ({ region: { slug: 'test', bbox: '-121,36,-119,38', released_at: null },
  clips: [clip('a')], evidence: [], endpoints: [{ id: 'a', lat: 37, lng: -120 }, { id: 'b', lat: 38, lng: -120 }] })
test('initial endpoint readiness counts distinct vehicle access, preserving legacy raw pins', () => {
  const s = snapshot()
  expect(structuralBlockers(s).some(b => b.includes('distinct endpoints'))).toBe(false)
  s.endpoints.forEach(p => { p.access_lat = 37.5; p.access_lng = -120 })
  expect(structuralBlockers(s)).toContain('Initial launch needs two usable, distinct endpoints')
})
test('invalid and incomplete access pairs cannot masquerade as usable endpoints', () => {
  for (const access of [{ access_lat: 37, access_lng: null }, { access_lat: null, access_lng: -120 },
    { access_lat: 91, access_lng: -120 }, { access_lat: 37, access_lng: Infinity }]) {
    const s = snapshot(); Object.assign(s.endpoints[0]!, access)
    expect(structuralBlockers(s)).toContain('a: invalid endpoint geometry')
    expect(structuralBlockers(s)).toContain('Initial launch needs two usable, distinct endpoints')
  }
})
test('invalid road anchors block individual and combined subjects despite valid raw pins', () => {
  for (const combined of [false, true]) for (const anchor of [
    { speakable_lat: NaN, speakable_lng: -120 }, { speakable_lat: 37, speakable_lng: 181 },
    { speakable_lat: 37, speakable_lng: null }, { speakable_lat: null, speakable_lng: -120 },
  ]) {
    const s = snapshot(); s.clips = [clip('a', combined)]
    Object.assign(s.clips[0]!.members[0]!, anchor)
    expect(structuralBlockers(s)).toContain('a: invalid subject geometry')
  }
})
