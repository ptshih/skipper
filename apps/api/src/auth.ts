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
import * as authSchema from '@skipper/db/auth-schema'
import { authDb } from './auth-db'

// Register a social provider only if both its env creds are set.
const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {}
const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, APPLE_CLIENT_ID, APPLE_CLIENT_SECRET } = process.env
if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  socialProviders.google = { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET }
}
if (APPLE_CLIENT_ID && APPLE_CLIENT_SECRET) {
  socialProviders.apple = { clientId: APPLE_CLIENT_ID, clientSecret: APPLE_CLIENT_SECRET }
}

export const auth = betterAuth({
  database: drizzleAdapter(authDb, { provider: 'pg', schema: authSchema }),
  emailAndPassword: { enabled: true },
  socialProviders,
  // Manual freemium tier on the user (no Stripe yet). 'free' | 'paid'.
  user: {
    additionalFields: {
      tier: { type: 'string', required: false, defaultValue: 'free', input: false },
    },
  },
  plugins: [
    anonymous({
      onLinkAccount: async () => {
        // M2: nothing to migrate yet. When free-account favorites land, move any
        // anonymous saved_tours from anonymousUser -> newUser here.
      },
    }),
  ],
})
