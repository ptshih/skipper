// @skipper/api — account ERASURE (the data half of "delete my account").
//
// App Store Guideline 5.1.1(v) requires any account-creating app to offer in-app account deletion,
// and "delete" means the rider's DATA, not just their login. Better Auth erases what it owns (the
// user row, plus sessions/accounts via their ON DELETE CASCADE in @skipper/db/auth-schema) — but
// `drives.user_id` and `credit_entries.user_id` are SOFT refs: auth runs on a separate
// neon-serverless pool, so no DB-level FK spans the two and there is NO cascade to ride. Deleting
// the auth user alone would silently ORPHAN a rider's drives and ledger — precisely the personal
// data the guideline says must go, minus any session that could ever reach it again. Hence an
// explicit purge.
//
// ⚠ ORDER IS LOAD-BEARING: this runs BEFORE the user row is deleted, never after. If the purge
// lands and the user delete then fails, the rider still holds a session and can retry — converging,
// because a re-run finds nothing left to delete. Running after inverts that: a throw there strands
// orphaned rows behind a user row that no longer exists, unrecoverable.
//
// ⚠ WHICH hook, and why it changed (2026-08-02). This used to hang off `user.deleteUser.beforeDelete`,
// which fires on the two SELF-SERVE delete routes only. `POST /api/auth/admin/remove-user` — mounted
// and live, because the admin plugin is registered unconditionally — went straight to
// `internalAdapter.deleteUser` and skipped it, orphaning exactly the rows this file exists to remove.
// It now hangs off `databaseHooks.user.delete.before`, which every delete path reaches. See
// `./auth` for the full note and `../test/auth-delete-hook.test.ts` for the guard on that assumption.
//
// No R2 cleanup belongs here: audio is SHARED narration clips referenced by a drive, never
// per-user bytes (docs/decisions/create-a-drive-architecture.md). A drive owns its selection
// manifest, not its audio.

import { eq } from 'drizzle-orm'
import { db } from '@skipper/db'
import { creditEntries, drives } from '@skipper/db/schema'
import { withRetry } from './retry'

/** Hard-delete everything this API owns for a user: their drives (rows, not tombstones — a
 *  soft-delete would defeat the erasure) and their whole credit ledger.
 *
 *  Erasure is TOTAL and IMMEDIATE (founder call, 2026-07-15): no grace period, no tombstone.
 *  ⚠ The accepted consequence: `free:<userId>` keys the one-time free grant on the user id, so a
 *  delete → re-signup mints a FRESH allotment. That's a spend-farming vector, knowingly taken —
 *  the alternative (retaining an email hash post-deletion to recognize a returning user) means
 *  keeping a derived identifier after someone asked to be forgotten. Erasure wins.
 *  ⚠ This used to read "FREE_DRIVE_CAP is the blast radius, which is why it's small", and then said
 *  that stopped being true "when the cap was raised for 1.1 (founder call 2026-07-31)" — which never
 *  happened: 2026-07-31 RESOLVED to keep it at 10, and the raise (to 50) did not land until
 *  2026-08-04. The conclusion was right for the wrong reason, so keep the reason and drop the history:
 *  a grant is only a LEDGER ROW — it costs nothing until it is spent, and spending
 *  means creating drives, which `createDriveLimiter` bounds per IP per minute regardless of how many
 *  credits an account holds. So the cap bounds a farmed account's LIFETIME total, never its RATE; the
 *  rate limiter is and always was the actual control. See ./limits.
 *
 *  Batched so a partial purge can't leave drives without their ledger (or vice versa). */
export async function purgeUserData(userId: string): Promise<void> {
  await withRetry(
    () =>
      db.batch([
        db.delete(drives).where(eq(drives.userId, userId)),
        db.delete(creditEntries).where(eq(creditEntries.userId, userId)),
      ]),
    { label: 'account.purge' },
  )
}
