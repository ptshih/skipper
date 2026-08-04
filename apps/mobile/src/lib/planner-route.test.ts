// toProposeRequest / toCreateRequest AS TESTS — INV-1 on the client: anchor IDS ride the wire on both
// hops, verbatim, and NO coordinate or display name is ever reconstructed into a request. Runs under
// `bun test`.
import { describe, expect, test } from 'bun:test'
import type { DriveProposal, PlannedRoute } from '@skipper/shared'
import {
  durationDrift,
  isRoundTrip,
  proposeKey,
  reflowDrawnCard,
  toCreateRequest,
  toProposeRequest,
  turnaroundOf,
} from './planner-route'
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

describe('proposeKey', () => {
  test('the same drive keys the same however the object was built', () => {
    expect(proposeKey(planned())).toBe(proposeKey(planned()))
    expect(proposeKey(planned({ via: [MID] }))).toBe(proposeKey(planned({ via: [MID] })))
  })

  test('COLLIDES on targetMinutes alone — the case the dedupe exists for', () => {
    // /propose never sees targetMinutes, so these two bill the identical Google Routes call and
    // materialize the identical drive. Treating them as different is what put two identical cards
    // in one transcript.
    expect(proposeKey(planned({ targetMinutes: 120 }))).toBe(
      proposeKey(planned({ targetMinutes: 30 })),
    )
  })

  test('separates drives that really are different', () => {
    const base = proposeKey(planned())
    expect(proposeKey(planned({ end: MID }))).not.toBe(base)
    expect(proposeKey(planned({ start: MID }))).not.toBe(base)
    // A midpoint is a different drive, and so is losing one.
    expect(proposeKey(planned({ via: [MID] }))).not.toBe(base)
  })

  test('an absent via and an EMPTY via are the same drive', () => {
    // `toProposeRequest` omits an empty via rather than sending it, so the key must not split a
    // one-way ask in two depending on which shape the planner happened to emit.
    expect(proposeKey(planned({ via: [] }))).toBe(proposeKey(planned({ via: undefined })))
  })

  test('via ORDER is load-bearing', () => {
    // A→B via C then D is not A→B via D then C: different roads, different bill.
    expect(proposeKey(planned({ via: [MID, START] }))).not.toBe(
      proposeKey(planned({ via: [START, MID] })),
    )
  })
})

describe('reflowDrawnCard', () => {
  // Only the two fields the move actually decides on; the screen's card carries far more.
  const card = (route: PlannedRoute, afterTurn: number, id = 'x') => ({ id, route, afterTurn })

  test('moves the matching card to the END and re-slots it', () => {
    // ⚠ Both halves asserted together, because either alone is the bug: `afterTurn` places the card
    // in the transcript, LAST position makes it `newestCardId` (which gates the live map).
    const cards = [card(planned(), 2, 'a'), card(planned({ end: MID }), 5, 'b')]
    const out = reflowDrawnCard(cards, planned(), 9)

    expect(out.map((c) => c.id)).toEqual(['b', 'a'])
    expect(out[1]!.afterTurn).toBe(9)
  })

  test('COLLIDES on targetMinutes alone — the "make it shorter" case that read as frozen', () => {
    // The rider asks for the same endpoints in a different duration. /propose never sees
    // targetMinutes, so it is the same billed call and the same card — and before this moved, the
    // skipper agreed in words while the screen did nothing at all.
    const cards = [card(planned({ targetMinutes: 120 }), 2, 'a')]
    const out = reflowDrawnCard(cards, planned({ targetMinutes: 30 }), 8)

    expect(out).toHaveLength(1)
    expect(out[0]!.afterTurn).toBe(8)
  })

  test('carries the card ACROSS unchanged but for its slot — never a fresh card', () => {
    // The card owns an idempotency key and a live proposal; re-minting either would buy a second
    // Routes call and let one drive be credit-spent twice.
    const original = { ...card(planned(), 2, 'a'), idempotencyKey: 'k1', state: 'ready' as const }
    const out = reflowDrawnCard([original], planned(), 7)

    expect(out[0]).toEqual({ ...original, afterTurn: 7 })
  })

  test('leaves the array alone when no card matches', () => {
    const cards = [card(planned(), 2, 'a')]
    expect(reflowDrawnCard(cards, planned({ start: MID }), 9)).toEqual(cards)
  })

  test('does not disturb the cards it steps over', () => {
    const cards = [card(planned(), 1, 'a'), card(planned({ end: MID }), 3, 'b'), card(planned({ start: MID }), 4, 'c')]
    const out = reflowDrawnCard(cards, planned(), 9)

    expect(out.map((c) => c.id)).toEqual(['b', 'c', 'a'])
    // The two it moved past keep their own slots — only the re-flowed card is re-slotted.
    expect(out.map((c) => c.afterTurn)).toEqual([3, 4, 9])
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

/* -------------------------------------------------------------------------- */

// ⚠ THE ROUND-TRIP SHAPE, WHICH NOTHING ABOUT A ONE-WAY DRIVE CAN CHECK. The server encodes "down to
// Emerald Bay and back" as `endId === startId` with the turnaround appended as the LAST via, so both
// helpers below are wrong in ways that are invisible until a loop carries MORE than one midpoint —
// the case the preview card got wrong from the day it was written until 2026-08-03. Every
// single-via assertion here would pass against `via[0]`; the multi-via ones are the whole point.
describe('isRoundTrip', () => {
  test('the same id at both ends is a round trip', () => {
    expect(isRoundTrip(proposal({ endId: START }))).toBe(true)
  })

  test('distinct endpoints are one-way, midpoint or not', () => {
    expect(isRoundTrip(proposal())).toBe(false)
    // ⚠ The regression this replaced: keyed on `via.length`, a one-way drive through a midpoint was
    // announced as a "Round trip from X" and its destination never named.
    expect(
      isRoundTrip(proposal({ via: [MID], viaResolved: [{ name: 'Sunnyside', lat: 39.13, lng: -120.16 }] })),
    ).toBe(false)
  })
})

describe('turnaroundOf', () => {
  test('a one-way drive has none, even with midpoints', () => {
    expect(turnaroundOf(proposal())).toBeUndefined()
    expect(
      turnaroundOf(proposal({ viaResolved: [{ name: 'Sunnyside', lat: 39.13, lng: -120.16 }] })),
    ).toBeUndefined()
  })

  test('a round trip with one midpoint turns around there', () => {
    const t = turnaroundOf(
      proposal({ endId: START, viaResolved: [{ name: 'Emerald Bay State Park', lat: 38.95, lng: -120.11 }] }),
    )
    expect(t?.name).toBe('Emerald Bay State Park')
  })

  test('a round trip THROUGH somewhere turns around at the LAST via, not the first', () => {
    // The bug, stated: `via[0]` here is Zephyr Cove — a place the drive passes on the way out — and
    // naming it as the far end describes a drive the rider did not ask for, one tap from a credit.
    const t = turnaroundOf(
      proposal({
        endId: START,
        viaResolved: [
          { name: 'Zephyr Cove', lat: 38.99, lng: -119.95 },
          { name: 'Emerald Bay State Park', lat: 38.95, lng: -120.11 },
        ],
      }),
    )
    expect(t?.name).toBe('Emerald Bay State Park')
    expect(t?.name).not.toBe('Zephyr Cove')
  })

  test('a degenerate round trip with nothing to turn around at has none', () => {
    // Start == end and no midpoint is a zero-distance route; the card falls back to naming the start.
    expect(turnaroundOf(proposal({ endId: START }))).toBeUndefined()
    expect(turnaroundOf(proposal({ endId: START, viaResolved: [] }))).toBeUndefined()
  })
})
