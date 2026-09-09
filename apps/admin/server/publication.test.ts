import { expect, test } from 'bun:test'
import { reviewQueues, structuralBlockers, clipFingerprint, type PublicationClip } from './publication'
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
test('initial readiness needs endpoints and evidence; failed TTS is never advisory', () => {
  const a = clip('a'); a.findings = [{ pass: false, withheld: false, dimension: 'tts', findings: ['tail failure'] }]
  const blockers = structuralBlockers({ region: { slug: 'test', bbox: '-121,36,-119,38', released_at: null },
    clips: [a], endpoints: [], evidence: [] })
  expect(blockers.some(b => b.includes('endpoints'))).toBe(true)
  expect(blockers.some(b => b.includes('generation gate'))).toBe(true)
  expect(blockers.some(b => b.includes('route evidence'))).toBe(true)
})
