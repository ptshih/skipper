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
export async function accessToken(): Promise<string> {
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
// record (only the live corpus/roam ops); the test only checks the scripts that remain.
export const SCRIPTS: Partial<Record<JobKind, string>> = {
  resynth_narration: 'packages/studio/src/resynth-narration.ts',
  sweep_orphans: 'packages/studio/src/sweep-orphans.ts',
  discover_pois: 'packages/studio/src/discover-pois.ts',
  enrich_pois: 'packages/studio/src/enrich-pois.ts',
  generate_narrations: 'packages/studio/src/generate-narrations.ts',
  refetch_facts: 'packages/studio/src/refetch-poi.ts',
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
    if (body.bbox) args.push(`--bbox=${str(body.bbox)}`)
    if (apply) args.push('--apply')
    // sweep is free (WDQS + MediaWiki, no LLM/TTS); spends:false so no confirm gate.
    return { args, dryRun: !apply, spends: false, targetId: 'roam-corpus' }
  }

  if (kind === 'enrich_pois') {
    const apply = body.apply === true
    const args: string[] = [script]
    // Selection: a FILTER (bbox/source/query) + exclude-ids, XOR an explicit include-ids list — the CLI
    // resolves it server-side (explicit XOR filter, NOT a union). See the enrich-pois.ts selection block.
    const idCsv = (v: unknown): string => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').join(',') : '')
    if (body.bbox) args.push(`--bbox=${str(body.bbox)}`)
    if (body.source) args.push(`--source=${str(body.source)}`)
    if (body.query) args.push(`--query=${str(body.query)}`)
    if (idCsv(body.includeIds)) args.push(`--include-ids=${idCsv(body.includeIds)}`)
    if (idCsv(body.excludeIds)) args.push(`--exclude-ids=${idCsv(body.excludeIds)}`)
    if (body.limit) args.push(`--limit=${Number(body.limit)}`)
    if (body.force) args.push('--force')
    if (body.model) args.push(`--model=${str(body.model)}`)
    if (body.maxCostUsd) args.push(`--max-cost=${Number(body.maxCostUsd)}`)
    if (apply) args.push('--apply')
    // enrich SPENDS (Anthropic) on --apply → confirm gate; the dry run makes no model calls (free).
    return { args, dryRun: !apply, spends: apply, targetId: 'region-corpus' }
  }

  if (kind === 'generate_narrations') {
    const apply = body.apply === true
    const args: string[] = [script]
    if (body.bbox) args.push(`--bbox=${str(body.bbox)}`)
    if (body.limit) args.push(`--limit=${Number(body.limit)}`)
    if (body.force) args.push('--force')
    // --min-extract removed 2026-06-16: roam story-eligibility is "has a fact sheet" (#1), not a char floor.
    if (body.maxCostUsd) args.push(`--max-cost=${Number(body.maxCostUsd)}`)
    if (apply) args.push('--apply')
    return { args, dryRun: !apply, spends: apply, targetId: 'roam-corpus' }
  }

  // sweep_orphans — V2 sweeps the whole narration/ R2 prefix (tour-scoped sweeping is gone with the
  // tours table); the script honors only --apply. targetId 'narration' matches its beginJob target.
  const apply = body.apply === true
  const args: string[] = [script]
  if (apply) args.push('--apply')
  return { args, dryRun: !apply, spends: apply, targetId: 'roam' }
}

/** Trigger a skipper-studio execution with per-run arg + env overrides. Returns the execution's
 *  SHORT name (matches the Job's self-reported CLOUD_RUN_EXECUTION), or '' if unparseable. */
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
  const json = (await res.json()) as {
    metadata?: { name?: string }
    error?: { message?: string }
  }
  if (!res.ok) throw new Error(`jobs:run ${res.status}: ${json.error?.message ?? JSON.stringify(json)}`)
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
