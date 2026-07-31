# Account deletion + password recovery — the two App Store gates on identity

> **Status:** DECIDED + BUILT 2026-07-15. In-app account deletion (App Store Guideline 5.1.1(v)) and
> password reset now exist; both were absent, and either one alone would have blocked or broken a
> public launch. Deletion is **immediate and total** (founder call): Better Auth's `deleteUser` with
> `beforeDelete` → `purgeUserData` (`apps/api/src/account.ts`) hard-deleting the rider's `drives` +
> `credit_entries`; UI at Settings → Delete account. Reset mails a one-time link via Resend
> (`apps/api/src/email.ts`) that resolves on the WEB (`apps/site/src/pages/reset-password.astro`).
> **Both are LIVE and proven E2E (2026-07-15).** Deletion: grant materialized → deleted →
> `credit_entries` 1→0 → re-sign-in 401, against the real DB. Reset: `notifications.skipper.fm` is
> Resend-verified with DKIM+SPF published, and a real reset mail to the founder's account came back
> `last_event=delivered`. ⚠ The API reads env at BOOT — a running server keeps the old
> `RESEND_API_KEY`/`FREE_DRIVE_CAP` until it restarts, and **prod still needs a deploy**: the live API
> predates these routes, so `delete-user` does not exist in production yet.

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
Erasure wins. `FREE_DRIVE_CAP` was described here as the blast radius, and was set explicitly in both
env files for that reason. ⚠ **Superseded 2026-07-31** (see [free-allotment-through-1-1.md](free-allotment-through-1-1.md)):
the cap was raised for 1.1, and the blast-radius framing was never quite right. A grant is only a ledger
row — it costs nothing until spent, and spending means creating drives, which the per-IP create limiter
bounds regardless of how many credits an account holds. The cap bounds a farmed account's **lifetime**
total, never its **rate**. (⚠ Env is still read at boot — a running server keeps the old value until it
restarts/redeploys.)

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

## The mail account: SHARED with Manoa Health (founder call 2026-07-15)

Skipper sends through the **Manoa Health Resend account** rather than its own. Consequences a future
agent must know: one key rotates for BOTH products, and Skipper's bounce/spam reputation lands in the
same account as a health product's mail. That coupling is the reason sending is scoped to a
**subdomain** rather than the apex.

`notifications.skipper.fm`, specifically:
- **A subdomain at all** — Resend's own guidance ("send from one or more subdomains … to isolate your
  sending reputation"). Doubly true on a shared account, and `skipper.fm`'s apex already serves
  Firebase Hosting.
- **Not `mail.`** — that's the conventional webmail/MX label; it would collide with a future Workspace
  on `skipper.fm`.
- **Not `send.`** — Resend puts its own SPF records at `send.<registered-domain>` (verified against the
  live `notifications.manoa.health` records: SPF MX+TXT at `send.notifications`, DKIM at
  `resend._domainkey.notifications`). Registering `send.skipper.fm` would yield `send.send.skipper.fm`.
- The name itself carries no deliverability weight — no provider prescribes one. What matters is that
  it's dedicated to sending, isn't already in use, and doesn't look machine-generated. It also mirrors
  the `notifications.manoa.health` convention, so both are managed the same way.

**RESOLVED 2026-07-15:** `notifications.skipper.fm` is verified and sending (a real reset mail came
back `delivered`). Getting there hit the plan's 1-domain limit — Skipper's domain now holds the slot
that `notifications.manoa.health` used to, so **Manoa Health can no longer send from this account**
(its code hardcodes `hello@notifications.manoa.health` for sign-in OTPs). Founder is aware and called
it acceptable; noted here because a future agent will otherwise rediscover it as an incident.

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
