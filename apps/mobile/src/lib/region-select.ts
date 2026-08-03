// Which region a freshly-loaded home screen pins itself to.
//
// ⚠ THIS EXISTS BECAUSE "AUTO-SELECT ONLY WHEN THERE IS EXACTLY ONE" WAS A LATENT KILL SWITCH ON
// EVERY BUILD ALREADY IN RIDERS' HANDS (founder, 2026-08-03). Regions are SERVER data — releasing one
// is a `released_at` flip, deliberately not an App Store submission — so the client has to survive the
// list GROWING under it. The old rule did the opposite: a list of two selected nothing, and "nothing
// selected" is not a quiet degradation on this screen. It is no region chip, no example asks, and a
// composer disabled by `sending || !regionId` — i.e. releasing region 2 would have bricked the home
// screen of every installed app until the next submission. It was found early only because an ADMIN is
// served STAGED regions too (`canPreview`, apps/api GET /regions), so a merely SEEDED Yosemite put the
// signed-in founder into the multi-region path months before any rider would have hit it.
//
// The rule is therefore: with a non-empty list, ALWAYS land on something. Picking imperfectly is
// recoverable in one tap; picking nothing is not recoverable at all.

/** The rider's last region if it is still on offer, else the first the server listed, else null.
 *
 *  ⚠ Structural, not `Region`-typed: `app/index.tsx` holds two region shapes (`Region` from
 *  `@skipper/shared` and `CachedRegion` from ./region-cache) and this rule needs only an id off each.
 *  Keeping it that way is what lets it be a pure, testable function at all — the screen's own hooks
 *  sit behind native modules `bun test` cannot load. */
export function pickRegionId<T extends { id: string }>(
  regions: readonly T[],
  cachedRegionId: string | null | undefined,
): string | null {
  // The rider's last choice wins whenever it is still on offer. Without this, a rider who switched to
  // Yosemite would be silently dragged back to Lake Tahoe on every cold start — the list is ordered by
  // display name, so "first" is alphabetical, not "theirs".
  // ⚠ Membership is re-checked rather than trusted: a cached region can be UNRELEASED later (release
  // is monotonic for narrations, not for regions) or belong to a signed-out admin's staged preview, and
  // pinning `regionId` to something absent from `regions` resolves to `region === null` on the screen —
  // which is the exact dead state this whole file exists to prevent.
  if (cachedRegionId && regions.some((r) => r.id === cachedRegionId)) return cachedRegionId
  // Otherwise the first one offered. Arbitrary-but-stable beats nothing, and it is only ever a
  // STARTING point: the chip beside it opens the picker.
  return regions[0]?.id ?? null
}
