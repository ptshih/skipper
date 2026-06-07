// Better Auth instance — the freemium auth foundation (M2).
//
// Tiers: anonymous (no/guest session) -> free (signed-in) -> paid (tier='paid').
// Tours stay anonymous/shareable; auth is layered AROUND them. Email/password is
// enabled now; Google/Apple are registered only when their creds are present
// (placeholders otherwise) so the server boots without them. The anonymous plugin
// gives guests a session that links to a real account on sign-up.
//
// Secret/base URL come from env: BETTER_AUTH_SECRET, BETTER_AUTH_URL.

import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { anonymous } from 'better-auth/plugins'
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
  database: drizzleAdapter(authDb, { provider: 'pg', schema: authSchema }),
  // Allow the mobile app's deep-link scheme for cross-origin auth + OAuth callbacks.
  trustedOrigins: [`${MOBILE_SCHEME}://`],
  emailAndPassword: { enabled: true },
  socialProviders,
  // Manual freemium tier on the user (no Stripe yet). 'free' | 'paid'.
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
        // M2: nothing to migrate yet. When free-account favorites land, move any
        // anonymous saved_tours from anonymousUser -> newUser here.
      },
    }),
  ],
})
