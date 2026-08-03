// The pure decisions inside the location-permission dance (`useLocationPriming`).
//
// Native-free (no react, no expo-location) so it runs under `bun test` — same split as
// connectivity-util.ts / gps-util.ts / preview-util.ts. The hook keeps the refs, the async plumbing
// and the callbacks; the two RULES live here, because both of them are the kind that look like a
// simplification when you delete them.

/** The permission facts a decision needs — the subset `gps.ts` returns, in plain booleans. */
export interface PermissionFacts {
  granted: boolean
  /** Can the OS still prompt? false → the recovery is system Settings, not a re-prompt. */
  canAskAgain: boolean
  /** Granted, but iOS APPROXIMATE location (Precise Location off). */
  reduced: boolean
}

/** What a start tap should do, given the status read WITHOUT prompting. */
export type StartAction =
  /** Never asked — show the pre-permission explainer first; its CTA fires the real prompt. */
  | 'prime'
  /** Already decided — request straight through. Shows no OS UI, so a grant just rolls. */
  | 'request'

/** Decide whether a start tap shows the explainer or requests straight through.
 *
 *  ⚠ BOTH DIRECTIONS ARE LOAD-BEARING, for different reasons:
 *  - **undetermined → prime.** iOS's prompt is ONE-SHOT. Spending it without context is how an app
 *    gets a permanent denial from a rider who had no idea what it was for, and the explainer is also
 *    an App Store 5.1.1(iv) obligation (which is why it has no "Not Now" — a pre-prompt may not offer
 *    its own decline).
 *  - **decided → request, NOT prime.** Showing the explainer to someone who already answered leads to
 *    a CTA that opens no dialog at all — a dead button. `requestForegroundPermissionsAsync` renders no
 *    UI when the status is settled, so requesting through is safe and a grant proceeds silently. */
export function decideStart(status: { undetermined: boolean }): StartAction {
  return status.undetermined ? 'prime' : 'request'
}

/** What to do with a permission result. */
export type PermissionRoute = { kind: 'proceed' } | { kind: 'denied'; denial: PermissionFacts }

/** Route a permission result to "start the drive" or "show the gate".
 *
 *  ⚠ THE RULE THAT IS EASY TO DELETE: **granted-but-REDUCED is a denial.** `perm.granted` is TRUE on
 *  that branch, so a check that reads only `granted` compiles, passes review, and lets a live drive
 *  start on iOS approximate location. That is not a degraded map pin — the whole trigger core is
 *  speed-adaptive and distance-based (`@skipper/engine`), so approximate fixes fire stops at the wrong
 *  places, or not at all, and it presents as "the triggering is broken" rather than as a permission
 *  problem. Precise is a requirement here, not a preference.
 *
 *  `canAskAgain` rides along untouched because the CALLER decides the recovery: false means the OS
 *  will not prompt again and the only way back is system Settings. */
export function routePermission(perm: PermissionFacts): PermissionRoute {
  if (!perm.granted || perm.reduced) return { kind: 'denied', denial: { ...perm } }
  return { kind: 'proceed' }
}
