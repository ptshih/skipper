// Pure freemium-tier logic — no auth/DB imports, so it's unit-testable in
// isolation (importing the Better Auth instance is not required to reason about
// tiers).
//
//   anonymous (no/guest session) -> free (signed-in) -> paid (user.tier='paid')

import type { AccessTier } from '@skipper/shared'

/** The only session fields tierOf needs — structurally satisfied by Better Auth's session. */
export interface TierSession {
  user?: { isAnonymous?: boolean | null; tier?: string | null } | null
}

/** Derive the access tier from a session (null/guest → anonymous). */
export function tierOf(session: TierSession | null | undefined): AccessTier {
  const user = session?.user
  if (!user || user.isAnonymous) return 'anonymous'
  return user.tier === 'paid' ? 'paid' : 'free'
}

const TIER_RANK: Record<AccessTier, number> = { anonymous: 0, free: 1, paid: 2 }
export const meetsTier = (have: AccessTier, need: AccessTier): boolean => TIER_RANK[have] >= TIER_RANK[need]

/** Feature -> minimum tier. Edit here as paid features land (M3+/player). */
export const FEATURES = {
  // Playing a non-preview tour requires at least a free account.
  playTour: 'free',
} as const satisfies Record<string, AccessTier>
