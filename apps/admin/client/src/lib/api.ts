// Typed fetch client for the admin-api. Same-origin in prod (behind IAP), proxied in dev.

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message)
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const text = await res.text()
  const json = text ? JSON.parse(text) : {}
  if (!res.ok) {
    throw new ApiError(res.status, json?.message ?? json?.error ?? res.statusText, json?.error)
  }
  return json as T
}

/* ------------------------------- types ------------------------------- */

export type JobKind = 'generate' | 'patch_clip' | 'resynth' | 'sweep_orphans' | 'sweep_roam_pois' | 'generate_roam'
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'

export interface GenJob {
  id: string
  kind: JobKind
  status: JobStatus
  targetSlug: string | null
  tourId: string | null
  targetId: string | null
  args: string[]
  dryRun: boolean
  phase: string | null
  costUsd: number | null
  triggeredBy: string
  error: string | null
  cloudRunExecution: string | null
  startedAt: string | null
  endedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface Region {
  slug: string
  displayName: string
}

export interface TourCard {
  id: string
  slug: string
  headline: string
  regionSlug: string
  regionName: string
  status: 'draft' | 'generating' | 'ready' | 'failed'
  distanceMeters: number | null
  durationSeconds: number | null
  stops: number
  brackets: number
  authored: 'admin' | 'seed'
  createdAt: string
  updatedAt: string
}

export interface EvalScore {
  seq: number
  stopType: string | null
  dimension: string
  source: string
  pass: boolean
  value: number
  findings: string[]
}

export interface TourEval {
  id: string
  pass: boolean
  dryRun: boolean
  grounding: number | null
  tts: number | null
  diversity: number | null
  charm: number | null
  veracity: number | null
  narrationModel: string | null
  createdAt: string
  scores: EvalScore[]
}

export interface TourStopDetail {
  seq: number
  stopType: 'story' | 'scenic' | 'break'
  name: string
  poiSource: string
  poiSourceId: string
  script: string | null
  audioDurationMs: number | null
  attribution: unknown
  factsHash: string | null
  triggerLat: number | null
  triggerLng: number | null
  triggerRadiusM: number | null
  revisedAt: string
  hasAudio: boolean
}

export interface TourBracketDetail {
  kind: 'intro' | 'outro'
  script: string | null
  audioDurationMs: number | null
  revisedAt: string
  hasAudio: boolean
}

export interface TourDetail {
  tour: {
    id: string
    slug: string
    headline: string
    status: string
    summary: string | null
    distanceMeters: number | null
    durationSeconds: number | null
    startAnchor: { name: string; lat: number; lng: number }
    endAnchor: { name: string; lat: number; lng: number }
    polyline: [number, number][]
    routeProvenance: unknown
  }
  region: { slug: string; displayName: string } | null
  stops: TourStopDetail[]
  brackets: TourBracketDetail[]
  eval: TourEval | null
}

export interface SignedClip {
  seq: number
  url: string
  contentType: string
  durationMs: number | null
}
export interface SignResult {
  stops: SignedClip[]
  intro: { url: string; contentType: string; durationMs: number | null } | null
  outro: { url: string; contentType: string; durationMs: number | null } | null
}

export interface EvalRunSummary {
  id: string
  kind: string
  dryRun: boolean
  pass: boolean
  grounding: number | null
  tts: number | null
  diversity: number | null
  charm: number | null
  veracity: number | null
  narrationModel: string | null
  gitSha: string | null
  createdAt: string
}

// A unified Runs-timeline row: either an operational gen_job or a historical eval_run.
export interface RunEvent {
  source: 'job' | 'eval'
  id: string
  kind: string
  slug: string | null
  status: JobStatus | null
  pass: boolean | null
  dryRun: boolean
  phase: string | null
  costUsd: number | null
  grounding: number | null
  narrationModel: string | null
  gitSha: string | null
  triggeredBy: string | null
  tourId: string | null
  createdAt: string
}

export interface ProposedWaypoint {
  label: string
  rationale?: string
  lat: number | null
  lng: number | null
  geocoded: boolean
}
export interface Proposal {
  model: string
  prompt: Record<string, unknown>
  regionSlug: string
  regionName: string | null
  headline: string
  summary: string
  startAnchorName: string
  endAnchorName: string
  waypoints: ProposedWaypoint[]
}

/* ------------------------------- client ------------------------------ */

export const api = {
  regions: () => req<{ regions: Region[] }>('/admin/regions'),
  tours: () => req<{ tours: TourCard[] }>('/admin/tours'),
  tour: (id: string) => req<TourDetail>(`/admin/tours/${id}`),
  sign: (id: string) => req<SignResult>(`/admin/tours/${id}/sign`),
  evals: (slug: string) => req<{ slug: string; runs: EvalRunSummary[] }>(`/admin/evals?slug=${encodeURIComponent(slug)}`),
  jobs: () => req<{ jobs: GenJob[] }>('/admin/jobs'),
  runs: () => req<{ runs: RunEvent[] }>('/admin/runs'),
  job: (id: string) => req<{ job: GenJob }>(`/admin/jobs/${id}`),
  createJob: (body: Record<string, unknown>) =>
    req<{ job: GenJob }>('/admin/jobs', { method: 'POST', body: JSON.stringify(body) }),
  propose: (body: Record<string, unknown>) =>
    req<{ proposal: Proposal }>('/admin/tours/propose', { method: 'POST', body: JSON.stringify(body) }),
  createTour: (body: Record<string, unknown>) =>
    req<{ tour: { id: string; slug: string } }>('/admin/tours', { method: 'POST', body: JSON.stringify(body) }),
}
