import { describe, expect, test } from 'bun:test'
import type { RawFix } from './gps-util'
import {
  MAX_TRACE_FIXES,
  parseTraceEnvelope,
  polylineFingerprint,
  TraceRecorder,
  traceFileName,
  traceMatchesRoute,
} from './trace-recorder'

const ROUTE: [number, number][] = Array.from({ length: 20 }, (_, i) => [0, i * 0.0001])
const META = { driveId: 'b6388400-0df4-4edc-a2e0-f4ca65072279', recordedAt: '2026-08-03T12:00:00.000Z', polyline: ROUTE }

function fix(i: number, over: Partial<RawFix['coords']> = {}): RawFix {
  return {
    coords: { latitude: i * 0.0001, longitude: 0, accuracy: 5, speed: 20, heading: 90, ...over },
    timestamp: 1_700_000_000_000 + i * 1000,
  }
}

describe('TraceRecorder — what it captures', () => {
  test('records fixes in order and reports the count + span', () => {
    const r = new TraceRecorder()
    for (let i = 0; i < 10; i++) r.record(fix(i))
    expect(r.count).toBe(10)
    expect(r.spanSec).toBe(9)
    expect(r.truncated).toBe(false)
  })

  test('⚠ preserves the iOS -1 sentinels VERBATIM — they are the data, not dirt', () => {
    // A recorder that "cleaned" these would produce a trace that can never reproduce the
    // sentinel-handling bugs, which are the ones that have actually bitten in the field.
    const r = new TraceRecorder()
    r.record(fix(0, { speed: -1, heading: -1, accuracy: -1 }))
    const env = r.envelope(META)
    expect(env.fixes[0]!.coords.speed).toBe(-1)
    expect(env.fixes[0]!.coords.heading).toBe(-1)
    expect(env.fixes[0]!.coords.accuracy).toBe(-1)
  })

  test('preserves nulls distinctly from -1', () => {
    const r = new TraceRecorder()
    r.record(fix(0, { speed: null, heading: null, accuracy: null }))
    const env = r.envelope(META)
    expect(env.fixes[0]!.coords.speed).toBeNull()
    expect(env.fixes[0]!.coords.heading).toBeNull()
  })

  test('stop() ends capture; later fixes are ignored', () => {
    const r = new TraceRecorder()
    r.record(fix(0))
    r.stop()
    r.record(fix(1))
    expect(r.count).toBe(1)
  })

  test('spanSec is 0 for fewer than two fixes', () => {
    const r = new TraceRecorder()
    expect(r.spanSec).toBe(0)
    r.record(fix(0))
    expect(r.spanSec).toBe(0)
  })

  test('the envelope snapshot does not alias the live buffer', () => {
    const r = new TraceRecorder()
    r.record(fix(0))
    const env = r.envelope(META)
    r.record(fix(1))
    expect(env.fixes).toHaveLength(1)
    expect(r.count).toBe(2)
  })
})

describe('TraceRecorder — the cap STOPS rather than dropping the start', () => {
  test('truncation is flagged, and the fixes kept are the EARLIEST ones', () => {
    // A ring buffer would hand back a full-looking trace missing its beginning — where cold-start
    // accuracy, the first stop and the permission grant live. Short-but-honest beats full-but-lying.
    const r = new TraceRecorder()
    for (let i = 0; i < MAX_TRACE_FIXES + 25; i++) r.record(fix(i))
    expect(r.count).toBe(MAX_TRACE_FIXES)
    expect(r.truncated).toBe(true)
    const env = r.envelope(META)
    expect(env.truncated).toBe(true)
    expect(env.fixes[0]!.timestamp).toBe(1_700_000_000_000) // the FIRST fix survived
  })
})

describe('polylineFingerprint / traceMatchesRoute — replaying against the wrong route', () => {
  test('the same route hashes the same; a different one does not', () => {
    expect(polylineFingerprint(ROUTE)).toBe(polylineFingerprint(ROUTE.map((p) => [...p] as [number, number])))
    const other: [number, number][] = ROUTE.map(([lng, lat]) => [lng + 0.01, lat])
    expect(polylineFingerprint(other)).not.toBe(polylineFingerprint(ROUTE))
  })

  test('sub-metre float noise does NOT change the fingerprint', () => {
    // Rejecting a valid replay over floating-point dust would make the guard worse than useless.
    const jittered: [number, number][] = ROUTE.map(([lng, lat]) => [lng + 1e-9, lat + 1e-9])
    expect(polylineFingerprint(jittered)).toBe(polylineFingerprint(ROUTE))
  })

  test('matches its own route, and names what differs when it does not', () => {
    const r = new TraceRecorder()
    r.record(fix(0))
    const env = r.envelope(META)
    expect(traceMatchesRoute(env, ROUTE)).toEqual({ ok: true })

    const shorter = ROUTE.slice(0, 10)
    const bad = traceMatchesRoute(env, shorter)
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.reason).toContain('vertices')

    const shifted: [number, number][] = ROUTE.map(([lng, lat]) => [lng + 0.01, lat])
    const bad2 = traceMatchesRoute(env, shifted)
    expect(bad2.ok).toBe(false)
    if (!bad2.ok) expect(bad2.reason).toContain('fingerprint')
  })
})

describe('parseTraceEnvelope — a bad file must not read as a broken drive', () => {
  test('round-trips a real envelope', () => {
    const r = new TraceRecorder()
    for (let i = 0; i < 5; i++) r.record(fix(i))
    const env = r.envelope({ ...META, label: 'Tahoe City → South Lake Tahoe', appVersion: '1.1.0' })
    const back = parseTraceEnvelope(JSON.stringify(env))
    expect(back).not.toBeNull()
    expect(back!.driveId).toBe(META.driveId)
    expect(back!.label).toBe('Tahoe City → South Lake Tahoe')
    expect(back!.fixes).toHaveLength(5)
    expect(back!.routeHash).toBe(env.routeHash)
  })

  test('returns null on malformed JSON rather than throwing', () => {
    expect(parseTraceEnvelope('{not json')).toBeNull()
    expect(parseTraceEnvelope('null')).toBeNull()
    expect(parseTraceEnvelope('[]')).toBeNull()
  })

  test('⚠ rejects a JSON array of the WRONG shape', () => {
    // Without this, the wrong file replays as a drive that never moves — which reads as a triggering
    // bug rather than a wrong file, the most expensive confusion this harness could create.
    const wrong = JSON.stringify({ driveId: 'x', fixes: [{ lat: 1, lng: 2 }] })
    expect(parseTraceEnvelope(wrong)).toBeNull()
  })

  test('tolerates an empty fix list (a drive that produced nothing is itself a finding)', () => {
    const parsed = parseTraceEnvelope(JSON.stringify({ driveId: 'x', fixes: [] }))
    expect(parsed).not.toBeNull()
    expect(parsed!.fixes).toHaveLength(0)
  })
})

describe('traceFileName', () => {
  test('is filesystem-safe and sorts chronologically', () => {
    const r = new TraceRecorder()
    const name = traceFileName(r.envelope(META))
    expect(name).toMatch(/^trace-b6388400-[\dT-]+Z\.json$/)
    expect(name).not.toContain(':')
  })
})
