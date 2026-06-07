// Freemium entitlements middleware — resolves the Better Auth session per request
// and stashes the derived tier on the Hono context. The pure tier math lives in
// ./tiers (unit-testable without constructing the auth instance).

import type { MiddlewareHandler } from 'hono'
import type { AccessTier } from '@skipper/shared'
import { auth } from './auth'
import { FEATURES, meetsTier, tierOf } from './tiers'

/** Better Auth's inferred session shape ({ session, user }), incl. tier + isAnonymous. */
export type AuthSession = typeof auth.$Infer.Session

export type ApiEnv = {
  Variables: {
    session: AuthSession | null
    tier: AccessTier
  }
}

/** Resolve the session + tier once and stash on context. Apply to gated data routes. */
export const withSession: MiddlewareHandler<ApiEnv> = async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  c.set('session', session)
  c.set('tier', tierOf(session))
  await next()
}

/** Free-account wall: reject anonymous callers. (Requires withSession upstream.) */
export const requireAccount: MiddlewareHandler<ApiEnv> = async (c, next) => {
  if (c.get('tier') === 'anonymous') {
    return c.json({ error: 'account_required', message: 'Create a free account to continue.' }, 401)
  }
  await next()
}

// Re-export the pure helpers so existing importers (index.ts) need no change.
export { FEATURES, meetsTier, tierOf }
