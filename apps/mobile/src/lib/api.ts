// Typed client for the Skipper API. Responses are validated against the shared Zod
// DTOs (@skipper/shared); auth rides on the Better Auth session cookie, which the Expo
// client stores in secure-store and hands us via authClient.getCookie().
//
// A tour is the whole self-contained drive now (corridors merged in): GET /tours lists
// the catalog (one card per drive) and GET /tours/:id returns the drive (route + region
// + host + intro/outro + stops).
import { signedAudio, sourcesResponse, tourDetail, tourList, versionResponse } from '@skipper/shared'
import type { DataSource, SignedAudio, TourDetail, TourList, VersionPolicy } from '@skipper/shared'
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

async function fetchJson(path: string, init?: RequestInit): Promise<unknown> {
  const cookie = authClient.getCookie()
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    // The session cookie is set manually above; 'include' would interfere on RN.
    credentials: 'omit',
  })
  const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
  if (!res.ok) {
    throw new ApiError(res.status, json.error, json.message ?? `Request failed (${res.status})`)
  }
  return json
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

/** The app-wide data-source/license catalog (authoritative; the app bundles only a fallback). */
export const getSources = async (): Promise<DataSource[]> =>
  parseDto(sourcesResponse, await fetchJson('/sources')).sources

/** The per-platform app-version policy for the launch-time update gate (see VersionGate). */
export const getVersion = async (): Promise<VersionPolicy[]> =>
  parseDto(versionResponse, await fetchJson('/version')).policies

export type { DataSource, SignedAudio, TourDetail, TourList, VersionPolicy }
