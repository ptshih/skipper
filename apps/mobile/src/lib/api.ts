// Typed client for the Skipper M2 API. Responses are validated against the shared
// Zod DTOs (@skipper/shared); auth rides on the Better Auth session cookie, which
// the Expo client stores in secure-store and hands us via authClient.getCookie().
import { corridorList, corridorTours, signedAudio, tourDetail } from '@skipper/shared'
import type { CorridorList, CorridorTours, SignedAudio, TourDetail } from '@skipper/shared'
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

export const listCorridors = async (): Promise<CorridorList> =>
  corridorList.parse(await fetchJson('/corridors'))

export const listCorridorTours = async (corridorId: string): Promise<CorridorTours> =>
  corridorTours.parse(await fetchJson(`/corridors/${corridorId}/tours`))

export const getTour = async (tourId: string): Promise<TourDetail> =>
  tourDetail.parse(await fetchJson(`/tours/${tourId}`))

export const signTourAudio = async (tourId: string): Promise<SignedAudio> =>
  signedAudio.parse(await fetchJson(`/tours/${tourId}/assets/sign`, { method: 'POST' }))

export type { CorridorList, CorridorTours, SignedAudio, TourDetail }
