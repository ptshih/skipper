// Freemium entitlements — resolve the Better Auth session once per request and
// derive the access tier, then gate routes.
//
//   anonymous (no/guest session)  -> free (signed-in)  -> paid (user.tier='paid')
//
// `requireAccount` is the free-account wall. A central FEATURES map keeps the
// feature -> minimum-tier policy in one editable place as paid features land
// (none are gated yet — the only live gate today is non-preview tour playback).

import type { MiddlewareHandler } from 'hono'
import type { AccessTier } from '@skipper/shared'
import { auth } from './auth'

/** Better Auth's inferred session shape ({ session, user }), incl. tier + isAnonymous. */
export type AuthSession = typeof auth.$Infer.Session

export type ApiEnv = {
  Variables: {
    session: AuthSession | null
    tier: AccessTier
  }
}

/** Derive the access tier from a session. */
export function tierOf(session: AuthSession | null): AccessTier {
  const user = session?.user as (AuthSession['user'] & { isAnonymous?: boolean | null; tier?: string | null }) | undefined
  if (!user || user.isAnonymous) return 'anonymous'
  return user.tier === 'paid' ? 'paid' : 'free'
}

const TIER_RANK: Record<AccessTier, number> = { anonymous: 0, free: 1, paid: 2 }
export const meetsTier = (have: AccessTier, need: AccessTier): boolean => TIER_RANK[have] >= TIER_RANK[need]

/** Feature -> minimum tier. Edit here as paid features land (M3+/player). */
export const FEATURES = {
  // Playing a non-preview tour requires at least a free account.
  playTour: 'free',
  // (future) interestFiltering: 'paid', voiceChoice: 'paid', offlineDownload: 'paid', ...
} as const satisfies Record<string, AccessTier>

/** Resolve the session + tier once and stash on context. Apply to data routes. */
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
