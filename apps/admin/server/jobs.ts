// Triggering + reconciling the skipper-studio Cloud Run Job from the admin-api.
//
// The admin-api mints a studio_jobs row, then calls run.googleapis.com `jobs:run` with the
// per-execution override args (the spec §5 contract) + STUDIO_JOB_ID in env, so the Job's
// job-progress hook updates that exact row. The caller SA needs roles/run.developer on the
// job (runWithOverrides + executions.get) — see spec §10. Auth is an OAuth access token off
// the metadata server (ADC, cloud-platform scope), the same mechanism TTS uses.

import { GoogleAuth } from 'google-auth-library'
import { isAbsolute, resolve } from 'node:path'
import type { JobKind } from '@skipper/shared'

const REGION = process.env.STUDIO_JOB_REGION ?? 'us-east4'
const JOB = process.env.STUDIO_JOB_NAME ?? 'skipper-studio'
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform'

// GOOGLE_APPLICATION_CREDENTIALS in .env.development is a key path RELATIVE to the repo root
// (`./keys/…`). The admin dev:server runs from apps/admin (bun `--filter` sets CWD to the
// package dir), so a relative path resolves to apps/admin/keys/… → ENOENT → no creds → the admin
// "can't dispatch Cloud Run jobs" locally. Pin it to an absolute path off the repo root (this
// file is apps/admin/server/jobs.ts → ../../.. is the root). Unset in prod (Cloud Run uses the
// metadata-server runtime SA) → undefined → GoogleAuth's default ADC.
function keyFilename(): string | undefined {
  const gac = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (!gac) return undefined
  return isAbsolute(gac) ? gac : resolve(import.meta.dir, '..', '..', '..', gac)
}

let auth: GoogleAuth | undefined
async function accessToken(): Promise<string> {
  auth ??= new GoogleAuth({ scopes: SCOPE, keyFilename: keyFilename() })
  const t = await auth.getAccessToken()
  if (!t) throw new Error('Could not obtain a Google access token (ADC / runtime service account).')
  return t
}

function jobBase(): string {
  const project = process.env.GOOGLE_CLOUD_PROJECT
  if (!project) throw new Error('GOOGLE_CLOUD_PROJECT is not set.')
  return `https://run.googleapis.com/v2/projects/${project}/locations/${REGION}/jobs/${JOB}`
}

/** A small typed 400/422 for request-shape problems, surfaced cleanly by the route. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

// The gen-job entrypoints, keyed by kind. ADDING A KIND? Its script MUST run its body through
// beginJob()/finishJob() (packages/studio/src/pipeline/job-progress.ts) — that is HOW a run
// records status AND captures its own stdout into outputLog/outputSummary/outputData on the row.
// A script that skips the hook records no status and shows NO logs in the console (the admin no
// longer reads Cloud Logging). Follow generate-narrations.ts's main()+begin/finish shape. Enforced by
// jobs.test.ts.
//
// V2: authored-tour generation is deferred — the generate / patch_clip / resynth scripts were
// removed with the tour pipeline. Those `jobKind` enum members survive in @skipper/shared (the
// wire contract evolves additively — installed clients still know the vocabulary) but have NO
// dispatchable script here, so buildJobArgs rejects them with "unknown kind". Hence a PARTIAL
// record (only the live corpus ops); the test only checks the scripts that remain.
export const SCRIPTS: Partial<Record<JobKind, string>> = {
  resynth_narration: 'packages/studio/src/resynth-narration.ts',
  sweep_orphans: 'packages/studio/src/sweep-orphans.ts',
  discover_pois: 'packages/studio/src/discover-pois.ts',
  enrich_pois: 'packages/studio/src/enrich-pois.ts',
  generate_narrations: 'packages/studio/src/generate-narrations.ts',
  generate_cluster_narrations: 'packages/studio/src/generate-cluster-narrations.ts',
  curate_places: 'packages/studio/src/curate-places.ts',
  refetch_facts: 'packages/studio/src/refetch-poi.ts',
  offline_audit: 'packages/studio/src/audit-corpus.ts',
}

export type { JobKind }

export interface BuildResult {
  args: string[]
  dryRun: boolean
  /** Does this run spend money or delete bytes → a typed confirm is required (spec §8). */
  spends: boolean
  targetSlug?: string
  targetId?: string
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

// = studio's DEFAULT_REGION_SLUG (packages/studio/src/config.ts). buildJobArgs sets each region run's
// targetSlug+targetId to MATCH the studio script's beginJob (per-region), so the in-flight lock + the
// studio_jobs_active_target_uq unique index scope per-region — two regions run concurrently, and an
// admin- vs CLI-triggered run of the same target agree. A whole-corpus explicit-id run leaves both NULL
// (no fake-region sentinel); the both-null path in POST /admin/jobs over-blocks the kind, which errs
// safe (it can't double-trigger a paid run). (audit #9 / #1)
const DEFAULT_REGION_SLUG = 'lake-tahoe'

/** Append a `--flag=N` only when the body carries a POSITIVE-number value; REJECT a present-but-invalid
 *  one (NaN / negative / non-numeric). The server is the trust boundary (the SPA isn't): without this a
 *  `maxCostUsd:"abc"` would emit `--max-cost=NaN`, which the CLI's maxCostFlag reads as Infinity →
 *  silently NO cost cap on a paid run. A falsy value (absent / 0) stays a no-op, as before. (audit #7) */
function pushPosNum(args: string[], flag: string, value: unknown, name: string): void {
  if (!value) return
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) throw new HttpError(400, `${name} must be a positive number`)
  args.push(`${flag}=${n}`)
}

/** Ceiling on a single id list. The console now always dispatches an explicit id list rather than a
 *  server-resolvable filter (apps/admin/client/src/views/pois/types.ts explains why), so this arg
 *  grows with the corpus: ~37 bytes per uuid.
 *
 *  ⚠ The real ceiling is UNDOCUMENTED. Cloud Run publishes only "Maximum number of command arguments
 *  for each container: 1000 per job or per service" (cloud.google.com/run/quotas) — a COUNT, which
 *  this never approaches because every id rides inside ONE `--include-ids=` argument. Neither a
 *  per-argument byte limit nor a RunJob request-size limit is published, and below them sits the
 *  kernel's own ARG_MAX. So rather than discover the cliff during a paid run, bound it here and say
 *  so: 5000 ids is ~185 KB, comfortably under anything plausible and far above today's corpus.
 *  If this ever fires legitimately, the answer is server-side pagination, not a bigger number. */
const MAX_JOB_IDS = 5000

/** Target metadata for a corpus run: what the Jobs page DISPLAYS and what the in-flight lock keys on.
 *
 *  ⚠ Deliberately separate from the SELECTION. `targetSlug`/`targetId` used to be derived from
 *  `body.region`, and set to undefined whenever `includeIds` was present — which was fine while
 *  select-all sent a filter, and became wrong the moment the console started always sending ids
 *  (2026-08-02): every corpus run then rendered as "All" on the Jobs page, i.e. a one-clip regenerate
 *  advertised as a whole-corpus paid generation, and select-all silently stopped taking the per-region
 *  lock it used to hold. Neither field is ever pushed as a CLI flag — narrowing is the ids' job. */
function scopeTarget(body: Record<string, unknown>): { targetSlug?: string; targetId?: string } {
  // The ORIGINAL derivation, kept as the fallback: a run scoped by region (and not by an id list)
  // keys on that region. ⚠ This is not just legacy support — `targetId` must agree with what the
  // studio script's own beginJob writes, so an admin-triggered run and a CLI-triggered run of the
  // same target collide on the in-flight lock instead of both proceeding. Dropping it would have
  // silently unaligned the two (caught by the audit #9/#11 tests, which is what they are for).
  const byRegion = idCsv(body.includeIds, 'includeIds') ? undefined : str(body.region) || DEFAULT_REGION_SLUG
  const label = typeof body.scopeLabel === 'string' && body.scopeLabel.trim() ? body.scopeLabel.trim() : byRegion
  const lock = typeof body.lockRegion === 'string' && body.lockRegion.trim() ? body.lockRegion.trim() : byRegion
  return { targetSlug: label, targetId: lock }
}

/** Comma-join a list of string ids for a `--include-ids=` / `--exclude-ids=` flag. Non-strings are
 *  dropped rather than stringified — an object in that array would otherwise become "[object Object]"
 *  and silently select nothing. */
function idCsv(v: unknown, name: string): string {
  if (!Array.isArray(v)) return ''
  const ids = v.filter((x): x is string => typeof x === 'string')
  if (ids.length > MAX_JOB_IDS) {
    throw new HttpError(400, `${name} has ${ids.length} ids; the per-run ceiling is ${MAX_JOB_IDS}`)
  }
  return ids.join(',')
}

/** Build the per-execution override args from a request body (the spec §5 contract). Value
 *  flags use the `=` form — the parser drops a space-form value that begins with `--`. */
export function buildJobArgs(body: Record<string, unknown>): BuildResult {
  const kind = body.kind as JobKind
  const script = SCRIPTS[kind]
  if (!script) throw new HttpError(400, `unknown kind: ${String(body.kind)}`)

  if (kind === 'resynth_narration') {
    const poiId = str(body.poiId)
    if (!poiId) throw new HttpError(400, 'resynth_narration needs poiId')
    const apply = body.apply === true
    const args = [script, poiId]
    if (apply) args.push('--apply')
    return { args, dryRun: !apply, spends: apply, targetId: poiId }
  }

  if (kind === 'refetch_facts') {
    const poiId = str(body.poiId)
    if (!poiId) throw new HttpError(400, 'refetch_facts needs poiId')
    const apply = body.apply === true
    const args = [script, poiId]
    if (apply) args.push('--apply')
    // Re-fetch is free (MediaWiki only, no LLM/TTS); spends:false so no confirm gate.
    return { args, dryRun: !apply, spends: false, targetId: poiId }
  }

  if (kind === 'discover_pois') {
    const apply = body.apply === true
    const args: string[] = [script]
    if (body.region) args.push(`--region=${str(body.region)}`)
    if (apply) args.push('--apply')
    // sweep is free (WDQS + MediaWiki, no LLM/TTS); spends:false so no confirm gate.
    return { args, dryRun: !apply, spends: false, targetId: str(body.region) || DEFAULT_REGION_SLUG }
  }

  if (kind === 'enrich_pois') {
    const apply = body.apply === true
    const args: string[] = [script]
    // Selection: a FILTER (region/source/query) + exclude-ids, XOR an explicit include-ids list — the CLI
    // resolves it server-side (explicit XOR filter, NOT a union). See the enrich-pois.ts selection block.
    if (body.region) args.push(`--region=${str(body.region)}`)
    if (body.source) args.push(`--source=${str(body.source)}`)
    if (body.query) args.push(`--query=${str(body.query)}`)
    if (idCsv(body.includeIds, 'includeIds')) args.push(`--include-ids=${idCsv(body.includeIds, 'includeIds')}`)
    if (idCsv(body.excludeIds, 'excludeIds')) args.push(`--exclude-ids=${idCsv(body.excludeIds, 'excludeIds')}`)
    pushPosNum(args, '--limit', body.limit, 'limit')
    if (body.force) args.push('--force')
    if (body.model) args.push(`--model=${str(body.model)}`)
    pushPosNum(args, '--max-cost', body.maxCostUsd, 'maxCostUsd')
    if (apply) args.push('--apply')
    // enrich SPENDS (Anthropic) on --apply → confirm gate; the dry run makes no model calls (free).
    // ⚠ targetId stays the CONSTANT 'region-corpus': enrich takes a GLOBAL lock, so only one runs at
    // a time. That is deliberate and unchanged. Only the DISPLAY becomes truthful — it used to
    // render as "whole corpus" even for three hand-picked places.
    return { args, dryRun: !apply, spends: apply, targetSlug: scopeTarget(body).targetSlug, targetId: 'region-corpus' }
  }

  if (kind === 'generate_narrations') {
    const apply = body.apply === true
    const args: string[] = [script]
    // Same selection contract as enrich: a region (default: lake-tahoe) XOR an explicit include-ids list,
    // narrowable by query/exclude-ids. The CLI resolves --region → its discovery bbox server-side.
    if (body.region) args.push(`--region=${str(body.region)}`)
    if (body.query) args.push(`--query=${str(body.query)}`)
    if (idCsv(body.includeIds, 'includeIds')) args.push(`--include-ids=${idCsv(body.includeIds, 'includeIds')}`)
    if (idCsv(body.excludeIds, 'excludeIds')) args.push(`--exclude-ids=${idCsv(body.excludeIds, 'excludeIds')}`)
    pushPosNum(args, '--limit', body.limit, 'limit')
    if (body.force) args.push('--force')
    // --min-extract removed 2026-06-16: story-eligibility is "has a fact sheet" (#1), not a char floor.
    pushPosNum(args, '--max-cost', body.maxCostUsd, 'maxCostUsd')
    if (apply) args.push('--apply')
    // A region run keys both the display slug and the lock on its region; a whole-corpus explicit-id
    // run leaves them undefined → stored NULL (no 'roam-corpus' sentinel), surfaced as "All".
    const genScope = scopeTarget(body)
    return { args, dryRun: !apply, spends: apply, ...genScope }
  }

  if (kind === 'generate_cluster_narrations') {
    const apply = body.apply === true
    const args: string[] = [script]
    // Region-scoped like the solo generator, but `--include-ids` here names CLUSTER ids, not poi ids —
    // a fused telling's subject is a `poi_clusters` row. No --exclude-ids/--force/--model: the CLI
    // doesn't take them, and silently accepting a flag it ignores is worse than not offering it.
    if (body.region) args.push(`--region=${str(body.region)}`)
    if (body.query) args.push(`--query=${str(body.query)}`)
    if (idCsv(body.includeIds, 'includeIds')) args.push(`--include-ids=${idCsv(body.includeIds, 'includeIds')}`)
    pushPosNum(args, '--limit', body.limit, 'limit')
    pushPosNum(args, '--max-cost', body.maxCostUsd, 'maxCostUsd')
    if (apply) args.push('--apply')
    // ⚠ spends: TRUE even on a dry run, unlike every other kind here. This CLI's own header says it:
    // "A preview is NOT free: it narrates and scores, so it costs an apply minus the TTS. Only the
    // persistence is gated." So the confirm gate must fire on Preview too — the operator is about to
    // spend Anthropic money either way, and a gate that only guards `--apply` would wave that through.
    const clusterRegion = idCsv(body.includeIds, 'includeIds') ? undefined : str(body.region) || DEFAULT_REGION_SLUG
    return { args, dryRun: !apply, spends: true, targetSlug: clusterRegion, targetId: clusterRegion }
  }

  if (kind === 'offline_audit') {
    const apply = body.apply === true
    const args: string[] = [script]
    // Same geometry-first selection as generate (region XOR include-ids, narrowable by query/exclude-ids).
    if (body.region) args.push(`--region=${str(body.region)}`)
    if (body.query) args.push(`--query=${str(body.query)}`)
    if (idCsv(body.includeIds, 'includeIds')) args.push(`--include-ids=${idCsv(body.includeIds, 'includeIds')}`)
    if (idCsv(body.excludeIds, 'excludeIds')) args.push(`--exclude-ids=${idCsv(body.excludeIds, 'excludeIds')}`)
    pushPosNum(args, '--limit', body.limit, 'limit')
    pushPosNum(args, '--max-cost', body.maxCostUsd, 'maxCostUsd')
    if (body.charm) args.push('--charm')
    if (body.veracity) args.push('--veracity')
    if (apply) args.push('--apply')
    // Re-score the EXISTING corpus: READ-ONLY on narrations/R2, but --apply runs Opus judges
    // (grounding always; charm/veracity opt-in, veracity also web-searches) → spends → confirm gate.
    // The dry preview makes no model calls (free).
    // Region run keys slug + lock on its region; a whole-corpus explicit-id run leaves them NULL ("All").
    const auditScope = scopeTarget(body)
    return { args, dryRun: !apply, spends: apply, ...auditScope }
  }

  if (kind === 'curate_places') {
    const apply = body.apply === true
    const args: string[] = [script]
    // Region-scoped (geometry-first: --region → its bbox). Optional model/target tweak the LLM draft.
    if (body.region) args.push(`--region=${str(body.region)}`)
    if (body.model) args.push(`--model=${str(body.model)}`)
    pushPosNum(args, '--target', body.target, 'target')
    pushPosNum(args, '--max-cost', body.maxCostUsd, 'maxCostUsd')
    if (apply) args.push('--apply')
    // curate SPENDS (Anthropic draft + Google Places resolve) on --apply → confirm gate; the dry run
    // makes no paid calls (free preview). Keys the lock per-region (matches the studio beginJob target).
    return { args, dryRun: !apply, spends: apply, targetId: str(body.region) || DEFAULT_REGION_SLUG }
  }

  // sweep_orphans — V2 sweeps the whole narration/ R2 prefix (tour-scoped sweeping is gone with the
  // tours table); the script honors only --apply. targetId 'narration' matches its beginJob target.
  const apply = body.apply === true
  const args: string[] = [script]
  if (apply) args.push('--apply')
  return { args, dryRun: !apply, spends: apply, targetId: 'narration' }
}

/** Trigger a skipper-studio execution with per-run arg + env overrides. Returns the execution's
 *  SHORT name (matches the Job's self-reported CLOUD_RUN_EXECUTION), or '' if unparseable. */
/** Cloud Run definitively REFUSED the execution — a non-2xx from jobs:run. Nothing was created, so the
 *  row is safe to settle 'failed' and the target is safe to unlock.
 *
 *  ⚠ Any OTHER throw (DNS, socket reset, a truncated body, a JSON parse error) is ambiguous: the
 *  request may well have created an execution whose response we simply never read. Treating those the
 *  same way marked a live paid run 'failed' with a NULL execution name, which released the in-flight
 *  lock, left nothing for the reconcile to attach to, and told the operator it had not started — so the
 *  obvious retry ran the same paid work a second time, concurrently. */
export class TriggerRejected extends Error {}

export async function runJob(args: string[], env: Record<string, string>): Promise<string> {
  const res = await fetch(`${jobBase()}:run`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      overrides: {
        containerOverrides: [
          { args, env: Object.entries(env).map(([name, value]) => ({ name, value })) },
        ],
      },
    }),
  })
  // Read the body defensively: a non-2xx with an unparseable body is still a definite REFUSAL, and
  // must not be reclassified as "we don't know" just because the error payload was malformed.
  const raw = await res.text().catch(() => '')
  let json: { metadata?: { name?: string }; error?: { message?: string } } = {}
  try {
    json = raw ? JSON.parse(raw) : {}
  } catch {
    if (!res.ok) throw new TriggerRejected(`jobs:run ${res.status}: ${raw.slice(0, 200)}`)
    throw new Error(`jobs:run ${res.status}: unreadable response body`)
  }
  if (!res.ok) {
    throw new TriggerRejected(`jobs:run ${res.status}: ${json.error?.message ?? JSON.stringify(json)}`)
  }
  // The LRO's metadata is the Execution being created; its name is the full resource path.
  return json.metadata?.name?.split('/').pop() ?? ''
}

/** Cancel a running Cloud Run Job execution by its short name (the operator stop path the
 *  schema reserved on studio_job_status='canceled'). 404 is treated as success — the execution
 *  is already gone. Throws on any other API error so the route can surface it. */
export async function cancelExecution(shortName: string): Promise<void> {
  const res = await fetch(`${jobBase()}/executions/${shortName}:cancel`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: '{}',
  })
  if (!res.ok && res.status !== 404) {
    const txt = await res.text().catch(() => '')
    throw new Error(`executions:cancel ${res.status}: ${txt}`)
  }
}

/** A console deep-link to a Cloud Run Job execution's logs (spec §14.6). Best-effort — null
 *  if the project isn't in env (so the caller renders no link rather than a broken one).
 *  Targets Logs Explorer (/logs/query) filtered to this execution — the same filter the
 *  inline capture uses. The old /run/jobs/details/<region>/<job>/executions/<name> path
 *  404s in the current console; the Logs Explorer URL format is verified (2026-06-13)
 *  against a real console share-URL. */
export function jobExecutionLogsUrl(shortName: string): string | null {
  const project = process.env.GOOGLE_CLOUD_PROJECT
  if (!project) return null
  const query = [
    'resource.type="cloud_run_job"',
    `resource.labels.job_name="${JOB}"`,
    `resource.labels.location="${REGION}"`,
    `labels."run.googleapis.com/execution_name"="${shortName}"`,
  ].join(' ')
  return `https://console.cloud.google.com/logs/query;query=${encodeURIComponent(query)};storageScope=project?project=${project}`
}

export type ExecState = 'running' | 'succeeded' | 'failed' | 'unknown'

/** Best-effort status of a Cloud Run Job execution by its short name (the reconcile backstop
 *  for a row whose in-process finishJob never ran, e.g. a hard crash). Never throws. */
export async function executionState(shortName: string): Promise<ExecState> {
  try {
    const res = await fetch(`${jobBase()}/executions/${shortName}`, {
      headers: { Authorization: `Bearer ${await accessToken()}` },
    })
    if (!res.ok) return 'unknown'
    const ex = (await res.json()) as {
      completionTime?: string
      succeededCount?: number
      failedCount?: number
    }
    if (!ex.completionTime) return 'running'
    return (ex.failedCount ?? 0) > 0 || (ex.succeededCount ?? 0) < 1 ? 'failed' : 'succeeded'
  } catch {
    return 'unknown'
  }
}
