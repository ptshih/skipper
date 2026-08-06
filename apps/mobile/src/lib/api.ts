// Typed client for the Skipper API. Responses are validated against the shared Zod
// DTOs (@skipper/shared); auth rides on the Better Auth session cookie, which the Expo
// client stores in secure-store and hands us via authClient.getCookie().
//
// API client: drives are user-OWNED. GET /drives lists the
// caller's saved drives (one card each) and GET /drives/:id replays one (route + ordered
// place-narration clips); POST /drives/propose (cheap, no credit) then POST /drives
// create one. Plus the anonymous read: GET /bootstrap (the cold open's regions + copy).
import {
  driveList,
  driveManifest,
  driveProposal,
  bootstrap,
  versionResponse,
} from '@skipper/shared'
import type {
  CreateDriveRequest,
  DriveList,
  DriveManifest,
  DriveProposal,
  DriveProposeRequest,
  Bootstrap,
  DriveSummary,
  Region,
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
// would hang FOREVER: the load effect's await never settles, leaving an infinite spinner with no
// retry surfaced and no honest "no signal" line. We use an AbortController + timer — the portable RN
// pattern; AbortSignal.timeout()'s Hermes support is uncertain — and keep it armed across BOTH the
// response AND the body read (res.json()), so a body that stalls mid-stream aborts too. A fired
// abort rejects with an AbortError the callers already handle (errorMessage → a retryable error on
// load). 15s: generous enough not to false-abort a slow-but-alive request. ⚠ This used to bound a
// MID-DRIVE call too (the re-sign, whose failure skipped a stop) and no longer does: a drive's audio
// is served from disk, so nothing on this path sits between a rolling rider and a stop. A shorter
// per-call override is a future refinement.
const REQUEST_TIMEOUT_MS = 15_000

// `anonymous: true` deliberately OMITS the session Cookie so an intentionally-anonymous call — the
// ?preview=1 funnel and (in 1.1) the planner — never links a signed-in identity to
// preview activity. Authenticated calls (the rider's own drives) leave it false so the cookie still
// rides.
//
// ⚠ IT HAS NO CALLERS TODAY, and both reasons are worth knowing. The `?preview=1` funnel is gone, and
// the planner is anonymous BY CONSTRUCTION instead — `planTurn` does not import `authClient`, so
// there is no cookie to send and no flag a future caller can forget (see planner.ts). That is the
// stronger pattern: prefer it over this flag for anything genuinely anonymous.
// ⚠ Its ONE historical caller was `getBootstrap`, where it was WRONG and cost the admin staged-region
// preview for two days (see that function). So the rule this leaves behind: the flag is for a call
// carrying something the rider TYPED. A call that merely reads public config is not that, and marking
// one anonymous silently strips every session-derived answer the server would otherwise give — here,
// `isAdmin`. Kept rather than deleted for the same reason as `ignoreOffline` below: it names a real
// distinction. Do not reach for it without re-reading this.
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
  //
  // ⚠ `ignoreOffline` HAS NO CALLER TODAY and is kept deliberately — it is a recorded decision
  // (docs/decisions/offline-connectivity-and-roam-pack.md), not a leftover. Its one caller was the
  // drive re-sign, deleted when a drive's audio became disk-only; the escape hatch it names (a call
  // whose seconds of waiting are the FEATURE, because the caller's fallback is worse than the wait)
  // outlives it. Do not delete it as dead code without re-opening that record.
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
    // ⚠ AbortSignal.any — NOT `signal: controller.signal` written after the `...init` spread. That is
    // how this line read until 2026-08-01, and it silently DROPPED a caller-supplied `init.signal`
    // (in an object literal the later key wins), so a screen that unmounted mid-request could never
    // cancel it. Latent then (no call site passed one); on the 1.1 planner path it would mean a rider
    // who backgrounds the app bills a model call to completion with nobody left to read it.
    // ⚠ And do NOT "tidy" it the other way either — moving `signal` ABOVE the spread lets a caller
    // clobber the internal dead-zone TIMEOUT, which is the guard this whole file exists for (see
    // REQUEST_TIMEOUT_MS above). Both signals have to survive; that is what `any` is for.
    // AbortSignal.any is a WinterCG global here — expo installs it when the engine lacks it
    // (expo/src/winter/AbortSignal.ts, wired from winter/runtime.native.ts).
    const callerSignal = init?.signal ?? undefined
    const signal = callerSignal
      ? AbortSignal.any([callerSignal, controller.signal])
      : controller.signal
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        // Spread AFTER the caller's headers so neither of ours can be clobbered by a call site.
        ...(cookie ? { Cookie: cookie } : {}),
      },
      // The session cookie is set manually above; 'include' would interfere on RN.
      credentials: 'omit',
      signal,
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
 *  dump or the in-voice fallback.
 *
 *  Exported for `planner.ts`, which does NOT go through `fetchJson` (it reads an SSE stream) but must
 *  validate its terminal frame against the same DTOs and surface drift the same way. `isZodError`
 *  stays private — the duck-type is an implementation detail of this one guard. */
export function parseDto<T>(schema: { parse: (data: unknown) => T }, data: unknown): T {
  try {
    return schema.parse(data)
  } catch (e) {
    if (isZodError(e)) throw new ContractError()
    throw e
  }
}

/* ⚠ `getSample` (GET /sample) WAS DELETED HERE (2026-08-05) with the screen that was its only
 * caller. The anonymous taste is now the preview clip that rides `POST /drives/propose` — a real stop
 * from the rider's own planned route. docs/designs/onboarding-gate-reconsidered.md. */

/* -------------------------------------------------------------------------- */
/*  Create-a-Drive — user-owned on-demand A→B drives. ⚠ NOT uniformly gated any   */
/*  more: 1.1 opened plan + propose to anonymous, and the wall is POST /drives    */
/*  ALONE. On the server that is `requireAccount` per-ROUTE, never on the /drives  */
/*  mount — so do not "simplify" this file back to one blanket account rule.      */
/* -------------------------------------------------------------------------- */

/* ⚠ `listRegions` (GET /regions, plain) WAS DELETED HERE (2026-08-05). Its doc said "STILL USED —
 * /sample needs region NAMES and nothing else", and that was its ONLY caller: when the screen went, the
 * function had none. Home has always used `getBootstrap` below, which is the per-device call.
 * ⚠ The distinction it protected is still real and still enforced by that split: `/regions` is memoized
 * and identical for every rider, while the bootstrap answer varies with a per-device launch rotation —
 * folding a per-device answer into a shared cache is how a cache starts serving one rider another
 * rider's screen. If a plain region list is ever needed again, add it back rather than widening
 * `getBootstrap`. */

/**
 * Everything the cold open needs, in one call: the pickable regions, each region's suggestions already
 * composed into finished sentences, and the two lines the app seeds into the transcript with no model
 * call. Anonymous.
 *
 * ⚠ `rotation` is THIS DEVICE's launch counter and the answer varies with it, which is why this is not
 * folded into `/regions` — that list is memoized and identical for every rider, and a per-device answer
 * inside a shared cache is how a cache starts serving one rider another rider's screen.
 *
 * ⚠ THE SENTENCES ARRIVE FINISHED. Nothing here fills a placeholder any more (founder, 2026-08-04):
 * the server chose the words AND the names, so there is no token budget for the two sides to disagree
 * about. The first cut split that job and they disagreed immediately, silently dropping a chip.
 *
 * ⚠ NO BAKED FALLBACK on failure — a default string in the app is exactly what serving this deleted,
 * because it is the copy nobody remembers to update and it fails by looking fine.
 *
 * ⚠ IT SENDS THE SESSION, AND MUST. It carried `anonymous: true` from 2026-08-04 (`5d842738`, which
 * moved the region list here) until 2026-08-06, and that silently broke the admin staged-region
 * preview: `isAdmin` is the SOLE bypass of the release gate, the server can only apply it if the
 * session reaches it, and a cookie-less call is indistinguishable from a rider's. The app showed one
 * region, nothing errored, and no test could see it. The predecessor `listRegions` sent the cookie.
 * ⚠ This does NOT weaken the anonymous-call rule below, because the rule is about content a rider
 * TYPED (the planner) — this request carries none, and the same launch already identifies the rider
 * on `GET /drives`. Do not "restore" the flag here. `apps/api/test/regions-cache.test.ts` (server)
 * and `./api-source.test.ts` (client) pin both halves.
 */
export const getBootstrap = async (rotation: number): Promise<Bootstrap> =>
  parseDto(bootstrap, await fetchJson(`/bootstrap?rotation=${encodeURIComponent(String(rotation))}`))

// ⚠ THERE IS NO `listAnchors` ANY MORE, and re-adding one would be a real exposure, not a
// convenience. GET /drives/anchors dumped a region's entire curated allowlist WITH exact lat/lng —
// the output of a paid `curate-places` run, and the very thing INV-1 keeps server-side. In 1.1 the
// rider never picks an endpoint from a list: the PLANNER resolves endpoints to anchor IDS server-side
// and the client re-sends the route object verbatim. Display-only place NAMES (the example asks, the
// offline card) ride on `region.exampleAnchors` — names, no ids, no coordinates.

/** Phase 1: preview the route for a rider-picked START→END. Cheap, persists nothing, costs no credit
 *  — the confirm-before-spend interstitial, and ANONYMOUS: it is half the open front door (with
 *  `planTurn`), so it does NOT 401 and no caller should branch as though it might. */
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

/** Remove a saved drive from the caller's list. Soft-delete on the server — it does NOT refund a
 *  credit (a credit is spent at generation). 404 if it's already gone or not yours. */
export const deleteDrive = async (driveId: string): Promise<void> => {
  await fetchJson(`/drives/${encodeURIComponent(driveId)}`, { method: 'DELETE' })
}


/** Set a password on an account that has none — the opt-in fallback for a rider who signed up with an
 *  emailed code (Settings → "Set a password").
 *
 *  ⚠ NOT an `authClient` call, and it can't be: better-auth declares `setPassword` `serverOnly`, so it
 *  is unreachable from the client SDK by design. `apps/api/src/password.ts` is the sanctioned wrapper.
 *  ⚠ Goes through `fetchJson`, so it carries the session cookie and surfaces the server's `message`
 *  verbatim through ApiError — which is what lets the 409 ("this account already has a password")
 *  render as itself rather than as the generic failure. */
export const setAccountPassword = async (newPassword: string): Promise<void> => {
  await fetchJson('/account/password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ newPassword }),
  })
}

/** The per-platform app-version policy for the launch-time update gate (see VersionGate). */
export const getVersion = async (): Promise<VersionPolicy[]> =>
  parseDto(versionResponse, await fetchJson('/version')).policies

export type {
  CreateDriveRequest,
  DriveList,
  DriveManifest,
  DriveProposal,
  DriveProposeRequest,
  DriveSummary,
  Region,
  VersionPolicy,
}
