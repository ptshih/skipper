import { describe, expect, test } from 'bun:test'
import { createDriveRequest, driveProposeRequest } from '../src/schemas'

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
