import { describe, expect, test } from 'bun:test'
import { FREE_DRIVE_CAP, driveConsumeEntry, driveConsumeKey } from '../src/credits'

// Pure-surface contract for the credit LEDGER (./src/credits). The DB-bound logic (the idempotent
// free grant's ON CONFLICT DO NOTHING, the SUM-based balance) lives in SQL and would need a live/test
// DB harness the repo doesn't have — these tests pin the parts that DON'T touch the DB: the consume
// entry shape (one drive = exactly −1 credit) and the idempotency key formats.

describe('credit ledger — consume contract', () => {
  test('driveConsumeEntry charges exactly one credit, keyed on the drive id', () => {
    const e = driveConsumeEntry('user_abc', 'drive_123')
    expect(e.userId).toBe('user_abc')
    expect(e.amount).toBe(-1) // one drive consumes exactly one credit
    expect(e.kind).toBe('consume')
    // A debit has no funding source — `source` is left unset (NULL in the ledger).
    expect(e.source ?? null).toBeNull()
    // Idempotency: keyed on the drive id, so a single drive can charge at most once even on retry.
    expect(e.idempotencyKey).toBe('drive:drive_123')
  })

  test('driveConsumeKey matches the entry idempotency key (same drive ⇒ same key)', () => {
    expect(driveConsumeKey('drive_123')).toBe('drive:drive_123')
    expect(driveConsumeKey('drive_123')).toBe(driveConsumeEntry('u', 'drive_123').idempotencyKey)
  })

  test('distinct drives get distinct consume keys (no cross-drive dedupe collision)', () => {
    expect(driveConsumeKey('a')).not.toBe(driveConsumeKey('b'))
  })

  test('FREE_DRIVE_CAP is a positive integer (the lifetime free allotment grant amount)', () => {
    expect(Number.isInteger(FREE_DRIVE_CAP)).toBe(true)
    expect(FREE_DRIVE_CAP).toBeGreaterThan(0)
  })
})
