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
