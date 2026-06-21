// Better Auth instance — the freemium auth foundation (M2).
//
// Tiers: anonymous (no/guest session) -> free (signed-in) -> paid (tier='paid').
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
import { authDb } from './auth-db'

// The mobile app's deep-link scheme — must match apps/mobile app.json `scheme`
// and the expoClient `scheme`. OAuth callbacks + cross-origin auth use it.
const MOBILE_SCHEME = 'skipper'

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

export const auth = betterAuth({
  secret,
  // Base URL Better Auth uses to build callback / redirect / password-reset links
  // (it appends its own /api/auth basePath — do NOT put a path here). Resolved
  // PER-REQUEST from the validated Host header, so dev, the prod service, AND
  // ephemeral Render PR-preview URLs all work with NO env var to manage (no
  // BETTER_AUTH_URL). `allowedHosts` is the security allowlist that blocks
  // Host-header injection of reset/OAuth links and seeds `trustedOrigins`;
  // `fallback` covers any non-matching host and serves as the init-time base URL
  // (so there's no "Base URL could not be determined" startup warning).
  // Custom domain: api.skipper.fm — this service is API-ONLY. The apex skipper.fm is a
  // SEPARATE landing site (Astro on Vercel), mapped
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
  // Allow the mobile app's deep-link scheme for cross-origin auth + OAuth callbacks.
  trustedOrigins: [`${MOBILE_SCHEME}://`],
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
  emailAndPassword: { enabled: true },
  socialProviders,
  // Manual freemium tier on the user (no Stripe yet). 'free' | 'paid'. Server-set only (input:false).
  // (The region-release-gate preview role — who hears staged content — is the admin plugin's `role`,
  // NOT a tier and NOT a separate flag; see the admin() plugin below + docs/decisions/region-release-gate.md.)
  user: {
    additionalFields: {
      tier: { type: 'string', required: false, defaultValue: 'free', input: false },
    },
  },
  plugins: [
    // Expo integration: secure-store session handling + deep-link OAuth for the app.
    expo(),
    anonymous({
      onLinkAccount: async () => {
        // Nothing to migrate on sign-up: roam state is anonymous and drives are created
        // (and owned) only by a signed-in account — there is no anonymous per-user state to move.
      },
    }),
    // Admin roles. Adds user.role (default 'user'; server-set input:false) + ban/impersonate columns
    // and the /admin/* management endpoints (guarded — only an admin role can call them). `role==='admin'`
    // is ALSO the region-release-gate preview check (an admin hears staged content in-app — `isAdmin` in
    // ./tiers). Defaults: defaultRole='user', adminRoles=['admin']. The first admin is bootstrapped by
    // setting role='admin' directly in the DB (no admin exists yet to call set-role). See region-release-gate.
    admin(),
  ],
})
