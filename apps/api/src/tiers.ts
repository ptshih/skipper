// Pure freemium-tier logic — no auth/DB imports, so it's unit-testable in
// isolation (importing the Better Auth instance is not required to reason about
// tiers).
//
//   anonymous (no/guest session) -> free (signed-in) -> paid (user.tier='paid')

import type { AccessTier } from '@skipper/shared'

/** The only session fields tierOf/isAdmin need — structurally satisfied by Better Auth's session. */
export interface TierSession {
  user?: { isAnonymous?: boolean | null; tier?: string | null; role?: string | null } | null
}

/** Derive the access tier from a session (null/guest → anonymous). */
export function tierOf(session: TierSession | null | undefined): AccessTier {
  const user = session?.user
  if (!user || user.isAnonymous) return 'anonymous'
  return user.tier === 'paid' ? 'paid' : 'free'
}

/** Region-release-gate preview check: an admin hears STAGED (not-yet-released) content. Anonymous/guest
 *  sessions are never admins (the role lives on a real account). The read paths skip the released_at
 *  filter when this is true. `role` is the Better Auth admin plugin's field (auth.ts). See
 *  docs/decisions/region-release-gate.md. */
export function isAdmin(session: TierSession | null | undefined): boolean {
  const user = session?.user
  return !!user && !user.isAnonymous && user.role === 'admin'
}

const TIER_RANK: Record<AccessTier, number> = { anonymous: 0, free: 1, paid: 2 }
export const meetsTier = (have: AccessTier, need: AccessTier): boolean => TIER_RANK[have] >= TIER_RANK[need]

/** Feature -> minimum tier. Edit here as paid features land (M3+/player). */
export const FEATURES = {
  // Creating/playing a drive requires at least a free account (anonymous = roam only).
  playDrive: 'free',
} as const satisfies Record<string, AccessTier>
