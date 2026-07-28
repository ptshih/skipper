# Drive credits: a user-owned ledger (not a count of `drives`)

**Status:** ✅ **BUILT 2026-06-19** (the free-tier slice), **amended 2026-07-28** — the free allotment
is now granted at SIGNUP rather than lazily on first touch (see the Free allotment bullet below; the
lazy path stays as the backstop). The `credit_entries` ledger + the free
allotment grant + per-drive consume are live (migration `0016`); POST/GET `/drives` run off the
ledger. The PURCHASE plumbing (Apple IAP / Google Play grant + refund clawback) is **DEFERRED** —
the schema is provider-agnostic and ready for it. Supersedes the implicit "credits = `COUNT(drives)`"
model (and retires the soft-delete tombstone's credit rationale; see the `drives.deleted_at` note).

## Context — the old model was an anti-pattern

Credits were never an entity: a free user's "credits used" was a `COUNT(*)` of their `drives` rows
**including soft-deleted tombstones** (a delete kept the row so it kept counting, so a delete didn't
refund). Research into Stripe + ledger best practice (Modern Treasury, Square's "Books", Finlego)
flagged this as a textbook anti-pattern: no audit trail (can't answer "why 7 left?", can't tell a free
grant from a purchased pack), no idempotency (a retried insert silently double-charges), no
grant/refund semantics (a purchased pack has no row to count), and tight coupling to a content table
(any change to drive lifecycle corrupts the "balance" — which is exactly why tombstones had to be kept).

## Decision

Credits are a **user-owned, append-only ledger** (`credit_entries`). A user's balance is `SUM(amount)`
over their entries — never a stored mutable counter, never a count of another table.

- **Entries are immutable**; corrections/refunds are new compensating entries (`reverse`), never an
  UPDATE/DELETE. Kinds: `grant` (+), `consume` (−1 per drive), `reverse` (± clawback / reinstatement).
- **Idempotency** via a unique `idempotency_key` per movement (`free:<userId>`, `drive:<driveId>`, and
  for future purchases `<provider>:<txnId>`), so retries never double-grant or double-charge.
- **Atomic consume**: `POST /drives` co-commits the `−1` consume with the drive insert in one
  `db.batch` (neon-http co-commit), keyed on the drive id → a drive charges exactly one credit.
- **Free allotment** = a single `grant(+FREE_DRIVE_CAP)` (`ensureFreeGrant`, idempotent on
  `free:<userId>`), written **at signup** from `databaseHooks.user.create.after` — amended 2026-07-28.
  It was originally lazy-on-first-touch to avoid coupling to the Better Auth user-creation lifecycle;
  the cost of that decoupling was that a brand-new account read **0 credits** in the DB and in admin,
  which is indistinguishable from a broken account (it was misread exactly that way while recovering
  the App Review demo login). The lazy calls on the read/spend paths REMAIN as the backstop, so this is
  additive: same idempotency key on both paths, no double-grant possible, and no signup route can
  produce a credit-less account. ⚠ Anonymous users are skipped — the anonymous plugin deletes its
  `user` row on link-to-account, and `credit_entries.user_id` has no FK/cascade, so granting there
  would strand the row.
- **Single pool**: free + (future) purchased credits share one balance. `user.tier='paid'` (comped)
  bypasses the gate entirely; the ledger governs free accounts.
- **Lifetime / no-refund-on-delete** is now an explicit policy (delete emits no `reverse`), not a
  side-effect of counting rows. The `drives` soft-delete tombstone survives only as "remove from list".

## Why not Stripe's credit primitives directly

Stripe is the **wrong rail, right pattern**. Stripe Billing Credit Grants only burn down against a
**metered Stripe *subscription* invoice at finalization**, are denominated in **money** (not "N
drives"), and apply **asynchronously** (no synchronous spend/allow-deny). Our rail is **Apple IAP /
Google Play**, not Stripe — Stripe never sees the money. What we copied is Stripe's *internal shape*:
an immutable balance-transaction ledger (`credits_granted`/`credits_applied`/…), a derived
available-vs-ledger balance, grant/expire/void operations, and idempotency-keyed mutations.

## Provider-agnostic by design (Apple IAP + Google Play) — DEFERRED plumbing

The credit pack is a **consumable** on both stores. When built, a verified purchase writes a `grant`;
a platform refund writes a `reverse`. Provider mapping (grounded in current docs):

| Concept | Apple IAP | Google Play | Ledger |
|---|---|---|---|
| Idempotency key (grant once) | `transactionId` | `purchaseToken` (NEVER `orderId` — absent for promo codes) | `idempotency_key` = `<source>:<txnId>` |
| Verify before granting | App Store Server API + JWS (`SignedDataVerifier`) | `purchases.products.get` (ProductPurchase) | per-provider verify seam |
| User link (set at purchase) | `appAccountToken` (UUID) | `obfuscatedExternalAccountId` | — (we know the buyer from the session) |
| Refund/void signal | ASSN V2 `REFUND` | RTDN `VoidedPurchaseNotification` / Voided Purchases API | → emit `reverse` |
| Refund-preference handshake | `CONSUMPTION_REQUEST` → Send Consumption Info (`consumptionStatus`) | **none** (Google decides, notify-only) | Apple-only branch |

Google-only gotchas to accommodate: mandatory server-side **consume** + **3-day acknowledge** (miss it
→ auto-refund); RTDN needs Cloud Pub/Sub. **Refund stance:** user-initiated delete never refunds (our
policy), but a platform-initiated refund (Apple/Google) MUST be able to claw back — Apple/Google make
the final call (we can only *prefer* decline via Apple's consumption info), so the ledger is built so a
`reverse` can decrement. The `balance` is clamped ≥0 for display.

## Schema (migration `0016`)

`credit_entries`: `id`, `user_id` (text soft-ref to the auth user, like `drives.user_id`), `amount`
(signed int), `kind` (`credit_entry_kind`: grant|consume|reverse), `source` (`credit_source`, nullable:
`free_tier` live; `apple_iap`/`google_play`/`admin_grant` reserved), `reason`, `idempotency_key` (UNIQUE),
`expires_at` (reserved for promo FIFO; ignored by the balance calc — lifetime-only in v2), `created_at`;
indexed on `user_id`. The internal API lives in `apps/api/src/credits.ts`.

## Deferred

Purchase verification + grant (Apple/Google), refund/clawback webhooks (ASSN V2 + RTDN), credit-pack
products, promo credits with expiry (FIFO/expiring-first consumption), and a cached balance column
(unneeded at current scale — `SUM(entries)` per user is fine). A `purchases` table (UNIQUE on
`(provider, provider_txn_id)`) writing ledger grants is the planned shape.
