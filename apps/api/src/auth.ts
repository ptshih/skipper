// Better Auth instance — the freemium auth foundation (M2).
//
// Access: anonymous (no/guest session) -> free (a signed-in account). There is no paid tier —
// premium is bought as CREDITS, not a plan (docs/decisions/cut-tiers.md).
// The front door (plan / propose / sample) is open/anonymous; drives are user-owned. Auth layers
// around both. Email/password is enabled now; Google/Apple are registered only when their creds
// are present (placeholders otherwise) so the server boots without them. The anonymous plugin
// gives guests a session that links to a real account on sign-up.
//
// Secret comes from env (BETTER_AUTH_SECRET); the base URL is derived per-request from the
// validated Host header (there is no BETTER_AUTH_URL) — see the `baseURL` config below.
//
// ⚠ THE INSTANCE IS LAZY + MEMOIZED (1.1 step 8 pre-work). This module used to throw at IMPORT time
// without a secret, which meant importing ./entitlements — and therefore ./drives — required env.
// That made a request-level test of the /drives access boundary impossible, and that test is now
// INV-15's control (the hazard is intra-8a: the split moves requireAccount off the `/drives*` mount
// onto five individual owner routes, and a route that loses its gate WRITES — GET / grants, POST /
// spends — against an anonymous user id better-auth hard-deletes with no cascade; deploy ordering
// cannot detect that, a test can). So boot-time fail-fast moved OUT of module scope into
// `assertAuthEnv()`, which ./index calls eagerly. `createAuth()` still asserts the secret itself, so
// an entrypoint that forgets the call fails with the remediation rather than silently running on
// better-auth's publicly-known DEFAULT_SECRET.
//
// ⚠ Two consequences worth knowing before you touch this: (1) the proxy has only a `get` trap, so
// `{...auth}` / `Object.keys(auth)` / `'x' in auth` see an empty object — no current caller does any
// of those; (2) if `bunx @better-auth/cli generate` ever chokes on the proxied export, do NOT add
// traps to the shared `createLazyProxy` (@skipper/db owns it) — point the CLI at a scratch file that
// calls `createAuth()` directly. Regeneration only happens when the plugin list changes.

import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin, anonymous } from 'better-auth/plugins'
import { expo } from '@better-auth/expo'
import { createLazyProxy } from '@skipper/db'
import * as authSchema from '@skipper/db/auth-schema'
import { purgeUserData } from './account'
import { authDb } from './auth-db'
import { ensureFreeGrant, shouldGrantAtSignup } from './credits'
import { emailConfigured, sendPasswordResetEmail } from './email'

// The mobile app's deep-link scheme — must match apps/mobile app.json `scheme`
// and the expoClient `scheme`. OAuth callbacks + cross-origin auth use it.
const MOBILE_SCHEME = 'skipper'

// The marketing site's origin (Astro on Firebase Hosting) — a DIFFERENT host from this API-only
// service. It hosts the one auth surface that can't live in the app: the password-reset form. Env
// override so a local site build (`bun run dev:site`) can be pointed at without editing code.
//
// Exported because that page is also this API's ONLY browser client, so the same origin has to be
// trusted TWICE, in two unrelated mechanisms: here for Better Auth's redirect allowlist, and in
// ./index for the CORS policy on the reset POST. Keeping one const means a local override (or a
// domain change) can't satisfy one and silently miss the other — which is exactly how the reset
// form ended up rendering fine and failing on submit.
export const SITE_ORIGIN = process.env.SITE_ORIGIN ?? 'https://skipper.fm'

// ONE message, shared by the eager boot assert and the lazy build, so a forgotten `assertAuthEnv()`
// still fails with the remediation instead of better-auth's default-secret silence.
const MISSING_SECRET =
  'BETTER_AUTH_SECRET is not set. Generate one and store it (dev + prod):\n' +
  '  dotenvx set BETTER_AUTH_SECRET "$(openssl rand -base64 32)" -f .env.development\n' +
  '  dotenvx set BETTER_AUTH_SECRET "$(openssl rand -base64 32)" -f .env.production'

// Fail rather than let Better Auth silently fall back to its publicly-known DEFAULT secret (it only
// throws on its own when NODE_ENV=production, and `validateSecret` returns early under test). Every
// auth crypto path keys off this — cookie signatures, OAuth state, verification/reset tokens — so a
// missing secret must stop the process, not run on a known value.
//
// ⚠ RETURNS the secret rather than being a bare assert, so the config below narrows to `string`
// without a non-null `!`: the throw IS the narrowing.
function authSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) throw new Error(MISSING_SECRET)
  return secret
}

/**
 * BOOT-TIME env gate. Called once at the top of ./index, BEFORE the first request.
 *
 * ⚠ THIS IS WHERE FAIL-FAST LIVES NOW, and it is load-bearing. `auth` below is a lazy proxy, so
 * nothing here runs at import; this call is the only thing that still stops boot on a missing
 * secret. An entrypoint that forgets it boots CLEAN and then degrades silently: `withSession` builds
 * auth inside the thunk handed to `resolveSessionSafely` (./entitlements, ./session), which retries
 * the throw and FAILS OPEN to null — so every owner route 401s for real accounts too, riders read it
 * as "I've been logged out", and each request eats the retry backoff. Secure, but invisible. Any new
 * entrypoint that mounts these routes owes this same call.
 *
 * Checks the secret (throw) and the mailer (warn). Deliberately NOT DATABASE_URL — GET /health is
 * env-free by design and both DB clients are lazy to keep it that way — and deliberately not
 * ANTHROPIC_API_KEY: ./planner records that auth is the one hard throw-at-load this app tolerates,
 * and a keyless deploy degrades to an in-persona apology on the first planner turn, not a crash.
 */
export function assertAuthEnv(): void {
  authSecret()

  // A missing mailer is NOT fatal — dev and every read-only surface boot fine without it, and failing
  // boot over it would take the anonymous front door down with it. But it silently disables the only
  // unlock for a locked-out account, and Better Auth answers reset requests identically either way
  // (enumeration-safe), so the rider is told "check your email" for mail that never sends. Say it
  // once, loudly, AT BOOT — the alternative is learning it from a stranded user with no support
  // channel. ⚠ That is exactly why it lives here and not in `createAuth()`: inside the factory it
  // would fire on whichever request happened to touch auth first, interleaved into request logs
  // hours after the deploy, which is a warning nobody sees.
  if (!emailConfigured()) {
    console.warn(
      '[api] RESEND_API_KEY is not set — password RESET WILL FAIL. Set it, and verify the EMAIL_FROM ' +
        'domain with Resend, before opening public signup.',
    )
  }
}

/**
 * ⚠ NO EXPLICIT RETURN TYPE, deliberately. `auth.$Infer.Session` (./entitlements) is inferred from
 * THIS options object — the admin plugin contributes `role`, the anonymous plugin `isAnonymous`.
 * Annotating this `: ReturnType<typeof betterAuth>` erases both and every tier check silently
 * becomes `any`.
 *
 * ⚠ Asserts the SECRET (via `secret: authSecret()`) but does not call `assertAuthEnv()` — see the
 * mailer warning above for why the two halves are split.
 */
function createAuth() {
  // Register a social provider only if both its env creds are set. Read here rather than at module
  // scope: under dotenvx the env is fully populated before the process starts, so there is no
  // read-timing difference — it just stops importing this module from touching env at all.
  const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {}
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, APPLE_CLIENT_ID, APPLE_CLIENT_SECRET } = process.env
  if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
    socialProviders.google = { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET }
  }
  if (APPLE_CLIENT_ID && APPLE_CLIENT_SECRET) {
    socialProviders.apple = { clientId: APPLE_CLIENT_ID, clientSecret: APPLE_CLIENT_SECRET }
  }

  return betterAuth({
    secret: authSecret(),
    // Base URL Better Auth uses to build callback / redirect / password-reset links
    // (it appends its own /api/auth basePath — do NOT put a path here). Resolved
    // PER-REQUEST from the validated Host header, so dev, the prod service, AND
    // ephemeral Cloud Run revision/preview URLs all work with NO env var to manage (no
    // BETTER_AUTH_URL). `allowedHosts` is the security allowlist that blocks
    // Host-header injection of reset/OAuth links and seeds `trustedOrigins`;
    // `fallback` covers any non-matching host and serves as the init-time base URL
    // (so there's no "Base URL could not be determined" startup warning).
    // Custom domain: api.skipper.fm — this service is API-ONLY. The apex skipper.fm is a
    // SEPARATE landing site (Astro on Firebase Hosting), mapped
    // via a Cloud Run domain mapping (us-east4, Google-managed cert); a subdomain maps with a
    // CNAME to ghs.googlehosted.com, held DNS-only (grey cloud) in Cloudflare so Google can
    // provision the cert. The run.app host stays listed for direct access during cutover.
    // NOTE: social OAuth (Google/Apple) needs EXACT pre-registered redirect URIs — use api.skipper.fm.
    baseURL: {
      allowedHosts: [
        // Local dev. BOTH entries are needed: `matchesHostPattern` compares the Host header
        // verbatim and does NOT strip the port, so bare 'localhost' alone never matches the
        // real dev header (`localhost:8787`) — the request silently fell through to `fallback`
        // and generated PRODUCTION links from a local server. Harmless-looking, and made worse
        // by dev and prod sharing one Neon DB: a locally-triggered reset link resolved against
        // prod instead of failing loudly. A port wildcard is not a spoofing risk — it widens
        // the allowlist only to loopback, which an outside attacker can't point anywhere useful.
        'localhost',
        'localhost:*',
        'api.skipper.fm', // custom domain — the API host
        'skipper-api-csslmysz7q-uk.a.run.app', // Cloud Run direct (cutover / fallback)
      ],
      // http for localhost, https everywhere else — but ONLY because `trustedProxyHeaders`
      // is on below. 'auto' alone is not enough behind a TLS-terminating proxy; see there.
      protocol: 'auto',
      fallback: 'https://api.skipper.fm', // base URL for any non-matching host + at init
    },
    // Required for `protocol: 'auto'` above to resolve HTTPS in production. Cloud Run terminates
    // TLS at the front end and forwards to the container over plain http, so the request URL the
    // app sees is `http://…` no matter how the rider connected. Better Auth reads `x-forwarded-proto`
    // ONLY when this is true (it defaults to FALSE, verified in better-auth's own
    // dist/utils/url.mjs `getProtocolFromSource`); without it 'auto' falls through to that request
    // URL and every generated link is http.
    //
    // That is not cosmetic: it emailed password-reset links as `http://api.skipper.fm/…` with the
    // one-time recovery token in the PATH (observed in a real 2026-07-15 reset). The host redirects
    // to https, so the flow worked — which is exactly why nothing caught it — but the token crossed
    // the wire in cleartext first, on the ONLY route back into a locked-out account.
    //
    // Safe here, and the docs' "only if you trust your proxy" caveat is already satisfied twice over:
    // the proto header is validated to be literally "http"|"https" (no injection surface — the worst a
    // spoof achieves is DOWNGRADING our own links), and the far more dangerous `x-forwarded-host`
    // it also enables is still gated by the `allowedHosts` allowlist above, which is the whole reason
    // that allowlist exists. Google's front end overwrites both headers on the way in regardless.
    advanced: { trustedProxyHeaders: true },
    database: drizzleAdapter(authDb, { provider: 'pg', schema: authSchema }),
    // Redirect/callback allowlist. The mobile app's deep-link scheme covers cross-origin auth + OAuth
    // callbacks; the apex is here because password reset RESOLVES ON THE WEB (skipper.fm/reset-password
    // is the client's `redirectTo` — see sendResetPassword below). Without the apex listed, Better Auth
    // rejects the reset request outright with INVALID_REDIRECT_URL. This is an open-redirect guard, so
    // it stays an exact-origin allowlist — never a wildcard.
    trustedOrigins: [`${MOBILE_SCHEME}://`, SITE_ORIGIN],
    // ⚠ SESSION COOKIE CACHE — a signed copy of the session rides in the cookie, so `getSession()`
    // validates WITHOUT an auth-DB round-trip. Founder call 2026-08-02.
    //
    // WHY IT IS WORTH A TRADE AT ALL: `withSession` resolves the session on every request that uses
    // it — `/regions` and all of `/drives*` — and that read goes through the SEPARATE
    // neon-serverless Pool (auth needs interactive transactions; the rest of the app is neon-http).
    // Post-D16 it never short-circuits either: the anonymous mint means every rider carries a cookie,
    // so there is always a token to look up. This removes that read from the common path.
    //
    // ⚠ WHAT IT COSTS, STATED PLAINLY: REVOCATION IS DELAYED BY `maxAge`. Better Auth's own docs —
    // "revoked sessions may remain active on other devices until the cookie cache expires" — because
    // the server cannot reach out and delete a cookie on a device it is not talking to. Signing out
    // clears the cookie on THAT device immediately; another device keeps a usable cached session for
    // up to the window.
    //
    // ⚠ THE SHARP EDGE HERE IS NOT SIGN-OUT, IT IS ACCOUNT DELETION. `purgeUserData` erases a rider's
    // drives + ledger and the user row goes with it — but a second device holding a cached cookie can
    // still authenticate for up to `maxAge`, and a WRITE in that window (POST /drives) would insert a
    // row against a user id that no longer exists: exactly the orphan INV-4 and App Store 5.1.1(v)
    // exist to prevent, with no FK to catch it. That is why this is 60s and not the library's 300s
    // default — it is a deliberate 5× reduction of that window, not a tuning number. It requires a
    // rider signed in on two devices who deletes on one while creating a drive on the other, inside a
    // minute; accepted knowingly at that size. See TODO for the follow-up that closes it properly
    // (`disableCookieCache` on the WRITE paths, which reads cannot orphan anything through).
    //
    // ⚠ The anonymous→account link does NOT open a matching hole, and the reason is worth knowing:
    // that path also hard-deletes a user row (INV-4), but a stale cached ANONYMOUS session still
    // resolves to `tier: 'anonymous'`, so `requireAccount` 401s it before any write. The tier check,
    // not the freshness of the read, is what protects that one.
    //
    // ⚠ THREE THINGS VERIFIED AGAINST THIS BUILD before enabling it, each of which would have been a
    // silent failure — all three are now pinned in test/auth-cookie-cache.test.ts:
    //  • PLUGIN fields survive into the cached payload. `role` (admin) and `isAnonymous` (anonymous)
    //    are not core columns, and the cached user is filtered through `parseUserOutput`. Had they
    //    been dropped, `isAdmin()` would return false for admins and `tierOf()` would mis-read
    //    anonymity on CACHED reads only — nothing throwing, just an admin quietly losing the staged
    //    /regions view. `getFields` merges each plugin's schema fields, so they ride.
    //  • SIGN-OUT clears the cached cookie, not only the session token (`deleteSessionCookie` expires
    //    `sessionData` too). Without that the window would not be cross-device at all — a signed-out
    //    rider would keep authenticating on their own device.
    //  • `banned` rides in the payload as well, which means an admin BAN is subject to the same
    //    `maxAge` delay as a revocation. Same bound, same acceptance.
    //
    // ⚠ Do NOT raise `maxAge` without re-reading the paragraph above; test/auth-cookie-cache.test.ts
    // fails if it moves. Grounded in the INSTALLED better-auth 1.6.23 source
    // (`dist/api/routes/session.mjs` reads `session.cookieCache.enabled` + `maxAge`, defaulting the
    // cookie to 300s in `dist/cookies/index.mjs`), not just the docs.
    session: {
      cookieCache: { enabled: true, maxAge: 60 },
    },
    // Brute-force guard on the auth endpoints. Better Auth's built-in limiter is enabled by DEFAULT
    // ONLY in production; making it explicit (`enabled: true`) turns it on in dev too, so the same
    // ceiling holds everywhere. Default in-memory "memory" storage — per-instance, same first-cut
    // tradeoff as ./rate-limit; a shared store is the M4 upgrade. A conservative 100/60s baseline,
    // with the credential paths (sign-in/sign-up) tightened via customRules to blunt password spraying.
    // Shape grounded in the installed @better-auth/core 1.6.18 BetterAuthRateLimitOptions type.
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 10 },
        '/sign-up/email': { window: 60, max: 10 },
        // INV-14. The anonymous MINT is the one endpoint where a SUCCESSFUL call costs something
        // permanent: it inserts a real `user` row that nothing ever reaps (a reaper is forbidden —
        // it would delete a rider's identity mid-conversation), and that row is outside
        // `purgeUserData`'s reach because better-auth hard-deletes it at link with no cascade. So
        // unlike the credential paths above — where the attacker's win is a guess and a failed try
        // costs us nothing — every request that gets THROUGH here is the cost.
        //
        // 5/60s, tighter than the credential paths, and the asymmetry is what argues it: a mint is a
        // once-per-INSTALL call plus a retry or two on a flaky first launch, so 5 is generous for the
        // real client; and a legitimate rider who somehow hits the ceiling (several first-launches
        // behind one carrier-NAT address inside a minute) is NOT locked out — the planner front door
        // is anonymous-reachable with NO session at all, so a 429 here degrades to "no anonymous
        // session", which is exactly the pre-mint status quo. Cheap miss, expensive overshoot.
        //
        // ⚠ Storage is better-auth's default in-memory store, so this ceiling is PER CONTAINER — it
        // blunts casual abuse, it is not a bound on total row growth. A shared store is the same M4
        // upgrade the baseline above is waiting on.
        '/sign-in/anonymous': { window: 60, max: 5 },
      },
    },
    emailAndPassword: {
      enabled: true,
      // Reset is the ONLY route back into a locked-out account: email/password is the sole sign-in
      // method in prod (socialProviders registers nothing without creds) and there's no email
      // verification, so a forgotten password otherwise costs the rider their drives AND their
      // credits — permanently, since the ledger never refunds. `url` is Better Auth's one-time link
      // (1 h default); it lands on the rider's phone but resolves on the WEB (skipper.fm/reset-password,
      // the client's `redirectTo`) — a mail link can't be trusted to open a specific app, and a
      // reset that only works on the device that lost access isn't a reset.
      sendResetPassword: async ({ user, url }) => {
        await sendPasswordResetEmail(user.email, url)
      },
    },
    socialProviders,
    user: {
      deleteUser: {
        // App Store Guideline 5.1.1(v): an app that creates accounts MUST let them be deleted from
        // inside the app. Non-negotiable for submission.
        enabled: true,
        // `sendDeleteAccountVerification` is deliberately UNSET → deletion is IMMEDIATE (founder call,
        // 2026-07-15). The endpoint already sits behind a fresh session or a password re-entry
        // (Better Auth's sensitiveSessionMiddleware), which is the confirmation that matters; an
        // email round-trip would only add a second way to be locked out of your own erasure.
        //
        // ⚠ THE PURGE IS NOT HERE ANY MORE. It moved to `databaseHooks.user.delete.before` below,
        // because `deleteUser.beforeDelete` only fires on the two SELF-SERVE routes and silently
        // skipped every other way a user row can die. See that hook for the whole story.
      },
    },
    databaseHooks: {
      user: {
        // ERASURE LIVES HERE, not on `user.deleteUser.beforeDelete`, and the difference is a data bug.
        //
        // `deleteUser.beforeDelete` is invoked from exactly TWO places in the installed package — the
        // self-serve `/delete-user` and its `/delete-user/callback` (verified in
        // better-auth/dist/api/routes/update-user.mjs). Every OTHER way a user row dies goes straight
        // through `internalAdapter.deleteUser` and never sees it:
        //   • `POST /api/auth/admin/remove-user` — the admin plugin is mounted unconditionally below,
        //     so this endpoint is LIVE on api.skipper.fm. It called `internalAdapter.deleteUser`
        //     directly, which meant a deleted rider's `drives` and `credit_entries` were left behind a
        //     vanished user id, forever — the exact orphan `purgeUserData` exists to prevent, because
        //     those are soft refs across the auth-pool boundary with no FK and therefore no cascade.
        //   • the anonymous plugin's link-time cleanup (see `anonymous()` below).
        //
        // A `databaseHooks` hook reaches all of them: `internalAdapter.deleteUser` calls
        // `deleteWithHooks(where, 'user')`, which runs `hooks.user.delete.before` before the row goes
        // (better-auth/dist/db/{internal-adapter,with-hooks}.mjs). That is an implementation detail of
        // the vendor, so `apps/api/test/auth-delete-hook.test.ts` pins it against the installed source
        // and fails loudly on an upgrade that changes it — do not delete that test.
        //
        // ⚠ Still BEFORE, never after: `./account` explains why the order is load-bearing (a post-delete
        // throw strands rows behind a user with no session left to retry). Returning `false` here would
        // ABORT the delete; we never do — erasure must not be blockable by a ledger hiccup.
        //
        // ⚠ It now also fires on the ANONYMOUS link-time delete, where it should find nothing: INV-4
        // says no `drives`/`credit_entries` row may reference an anonymous id, and that holds
        // structurally (POST /drives is tier-gated, and the signup grant skips anonymous). So this is a
        // no-op batch on that path — and if it ever ISN'T, it deletes rows that were about to orphan
        // permanently, which is the outcome we want either way.
        delete: {
          before: async (user) => {
            await purgeUserData((user as { id: string }).id)
          },
        },
        create: {
          // Materialize the free allotment AT SIGNUP so a new account's balance is REAL the moment it
          // exists (founder call 2026-07-28). Before this it appeared only on first credit-relevant
          // request, so a freshly-created account read 0 credits in the DB and in admin — indistinguishable
          // from a broken account, which is exactly how it was misread while recovering the App Review
          // demo login.
          //
          // ⚠ ANONYMOUS USERS ARE SKIPPED, deliberately. The anonymous plugin creates a real `user` row,
          // and on link-to-account it DELETES that row and creates a fresh one (verified in the installed
          // plugin source, not assumed). Granting there would hand credits to an identity that cannot
          // spend them — `/drives*` is behind requireAccount — and then STRAND the grant when the row is
          // deleted, because `credit_entries.user_id` is a soft ref across the auth-pool boundary with no
          // FK and no cascade. (Since 2026-08-02 the delete hook above DOES reach that path, so such a
          // grant would now be purged rather than stranded — but a credit that is minted only to be
          // deleted is still pointless work, so the skip stays.) The real account created by the link
          // gets its own grant through this same hook.
          //
          // This is ADDITIVE, not a replacement: `ensureFreeGrant` stays on its read/spend paths in
          // ./drives as the backstop. Both write the same `free:<userId>` idempotency key under
          // ON CONFLICT DO NOTHING, so the two paths can never double-grant, and any signup route that
          // bypasses this hook still cannot produce a credit-less account.
          after: async (createdUser) => {
            if (!shouldGrantAtSignup(createdUser as { isAnonymous?: boolean | null })) return
            try {
              await ensureFreeGrant(createdUser.id)
            } catch (err) {
              // NEVER fail signup over a ledger write. The account is already committed at this point,
              // and the lazy backstop will materialize the grant before any balance is read or spent —
              // so the worst case is a delayed row, not a lost credit or a rider who can't sign up.
              console.error(`[api] free-grant at signup failed for ${createdUser.id}; backstop will cover`, err)
            }
          },
        },
      },
    },
    // No freemium tier column — premium is bought as CREDITS, governed by the credit_entries ledger
    // (docs/decisions/cut-tiers.md). (The region-release-gate preview role — who hears staged content —
    // is the admin plugin's `role`, a SEPARATE concern; see the admin() plugin below +
    // docs/decisions/region-release-gate.md.)
    plugins: [
      // Expo integration: secure-store session handling + deep-link OAuth for the app.
      expo(),
      anonymous({
        onLinkAccount: async () => {
          // Nothing to migrate on sign-up: the anonymous surfaces (plan / propose / sample) keep no
          // per-user server state, and drives are created (and owned) only by a signed-in account —
          // so there is no anonymous per-user state to move.
        },
      }),
      // Admin roles. Adds user.role (plugin sets 'user' on signup; server-set input:false) + ban/impersonate columns
      // and the /admin/* management endpoints (guarded — only an admin role can call them). `role==='admin'`
      // is ALSO the region-release-gate preview check (an admin hears staged content in-app — `isAdmin` in
      // ./tiers). Defaults: defaultRole='user', adminRoles=['admin']. The first admin is bootstrapped by
      // setting role='admin' directly in the DB (no admin exists yet to call set-role). See region-release-gate.
      admin(),
    ],
  })
}

type Auth = ReturnType<typeof createAuth>

let cached: Auth | undefined

/**
 * ⚠ MEMOIZED, AND THAT IS NOT AN OPTIMIZATION. `createLazyProxy` (@skipper/db) runs its factory on
 * EVERY property read, and `auth.api.getSession(...)` in ./entitlements is two reads — so an
 * un-memoized build would construct a whole fresh auth context per request: a new `init()`, new
 * cookie config, and the one that is a security regression rather than a performance one, a NEW
 * IN-MEMORY RATE-LIMIT STORE. The brute-force guard configured above would count to 1 forever.
 * Nothing would error and `bun run check` would stay green — which is why `test/auth-lazy.test.ts`
 * asserts the instance identity, and why that test was mutation-checked against this exact line.
 * Same shape as the repo's two other lazy clients (@skipper/db's `getDb`, ./auth-db's `getAuthDb`).
 *
 * ⚠ A THROW IS DELIBERATELY NOT CACHED: `cached` stays undefined, so a misconfigured process keeps
 * failing loudly on every attempt rather than serving one poisoned instance forever.
 */
function buildAuth(): Auth {
  cached ??= createAuth()
  return cached
}

export const auth: Auth = createLazyProxy(buildAuth)
