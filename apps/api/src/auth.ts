// Better Auth instance — the freemium auth foundation (M2).
//
// Access: anonymous (no/guest session) -> free (a signed-in account). There is no paid tier —
// premium is bought as CREDITS, not a plan (docs/decisions/cut-tiers.md).
// Roam is open/anonymous; drives are user-owned. Auth layers around both. Email/password is
// enabled now; Google/Apple are registered only when their creds are present
// (placeholders otherwise) so the server boots without them. The anonymous plugin
// gives guests a session that links to a real account on sign-up.
//
// Secret comes from env (BETTER_AUTH_SECRET); the base URL is derived per-request from the
// validated Host header (there is no BETTER_AUTH_URL) — see the `baseURL` config below.

import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin, anonymous } from 'better-auth/plugins'
import { expo } from '@better-auth/expo'
import * as authSchema from '@skipper/db/auth-schema'
import { purgeUserData } from './account'
import { authDb } from './auth-db'
import { emailConfigured, sendPasswordResetEmail } from './email'

// The mobile app's deep-link scheme — must match apps/mobile app.json `scheme`
// and the expoClient `scheme`. OAuth callbacks + cross-origin auth use it.
const MOBILE_SCHEME = 'skipper'

// The marketing site's origin (Astro on Firebase Hosting) — a DIFFERENT host from this API-only
// service. It hosts the one auth surface that can't live in the app: the password-reset form. Env
// override so a local site build (`bun run dev:site`) can be pointed at without editing code.
const SITE_ORIGIN = process.env.SITE_ORIGIN ?? 'https://skipper.fm'

// Register a social provider only if both its env creds are set.
const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {}
const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, APPLE_CLIENT_ID, APPLE_CLIENT_SECRET } = process.env
if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  socialProviders.google = { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET }
}
if (APPLE_CLIENT_ID && APPLE_CLIENT_SECRET) {
  socialProviders.apple = { clientId: APPLE_CLIENT_ID, clientSecret: APPLE_CLIENT_SECRET }
}

// Fail fast rather than let Better Auth silently fall back to its publicly-known
// DEFAULT secret (it only throws on its own when NODE_ENV=production). Every auth
// crypto path keys off this — cookie signatures, OAuth state, verification/reset
// tokens — so a missing secret must stop boot, not run on a known value.
const secret = process.env.BETTER_AUTH_SECRET
if (!secret) {
  throw new Error(
    'BETTER_AUTH_SECRET is not set. Generate one and store it (dev + prod):\n' +
      '  dotenvx set BETTER_AUTH_SECRET "$(openssl rand -base64 32)" -f .env.development\n' +
      '  dotenvx set BETTER_AUTH_SECRET "$(openssl rand -base64 32)" -f .env.production',
  )
}

// A missing mailer is NOT fatal — dev and every read-only surface boot fine without it, and failing
// boot over it would take roam (the anonymous front door) down with it. But it silently disables the
// only unlock for a locked-out account, and Better Auth answers reset requests identically either way
// (enumeration-safe), so the rider is told "check your email" for mail that never sends. Say it once,
// loudly, at boot — the alternative is learning it from a stranded user with no support channel.
if (!emailConfigured()) {
  console.warn(
    '[api] RESEND_API_KEY is not set — password RESET WILL FAIL. Set it, and verify the EMAIL_FROM ' +
      'domain with Resend, before opening public signup.',
  )
}

export const auth = betterAuth({
  secret,
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
      'localhost', // local dev
      'api.skipper.fm', // custom domain — the API host
      'skipper-api-csslmysz7q-uk.a.run.app', // Cloud Run direct (cutover / fallback)
    ],
    protocol: 'auto', // http for localhost, https for the custom domain / Cloud Run hosts
    fallback: 'https://api.skipper.fm', // base URL for any non-matching host + at init
  },
  database: drizzleAdapter(authDb, { provider: 'pg', schema: authSchema }),
  // Redirect/callback allowlist. The mobile app's deep-link scheme covers cross-origin auth + OAuth
  // callbacks; the apex is here because password reset RESOLVES ON THE WEB (skipper.fm/reset-password
  // is the client's `redirectTo` — see sendResetPassword below). Without the apex listed, Better Auth
  // rejects the reset request outright with INVALID_REDIRECT_URL. This is an open-redirect guard, so
  // it stays an exact-origin allowlist — never a wildcard.
  trustedOrigins: [`${MOBILE_SCHEME}://`, SITE_ORIGIN],
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
      // beforeDelete (NOT afterDelete) — see ./account for why the order is load-bearing.
      beforeDelete: async (user) => {
        await purgeUserData(user.id)
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
        // Nothing to migrate on sign-up: roam state is anonymous and drives are created
        // (and owned) only by a signed-in account — there is no anonymous per-user state to move.
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
