// toProposeRequest / toCreateRequest AS TESTS — INV-1 on the client: anchor IDS ride the wire on both
// hops, verbatim, and NO coordinate or display name is ever reconstructed into a request. Runs under
// `bun test`.
import { describe, expect, test } from 'bun:test'
import type { DriveProposal, PlannedRoute } from '@skipper/shared'
import { durationDrift, toCreateRequest, toProposeRequest } from './planner-route'
import { spokenDuration } from '../ui/voice'

const START = '11111111-1111-4111-8111-111111111111'
const END = '22222222-2222-4222-8222-222222222222'
const MID = '33333333-3333-4333-8333-333333333333'

const planned = (over: Partial<PlannedRoute> = {}): PlannedRoute => ({
  start: START,
  end: END,
  via: undefined,
  targetMinutes: 120,
  ...over,
})

const proposal = (over: Partial<DriveProposal> = {}): DriveProposal => ({
  start: { name: 'Tahoe City, California', lat: 39.1677, lng: -120.1435 },
  end: { name: 'Emerald Bay, California', lat: 38.9541, lng: -120.1097 },
  startId: START,
  endId: END,
  via: undefined,
  viaResolved: undefined,
  polyline: [
    [-120.1435, 39.1677],
    [-120.1097, 38.9541],
  ],
  distanceMeters: 34_000,
  durationSeconds: 2_700,
  routeSig: 'sig',
  estStopCount: 7,
  ...over,
})

describe('toProposeRequest', () => {
  test('emits exactly {start,end} for a one-way — no via, no coords, no names', () => {
    const req = toProposeRequest(planned())
    expect(req).toEqual({ start: START, end: END })
    expect(Object.keys(req).sort()).toEqual(['end', 'start'])
  })

  test('carries via ids through when the planner drew a loop', () => {
    expect(toProposeRequest(planned({ via: [MID] }))).toEqual({
      start: START,
      end: END,
      via: [MID],
    })
  })

  test('an empty via is omitted, not sent as []', () => {
    expect('via' in toProposeRequest(planned({ via: [] }))).toBe(false)
  })

  test('targetMinutes is dropped — /propose has nowhere to put the rider advisory', () => {
    expect('targetMinutes' in toProposeRequest(planned())).toBe(false)
  })

  test('nothing coordinate-shaped can appear in the body', () => {
    const body = JSON.stringify(toProposeRequest(planned({ via: [MID] })))
    expect(body).not.toContain('lat')
    expect(body).not.toContain('lng')
    expect(body).not.toContain('name')
  })
})

describe('toCreateRequest', () => {
  test('reads startId/endId — NOT the resolved display endpoints', () => {
    const req = toCreateRequest(proposal(), 'key-1')
    expect(req).toEqual({ start: START, end: END, idempotencyKey: 'key-1' })
    const body = JSON.stringify(req)
    expect(body).not.toContain('Tahoe City')
    expect(body).not.toContain('lat')
    expect(body).not.toContain('lng')
  })

  test('sends the via IDS, never viaResolved (which is display only)', () => {
    const req = toCreateRequest(
      proposal({
        via: [MID],
        viaResolved: [{ name: 'Sunnyside, California', lat: 39.13, lng: -120.16 }],
      }),
      'key-1',
    )
    expect(req.via).toEqual([MID])
    expect(JSON.stringify(req)).not.toContain('Sunnyside')
  })

  test('an empty via is omitted', () => {
    expect('via' in toCreateRequest(proposal({ via: [] }), 'key-1')).toBe(false)
  })

  test('the key rides verbatim — the same key twice dedupes a retry, a new one is a new create', () => {
    const p = proposal()
    expect(toCreateRequest(p, 'key-1')).toEqual(toCreateRequest(p, 'key-1'))
    expect(toCreateRequest(p, 'key-2').idempotencyKey).toBe('key-2')
  })
})

// The rider's stated duration vs the route Google actually returned. This is the ONLY place the two
// numbers are ever compared — `targetMinutes` is dropped on the way to /propose — so the thresholds
// live or die here.
describe('durationDrift', () => {
  const HOUR = 3600

  test('no stated target → nothing to say (the common case)', () => {
    expect(durationDrift(null, HOUR)).toBeNull()
    expect(durationDrift(undefined, HOUR)).toBeNull()
  })

  test('the observed case: asked ~120 min, got 54 → flagged SHORT', () => {
    const d = durationDrift(120, 54 * 60)
    expect(d).toEqual({ askedMinutes: 120, actualMinutes: 54, direction: 'short' })
  })

  test('a route that runs over is flagged LONG', () => {
    expect(durationDrift(60, 120 * 60)?.direction).toBe('long')
  })

  test('close enough stays quiet — a 60 min ask answered in 55', () => {
    expect(durationDrift(60, 55 * 60)).toBeNull()
  })

  // ⚠ BOTH guards, and each catches what the other misses. Ratio-only nags on short asks; absolute-only
  // nags on long ones. These two cases are why neither threshold may be dropped as redundant.
  test('a big RATIO but a small absolute gap stays quiet (20 min ask, 34 min drive)', () => {
    expect(durationDrift(20, 34 * 60)).toBeNull() // 70% over, but only 14 min
  })

  test('a big ABSOLUTE gap but a small ratio stays quiet (240 min ask, 260 min drive)', () => {
    expect(durationDrift(240, 260 * 60)).toBeNull() // 20 min out, but only 8%
  })

  test('a nonsense duration is never a note', () => {
    expect(durationDrift(120, 0)).toBeNull()
    expect(durationDrift(0, HOUR)).toBeNull()
  })
})

// The ASK is echoed the way it was said, not the way it was stored. A rider who says "about two
// hours" must not be answered with "120 minutes" — the one place this card can sound like a receipt.
describe('spokenDuration', () => {
  test('round hours are spoken, not counted', () => {
    expect(spokenDuration(60)).toBe('an hour')
    expect(spokenDuration(120)).toBe('two hours')
    expect(spokenDuration(180)).toBe('three hours')
  })

  test('half hours read naturally', () => {
    expect(spokenDuration(90)).toBe('an hour and a half')
    expect(spokenDuration(150)).toBe('two and a half hours')
  })

  test('under an hour stays in minutes', () => {
    expect(spokenDuration(45)).toBe('45 minutes')
  })

  test('an awkward figure still reads as words + minutes', () => {
    expect(spokenDuration(140)).toBe('two hours 20 minutes')
  })

  // The tool caps target_minutes at 480 (planner-prompt.ts), which is inside SPELLED — but the
  // fallback must not print `undefined` if that cap ever moves.
  test('beyond the spelled range falls back to a numeral, never undefined', () => {
    expect(spokenDuration(600)).toBe('10 hours')
  })
})
