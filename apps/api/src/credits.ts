// @skipper/api — the user-owned credit LEDGER (the internal credit API).
//
// Credits are an APPEND-ONLY ledger (`credit_entries`), NOT a count of `drives` rows: each row is one
// immutable movement (+grant / −consume / ±reverse) and a user's balance is SUM(amount). This is the
// billing source of truth, decoupled from the content table. See docs/decisions/credit-ledger.md.
//
// LIVE today: the lifetime free allotment (a single `grant` of FREE_DRIVE_CAP, lazily ensured on
// first touch) + a `consume` per generated drive. DEFERRED: purchase grants (Apple IAP / Google Play,
// idempotent on the provider txn id) + refund clawbacks (a `reverse`). There is NO paid tier — the
// ledger governs EVERY account; a comp/unlimited account is just a large admin grant.

import { eq, sql } from 'drizzle-orm'
import { db } from '@skipper/db'
import { creditEntries } from '@skipper/db/schema'
import { withRetry } from './retry'

// LIFETIME free allotment: every account is granted this many credits, once, ever. A credit is spent
// at generation (POST /drives) and never refunded on delete (no `reverse` is emitted). Beyond it a
// one-time credit pack is the planned unlock (IAP/Play fast-follow); a comp = a large admin grant.
// Admin-tunable via env. NOTE: a grant's amount is frozen when it's written (the ledger is immutable),
// so raising this only affects users not yet granted.
export const FREE_DRIVE_CAP = Number(process.env.FREE_DRIVE_CAP ?? 100)

/** Idempotency key for a user's one free-tier grant (so the lazy grant is exactly-once). */
const freeGrantKey = (userId: string) => `free:${userId}`
/** Idempotency key for the consume that pays for a drive (a drive charges exactly one credit). */
export const driveConsumeKey = (driveId: string) => `drive:${driveId}`

/** The free-tier allotment grant entry — a PURE value builder (mirrors `driveConsumeEntry`) so the
 *  grant's shape (amount/kind/source/key) is unit-testable instead of buried in the insert. */
export function freeGrantEntry(userId: string): typeof creditEntries.$inferInsert {
  return {
    userId,
    amount: FREE_DRIVE_CAP,
    kind: 'grant',
    source: 'free_tier',
    reason: 'free allotment',
    idempotencyKey: freeGrantKey(userId),
  }
}

/** Ensure the free-tier allotment grant exists for this user — idempotent (ON CONFLICT DO NOTHING on
 *  the idempotency key), so it's safe to call on every credit-relevant request. Lazy-on-first-touch
 *  avoids coupling to the auth user-creation lifecycle (anonymous → free conversion, account merges). */
export async function ensureFreeGrant(userId: string): Promise<void> {
  await withRetry(
    () =>
      db
        .insert(creditEntries)
        .values(freeGrantEntry(userId))
        .onConflictDoNothing({ target: creditEntries.idempotencyKey }),
    { label: 'credit.grant.free' },
  )
}

/** The user's credit balance + lifetime granted, in ONE query. `remaining` = SUM(amount) (grants −
 *  consumes − reverses); `granted` = SUM of grant amounts (the lifetime cap, for "N of <granted> left").
 *  Expiry is ignored (lifetime-only in v2; the `expires_at` column is reserved for future promo FIFO). */
export async function creditSummary(userId: string): Promise<{ remaining: number; granted: number }> {
  const rows = await withRetry(
    () =>
      db
        .select({
          remaining: sql<number>`coalesce(sum(${creditEntries.amount}), 0)::int`,
          granted: sql<number>`coalesce(sum(${creditEntries.amount}) filter (where ${creditEntries.kind} = 'grant'), 0)::int`,
        })
        .from(creditEntries)
        .where(eq(creditEntries.userId, userId)),
    { label: 'credit.summary' },
  )
  return { remaining: rows[0]?.remaining ?? 0, granted: rows[0]?.granted ?? 0 }
}

/** The consume entry that pays for a drive — a PURE value builder so the caller can co-commit it with
 *  the drive insert in one `db.batch` (atomic). Keyed on the drive id, so a given drive charges exactly
 *  one credit even if the insert is retried. `source` is null (a debit has no funding source). */
export function driveConsumeEntry(userId: string, driveId: string): typeof creditEntries.$inferInsert {
  return {
    userId,
    amount: -1,
    kind: 'consume',
    reason: `drive:${driveId}`,
    idempotencyKey: driveConsumeKey(driveId),
  }
}
