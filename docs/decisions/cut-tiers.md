# Cut user tiers — credits govern premium, there is no paid plan

> **Status:** DECIDED + DONE 2026-06-20. The `user.tier` ('free'|'paid') flag is removed everywhere —
> the Better Auth `additionalFields.tier`, the `user.tier` column (`@skipper/db/auth-schema`), the
> `paid` member of the `accessTier` Zod enum (`@skipper/shared`), `tierOf`'s `paid` branch +
> `TIER_RANK.paid` (`apps/api/src/tiers.ts`), and the three `tier === 'free'` credit-gate conditionals
> in `apps/api/src/drives.ts` (the pre-check, the consume, and the "N left" hint). Supersedes the
> freemium "anonymous → free → paid `user.tier`" ladder (CLAUDE.md auth invariant + stack note, both
> updated in this change). A migration drops the orphaned `user.tier` column; applying it to the shared
> DB is founder-gated (db:migrate). Not committed/pushed as of writing.

## Why

We moved drive capacity onto a user-owned **credit ledger** (`credit_entries`; see
[credit-ledger.md](credit-ledger.md)). Once credits meter what an account can do, a separate `paid`
*tier* is redundant: any future premium is **bought as credits**, not unlocked by a plan flag. The
`paid` tier's only behavioral role was a credit-gate **bypass** (uncapped generation) — and a comped /
unlimited account is now expressed the same way everyone buys capacity: a large **admin grant** (the
admin Users page → "Grant credits" CTA). One concept (credits) instead of two (credits + tier).

## What changed

- **Access collapses to two levels.** `accessTier` is now `'anonymous' | 'free'`. `anonymous` =
  no/guest session (roam + preview only); `free` = **any** signed-in account. The load-bearing wall is
  unchanged: `requireAccount` still rejects `anonymous` (drives need an account).
- **Every account spends credits.** The `tier === 'free'` guards in `POST /drives` are gone — the
  pre-check, the co-committed consume, and the `GET /drives` "N left" hint now run for **every**
  account. There is no uncapped path.
- **Comp = a grant, not a tier.** To give someone unlimited-feeling capacity, grant a big credit pile
  via the admin CTA. (The allotment is `FREE_DRIVE_CAP` — the value lives in `apps/api/src/credits.ts`
  + env, never in prose; see [free-allotment-through-1-1.md](free-allotment-through-1-1.md).)
- **`role` is untouched.** The Better Auth admin `role` (region-release-gate preview / admin console)
  was always a separate concern from tier and stays exactly as-is.

## Rejected alternatives

- **Admin-role bypasses the cap** — keep `role === 'admin'` uncapped, everyone else on credits. Kept
  the model impure (a second capacity path) for marginal convenience; comp-via-grant covers it.
- **A dedicated `unlimited` flag** — most explicit, but adds a column + admin toggle UI for what a
  large grant already does.

## Migration / wire notes

No users yet and v1 isn't shipped live, so this is a clean break: the `accessTier` wire enum drops
`paid` additively-incompatibly (acceptable pre-launch), and the `user.tier` column is dropped via a
drizzle migration (`db:generate`; the **apply** to the shared Neon DB is founder-gated). Nothing reads
`user.tier` after this change, so an un-applied migration is harmless in the interim — the orphaned
column is simply ignored by the schema.
