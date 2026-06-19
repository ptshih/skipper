// Freemium entitlements middleware — resolves the Better Auth session per request
// and stashes the derived tier on the Hono context. The pure tier math lives in
// ./tiers (unit-testable without constructing the auth instance).

import type { MiddlewareHandler } from 'hono'
import type { AccessTier } from '@skipper/shared'
import { auth } from './auth'
import { resolveSessionSafely } from './session'
import { FEATURES, meetsTier, tierOf } from './tiers'

/** Better Auth's inferred session shape ({ session, user }), incl. tier + isAnonymous. */
export type AuthSession = typeof auth.$Infer.Session

export type ApiEnv = {
  Variables: {
    session: AuthSession | null
    tier: AccessTier
  }
}

/** Resolve the session + tier once and stash on context. Apply to gated data routes.
 *
 *  FAIL-OPEN: resolving the session reads the auth DB, and this middleware runs BEFORE the
 *  per-route gate — so a transient auth-DB blip must not 500 the request (it would needlessly
 *  take down the open `?preview=1` funnel, which needs no session). resolveSessionSafely retries
 *  the read, then degrades to null → tierOf(null) = 'anonymous': the secure direction (a gated
 *  route falls back to its AccountGate 401, never a leak; preview keeps serving). See ./session. */
export const withSession: MiddlewareHandler<ApiEnv> = async (c, next) => {
  const session = await resolveSessionSafely(() => auth.api.getSession({ headers: c.req.raw.headers }))
  c.set('session', session)
  c.set('tier', tierOf(session))
  await next()
}

/**
 * Free-account wall: reject anonymous callers. (Requires withSession upstream.)
 * Pre-placed gate for the planned `POST /drives/:id/ask` route — kept intentionally
 * UNMOUNTED until Ask ships (its first real caller). The 401 shape + message mirror the
 * live drive/offline wall in `loadOwnedDrive` (drives.ts) so the two gates stay aligned.
 */
export const requireAccount: MiddlewareHandler<ApiEnv> = async (c, next) => {
  if (c.get('tier') === 'anonymous') {
    return c.json(
      { error: 'account_required', message: 'Create a free account to play this tour.' },
      401,
    )
  }
  await next()
}

// Re-export the pure helpers so existing importers (index.ts) need no change.
export { FEATURES, meetsTier, tierOf }
