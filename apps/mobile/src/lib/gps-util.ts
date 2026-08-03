// The expo-specific GPS remainder, plus the app's stable import surface for the live fix pipeline.
//
// ⚠ The pipeline itself — the accuracy gate, the iOS -1 sentinel handling, the monotonic projection
// cursor, the end predicate and `createFixMapper` that composes them — MOVED to
// `@skipper/engine/fix-mapper`. It belongs there because `packages/sim` and every headless harness
// must run the exact code the phone runs; a mapper only the phone could execute is precisely the
// drift the engine exists to prevent. Re-exported here so call sites keep importing from one place.
//
// What legitimately stays: `isReducedAccuracy`, which reads expo's own `ios.accuracy` string. That is
// a platform permission detail, not geometry, and the engine has no business knowing about it.
export {
  accuracyCeilingM,
  accuracyOk,
  createFixMapper,
  MAX_FIX_ACCURACY_M,
  ACCURACY_LEAD_FRACTION,
  PROJECT_WINDOW_VERTS,
  projectForwardIndex,
  reachedRouteEnd,
  ROUTE_END_EPSILON_M,
  saneNonNeg,
  type FixMapperOptions,
  type RawFix,
} from '@skipper/engine'

/** iOS granted location but only at REDUCED (approximate) accuracy — the Precise Location toggle is off.
 *  Pure on the raw `ios.accuracy` value (undefined off iOS → false, so it never blocks sim/Android).
 *  Typed `string | undefined` to stay decoupled from expo's exact union — the literal 'reduced' is the
 *  contract (a value-set change must be caught here, not silently pass). */
export function isReducedAccuracy(iosAccuracy: string | undefined): boolean {
  return iosAccuracy === 'reduced'
}
