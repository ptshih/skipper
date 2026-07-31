# 1.1 ships effectively free; credits stay live and silent

> **Status:** DECIDED + APPLIED 2026-07-31 (founder). `FREE_DRIVE_CAP` is **100** in both env files,
> the two pre-1.1 accounts are admin-granted to a `granted` of 100, and the home-screen credit hint is
> gated to appear only at a low balance. The credit ledger is **untouched** — this is a number, not an
> architecture change. Amends the blast-radius reasoning in
> [account-deletion-and-recovery.md](account-deletion-and-recovery.md); the ledger model itself
> ([credit-ledger.md](credit-ledger.md)) and the no-tiers call ([cut-tiers.md](cut-tiers.md)) stand.

## The question

Should 1.1 ship completely free, grandfather existing users, and introduce a credit system in 2.0?

## The answer, and why it was smaller than it looked

**Yes — but almost none of it was a build.** The credit system is already live and metering every
account. "Going free" is one env value plus two admin grants. What made the question look bigger was a
wrong premise, corrected here so it does not get re-derived:

- ⚠ **`FREE_DRIVE_CAP` was 10, not 100.** `credits.ts` reads `process.env.FREE_DRIVE_CAP ?? 100`, and
  the *code default* is what gets quoted in conversation — but both env files set **10**. So the
  product was NOT already effectively free; 10 is a wall a genuine enthusiast reaches, and the two
  test accounts had burned 3 of their 20 before launch. Read the env, never the fallback.
- ⚠ **Frozen grant amounts cut BOTH ways, and only one direction was understood.** A grant's `amount`
  is written into an immutable row at signup, which is what makes *lowering* the cap safely
  prospective — the well-known half. The unexamined half: it equally blocks *raising* it. Bumping the
  env helps only accounts created afterwards, so without an explicit top-up the two founding riders
  would have ended up the most constrained users in the world, and the only ones ever shown a counter.
  **Any future cap raise carries the same obligation.**

## What was applied

1. `FREE_DRIVE_CAP` → **100** in `.env.development` and `.env.production` (they point at the same Neon
   DB and R2 — there is no staging). `.env.example` updated to match, with the frozen-grant warning.
2. Both pre-1.1 accounts admin-granted **+90** to a `granted` of 100 (`kind: 'grant'`,
   `source: 'admin_grant'`, fresh idempotency key — the exact shape `POST /admin/users/:id/credits`
   writes). Verified after: `granted=100` for both, balances 99 and 98.
3. The home-screen hint (`apps/mobile/app/index.tsx`) now renders only at or below a low absolute
   balance. It previously rendered unconditionally, with a comment claiming it was "not a depleting
   X-left-of-N toll gauge" — true only while the allotment was small enough to be interesting. At a
   generous allotment an always-on counter is worse than none: it hangs a meter on a charm-first
   screen to report a wall a decade away.

## What was NOT done, deliberately

- **The ledger was not removed or bypassed.** It is the only per-user attribution of real spend, and
  its frozen `amount` IS the grandfathering mechanism. Removing it would touch ~10 files and 4 docs
  for zero user-visible gain.
- **No "Buy credits" affordance ships in 1.1.** A visible purchase control that cannot transact is an
  App Review 2.1 (App Completeness) rejection.
- **The `403 drive_limit_reached` copy stays.** It already names the credit pack as coming — which
  makes a 2.0 credit launch a fulfilled promise rather than a bait-and-switch.

## What this does NOT fix — and it is the part that actually costs money

Charging for drives cannot touch the surface 1.1 introduces. `POST /drives/plan` (model tokens) and
`POST /drives/propose` (Google Routes) fire on **anonymous, pre-account, pre-credit** requests. A
credit is consumed at `POST /drives`, which an anonymous rider never reaches by construction.

⚠ Verified 2026-07-31: **there is no anonymous paid surface in production today** — `/drives/plan` does
not exist yet, and `driveRoutes.use('*', withSession, requireAccount)` currently walls all of
`/drives/*` including propose. 1.1 creates the exposure. That is the good news: these caps get set
before any rider is habituated, which the AI-pricing precedent (Cursor, June 2025) says is the one
thing that cannot be clawed back cheaply.

The controls are `apps/api/src/limits.ts` and nothing else. ⚠ **Mount BOTH plan limiters** —
`rateLimit(PLAN_RATE_MINUTE), rateLimit(PLAN_RATE_HOUR)` — the per-minute bucket alone permits ~28,800
requests/day per IP per instance.

## Two corrections to reasoning recorded elsewhere

- **The cap was never the spend control.** A grant is a ledger row; it costs nothing until spent, and
  spending means creating drives, which the per-IP create limiter bounds regardless of balance. So
  `FREE_DRIVE_CAP` bounds a farmed account's **lifetime** total, never its **rate** — which means
  raising it does not raise the rate of the delete→re-signup farming vector that
  [account-deletion-and-recovery.md](account-deletion-and-recovery.md) knowingly accepts.
- **A redeemed credit costs ~$0.08**, not the ~$3.62 corpus-generation figure: `buildDrive` reuses
  existing `narrations` rows and mints no audio. The worst-case liability of a generous cap is
  therefore bounded and trivial at this user count.

## The promise, if it is ever made

Promise a **noun**, not an adverb. Bitwarden took a trust hit in Oct 2025 for editing a webpage to
remove "Always free" — with no pricing change attached. *"What's in your account stays in your
account"* is keepable and structurally already true (frozen `amount`). *"Skipper is free"* is not,
because the anonymous planner is exactly the surface that may need gating. Any promise should carry a
cutoff date, its exclusions in the same document, and the account-active conditional that
`purgeUserData` already enforces (deleting an account forfeits unspent credits, immediately and by
design).

## Rejected

- **Keep the cap at 10 and merely hide the counter.** It rations a product that cannot yet be sold —
  IAP is deferred either way — and the wall lands on the most engaged riders with nothing to buy on
  the other side.
- **Raise it for new riders only.** Frozen grants would leave the two earliest supporters with a tenth
  of what a stranger signing up tomorrow receives. The one option that turns a correct mechanism into
  a visible unfairness.
- **Measure willingness-to-pay in 1.1.** At 2 accounts it is unmeasurable: 0 payers out of 10 users is
  statistically consistent with a true conversion rate as high as ~31%. Pinning a 2% rate to ±1 point
  needs ~750 users. This is a measurement that cannot be taken, not one being given up.
