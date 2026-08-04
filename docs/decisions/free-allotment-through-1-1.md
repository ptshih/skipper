# The free allotment stays small, and running out is a conversation

> **Status:** DECIDED + APPLIED 2026-07-31 (founder), **AMENDED 2026-08-04 (founder): the number is
> now 50, not 10.** The SHAPE below is unchanged and still the decision — a bounded cap plus a human,
> never a large cap plus a paywall — but 10 put the wall inside a single trip for a rider who was
> actually enjoying the thing, which is the worst possible moment to meet a support address. 50 keeps
> every argument in §"The answer" true while moving the wall past the first real road trip.
> Admin/demo/test accounts go ABOVE 50 by explicit grant, never by moving the number.
> A rider who runs out still emails `hello@skipper.fm` and gets more, **free**, via an admin grant —
> until there is actually something to sell. The credit ledger is **untouched** (the raise is one
> constant + two env values; existing riders keep their frozen 10 until granted — see §"Two premises").
> The home-screen hint is gated to a low balance.
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

- ⚠ **The code default and the deployed value must be EQUAL, and for nine days they were not.**
  The 2026-07-31 revert put both env files back to **10** but left `credits.ts` reading
  `process.env.FREE_DRIVE_CAP ?? 100` — the leftover of the reverted experiment. So the fallback was
  the number that got quoted in conversation, and a deploy that ever dropped the env var would have
  granted 100 silently. Closed 2026-08-04: the default is now **50**, the same as both env files.
  A fallback looser than the deployed value is a silent overspend, not a convenience.
- ⚠ **Frozen grant amounts cut BOTH ways, and only one direction was understood.** Freezing `amount`
  at signup is what makes *lowering* the cap safely prospective — the known half. It equally blocks
  *raising* it: bumping the env helps only accounts created afterwards. **Any cap change owes existing
  riders an explicit admin grant**, in both directions. This is also why the top-up path is an admin
  grant rather than "we'll raise the cap".

## What was applied

1. `FREE_DRIVE_CAP` is **50** in `.env.development` and `.env.production` (they point at the same
   Neon DB and R2 — there is no staging), and the `credits.ts` default matches. `.env.example` carries
   the reasoning and the frozen-grant warning alongside the number. *(Was 10 from 2026-07-31 until the
   2026-08-04 amendment above.)*
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
   toll gauge". ⚠ The threshold is an ABSOLUTE count, not a ratio, deliberately (the rider's grant is
   frozen while the default moves, so a percentage would mean different things to two riders on one
   screen) — which means the 2026-08-04 raise to 50 changed what it buys: the same threshold that was
   half the allotment is now a tenth of it. Left as-is; the hint is meant to fire when the wall is
   genuinely near, and a tenth is nearer than a half. ⚠ The value is DUPLICATED in
   `app/index.tsx` and `app/drives/index.tsx` — two copies of one number, which is the drift class
   CLAUDE.md's "ONE expression" rule exists to stop. Not fixed here; it is a mobile change, not a
   ledger one.

## ⚠ PLANNING IS NEVER METERED. Only the artifact is. (founder, 2026-07-31)

**Talking to the Skipper costs the rider nothing, even though it costs us money.** A credit is consumed
at `POST /drives` — creating/saving a planned drive — and nowhere else. `POST /drives/plan` (model
tokens) and `POST /drives/propose` (Google Routes) are free to the rider, forever, including
anonymously.

This is a deliberate inversion, not an oversight: **the expensive surface is free and the cheap surface
is charged.** A drive is nearly free to serve (it reuses pre-generated `narrations`; ~$0.08 all-in),
while the conversation that precedes it is where the real per-request spend lives. Do not "fix" this
after reading a cost report — the inversion IS the product decision:

- The persona is the product. A rider who batches their intent into one careful message to conserve
  credits has already lost the thing being sold. Windsurf shipped exactly this meter on a conversational
  agent and **killed it in public** (2026-03-19), naming the harm: users *"scared of asking quick
  questions"*, cramming requests together, *"ultimately degrading the quality of their experience."*
- A credit prices a discrete, ownable artifact the rider actually wants, at the emotional peak of the
  conversation, with no arithmetic in the way. That is the one job credits are good at.
- The conversation is bounded by **capacity, not price** — `apps/api/src/limits.ts` and nothing else.
  That is why those caps are the real cost control and why weakening one is a cost regression rather
  than a UX tweak (INV-11).

⚠ The corollary: **no amount of credit pricing can ever bound planner spend**, because an anonymous
rider never reaches `POST /drives`. Anyone reasoning about "making the planner pay for itself" via
credits is reasoning about the wrong lever.

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
