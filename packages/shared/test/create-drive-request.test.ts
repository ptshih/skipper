import { describe, expect, test } from 'bun:test'
import { createDriveRequest, driveProposeRequest, isDegenerateRoute, plannedRoute } from '../src/schemas'

// The create idempotency key is the money-path dedupe mechanism: the server uses it AS the drive id, so
// a lost-ACK retry no-ops the second create + the second (non-refundable) credit charge. Pin the wire
// contract so a future edit can't quietly break it: OPTIONAL (an older client omits it → the server
// mints the id) and a well-formed UUID when present (it becomes the drive PK; a malformed key must not
// slip through to the insert). See docs/decisions/credit-ledger.md + apps/api/src/drives.ts.
describe('createDriveRequest.idempotencyKey (money-path dedupe contract)', () => {
  const start = '3582ed8a-a55e-4fb2-b8af-59dcd9eef16c'
  const end = '9f1c0b2e-7a4d-4c8b-9e6f-2a1b3c4d5e6f'

  test('accepts a valid UUID', () => {
    const r = createDriveRequest.safeParse({ start, end, idempotencyKey: '3582ed8a-a55e-4fb2-b8af-59dcd9eef16c' })
    expect(r.success).toBe(true)
  })

  test('is optional — an older client may omit it (server mints the id)', () => {
    const r = createDriveRequest.safeParse({ start, end })
    expect(r.success).toBe(true)
  })

  test('rejects a non-UUID key (it becomes the drive PK — no garbage)', () => {
    const r = createDriveRequest.safeParse({ start, end, idempotencyKey: 'not-a-uuid' })
    expect(r.success).toBe(false)
  })
})

// INV-1, pinned at the WIRE. A request names an endpoint by the id of a curated `places` row and
// CANNOT express a coordinate — which is what makes "grounded by construction" a property of the
// schema rather than a promise in a prompt. Once /propose opens to anonymous riders, the old
// `{name, lat, lng}` shape was an unauthenticated endpoint that billed Google Routes for any two
// points on Earth.
describe('drive requests carry ANCHOR IDS, never coordinates (INV-1)', () => {
  const A = '3582ed8a-a55e-4fb2-b8af-59dcd9eef16c'
  const B = '9f1c0b2e-7a4d-4c8b-9e6f-2a1b3c4d5e6f'

  test('a coordinate endpoint is REJECTED', () => {
    const coord = { name: 'Somewhere', lat: 39.1707, lng: -120.1428 }
    expect(driveProposeRequest.safeParse({ start: coord, end: B }).success).toBe(false)
    expect(createDriveRequest.safeParse({ start: A, end: coord }).success).toBe(false)
  })

  test('a non-uuid string is REJECTED — an id must be an id, not a place name', () => {
    expect(driveProposeRequest.safeParse({ start: 'Tahoe City', end: B }).success).toBe(false)
  })

  // ⚠ The one that was actually missing: start/end were hardened while `via` still took coordinates,
  // which satisfies "reject a non-anchor ENDPOINT" exactly while shipping 8 arbitrary billable points.
  // Guarding both ends of a route and leaving the middle open is not a partial guarantee, it is none.
  test('VIA goes through the allowlist too', () => {
    const coord = { name: 'Somewhere', lat: 39.1707, lng: -120.1428 }
    expect(driveProposeRequest.safeParse({ start: A, end: B, via: [coord] }).success).toBe(false)
    expect(createDriveRequest.safeParse({ start: A, end: B, via: [coord] }).success).toBe(false)
    expect(driveProposeRequest.safeParse({ start: A, end: B, via: [A] }).success).toBe(true)
  })

  test('via stays capped, so one request cannot fan out the billed Routes call', () => {
    const many = Array.from({ length: 9 }, () => A)
    expect(driveProposeRequest.safeParse({ start: A, end: B, via: many }).success).toBe(false)
    expect(driveProposeRequest.safeParse({ start: A, end: B, via: many.slice(0, 8) }).success).toBe(true)
  })
})

/**
 * The zero-distance shape, refused at parse on BOTH billed request paths.
 *
 * ⚠ WHY IT NEEDED A SCHEMA RULE RATHER THAN A HANDLER BRANCH. `start === end` with an empty `via`
 * materializes as a near-zero polyline, and nothing downstream refuses it: `loopShapeOf` scores its
 * `retraceFraction` at 0 (the measure needs ~1.5 km of along-route distance before it can see a
 * doubling-back), so the no-same-road gate passes it; `/propose` then bills Google and answers 200 with
 * `estStopCount: 0`; and the only guard that catches an empty drive sits on the CREATE path, which bills
 * a SECOND Routes call before its 422. Two vendor calls for a card that was never a drive.
 */
describe('a route from a place back to itself is refused at parse (the zero-distance shape)', () => {
  const A = '3582ed8a-a55e-4fb2-b8af-59dcd9eef16c'
  const B = '9f1c0b2e-7a4d-4c8b-9e6f-2a1b3c4d5e6f'

  test('both billed request schemas reject it', () => {
    expect(driveProposeRequest.safeParse({ start: A, end: A }).success).toBe(false)
    expect(createDriveRequest.safeParse({ start: A, end: A }).success).toBe(false)
    // An explicitly empty `via` is the same shape spelled differently.
    expect(driveProposeRequest.safeParse({ start: A, end: A, via: [] }).success).toBe(false)
  })

  // ⚠ THE ASSERTION THAT KEEPS THE GUARD FROM EATING THE PRODUCT. A loop IS `end === start`, with the
  // turnaround and the way home as the last two midpoints — so a rule written as "reject start === end"
  // would refuse every round trip in the app while passing every test above it.
  test('a LOOP — start === end WITH midpoints — is still accepted', () => {
    expect(driveProposeRequest.safeParse({ start: A, end: A, via: [B] }).success).toBe(true)
    expect(driveProposeRequest.safeParse({ start: A, end: A, via: [B, A] }).success).toBe(true)
    expect(createDriveRequest.safeParse({ start: A, end: A, via: [B] }).success).toBe(true)
  })

  test('an ordinary one-way route is untouched', () => {
    expect(driveProposeRequest.safeParse({ start: A, end: B }).success).toBe(true)
  })

  // ⚠ MUTATION CHECK ON THE PREDICATE ITSELF, because both halves of it are load-bearing in opposite
  // directions: drop the `start === end` half and every one-way drive is refused; drop the empty-`via`
  // half and every loop is.
  test('the predicate is exactly "same ends AND nothing in between"', () => {
    expect(isDegenerateRoute({ start: A, end: A })).toBe(true)
    expect(isDegenerateRoute({ start: A, end: A, via: [] })).toBe(true)
    expect(isDegenerateRoute({ start: A, end: A, via: null })).toBe(true)
    expect(isDegenerateRoute({ start: A, end: A, via: [B] })).toBe(false)
    expect(isDegenerateRoute({ start: A, end: B })).toBe(false)
  })

  // ⚠ `plannedRoute` IS DELIBERATELY *NOT* REFINED, and this pins that choice rather than leaving it to
  // look like an omission. It also types `drivePlanRequest.drawn`, whose documented rule is that a bad
  // entry is DROPPED rather than rejected — refining it would turn one stale card in a client's history
  // into a 400 on a legitimate conversation turn. The planner-side refusal lives in `toPlannedRoute`
  // (apps/api/src/plan-route.ts), which reads the same predicate.
  test('plannedRoute stays permissive — the drawn array must degrade, never 400', () => {
    expect(plannedRoute.safeParse({ start: A, end: A }).success).toBe(true)
  })
})
