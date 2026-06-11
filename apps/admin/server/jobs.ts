// Triggering + reconciling the skipper-gen Cloud Run Job from the admin-api.
//
// The admin-api mints a gen_jobs row, then calls run.googleapis.com `jobs:run` with the
// per-execution override args (the spec §5 contract) + GEN_JOB_ID in env, so the Job's
// job-progress hook updates that exact row. The caller SA needs roles/run.developer on the
// job (runWithOverrides + executions.get) — see spec §10. Auth is an OAuth access token off
// the metadata server (ADC, cloud-platform scope), the same mechanism TTS uses.

import { GoogleAuth } from 'google-auth-library'

const REGION = process.env.GEN_JOB_REGION ?? 'us-east4'
const JOB = process.env.GEN_JOB_NAME ?? 'skipper-gen'
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform'

let auth: GoogleAuth | undefined
export async function accessToken(): Promise<string> {
  auth ??= new GoogleAuth({ scopes: SCOPE })
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

const SCRIPTS = {
  generate: 'packages/generator/src/run.ts',
  patch_clip: 'packages/generator/src/patch-clip.ts',
  resynth: 'packages/generator/src/resynth-tour.ts',
  resynth_roam_clip: 'packages/generator/src/resynth-roam-clip.ts',
  sweep_orphans: 'packages/generator/src/sweep-orphans.ts',
  sweep_roam_pois: 'packages/generator/src/sweep-roam-pois.ts',
  generate_roam: 'packages/generator/src/generate-roam.ts',
} as const

export type JobKind = keyof typeof SCRIPTS

export interface BuildResult {
  args: string[]
  dryRun: boolean
  /** Does this run spend money or delete bytes → a typed confirm is required (spec §8). */
  spends: boolean
  targetSlug?: string
  tourId?: string
  targetId?: string
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** Build the per-execution override args from a request body (the spec §5 contract). Value
 *  flags use the `=` form — the parser drops a space-form value that begins with `--`. */
export function buildJobArgs(body: Record<string, unknown>): BuildResult {
  const kind = body.kind as JobKind
  const script = SCRIPTS[kind]
  if (!script) throw new HttpError(400, `unknown kind: ${String(body.kind)}`)

  if (kind === 'generate') {
    const slug = str(body.slug)
    if (!slug) throw new HttpError(400, 'slug is required for generate')
    const dryRun = body.dryRun !== false // default dry-run
    const maxCost = Number(body.maxCostUsd ?? 5)
    if (!Number.isFinite(maxCost) || maxCost <= 0) throw new HttpError(400, 'maxCostUsd must be > 0')
    const args = [script, slug, `--max-cost=${maxCost}`]
    if (body.jokeLevel) args.push(`--joke-level=${str(body.jokeLevel)}`)
    if (body.duration) args.push(`--duration=${str(body.duration)}`)
    if (body.noJudgeClosers) args.push('--no-judge-closers')
    if (dryRun) args.push('--dry-run')
    return { args, dryRun, spends: !dryRun, targetSlug: slug }
  }

  if (kind === 'patch_clip') {
    const id = str(body.targetId)
    const find = body.find
    const replace = body.replace
    if (!id || typeof find !== 'string' || typeof replace !== 'string' || find === '')
      throw new HttpError(400, 'patch_clip needs targetId, a non-empty find, and replace')
    const apply = body.apply === true
    const args = [script, id, `--find=${find}`, `--replace=${replace}`]
    if (body.all) args.push('--all')
    if (apply) args.push('--apply')
    return { args, dryRun: !apply, spends: apply, targetId: id }
  }

  if (kind === 'resynth_roam_clip') {
    const poiId = str(body.poiId)
    if (!poiId) throw new HttpError(400, 'resynth_roam_clip needs poiId')
    const apply = body.apply === true
    const args = [script, poiId]
    if (apply) args.push('--apply')
    return { args, dryRun: !apply, spends: apply, targetId: poiId }
  }

  if (kind === 'resynth') {
    const tourId = str(body.tourId)
    if (!tourId) throw new HttpError(400, 'resynth needs tourId')
    const apply = body.apply === true
    const args = [script, tourId]
    if (apply) args.push('--apply')
    if (body.keepOld) args.push('--keep-old')
    return { args, dryRun: !apply, spends: apply, tourId, targetId: tourId }
  }

  if (kind === 'sweep_roam_pois') {
    const apply = body.apply === true
    const args: string[] = [script]
    if (body.bbox) args.push(`--bbox=${str(body.bbox)}`)
    if (apply) args.push('--apply')
    // sweep is free (WDQS + MediaWiki, no LLM/TTS); spends:false so no confirm gate.
    return { args, dryRun: !apply, spends: false, targetId: 'roam-corpus' }
  }

  if (kind === 'generate_roam') {
    const apply = body.apply === true
    const args: string[] = [script]
    if (body.bbox) args.push(`--bbox=${str(body.bbox)}`)
    if (body.limit) args.push(`--limit=${Number(body.limit)}`)
    if (body.force) args.push('--force')
    if (body.minExtract) args.push(`--min-extract=${Number(body.minExtract)}`)
    if (apply) args.push('--apply')
    return { args, dryRun: !apply, spends: apply, targetId: 'roam-corpus' }
  }

  // sweep_orphans
  const apply = body.apply === true
  const allTours = body.allTours === true
  const args: string[] = [script]
  let tourId: string | undefined
  if (allTours) {
    args.push('--all')
  } else {
    tourId = str(body.tourId)
    if (!tourId) throw new HttpError(400, 'sweep_orphans needs tourId or allTours:true')
    args.push(tourId)
  }
  if (apply) args.push('--apply')
  if (allTours && apply) args.push('--yes')
  return { args, dryRun: !apply, spends: apply, tourId, targetId: allTours ? 'all' : tourId }
}

/** Trigger a skipper-gen execution with per-run arg + env overrides. Returns the execution's
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
 *  schema reserved on gen_job_status='canceled'). 404 is treated as success — the execution
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
 *  if the project isn't in env (so the caller renders no link rather than a broken one). */
export function jobExecutionLogsUrl(shortName: string): string | null {
  const project = process.env.GOOGLE_CLOUD_PROJECT
  if (!project) return null
  return `https://console.cloud.google.com/run/jobs/details/${REGION}/${JOB}/executions/${shortName}?project=${project}`
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
