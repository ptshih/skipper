// Typed client for the Skipper API. Responses are validated against the shared Zod
// DTOs (@skipper/shared); auth rides on the Better Auth session cookie, which the Expo
// client stores in secure-store and hands us via authClient.getCookie().
//
// API client: drives are user-OWNED. GET /drives lists the
// caller's saved drives (one card each) and GET /drives/:id replays one (route + ordered
// place-narration clips); POST /drives/propose (cheap, no credit) then POST /drives
// create one. Plus the anonymous reads: GET /regions, GET /sample.
import {
  driveList,
  driveManifest,
  driveProposal,
  regionAnchorList,
  regionList,
  sample,
  signedDriveAudio,
  sourcesResponse,
  versionResponse,
} from '@skipper/shared'
import type {
  CreateDriveRequest,
  DataSource,
  DriveList,
  DriveManifest,
  DriveProposal,
  DriveProposeRequest,
  DriveSummary,
  Region,
  RegionAnchor,
  Sample,
  SignedDriveAudio,
  VersionPolicy,
} from '@skipper/shared'
import { API_URL, authClient } from './auth'
import { noteNetworkReachable, shouldSkipRequest } from './connectivity'
import { voice } from '@/ui/voice'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
  /** 401 from a gated route = a free account is required (e.g. a gated /drives* route). */
  get needsAccount(): boolean {
    return this.status === 401
  }
}

/** Thrown when a response is HTTP-OK but doesn't match the DTO this app was built against —
 *  the wire contract drifted and this (likely outdated) client can't read it. Surfaced as
 *  "please update" instead of the in-voice fallback, so a contract break reads as an
 *  app-version problem rather than a mysterious failure. The hard update WALL stays driven
 *  by the server /version floor (see VersionGate); this just makes the inline message honest. */
export class ContractError extends Error {
  constructor() {
    super('Please update Skipper to the latest version.')
    this.name = 'ContractError'
  }
}

/** Thrown INSTEAD of attempting a request the device has no network to carry. Distinct from a
 *  request that failed: this one never left the phone, so the rider is told the honest thing
 *  ("no signal") rather than the generic in-voice fallback that also covers a 500, a parse blip
 *  and a GPS timeout — and, critically, they aren't handed a retry button that cannot work.
 *  Carries no message of its own; `errorMessage` supplies the rider-facing line from `voice`,
 *  which is where every persona string lives. */
export class OfflineError extends Error {
  constructor() {
    super('offline')
    this.name = 'OfflineError'
  }
}

/** A user-safe error string: server-authored ApiError messages and the ContractError
 *  "update" message are shown as-is, an OfflineError becomes the in-voice "no signal" line, and
 *  everything else (a raw RN `TypeError: Network request failed`, a multi-line ZodError dump)
 *  collapses to the `fallback`. Use at every fetch surface so plumbing never reaches the rider. */
export const errorMessage = (e: unknown, fallback: string): string =>
  e instanceof OfflineError
    ? voice.offline.noSignal
    : e instanceof ContractError || e instanceof ApiError
      ? e.message
      : fallback

// Time-box every request. RN's fetch has NO default timeout, so a half-open connection in a
// cellular dead zone (the core Tahoe-drive concern — CLAUDE.md "Offline-first… Tahoe dead zones")
// would hang FOREVER: the load effect's await never settles (an infinite spinner, no retry
// surfaced), and a mid-drive re-sign never rejects, so the skip-the-stop fallback in useDrive that
// keeps the drive moving never runs. We use an AbortController + timer — the portable RN pattern;
// AbortSignal.timeout()'s Hermes support is uncertain — and keep it armed across BOTH the response
// AND the body read (res.json()), so a body that stalls mid-stream aborts too. A fired abort
// rejects with an AbortError the callers already handle (errorMessage → retryable error on load;
// resign's catch → skip-the-stop). 15s: generous enough not to false-abort a slow-but-alive
// request; the in-drive path inherits it (worst case ~CLIP_STALL_MS + this before a dead-zone stop
// skips — BOUNDED, vs the infinite hang today). A shorter per-call override is a future refinement.
const REQUEST_TIMEOUT_MS = 15_000

// `anonymous: true` deliberately OMITS the session Cookie so an intentionally-anonymous call — the
// ?preview=1 funnel, GET /sample, and (in 1.1) the planner — never links a signed-in identity to
// preview activity. Authenticated calls (drive/offline sign without preview) leave it false so the
// cookie still rides.
//
// ⚠ THE RULE THAT OUTLIVED THE HEADER IT WAS WRITTEN FOR: a client-identity header used to ride every
// call, including anonymous ones, and that was defensible only because it carried a version and a
// capability list — nothing identifying a device or an install. It is gone with the capability channel
// (its one token was `area`). Do not add a per-install identifier here to replace it: it would quietly
// undo the separation the anonymous flag exists to create, and make the App Privacy label wrong.
async function fetchJson(
  path: string,
  init?: RequestInit,
  opts?: { anonymous?: boolean; ignoreOffline?: boolean },
): Promise<unknown> {
  // Pre-flight: with NO network, don't spend the 15 s timeout discovering it. Every dead-zone
  // fallback in the app (the home drive list, the drive detail) is triggered by a
  // FAILED fetch, so short-circuiting here is what turns each of them from "~15 s of skeletons,
  // then the saved copy" into an instant disk read — without any of them changing shape. The
  // verdict is push-based, fails OPEN, and self-heals via a probe (see connectivity.ts), so an
  // unknown — or merely stale — state still tries.
  if (!opts?.ignoreOffline && shouldSkipRequest()) throw new OfflineError()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    // Read the cookie INSIDE the try: a SecureStore/keychain read can throw, and we want that to
    // degrade to an anonymous request handled by the normal error path — not escape raw past the
    // abort timer and error envelope. Anonymous calls skip the read entirely.
    let cookie = ''
    if (!opts?.anonymous) {
      try {
        cookie = authClient.getCookie()
      } catch {
        cookie = ''
      }
    }
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        // Spread AFTER the caller's headers so neither of ours can be clobbered by a call site.
        ...(cookie ? { Cookie: cookie } : {}),
      },
      // The session cookie is set manually above; 'include' would interfere on RN.
      credentials: 'omit',
      signal: controller.signal,
    })
    // A response of ANY status proves the device reached the network. If the pushed verdict said
    // otherwise, it was stale or the event stream is dead — correct it now rather than let one bad
    // verdict short-circuit the app for the rest of the process. (connectivity.ts)
    noteNetworkReachable()
    const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
    if (!res.ok) {
      throw new ApiError(res.status, json.error, json.message ?? `Request failed (${res.status})`)
    }
    return json
  } finally {
    clearTimeout(timer)
  }
}

// Detect a Zod validation failure without importing `zod` into the app bundle (it isn't a
// direct mobile dep — it rides in via @skipper/shared). Duck-type on `.issues` being an array
// (ZodError's defining shape) rather than `name === 'ZodError'`, which a transform/minify/rename
// could break.
const isZodError = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && Array.isArray((e as { issues?: unknown }).issues)

/** Validate a response against its DTO. A schema mismatch — additive-only contract drift an
 *  old client can't read — becomes a ContractError ("please update"), never a raw ZodError
 *  dump or the in-voice fallback. */
function parseDto<T>(schema: { parse: (data: unknown) => T }, data: unknown): T {
  try {
    return schema.parse(data)
  } catch (e) {
    if (isZodError(e)) throw new ContractError()
    throw e
  }
}

/** GET /sample — the one curated "taste" clip for a rider outside any coverage. Anonymous (no
 *  account, no location). Throws on a non-2xx (incl. the soft 404 when no sample is configured) — the
 *  /sample screen catches it and shows a reachable retry. */
export const getSample = async (): Promise<Sample> =>
  parseDto(sample, await fetchJson('/sample', undefined, { anonymous: true }))

/* -------------------------------------------------------------------------- */
/*  Create-a-Drive — user-owned on-demand A→B drives. Account-gated today, so     */
/*  every call sends the session cookie. ⚠ 1.1 opens plan/propose to anonymous.   */
/* -------------------------------------------------------------------------- */

/** The pickable regions for the Create-a-Drive region selector (anonymous; just id/slug/name). */
export const listRegions = async (): Promise<Region[]> =>
  parseDto(regionList, await fetchJson('/regions')).regions

/** A region's pickable START/END anchors (real, narratable places with exact coords). The create
 *  form's FROM/TO pickers choose from these, so endpoints are grounded — no free text, no geocode. */
export const listAnchors = async (regionId: string): Promise<RegionAnchor[]> =>
  parseDto(regionAnchorList, await fetchJson(`/drives/anchors?regionId=${encodeURIComponent(regionId)}`)).anchors

/** Phase 1: preview the route for a rider-picked START→END. Cheap, persists nothing, costs no credit
 *  — the confirm-before-spend interstitial. 401 ⇒ needs an account. */
export const proposeDrive = async (req: DriveProposeRequest): Promise<DriveProposal> =>
  parseDto(
    driveProposal,
    await fetchJson('/drives/propose', { method: 'POST', body: JSON.stringify(req) }),
  )

/** Phase 2: generate + persist the confirmed drive (consumes a credit; enforces the free-tier cap).
 *  A 403 `drive_limit_reached` means the free cap is hit (carry `cap` in the ApiError message). */
export const createDrive = async (req: CreateDriveRequest): Promise<DriveManifest> =>
  parseDto(driveManifest, await fetchJson('/drives', { method: 'POST', body: JSON.stringify(req) }))

/** The caller's saved drives (one card each; newest first). */
export const listDrives = async (): Promise<DriveList> =>
  parseDto(driveList, await fetchJson('/drives'))

/** Replay a saved drive: frozen structure + LIVE narration content + freshly presigned clips. */
export const getDrive = async (driveId: string): Promise<DriveManifest> =>
  parseDto(driveManifest, await fetchJson(`/drives/${encodeURIComponent(driveId)}`))

/** Re-presign a saved drive's clips (offline refresh), keyed by seq.
 *
 *  ⚠ The ONLY call that opts OUT of the offline pre-flight, and deliberately. This runs from
 *  useDrive's mid-drive stall watchdog, where a FAILED re-sign skips the stop immediately — and the
 *  skip is guarded on `!sawFresh`, so the seconds this call spends waiting are a real second chance
 *  for a slow-but-alive clip to start and save the stop. Short-circuiting it instantly would delete
 *  that window in exactly the marginal coverage it exists for, and silently drop stops. Here the
 *  request timeout is the FEATURE, not the cost. */
export const signDriveAudio = async (driveId: string): Promise<SignedDriveAudio> =>
  parseDto(
    signedDriveAudio,
    await fetchJson(`/drives/${encodeURIComponent(driveId)}/assets/sign`, { method: 'POST' }, {
      ignoreOffline: true,
    }),
  )

/** Remove a saved drive from the caller's list. Soft-delete on the server — it does NOT refund a
 *  credit (a credit is spent at generation). 404 if it's already gone or not yours. */
export const deleteDrive = async (driveId: string): Promise<void> => {
  await fetchJson(`/drives/${encodeURIComponent(driveId)}`, { method: 'DELETE' })
}

/** The app-wide data-source/license catalog (authoritative; the app bundles only a fallback). */
export const getSources = async (): Promise<DataSource[]> =>
  parseDto(sourcesResponse, await fetchJson('/sources')).sources

/** The per-platform app-version policy for the launch-time update gate (see VersionGate). */
export const getVersion = async (): Promise<VersionPolicy[]> =>
  parseDto(versionResponse, await fetchJson('/version')).policies

export type {
  CreateDriveRequest,
  DataSource,
  DriveList,
  DriveManifest,
  DriveProposal,
  DriveProposeRequest,
  DriveSummary,
  Region,
  RegionAnchor,
  SignedDriveAudio,
  VersionPolicy,
}
