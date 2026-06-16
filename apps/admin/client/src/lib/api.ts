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

// Mirrors the `jobKind` enum in @skipper/shared (the server validates against it; this is the UX-typing
// view, like StoryEligibility). Keep in sync if a kind is added/renamed there.
export type JobKind = 'generate' | 'patch_clip' | 'resynth' | 'resynth_roam_clip' | 'sweep_orphans' | 'sweep_region_pois' | 'enrich_region' | 'generate_roam' | 'refetch_facts'
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
  outputLog: string | null
  outputSummary: string | null
  outputData: Record<string, unknown> | null
  startedAt: string | null
  endedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface Region {
  slug: string
  displayName: string
  discoveryBbox: string | null
}

export interface BboxLlmResult {
  bbox: string
  reasoning: string
  confidence: 'high' | 'medium' | 'low'
}
export interface BboxOsmResult {
  name: string
  type: string
  bbox: string
}
export interface BboxLookupResult {
  llm: BboxLlmResult | null
  llmError: string | null
  osm: BboxOsmResult[] | null
  osmError: string | null
}

export interface PoiDetail {
  id: string
  source: string
  sourceId: string
  name: string
  kind: string | null
  lat: number
  lng: number
  summary: string | null
  facts: Record<string, unknown> | null
  factsHash: string | null
  factsFetchedAt: string | null
  createdAt: string
  updatedAt: string
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

/** The charm judge's detail payload — the funniest line + the flattest bit (the tuning gold). */
export interface CharmDetail {
  best?: string
  sag?: string
  charm?: number
}

export interface EvalScore {
  seq: number
  stopType: string | null
  dimension: string
  source: string
  pass: boolean
  value: number
  findings: string[]
  // Dimension-specific: charm = {best,sag}, grounding/veracity = claim verdicts, etc. Nullable.
  detail?: unknown
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
  /** The variant-0 track id — the target for per-stop patch / re-voice ops. */
  trackId: string
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

// A ready tour violating the audio/attribution invariant (§14.9 integrity audit).
export interface IntegrityTour {
  id: string
  slug: string
  headline: string
  silentStops: number[]
  silentBrackets: string[]
  unattributed: number[]
}
export interface IntegrityReport {
  checked: number
  tours: IntegrityTour[]
}

export interface RoamClipDetail {
  id: string
  script: string
  url: string
  contentType: string
  audioDurationMs: number
  attribution: unknown
  factsHash: string | null
}

/** Story-eligibility — whether a POI is story-grade narration material (a POI property; tours AND roam
 *  both draw from it). Mirrors `StoryEligibility` in @skipper/shared (server computes it). */
export type StoryEligibility = 'eligible' | 'filtered-source' | 'filtered-taste' | 'filtered-stub'

/** Roam-specific axis: does a roam clip exist for this POI, and is it on the POI's current facts. */
export type RoamClipStatus = 'none' | 'fresh' | 'stale'

export interface PoiRow {
  id: string
  source: string
  sourceId: string
  name: string
  kind: string | null
  factsHash: string | null
  createdAt: string
  tourCount: number
  roamClipCount: number
  storyEligibility: StoryEligibility
  /** A non-empty curated fact well exists (server checks `facts.well`) — tours & roam ground on it. */
  enriched: boolean
  roamClip: RoamClipStatus
  staleFacts: boolean
  attributed: boolean
  suspiciousDuration: boolean
  regionSlug: string | null
  regionName: string | null
}

// One fact-edit override row on a POI (a literal find→replace on the fetched extract).
export interface CorrectionOverride {
  find: string | null
  replace: string | null
  reason: string
  sourceUrl: string | null
  active: boolean
  upstreamStatus: string
  updatedAt: string
}
// A POI's curation surface: its fact-edit overrides + speakable anchor.
export interface PoiCorrections {
  overrides: CorrectionOverride[]
  speakable: { lat: number; lng: number } | null
}
// The discriminated POST body for /admin/pois/:id/corrections.
export type CorrectionBody =
  | { kind: 'fact_edit'; find: string; replace: string; reason: string; sourceUrl?: string }
  | { kind: 'retire'; find: string }
  | { kind: 'speakable'; lat: number; lng: number }
  | { kind: 'speakable'; lat: null }

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
  job: (id: string) => req<{ job: GenJob; logsUrl: string | null }>(`/admin/jobs/${id}`),
  cancelJob: (id: string) => req<{ job: GenJob }>(`/admin/jobs/${id}/cancel`, { method: 'POST' }),
  integrity: () => req<IntegrityReport>('/admin/integrity'),
  pois: () => req<{ pois: PoiRow[] }>('/admin/pois'),
  poi: (id: string) => req<{ poi: PoiDetail }>(`/admin/pois/${id}`),
  deletePoi: (id: string) => req<{ ok: true; id: string }>(`/admin/pois/${id}`, { method: 'DELETE' }),
  roamSign: (poiId: string) => req<{ clip: RoamClipDetail }>(`/admin/roam/sign/${poiId}`),
  poiCorrections: (id: string) => req<PoiCorrections>(`/admin/pois/${id}/corrections`),
  saveCorrection: (id: string, body: CorrectionBody) =>
    req<PoiCorrections>(`/admin/pois/${id}/corrections`, { method: 'POST', body: JSON.stringify(body) }),
  createRegion: (body: { slug: string; displayName: string; discoveryBbox?: string | null }) =>
    req<{ region: Region }>('/admin/regions', { method: 'POST', body: JSON.stringify(body) }),
  updateRegion: (slug: string, body: { displayName?: string; discoveryBbox?: string | null }) =>
    req<{ region: Region }>(`/admin/regions/${slug}`, { method: 'PATCH', body: JSON.stringify(body) }),
  bboxLookup: (query: string) =>
    req<BboxLookupResult>('/admin/regions/bbox-lookup', { method: 'POST', body: JSON.stringify({ query }) }),
  createJob: (body: Record<string, unknown>) =>
    req<{ job: GenJob }>('/admin/jobs', { method: 'POST', body: JSON.stringify(body) }),
  propose: (body: Record<string, unknown>) =>
    req<{ proposal: Proposal }>('/admin/tours/propose', { method: 'POST', body: JSON.stringify(body) }),
  createTour: (body: Record<string, unknown>) =>
    req<{ tour: { id: string; slug: string } }>('/admin/tours', { method: 'POST', body: JSON.stringify(body) }),
}
