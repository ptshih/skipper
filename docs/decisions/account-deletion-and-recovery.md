# Account deletion + password recovery — the two App Store gates on identity

> **Status:** DECIDED + BUILT 2026-07-15. In-app account deletion (App Store Guideline 5.1.1(v)) and
> password reset now exist; both were absent, and either one alone would have blocked or broken a
> public launch. Deletion is **immediate and total** (founder call): Better Auth's `deleteUser` with
> `beforeDelete` → `purgeUserData` (`apps/api/src/account.ts`) hard-deleting the rider's `drives` +
> `credit_entries`; UI at Settings → Delete account. Reset mails a one-time link via Resend
> (`apps/api/src/email.ts`) that resolves on the WEB (`apps/site/src/pages/reset-password.astro`).
> **⚠ Reset is INERT until `RESEND_API_KEY` is set and the `EMAIL_FROM` domain is verified with
> Resend** — the API boots and warns. Verified E2E against the live DB: grant materialized → deleted →
> `credit_entries` 1→0 → re-sign-in 401.

## Why deletion had to exist

Guideline 5.1.1(v) requires any app that lets you *create* an account to let you *delete* it from
inside the app. `sign-in.tsx` offers sign-up, so this was a **certain rejection**, not a risk.

The interesting half isn't the button — it's what "delete" means here. Better Auth erases what it
owns (the `user` row; `session`/`account` follow via their `ON DELETE CASCADE` in
`@skipper/db/auth-schema`). But `drives.user_id` and `credit_entries.user_id` are **soft refs** —
auth runs on its own `neon-serverless` pool, so no DB-level FK spans the two and **there is no
cascade to ride**. Deleting the auth user alone would have silently orphaned every drive and ledger
row a rider ever had: personal data, retained forever, with no session left that could ever reach it.
The guideline's whole point, inverted. So the purge is explicit.

**`beforeDelete`, not `afterDelete`** — the order is load-bearing. Purge-then-delete converges: if the
user delete fails after the purge, the rider still holds a session and can retry, and the re-run finds
nothing left to remove. Delete-then-purge does not: a throw in `afterDelete` strands orphaned rows
behind a user row that no longer exists.

## The accepted cost: re-signup mints a fresh grant

`freeGrantKey` is `free:<userId>`, so a deleted-then-recreated account is a *new* user id and gets a
*new* free allotment. That is a spend-farming vector, taken knowingly. The alternative — retaining a
one-way hash of the email to recognize a returning rider — means keeping a derived identifier about
someone who just asked to be forgotten, and then disclosing that retention in the privacy policy.
Erasure wins. `FREE_DRIVE_CAP` is the blast radius, which is the other half of this change: it was
**unset in prod and defaulting to 100**; it is now explicitly **10** in both env files. (⚠ Env is read
at boot — a running server keeps the old value until it restarts/redeploys.)

## Why reset resolves on the web, not in the app

A reset link arrives in a mail client. Mail links can't be relied on to hand off into a specific
native app — and more fundamentally, a reset that only works on the device still holding a session
isn't a reset at all. So `requestPasswordReset` passes `redirectTo: https://skipper.fm/reset-password`
and the journey finishes in any browser, on any device.

This forced one server change worth remembering: `trustedOrigins` was `['skipper://']` only, so Better
Auth rejected the reset outright with `INVALID_REDIRECT_URL`. The site origin is now allowlisted
(`SITE_ORIGIN`, default `https://skipper.fm`). It stays an exact-origin allowlist — it is an
open-redirect guard, never a wildcard.

## Why reset had to exist at all

Email/password is the **only** way into an account in production: `socialProviders` registers a
provider only when both its creds are present, and `GOOGLE_CLIENT_ID`/`APPLE_CLIENT_ID` are unset.
There is no email verification. So before this, a forgotten password or a typo'd address was
**permanent** account loss — taking the rider's drives and their credits with them, and the ledger
never refunds. Not a rejection risk; just a guaranteed support burden with no support channel.

Resend over raw `fetch`, no SDK — the same call shape the studio's TTS makes to Google. One HTTP POST
doesn't earn a dependency.

## Gotchas for the next agent

- **`Origin` is mandatory** on Better Auth's sensitive POSTs (`delete-user` → 403
  `MISSING_OR_NULL_ORIGIN` without it). The app is fine: `@better-auth/expo`'s client sends an
  `expo-origin` header and the server-side `expo()` plugin promotes it to `origin`. Any NON-Expo
  caller (a script, a curl repro) must send `Origin: skipper://` or it will look broken when it isn't.
- **Delete needs the password** unless the session is fresh (`sensitiveSessionMiddleware`). The UI
  always asks — re-auth is the right bar for an irreversible erasure regardless of session age.
- Deletion does **not** touch R2. Audio is shared narration clips referenced by a drive, never
  per-user bytes.

## See also

- [credit-ledger.md](credit-ledger.md) — why delete never refunds.
- [cut-tiers.md](cut-tiers.md) — why there's no plan flag to clean up.
