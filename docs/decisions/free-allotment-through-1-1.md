# The free allotment stays small, and running out is a conversation

> **Status:** DECIDED + APPLIED 2026-07-31 (founder). `FREE_DRIVE_CAP` stays **10**; a rider who runs
> out emails `hello@skipper.fm` and gets more, **free**, via an admin grant — until there is actually
> something to sell. The credit ledger is **untouched**. The home-screen hint is gated to a low balance.
> Amends the blast-radius reasoning in [account-deletion-and-recovery.md](account-deletion-and-recovery.md);
> the ledger model ([credit-ledger.md](credit-ledger.md)) and the no-tiers call
> ([cut-tiers.md](cut-tiers.md)) stand. Evidence:
> [credit-monetization-research.md](../research/credit-monetization-research.md).

## The question

Should 1.1 ship completely free, grandfather existing users, and introduce credits in 2.0?

## The answer

**Ship it effectively free, but do it with a small cap and a human, not a large cap.** The wall stays
where it is; what changes is what a rider finds on the other side of it — an invitation to email, not a
"come back when we build a store."

This keeps three things simultaneously true, which no single number does on its own:

- **Nobody is actually blocked.** Running out costs a rider one email and gets an immediate admin grant.
  The ledger was built for exactly this — a comp *is* a large grant (`cut-tiers.md`).
- **2.0 pricing stays open.** A grant's amount is frozen at signup, so a generous cap would hand the
  entire launch cohort a decade of drives *before* ever asking for money. A small cap keeps that choice.
- **The wall becomes a feedback channel.** For a toy whose whole thesis is that the persona is the
  product, "email me and I'll top you up" is charming, and it puts the founder in direct contact with
  exactly the riders who use it most. That is a better signal than a conversion metric at this scale.

## Two premises that were wrong, corrected here so they aren't re-derived

- ⚠ **`FREE_DRIVE_CAP` is 10, and the number that gets quoted is usually the code default.**
  `credits.ts` reads `process.env.FREE_DRIVE_CAP ?? 100`, and the `?? 100` fallback is what gets
  repeated in conversation — but both env files set **10**, and always have. Read the env, never the
  fallback. (Briefly set to 100 on 2026-07-31 and reverted the same day when this decision landed.)
- ⚠ **Frozen grant amounts cut BOTH ways, and only one direction was understood.** Freezing `amount`
  at signup is what makes *lowering* the cap safely prospective — the known half. It equally blocks
  *raising* it: bumping the env helps only accounts created afterwards. **Any cap change owes existing
  riders an explicit admin grant**, in both directions. This is also why the top-up path is an admin
  grant rather than "we'll raise the cap".

## What was applied

1. `FREE_DRIVE_CAP` stays **10** in `.env.development` and `.env.production` (they point at the same
   Neon DB and R2 — there is no staging). `.env.example` carries the reasoning and the frozen-grant
   warning instead of a bare number.
2. The two pre-1.1 accounts (`ptshih@`, and `review@skipper.fm` — the App Review demo login, which must
   never hit a wall mid-review) were admin-granted to a `granted` of **100**. Left there: the ledger is
   append-only, and reducing them would mean writing a negative `reverse`, which would be dishonest
   bookkeeping for a comp. They are simply comped riders.
3. The `403 drive_limit_reached` copy now names the email path and **no longer promises a credit pack**.
   ⚠ It is the ONLY thing that tells a rider the top-up exists — the client renders the server message
   verbatim. The old copy committed to shipping a purchase flow; nothing sells today and 2.0 may price
   differently.
4. The home-screen hint (`apps/mobile/app/index.tsx`) renders only at or below a low absolute balance.
   It previously rendered unconditionally under a comment claiming it was "not a depleting X-left-of-N
   toll gauge". At a cap of 10 a threshold of 5 gives a rider real runway before the ask.

## The dependency this creates

⚠ **`hello@skipper.fm` must be read by a human.** It was already the App Store support contact, the
privacy contact, and the NRS 603A designated request address; as of this decision it is also **the only
route past the free-drive wall**. The repo's own record says the skipper.fm catch-all does not forward
to the founder's Gmail (verified for `review@`, never for `hello@`), and because the catch-all accepts
everything, SMTP probing can never prove an address is read — only a real test message can. This was
already the top item in `TODO.md`'s ops-hardening list; this decision makes it load-bearing rather than
merely overdue.

## What this does NOT fix — and it is the part that actually costs money

Charging for drives cannot touch the surface 1.1 introduces. `POST /drives/plan` (model tokens) and
`POST /drives/propose` (Google Routes) fire on **anonymous, pre-account, pre-credit** requests. A credit
is consumed at `POST /drives`, which an anonymous rider never reaches by construction.

⚠ Verified 2026-07-31: **there is no anonymous paid surface in production today** — `/drives/plan` does
not exist, and `driveRoutes.use('*', withSession, requireAccount)` currently walls all of `/drives/*`
including propose. 1.1 creates the exposure. That is the good news: the caps get set before any rider is
habituated, which the AI-pricing precedent (Cursor, June 2025) says cannot be clawed back cheaply.

The controls are `apps/api/src/limits.ts` and nothing else. ⚠ **Mount BOTH plan limiters** —
`rateLimit(PLAN_RATE_MINUTE), rateLimit(PLAN_RATE_HOUR)` — the per-minute bucket alone permits ~28,800
requests/day per IP per instance.

## A correction to reasoning recorded elsewhere

**The cap was never the spend control.** `account.ts` said `FREE_DRIVE_CAP` "is the blast radius, which
is why it's small", guarding the delete→re-signup farming vector. A grant is only a ledger row — it
costs nothing until spent, and spending means creating drives, which the per-IP create limiter bounds
regardless of balance. So the cap bounds a farmed account's **lifetime** total, never its **rate**. The
limiter is and always was the control. (A redeemed credit costs ~$0.08 — one planner turn plus one
Routes call — not the ~$3.62 corpus-generation figure; `buildDrive` mints no audio.)

## Rejected

- **Raise the cap to ~100 ("effectively free").** Applied briefly, then reverted. It is the worst of the
  available positions: too large to ever monetize, too large to ration, but small enough that a counter
  still renders — so it pays the cost of a meter for a gate that never fires, while permanently
  foreclosing revenue from the launch cohort. See §7 of the research memo.
- **Grant effectively-infinite (e.g. 10,000) and remove the counter entirely.** Coherent, and the honest
  "this never charges" position — but it forecloses 2.0 pricing for everyone who signs up first, which
  the founder explicitly wants to keep open.
- **Cut to 3–5.** Same shape as the decision taken, but tight enough that a rider hits the wall during
  ordinary early use, making the email a chore rather than a pleasant surprise.
- **Sell a credit pack in 1.1.** A visible purchase affordance that cannot transact is an App Review 2.1
  (App Completeness) rejection, and nothing is built to take money.
- **Remove or bypass the ledger to "go free".** It is the only per-user attribution of real spend, and
  its frozen `amount` IS the grandfathering mechanism. Removal would touch ~10 files and 4 docs for zero
  user-visible gain.
