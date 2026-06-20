import { describe, expect, test } from 'bun:test'
import { createDriveRequest } from '../src/schemas'

// The create idempotency key is the money-path dedupe mechanism: the server uses it AS the drive id, so
// a lost-ACK retry no-ops the second create + the second (non-refundable) credit charge. Pin the wire
// contract so a future edit can't quietly break it: OPTIONAL (an older client omits it → the server
// mints the id) and a well-formed UUID when present (it becomes the drive PK; a malformed key must not
// slip through to the insert). See docs/decisions/credit-ledger.md + apps/api/src/drives.ts.
describe('createDriveRequest.idempotencyKey (money-path dedupe contract)', () => {
  const start = { name: 'Tahoe City', lat: 39.1707, lng: -120.1428 }
  const end = { name: 'Kings Beach', lat: 39.2377, lng: -120.0263 }

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
