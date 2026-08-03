// The two hops from "the planner drew a route" to a wire request: plan → propose → create.
//
// Pure and native-free (type-only imports from @skipper/shared) so it runs under `bun test`.
//
// ⚠ INV-1, RESTATED AS A CLIENT RULE — this file is where it is kept or lost. Endpoints ride as ANCHOR
// IDS, verbatim, on BOTH hops. `toCreateRequest` reads the ids the PROPOSAL echoed (`startId`/`endId`),
// never `p.start.name` / `p.start.lat` — re-sending a name or a coordinate would reopen exactly the
// hole the id-only wire closes, since an id cannot express a point that is not on the curated
// allowlist while a coordinate pair can express any point on Earth (and bills Google Routes to find
// out). The proposal carries both halves on purpose: the resolved shape is for DISPLAY, the ids are
// for the next request. Nothing in this file reads a coordinate.

import type {
  CreateDriveRequest,
  DriveProposal,
  DriveProposeRequest,
  PlannedRoute,
} from '@skipper/shared'

/**
 * The planner's route → `POST /drives/propose`.
 *
 * `targetMinutes` is deliberately DROPPED: it is the rider's advisory ask, the planner already used it
 * to choose the endpoints, and /propose has nowhere to put it — Google decides the real duration from
 * the route it materializes.
 *
 * `via` is omitted rather than sent empty so the request matches what a one-way ask actually is.
 */
export const toProposeRequest = (r: PlannedRoute): DriveProposeRequest => ({
  start: r.start,
  end: r.end,
  ...(r.via?.length ? { via: r.via } : {}),
})

/**
 * The identity of the BILLED call a route would make: its `/drives/propose` body, stringified.
 *
 * Exists because the planner re-emits a route it has already drawn — observed on device 2026-08-03
 * answering "What's your name?" with "…drawn up just as you said" and a second, identical card. Every
 * one of those is another Google Routes call for a drive the rider is already looking at, so the
 * screen dedupes on this key before drawing (app/index.tsx `drawUp`).
 *
 * ⚠ DERIVED FROM `toProposeRequest`, never a hand-listed field set, and that is the whole point: the
 * question it answers is "would sending this bill a second call for a result we already have?", which
 * only the request itself can answer. A field added to the request joins the key for free; a key that
 * re-listed the fields would keep answering the old question after the request changed — the
 * two-copies-of-one-set drift this codebase keeps paying for.
 *
 * ⚠ `targetMinutes` is therefore ABSENT BY INHERITANCE, not by oversight. `toProposeRequest` drops it,
 * so two routes differing only in the duration the rider asked for materialize the SAME drive from the
 * SAME billed call — they must collide here, or the dedupe misses the case it exists for.
 *
 * ⚠ Key order is fixed by the literal above (`start`, `end`, then an optional `via`), so
 * `JSON.stringify` is stable without sorting. `via` ORDER is load-bearing and deliberately preserved:
 * A→B via C is not the drive A→B via D, nor the same as reversing two midpoints.
 */
export const proposeKey = (r: PlannedRoute): string => JSON.stringify(toProposeRequest(r))

/**
 * The planner re-emitted a route the conversation ALREADY has a card for → move that card to the end,
 * re-slotted at `afterTurn`. Returns the array unchanged when no card matches.
 *
 * ⚠ WHY MOVE RATHER THAN REDRAW, and why not simply ignore it (which is what the screen used to do).
 * The dedupe in `app/index.tsx` `drawUp` exists so one drive costs one billed Google Routes call and
 * owns one idempotency key — that part is right and this preserves all of it. What was wrong was the
 * REFUSAL being silent: the rider asks for a change, the skipper agrees in words, and nothing moves on
 * screen, because the card they are being pointed at is several exchanges up and the "Draw it up" bar
 * is suppressed by the very card that exists. Founder report, 2026-08-03.
 *
 * ⚠ BOTH HALVES ARE LOAD-BEARING. `afterTurn` decides which transcript slot the card renders in;
 * ARRAY POSITION decides `newestCardId`, which gates the live map on the card. Doing either alone
 * leaves the rider a card at the bottom of the screen with a dead map, or a live map still buried.
 *
 * ⚠ Matched by `proposeKey`, so it collides exactly where the dedupe collides — including on
 * `targetMinutes`, which `toProposeRequest` drops. Two routes differing only in the duration the rider
 * asked for are the same billed call and therefore the same card; re-flowing it is the whole reason a
 * rider saying "make it shorter" now sees anything happen at all.
 *
 * Generic over the card so this module stays free of the screen's `PreviewItem` (which carries native
 * state); the two fields below are all the decision needs.
 */
export function reflowDrawnCard<T extends { route: PlannedRoute; afterTurn: number }>(
  cards: readonly T[],
  route: PlannedRoute,
  afterTurn: number,
): T[] {
  const key = proposeKey(route)
  const i = cards.findIndex((c) => proposeKey(c.route) === key)
  if (i < 0) return cards as T[]
  return [...cards.slice(0, i), ...cards.slice(i + 1), { ...cards[i]!, afterTurn }]
}

/**
 * The confirmed proposal → `POST /drives` (this one SPENDS a non-refundable credit).
 *
 * `idempotencyKey` is minted once per proposal by the caller and REUSED across retries of that same
 * logical create: the server uses it as the drive id, so a lost-ACK retry hits the existing row and
 * no-ops instead of charging a second credit. A NEW proposal is a new logical create and must get a
 * new key — that lifecycle belongs to the card holding the proposal (there can be several cards in one
 * conversation, so a screen-level key would let one card's create dedupe against another's).
 */
export const toCreateRequest = (
  p: DriveProposal,
  idempotencyKey: string,
): CreateDriveRequest => ({
  start: p.startId,
  end: p.endId,
  ...(p.via?.length ? { via: p.via } : {}),
  idempotencyKey,
})

/* -------------------------------------------------------------------------- */
/*  Reconciling the rider's stated duration with the route Google returned      */
/* -------------------------------------------------------------------------- */

/**
 * How far the drive may drift from the duration the rider asked for before the card mentions it.
 *
 * BOTH conditions must hold. The RATIO alone nags on short asks (a 20-minute ask answered by a
 * 26-minute route is a fine answer); the ABSOLUTE alone nags on long ones (15 minutes off a
 * four-hour ask is nothing). Together they fire only when a rider would actually feel misled.
 */
const DRIFT_RATIO = 0.25
const DRIFT_MIN_MINUTES = 15

export interface DurationDrift {
  askedMinutes: number
  actualMinutes: number
  /** `short` = the drive is briefer than they asked for; `long` = it runs over. */
  direction: 'short' | 'long'
}

/**
 * Did the materialized route come back materially different from what the rider asked for?
 *
 * ⚠ WHY THIS EXISTS AT ALL — nothing downstream compares these two numbers. `targetMinutes` is
 * dropped on the way to `/propose` (see `toProposeRequest` above): it steers which ENDPOINTS the
 * model picks and has no other effect, and Google decides the real duration from the route it
 * materializes. That is a sound design, but it leaves a gap the rider sees: when a rider names both
 * the endpoints AND a duration that cannot both be true — "Emerald Bay to Incline Village" and "about
 * two hours" — the skipper agrees to both in prose and the card then prints 54 MIN directly above the
 * CTA. Observed on device 2026-08-03. Nothing was wrong with the number; what was missing was anyone
 * noticing the promise.
 *
 * Returns null when there is nothing to say: no stated target (the rider never named one — the
 * common case), or a drive close enough to the ask that mentioning it would be noise.
 *
 * ⚠ Deliberately ADVISORY and never a block. The drive is legitimate and the rider may well want it;
 * this only stops the screen from silently contradicting the conversation.
 */
export function durationDrift(
  targetMinutes: number | null | undefined,
  durationSeconds: number,
): DurationDrift | null {
  if (targetMinutes == null || !Number.isFinite(targetMinutes) || targetMinutes <= 0) return null
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null

  const actualMinutes = Math.round(durationSeconds / 60)
  const deltaMinutes = Math.abs(actualMinutes - targetMinutes)
  if (deltaMinutes < DRIFT_MIN_MINUTES) return null
  if (deltaMinutes / targetMinutes < DRIFT_RATIO) return null

  return {
    askedMinutes: targetMinutes,
    actualMinutes,
    direction: actualMinutes < targetMinutes ? 'short' : 'long',
  }
}
