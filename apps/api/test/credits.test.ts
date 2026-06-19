import { describe, expect, test } from 'bun:test'
import { FREE_DRIVE_CAP, driveConsumeEntry, driveConsumeKey, freeGrantEntry } from '../src/credits'

// Pure-surface contract for the credit LEDGER (./src/credits). The DB-bound logic (the idempotent
// free grant's ON CONFLICT DO NOTHING, the SUM-based balance) lives in SQL and would need a live/test
// DB harness the repo doesn't have — these tests pin the parts that DON'T touch the DB: the grant +
// consume entry shapes (the money movements) and the idempotency key formats.

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

})

describe('credit ledger — free grant contract', () => {
  test('freeGrantEntry grants exactly FREE_DRIVE_CAP credits, keyed once per user', () => {
    const g = freeGrantEntry('user_abc')
    expect(g.userId).toBe('user_abc')
    expect(g.amount).toBe(FREE_DRIVE_CAP) // the lifetime free allotment
    expect(g.amount).toBeGreaterThan(0) // a grant is a CREDIT (positive), unlike the -1 consume
    expect(g.kind).toBe('grant')
    expect(g.source).toBe('free_tier') // a grant records its funding source
    // Idempotency: keyed on the user, so the lazy grant mints AT MOST once ever (no double-allotment).
    expect(g.idempotencyKey).toBe('free:user_abc')
  })

  test('distinct users get distinct grant keys (no cross-user grant dedupe collision)', () => {
    expect(freeGrantEntry('a').idempotencyKey).not.toBe(freeGrantEntry('b').idempotencyKey)
  })

  test('a grant and a consume never share an idempotency key (no cross-kind dedupe collision)', () => {
    expect(freeGrantEntry('u').idempotencyKey).not.toBe(driveConsumeEntry('u', 'u').idempotencyKey)
  })
})
