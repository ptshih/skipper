// Typed client for the Skipper API. Responses are validated against the shared Zod
// DTOs (@skipper/shared); auth rides on the Better Auth session cookie, which the Expo
// client stores in secure-store and hands us via authClient.getCookie().
//
// A tour is the whole self-contained drive now (corridors merged in): GET /tours lists
// the catalog (one card per drive) and GET /tours/:id returns the drive (route + region
// + host + intro/outro + stops).
import {
  roamManifest,
  signedAudio,
  sourcesResponse,
  tourDetail,
  tourList,
  versionResponse,
} from '@skipper/shared'
import type {
  DataSource,
  RoamManifest,
  SignedAudio,
  TourDetail,
  TourList,
  VersionPolicy,
} from '@skipper/shared'
import { API_URL, authClient } from './auth'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
  /** 401 from a gated route = a free account is required (e.g. non-preview tour). */
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

/** A user-safe error string: server-authored ApiError messages and the ContractError
 *  "update" message are shown as-is; everything else (a raw RN `TypeError: Network request
 *  failed`, a multi-line ZodError dump) collapses to the `fallback`. Use at every fetch
 *  surface so plumbing never reaches the rider. */
export const errorMessage = (e: unknown, fallback: string): string =>
  e instanceof ContractError || e instanceof ApiError ? e.message : fallback

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

async function fetchJson(path: string, init?: RequestInit): Promise<unknown> {
  const cookie = authClient.getCookie()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      // The session cookie is set manually above; 'include' would interfere on RN.
      credentials: 'omit',
      signal: controller.signal,
    })
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
// direct mobile dep — it rides in via @skipper/shared). ZodError sets `name === 'ZodError'`.
const isZodError = (e: unknown): boolean => e instanceof Error && e.name === 'ZodError'

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

/** The catalog — one card per ready drive (no polyline). */
export const listTours = async (): Promise<TourList> =>
  parseDto(tourList, await fetchJson('/tours'))

// `preview: true` adds `?preview=1` — the OPEN funnel path (any ready tour, no account).
// Omit it for the live drive + offline download, which stay walled behind a free account.
const previewQuery = (opts?: { preview?: boolean }) => (opts?.preview ? '?preview=1' : '')

export const getTour = async (tourId: string, opts?: { preview?: boolean }): Promise<TourDetail> =>
  parseDto(tourDetail, await fetchJson(`/tours/${tourId}${previewQuery(opts)}`))

export const signTourAudio = async (
  tourId: string,
  opts?: { preview?: boolean },
): Promise<SignedAudio> =>
  parseDto(
    signedAudio,
    await fetchJson(`/tours/${tourId}/assets/sign${previewQuery(opts)}`, { method: 'POST' }),
  )

/** FREE-ROAM (alpha): every roam-narratable place near a point, with presigned clip URLs.
 *  Open like the preview (no account) — the alpha is a founder TestFlight toy. */
export const getRoamManifest = async (
  lat: number,
  lng: number,
  radiusKm = 50,
): Promise<RoamManifest> =>
  parseDto(roamManifest, await fetchJson(`/roam?lat=${lat}&lng=${lng}&radiusKm=${radiusKm}`))

/** The app-wide data-source/license catalog (authoritative; the app bundles only a fallback). */
export const getSources = async (): Promise<DataSource[]> =>
  parseDto(sourcesResponse, await fetchJson('/sources')).sources

/** The per-platform app-version policy for the launch-time update gate (see VersionGate). */
export const getVersion = async (): Promise<VersionPolicy[]> =>
  parseDto(versionResponse, await fetchJson('/version')).policies

export type { DataSource, RoamManifest, SignedAudio, TourDetail, TourList, VersionPolicy }
