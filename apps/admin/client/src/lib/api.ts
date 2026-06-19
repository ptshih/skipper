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
export type JobKind = 'generate' | 'patch_clip' | 'resynth' | 'resynth_roam_clip' | 'sweep_orphans' | 'discover_pois' | 'enrich_pois' | 'generate_narrations' | 'refetch_facts'
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'

export interface GenJob {
  id: string
  kind: JobKind
  status: JobStatus
  targetSlug: string | null
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

export interface NarrationDetail {
  id: string
  script: string
  url: string
  contentType: string
  audioDurationMs: number
  attribution: unknown
  factsHash: string | null
}

/** Story-eligibility — whether a POI is story-grade narration material (a POI property; roam draws
 *  from it). Mirrors `StoryEligibility` in @skipper/shared (server computes it). */
export type StoryEligibility = 'eligible' | 'filtered-source' | 'filtered-taste' | 'filtered-stub'

/** Narration axis: does a narration exist for this POI, and is it on the POI's current facts. */
export type NarrationStatus = 'none' | 'fresh' | 'stale'

export interface PoiRow {
  id: string
  source: string
  sourceId: string
  name: string
  kind: string | null
  factsHash: string | null
  createdAt: string
  narrationCount: number
  storyEligibility: StoryEligibility
  /** A non-empty curated fact sheet exists (server checks the `fact_sheet` column) — roam grounds on it. */
  enriched: boolean
  /** ENRICHED, but a curated sheet span no longer appears in the current article — the article drifted;
   *  the place needs a re-enrich (`enrich --force`) to pick up the upstream change. */
  sheetDrift: boolean
  narrationStatus: NarrationStatus
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
  createdAt: string
}

/* ------------------------------- client ------------------------------ */

export const api = {
  regions: () => req<{ regions: Region[] }>('/admin/regions'),
  jobs: () => req<{ jobs: GenJob[] }>('/admin/jobs'),
  runs: () => req<{ runs: RunEvent[] }>('/admin/runs'),
  job: (id: string) => req<{ job: GenJob; logsUrl: string | null }>(`/admin/jobs/${id}`),
  cancelJob: (id: string) => req<{ job: GenJob }>(`/admin/jobs/${id}/cancel`, { method: 'POST' }),
  pois: () => req<{ pois: PoiRow[] }>('/admin/pois'),
  poi: (id: string) => req<{ poi: PoiDetail }>(`/admin/pois/${id}`),
  deletePoi: (id: string) => req<{ ok: true; id: string }>(`/admin/pois/${id}`, { method: 'DELETE' }),
  poiNarration: (poiId: string) => req<{ narration: NarrationDetail }>(`/admin/pois/${poiId}/narration`),
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
}
