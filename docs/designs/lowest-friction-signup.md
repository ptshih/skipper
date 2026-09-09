# Lowest-friction signup — what the wall could ask for instead of a password

> **Status:** ✅ **BUILT 2026-08-05** — email OTP is the DEFAULT for signup and sign-in; password
> survives as a hidden sign-in fallback; Settings can set one. Root `bun run check` and `apps/mobile`
> `bun run check` both green. §8 is the spec it was built from and stayed accurate except where marked
> ⚠ CORRECTION (§8.3 — the server has no freshness gate at all, so the re-auth bar is OURS). §0–§7 are
> the investigation that produced the founder call and stay as the record.
>
> **Update 2026-09-09:** TestFlight 1.1.1 (26) includes the password fallback on the code step as well
> as the email step, local input validation, and pending-request form guards. Release verification
> is tracked in [release-batches.md](release-batches.md); App Store 1.1.0 remains unchanged.
>
> ⚠ **STILL OWED — the desk passes cannot prove these two.** (1) A real send/receive of a code through
> Resend, end to end on a device: the mailer is only exercised by the reset flow today, and OTP now
> sits on the FRONT DOOR, so a deliverability problem is a total signup outage. (2) An on-device pass
> of the collapsed sign-in screen and the two deletion confirmations — `bun test` cannot reach either
> (no native modules), and the iOS one-time-code autofill is most of the friction win.
>
> ⚠ **App Store Connect has NOT been re-entered.** The review notes now tell the reviewer to tap "Use
> a password instead"; ASC still serves the old text, and a reviewer who cannot receive a code stalls
> with no way forward. See docs/guides/app-store-submission.md.
>
> ⚠ **§8.1 is the sharp edge and it is now MITIGATED, not gone.** An email-code sign-in **DELETES the
> password** of any account whose address is unverified. The two that existed were backfilled to
> `emailVerified = true` (founder-authorised, verified: at-risk count went 2 → 0), and accounts created
> from here are verified from birth. Do not "clean up" that backfill — it is what keeps App Review's
> password login alive.

---

## §0 — The premise that does not hold: this cannot be measured first

TODO #76 says *"start by finding where they actually drop (PostHog is the demand instrument already in
the repo)."* That instinct is right and the instrument is real — but **the population does not exist.**

- **The funnel is already built and correctly shaped.** `wall_shown` carries a `source` discriminating
  all three walls (`propose`, `create_drive`, `drive_detail`, plus `drive_play`), and
  `signup_completed` fires **only** on `mode === 'up'` — `sign-in.tsx:90`, deliberately `=== 'up'`
  rather than `!== 'in'` so a returning rider's sign-in cannot inflate the wall's conversion rate.
  `wall_shown` → `signup_completed` **is** the number this TODO wants. Nothing needs building.
- **Events do reach PostHog from real builds.** `EXPO_PUBLIC_POSTHOG_KEY` is absent from
  `.env.production` and `.env.development` (a local dev build is inert), but `apps/mobile/eas.json`
  sets it on **all three** profiles — `development`, `preview`, `production` — so TestFlight and
  production builds report.
- ⚠ **But 1.1 is deployed and NOT released to riders.** There is no rider traffic through the wall, so
  the conversion rate is empty-or-noise by construction, no matter what the dashboard shows. Whatever
  TestFlight testers exist are the founder and invited friends — people who would push through any
  wall, which is the population least able to answer a friction question.
- Querying would need a PERSONAL API key (`phx_…`); only the public client key is committed. Project
  `517151`.

⚠ **This is the same collapse already recorded for a different question today** —
[download-before-start.md](download-before-start.md) §Q5 reached the identical structural conclusion
about `stop_skipped{mode:'live'}` on 2026-08-05. Two independent questions have now died on the same
missing population. That is not a coincidence to note in passing; it is an argument that **RISK-1 (drive
it once for real) and the release gate what can be decided by evidence at all.**

**So: this is a pre-release judgement call, not a measurement.** The instrumentation is already correct
and will validate the choice *after* release. Deciding to wait for data is deciding to wait for the
release — which is a legitimate ranking (§6, option E), just not a cheap one.

---

## §1 — What is true today, verified

| Claim | Verified | Where |
|---|---|---|
| Email + password is the **only** way to make an account | ✅ | `apps/api/src/auth.ts` `emailAndPassword.enabled: true` |
| Google / Apple register **only when both creds are set** | ✅ | `auth.ts:124–131` — `socialProviders` is built conditionally |
| Those creds are **absent from prod** | ✅ | `.env.production` holds 13 keys; no `GOOGLE_CLIENT_*`, no `APPLE_CLIENT_*` |
| There is **no email verification** on signup | ✅ | no `requireEmailVerification`; reset is the only recovery |
| Password reset is the **only** route back in | ✅ | `auth.ts:278–287`, and `RESEND_API_KEY` **is** set in prod |
| `webcredentials:skipper.fm` entitlement is already shipped | ✅ | `app.json:18` |
| The AASA already serves it | ✅ | `GET https://skipper.fm/.well-known/apple-app-site-association` → `200`, `{"webcredentials":{"apps":["L24UJYJ5DK.fm.skipper.app"]}}` |
| No native auth deps installed | ✅ | no `expo-apple-authentication`, no `@react-native-google-signin/*` in `apps/mobile/package.json` |

### ⚠ §1a — "Already PLUMBED and merely dark" is HALF TRUE, and the wrong half is Apple

TODO #76 records that Google and Apple are *"already PLUMBED and merely dark — a credentials-and-decision
task first and a build task second."* **For Google that is accurate. For Apple it is not, and the gap is
a time bomb rather than a missing feature.**

Apple's `clientSecret` is not a secret you paste once. It is a **JWT you sign with an ES256 key**, and
Apple rejects any whose `exp` is more than **15,777,000 seconds (six months)** past `iat` — a hard,
Apple-enforced ceiling ([Apple: Creating a client secret](https://developer.apple.com/documentation/accountorganizationaldatasharing/creating-a-client-secret),
[better-auth #1522 "Apple Authentication client secrets will eventually expire"](https://github.com/better-auth/better-auth/issues/1522)).
Generating it needs **four** inputs, not two: `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` (a
`.p8`), and the Services ID.

Consequences, both concrete:

1. **`.env.example` encodes the bomb.** It catalogues `APPLE_CLIENT_ID` + `APPLE_CLIENT_SECRET` as if
   the secret were static. Fill those two in and Sign in with Apple works — **and then silently stops
   working within six months**, on the one path a locked-out rider has no way around. No alarm fires;
   the failure is an `invalid_client` at Apple, months after the deploy, with nobody looking.
2. **`auth.ts`'s current shape cannot express the fix.** `socialProviders` is typed
   `Record<string, { clientId: string; clientSecret: string }>` — a plain object. Better Auth supports
   the regenerating form as an **async factory** (`apple: async () => ({ … })`), which is a different
   shape. Adding Apple therefore *is* a code change to `auth.ts`, plus a `jose` dependency, plus a
   decision about where the `.p8` lives.

⚠ **And native Apple sign-in does not avoid this.** The obvious hope — "the native flow verifies an
ID token, so surely no client secret is needed" — is false in this build. `@better-auth/core`'s Apple
provider **disables itself outright unless both `clientId` and `clientSecret` are present**
(`social-providers/apple.mjs:26`), before any ID-token path is reachable. The bundle id only affects
which `audience` the token is checked against (`apple.mjs:62`:
`options.audience ?? options.appBundleIdentifier ?? options.clientId`). **The secret machinery is
mandatory either way.**

---

## §2 — The App Store 4.8 coupling, from the CURRENT text

Fetched from [developer.apple.com/app-store/review/guidelines](https://developer.apple.com/app-store/review/guidelines/),
not from the TODO's paraphrase. The trigger:

> Apps that use a **third-party or social login service** (such as Facebook Login, Google Sign-In, Log in
> with X, Sign In with LinkedIn, Login with Amazon, or WeChat Login) to set up or authenticate the user's
> primary account **must also offer as an equivalent option another login service** with the following
> features: the login service limits data collection to the user's name and email address; **allows users
> to keep their email address private** as part of setting up their account; and does not collect
> interactions with your app for advertising purposes without consent.

Three things this settles:

1. **Skipper is not triggered today.** The exception list includes *"Your app exclusively uses your
   company's own account setup and sign-in systems"* — email+password is exactly that.
2. **The TODO's warning is CONFIRMED and sharper than stated.** Adding Google obliges an equivalent
   option, and **email/password cannot be that option** — it fails the second bullet outright (a rider
   cannot keep their address private from us when the address *is* the credential). Sign in with Apple
   is the option that satisfies all three. So *"just add Google"* is strictly **larger** than doing
   both, because it drags in every cost in §1a and cannot stand alone.
3. **Apple alone triggers nothing.** SIWA is the canonical equivalent, not a third-party service
   requiring one. Apple-only is a complete, compliant step.

⚠ Also note 5.1.1(v)'s second sentence, which bears directly on §5's ranking: *"Apps may not require
users to enter personal information to function, except when directly relevant to the core functionality
of the app or required by law."*

---

## §3 — What is already de-risked, and it is more than expected

**The anonymous→account link matcher already covers every candidate path.** This was the invariant most
likely to break under a new signup route (INV-4: the anonymous row is hard-deleted at link; a path that
misses the matcher would strand a live anonymous session). It does not break. From the installed
anonymous plugin (`dist/plugins/anonymous/index.mjs:121–122`), the matcher fires on:

```
/sign-in*   /sign-up*   /callback*   /oauth2/callback*   /magic-link/verify
/email-otp/verify-email   /one-tap/callback   /passkey/verify-authentication
/phone-number/verify   /verify-email
```

**Magic link, email OTP, passkeys, Google One Tap and the social callbacks are all named explicitly.**
Native `signIn.social({ idToken })` posts to `/sign-in/social`, caught by `/sign-in*`. So every option in
§4 inherits the correct link-and-delete behaviour with no work.

**The free grant is likewise path-independent.** It hangs off `databaseHooks.user.create.after`
(`auth.ts:361`) — the *universal* user-creation hook, not a per-route hook — gated by
`shouldGrantAtSignup` (skips anonymous) and made exactly-once by the `free:<userId>` idempotency key
under `ON CONFLICT DO NOTHING`. **A new signup path cannot miss or double-fire the grant**, which is
the specific worry TODO #76 raises. It is structurally already answered.

⚠ TODO #76's ask for *"a test on the grant, not just on the sign-in"* still stands — but as a
**regression guard on that hook's universality**, not as per-path plumbing.

---

## §4 — The options, each with its real cost

Ordered by rider friction, cheapest-to-the-rider first.

### A. Passkeys — best friction, worst supply chain
One Face ID prompt; nothing typed; nothing to forget; **kills the lockout problem outright.**
- ✅ **The prerequisite is already shipped** — passkeys need the `webcredentials:` associated domain
  and a matching AASA, and §1 confirms both are live. `rpID` would be `skipper.fm`.
- ⚠ **Server plugin is a separate package** — `@better-auth/passkey`, not in core's plugin set. New dep
  + an auth-schema regeneration (`bunx @better-auth/cli generate` → `db:generate` → `db:migrate`), and
  ⚠ `db:generate` **needs a real TTY** (it prompts on renames).
- ⛔ **The client does not work in Expo.** `@better-auth/passkey/client` calls browser WebAuthn
  (`navigator.credentials`) and throws *"WebAuthn is not supported in this browser"* in React Native —
  [better-auth#2235](https://github.com/better-auth/better-auth/issues/2235). The only bridges are
  **community** Expo modules ([expo-better-auth-passkey](https://github.com/lobehub/expo-better-auth-passkey),
  [expo-passkey](https://github.com/iosazee/expo-passkey)) wrapping `ASAuthorizationController`. That is
  an unvetted third-party native module on the auth path, plus a native rebuild.
- ⚠ **Needs a fallback regardless** — a rider with no passkey on a fresh device still needs a way in.
  Passkeys are never the *only* method, so they are additive, not a replacement.

### B. Sign in with Apple (native) — one tap, iOS-native, and the compliance keystone
`expo-apple-authentication` → `signIn.social({ provider: 'apple', idToken })`. On an iOS-only product
this is the shortest real path: the system sheet, Face ID, done.
- ⚠ Native rebuild + new dep + the `usesAppleSignIn` entitlement.
- ⚠ **All of §1a**: Services ID, `.p8` key, `jose`, the async-factory refactor of `auth.ts`, and a
  **≤6-month secret rotation** that must not be allowed to fail silently.
- ⚠ **Hide My Email is a duplicate-account vector — see §5.**
- ✅ Unblocks Google later with no further 4.8 decision.

### C. Email OTP — no password, no native code, no App Store coupling
`emailOtp()` is **in core** (`better-auth/plugins/email-otp`, confirmed in the installed exports).
Rider types their email, gets a 6-digit code, iOS keyboard autofills it from the message.
- ✅ **Zero native modules, zero OAuth creds, zero 4.8 exposure, no `app.json` change.**
- ✅ **Reuses the mailer already configured in prod** (`RESEND_API_KEY` is set).
- ✅ **Fixes the lockout problem at the root**: it *proves* the address at signup, so the typo'd-email
  account — today permanently unrecoverable, drives and credits included, since the ledger never
  refunds — stops being possible. It also retires the password, and with it the reset flow that is
  currently the single point of failure on re-entry.
- ⚠ Friction is real but small: an app-switch to Mail. Strictly worse than one Face ID tap, strictly
  better than inventing and remembering a password.
- ⚠ Deliverability becomes load-bearing on the *signup* path, not just recovery. A code that lands in
  spam is a rider who cannot sign up at all.

### D. Magic link — same family, worse in-app
`magicLink()` is also in core. But the link opens the **browser**, then needs a deep-link handoff back
into the app. More moving parts than OTP for the same email round-trip. ⛔ **Dominated by C.**

### E. Defer the wall further — cheapest to build, structurally constrained
- ⚠ **This is not a UX knob; INV-4 makes it an architecture change.** Letting an anonymous rider create
  a drive means writing `drives` against a user row Better Auth **hard-deletes at link** — and since
  2026-08-02 the `databaseHooks.user.delete.before` purge *reaches* that path, so the drive would be
  **deleted the moment the rider signs up**. Making it work means the drive lives on the CLIENT and is
  re-POSTed after signup, which is the existing rule ("state that must survive signup lives on the
  client and is re-sent"), applied to a much bigger object.
- ✅ **It costs nothing external.** `POST /drives` → `buildDrive` is deterministic selection over the
  existing corpus; the paid rider calls are `/drives/plan` (tokens) and `/drives/propose` (Routes),
  both already anonymous. The credit is a product scarcity knob, not a cost recovery.
- ⚠ So the honest framing: deferring the wall is **free in dollars, expensive in invariants**, and it
  moves the friction rather than removing it — the rider still has to sign up before they can *drive*
  what they made.

---

## §5 — Two hazards a new path introduces

1. **⚠ Apple's Hide My Email splits accounts.** A rider who signed up as `pete@gmail.com` and later taps
   Sign in with Apple **with Hide My Email** presents `…@privaterelay.appleid.com` — a different address,
   therefore a **new user row, a second `FREE_DRIVE_CAP` grant, and their existing drives invisible.**
   This is the "second place the grant can be double-fired" TODO #76 predicted; it is real, but it
   arrives via *identity*, not via a missed hook (§3). Any Apple rollout owes a decision here.
2. **✅ Auto-linking by verified email works, and is safe.** Verified in
   `dist/api/routes/callback.mjs:94`: linking is blocked only when the provider is untrusted **and** the
   email is unverified. `account.accountLinking.trustedProviders` is unset (→ `[]`), but Google and
   Apple both assert `email_verified`, so a Google sign-in on an address that already has a password
   account **links to the same row** — no duplicate, no second grant. The hazard is (1) only.

---

## §6 — Recommendation

**Ship C (email OTP) first; hold B (Sign in with Apple) as the deliberate second step; do not start
with Google under any framing.**

The reasoning, in order of weight:

1. **C is the only option that removes a real defect rather than shaving seconds.** Today a typo'd email
   at signup is an unrecoverable account — drives *and* credits gone, permanently, because the ledger
   never refunds and reset mail goes to an address the rider never owned. OTP proves the address at the
   moment of signup. Every other option leaves that hole open. *"Optimize for charm, not scale"* cuts
   toward the option that stops a rider losing their drives.
2. **C is the only option with no native rebuild, no App Store coupling, and no rotating secret.** It is
   a server plugin plus a screen, on infrastructure (Resend) already live in prod.
3. **B is the better *friction* answer and should still happen** — one Face ID tap beats an app-switch
   to Mail on an iOS-only product. It is second because it costs a native rebuild, a `.p8`, an `auth.ts`
   refactor, a §5.1 identity decision, and a six-month rotation obligation that must be alarmed. That is
   a real week, and it should be spent knowingly rather than as "turn on the dark config."
4. **A (passkeys) is the right destination and the wrong next step** — the prerequisite is already
   shipped, which is genuinely encouraging, but an unvetted community native module on the auth path is
   not a trade to make before the product has riders. Revisit when a first-party Expo client exists.
5. **E (defer the wall) is not free** and moves friction rather than removing it. Rank it only if the
   answer to §0 is "wait for data" — because then it is the *only* option that also increases the
   population the data would come from.

⚠ **Whatever lands, the guard TODO #76 asks for is a test that `databaseHooks.user.create.after` grants
on the new path** — i.e. that the hook's universality (§3) is a fact, not a coincidence.

## §7 — The one question that is actually the founder's — ✅ ANSWERED, see §8

Everything above is verifiable. This is not:

**Is the goal to reduce friction, or to stop losing riders to lockout?** They point at different first
steps. If friction, B (Apple) is the honest answer and its costs should be paid deliberately. If
robustness, C (OTP) is, and it is far cheaper. The recommendation picks C because the lockout is a
present defect and the friction is a hypothesis that §0 shows cannot be tested yet — but that is a
judgement about which risk is worse, and it is the founder's to make.

**Answered 2026-08-05: robustness, and go further than C — make OTP the DEFAULT for sign-in too.**

⚠ **Independent of the answer, one thing should be fixed now:** `.env.example`'s
`APPLE_CLIENT_SECRET=...` line invites a future agent to paste a static secret that expires inside six
months. It should say so, or the Apple entries should come out until §1a's machinery exists.

---

## §8 — THE BUILD (founder call 2026-08-05)

**Email OTP is the default and only VISIBLE way to sign up or sign in. Password sign-in survives behind
a secondary "Use a password instead" affordance. Password SIGNUP is removed outright — no new account
can ever hold one.**

Rejected alongside it, with reasons, so neither is re-proposed:
- **Removing password entirely** — ⛔ App Review cannot receive an email code. The reviewer signs in as
  `review@skipper.fm` with a password stored in ASC. The alternative is a fixed test code or a
  special-cased reviewer address, i.e. **a deliberate bypass on the auth path**, which is a worse risk
  than keeping one quiet legacy route.
- **Keeping password fully visible as a peer** — it does not reduce friction (the wall still shows a
  password field), keeps the lockout, and does not even avoid §8.1's trap.

### ⚠ §8.1 — THE TRAP: an email-code sign-in DELETES the rider's password

`revokeUnprovenAccountAccess` (`better-auth/dist/db/revoke-unproven-account-access.mjs`), called from
the OTP sign-in route (`plugins/email-otp/routes.mjs:425`) **and** from magic-link — so this is a
property of the whole email-proof family, not of OTP:

```js
if (!user || user.emailVerified) return;                       // verified → untouched
for (const account of accounts)
  if (account.providerId === "credential") await deleteAccount(account.id);   // ⚠ the PASSWORD row
await deleteUserSessions(userId);                              // ⚠ and every session
```

It is a correct anti-squatting measure (you claimed an address with a password; the real owner proves
ownership; your credential dies). But **Skipper has no email verification, so EVERY existing account is
`emailVerified: false`** — meaning the naive build ships a fallback that destroys itself on first use of
the default path, silently, with the rider left tapping a password that no longer exists.

**Blast radius, measured against the live DB 2026-08-05** (read-only, `.scratch/otp-blast-radius.ts`):

```
user rows: verified=false anon=false → 2      verified=false anon=true → 4
credential (password) account rows: 2
AT RISK (password + unverified):    2
```

**Two accounts, both ours** (founder + `review@skipper.fm`). There is no migration problem and there
never will be a cheaper moment. ⚠ **Mitigation is mandatory and one statement:** set
`emailVerified = true` on those rows before shipping. They are known-real addresses; marking them proven
is honest, and it is what keeps the App Review password alive through §8.1.

### §8.2 — Server (`apps/api/src/auth.ts`)

1. Add `emailOTP({ … })` to `plugins`. ✅ **No migration** — the plugin ships no `schema` export and
   stores codes in the existing `verification` table. (Confirmed: `dist/plugins/email-otp/` has no
   `schema.mjs`.) This dodges the `db:generate`-needs-a-TTY blocker entirely.
2. `sendVerificationOTP` routes through the existing `./email` Resend sender — already live in prod.
3. Keep `emailAndPassword.enabled: true` (the hidden fallback + App Review). **Keep `sendResetPassword`
   too** — a password that exists still needs a reset, and it is now the fallback's only recovery.
4. ⚠ **Defaults are already sane, do not loosen them:** 6 digits, `expiresIn: 300` (5 min), and the
   plugin registers its OWN rate limit of **3/60 s per endpoint** — tighter than `auth.ts`'s 100/60 s
   baseline. Leave `rateLimit` unset so the plugin's own numbers apply.
5. ⚠ **This is a new RIDER-TRIGGERED send on an anonymous-reachable route.** It is not a model or Routes
   call, but every request costs a Resend email and can be pointed at a stranger's inbox. The 3/60 s
   ceiling is the only guard, and — like `auth.ts`'s other limits — it is better-auth's default
   IN-MEMORY store, so it is **per container, not a global bound**. Same M4 shared-store upgrade as the
   rest.

✅ **Already correct, do not re-plumb** (§3): the anonymous link matcher names `/sign-in*` and
`/email-otp/verify-email` explicitly, so INV-4 holds; `signIn.emailOtp` creates the user through
`internalAdapter.createUser`, so `databaseHooks.user.create.after` fires and the `FREE_DRIVE_CAP` grant
lands exactly once; and it sets `emailVerified: true` on creation, so a code-created account is proven
from birth and never subject to §8.1.

✅ **Enumeration-safe by construction:** with signup enabled, the send route dispatches a code whether or
not the address exists (`routes.mjs:100`), matching the reset flow's existing posture.

### §8.3 — ⚠ Account deletion MUST be reworked in the SAME change (App Store 5.1.1(v))

`apps/mobile/app/settings.tsx` calls `deleteUser({ password })` with the button `disabled={!password}`.
**A code-created account has no password, so it could never delete itself — a guaranteed rejection on
the one guideline CLAUDE.md flags as non-negotiable.**

The server already allows the fix: `password` is **optional** on `/delete-user`, and is verified only
when it is actually sent (`api/routes/update-user.mjs:220,268`). So:

- Ask for the password when the account HAS one (which is what keeps App Review's flow working), and
  for a freshly emailed code when it doesn't. Which one is resolved at tap time from
  `listAccounts()` — `providerId === 'credential'` is the only real answer to "does this account have
  a password"; nothing on the session carries it.
- ⚠ This is arguably a BETTER confirmation than a password — it proves control of the address at the
  moment of erasure rather than knowledge of a string.

⚠ **CORRECTION, found while building (2026-08-05).** The OpenAPI text on that field says the password
is *"required if session is not fresh"* — **the code does not do that.** `/delete-user` sits on
`sensitiveSessionMiddleware`, which resolves an AUTHORITATIVE session but performs **no freshness
check**; the middleware that checks `freshAge` is `freshSessionMiddleware`, a different one, declared
a few lines away in `api/routes/session.mjs`. So the server would accept a bare `deleteUser({})` from
any live session, and there is **no inherited re-auth bar at all**.

That inverts the reasoning without changing the plan: the emailed-code step is not us satisfying a
server requirement, it is us **keeping a bar the server never enforced**. Settings' own comment called
re-auth *"the right bar for an irreversible erasure regardless of session age"* — that judgement did
not change just because the password did. ⚠ Anyone later "simplifying" the code step because the API
accepts the call without it would be lowering the bar on the most destructive action in the product.
`test/auth-otp.test.ts` pins both halves (optional-password AND the absent freshness gate).
- ⚠ `docs/guides/app-store-submission.md` scripts the reviewer through *"type the account password"*.
  That guide and the ASC review notes must be updated in the same pass, or the reviewer follows steps
  that no longer match the app.

### §8.4 — Client (`apps/mobile/app/sign-in.tsx`)

The screen collapses. Today's `'in' | 'up' | 'reset'` machine becomes: **email → code → done**, because
`signIn.emailOtp` signs in an existing rider and creates a new one through the *same* call. "Sign in"
and "Create account" stop being different screens. `'reset'` survives only under the password fallback.

⚠ **The analytics signal breaks and must be rebuilt in the same commit.** `signup_completed` fires on
the client's `mode === 'up'` (`sign-in.tsx:90`) — which will no longer exist. **Both OTP branches return
a byte-identical `{ token, user }`; there is no `isNewUser` flag** (`routes.mjs:407–434`). `createdAt` is
a core field and survives `parseUserOutput`, so a recency check on the returned user recovers the
signal — but it is a heuristic and must be written down as one. ⚠ This matters more than it looks:
**§0 says this change can only ever be validated after release, and this event is the instrument that
would do it.** Breaking it silently would leave the decision permanently unmeasurable.

### §8.5 — Owed tests

- The `FREE_DRIVE_CAP` grant fires exactly once on the OTP path (TODO #76's explicit ask) — a
  regression guard on `user.create.after` being UNIVERSAL, not per-route.
- An account with no password can complete deletion (guards §8.3 against a silent 5.1.1(v) regression).
- ⚠ A guard on §8.1: a verified account keeps its `credential` row across an OTP sign-in. This is the
  one that protects App Review's login, and nothing else would catch its loss.

### §8.6 — "Set a password" in Settings (founder ask, 2026-08-05)

A rider who signed up with a code has no password. Settings should let them opt into one. This is
consistent with §8, not a walk-back of it: **no signup path mints a password; a signed-in rider may
choose one.**

✅ **It is SAFE by construction, and the reason is worth knowing.** §8.1's trap only fires on accounts
with `emailVerified: false`. Every OTP-created account is verified **from birth**
(`routes.mjs:410` sets `emailVerified: true` at creation), so a password set this way is **never** at
risk of being silently deleted by a later code sign-in. The trap is a legacy-account problem only, and
§8.1's backfill closes it permanently.

⚠ **The endpoint is NOT client-reachable.** `setPassword` is declared
`createAuthEndpoint.serverOnly` (`api/routes/update-user.mjs:184`) — deliberately, since it sets a
credential without knowing the old one. `authClient` cannot call it. So this needs a **small custom
route in `apps/api`** behind `requireAccount`, calling `auth.api.setPassword({ body, headers })`
server-side. ⚠ That is a new route on the auth surface: it must be per-ROUTE gated like every other
owner route (never on a `.use('*')` mount) and must reject an anonymous session.

⚠ **It requires a FRESH session** — `setPassword` carries `sensitiveSessionMiddleware`, the same guard
`/delete-user` uses. **So §8.3 and this share one primitive:** a re-authenticate step (send a code →
verify → session is fresh again). Build it once; both call it. Skipping that means the button works
right after sign-in and mysteriously 401s a day later.

⚠ Semantics to get right: the endpoint **throws `PASSWORD_ALREADY_SET`** if a credential row already
exists (`update-user.mjs:213`) — it is *set*, not *change*. An account that already has one must be
routed to `changePassword` (which demands the current password) instead, so Settings needs to know which
state it is in. `session.user` does not carry that; it needs deriving.

**Why it earns its place beyond preference:** it is a hedge against the one new single point of failure
§8 introduces. With OTP as the default, **email deliverability becomes load-bearing on sign-IN, not just
recovery** — a rider whose code lands in spam has no way in at all. A password they set deliberately is
the way back that does not depend on mail arriving. ⚠ Owed test: setting a password does not disturb the
`credential`-row invariant §8.5 guards, and the route 401s an anonymous session.
