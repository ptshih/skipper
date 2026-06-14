// Capture Cloud Run execution output for a succeeded gen_job: fetch the raw log lines from
// Cloud Logging, then ask Claude to produce a text summary + structured JSON extract. Both
// are stored on gen_jobs.outputLog / outputSummary / outputData for inline display in the
// admin drawer (no GCP console round-trip needed).
//
// Called fire-and-forget from the reconcile paths in index.ts when a job transitions to
// 'succeeded'. The DB write is idempotent — if outputLog is already set we skip.

import Anthropic from '@anthropic-ai/sdk'
import { db } from '@skipper/db'
import { genJobs } from '@skipper/db/schema'
import { eq } from 'drizzle-orm'
import { accessToken } from './jobs'

const client = new Anthropic()

// ── Cloud Logging ──────────────────────────────────────────────────────────────

interface LogEntry {
  timestamp?: string
  textPayload?: string
  jsonPayload?: Record<string, unknown>
}

/** Fetch all stdout lines from a Cloud Run Job execution via Cloud Logging. Returns the
 *  lines joined as plain text, oldest-first. Empty string if none found or on error. */
export async function fetchExecutionLog(cloudRunExecution: string): Promise<string> {
  const project = process.env.GOOGLE_CLOUD_PROJECT
  if (!project) {
    console.error('[job-output] GOOGLE_CLOUD_PROJECT not set — cannot fetch logs')
    return ''
  }
  try {
    const token = await accessToken()
    // Cloud Run Jobs: resource.type="cloud_run_job" carries project_id/location/job_name as
    // resource labels; the execution name is a LOG-ENTRY label and it DOES carry the
    // `run.googleapis.com/` prefix — `labels."run.googleapis.com/execution_name"` (verified
    // 2026-06-13 against a real Logs Explorer query). A prior fix (61bbab6) dropped the prefix
    // to bare `labels.execution_name` on a docs misread; that matches nothing → empty logs.
    const filter = [
      'resource.type="cloud_run_job"',
      `labels."run.googleapis.com/execution_name"="${cloudRunExecution}"`,
    ].join('\n')

    let lines: string[] = []
    let pageToken: string | undefined
    do {
      const body: Record<string, unknown> = {
        resourceNames: [`projects/${project}`],
        filter,
        orderBy: 'timestamp asc',
        pageSize: 1000,
        ...(pageToken ? { pageToken } : {}),
      }
      const res = await fetch('https://logging.googleapis.com/v2/entries:list', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const errBody = await res.text().catch(() => '')
        console.error(`[job-output] Cloud Logging ${res.status} for ${cloudRunExecution}: ${errBody}`)
        break
      }
      const data = (await res.json()) as { entries?: LogEntry[]; nextPageToken?: string }
      console.log(`[job-output] Cloud Logging page: ${data.entries?.length ?? 0} entries for ${cloudRunExecution}`)
      for (const e of data.entries ?? []) {
        const text =
          e.textPayload ??
          (typeof e.jsonPayload?.message === 'string' ? e.jsonPayload.message : null) ??
          (e.jsonPayload ? JSON.stringify(e.jsonPayload) : null)
        if (text) lines.push(text.trimEnd())
      }
      pageToken = data.nextPageToken
    } while (pageToken)

    return lines.join('\n')
  } catch {
    // ADC not available locally, or transient token failure — skip silently.
    return ''
  }
}

// ── LLM synthesis ─────────────────────────────────────────────────────────────

export interface JobOutputSynthesis {
  summary: string
  data: Record<string, unknown>
}

const SYSTEM = `You are a concise technical analyst for Skipper, an AI-narrated driving audio tour app.
You will be given stdout logs from a Cloud Run gen job. Extract:
1. A plain-English summary (2–3 sentences) of what the job did and whether it succeeded cleanly.
2. A structured JSON object of key metrics — be kind-specific and practical. Common fields:
   dryRun (bool), itemsProcessed (int), clipsGenerated (int), totalDurationSec (float),
   estimatedCostUsd (float), warnings (string[]), errors (string[]).
   Include any kind-specific fields you can reliably extract (wpm, tailCollapses, groundingScore, etc.).
   Omit fields you cannot determine.`

/** Ask Claude to summarize the log and extract structured metrics. Falls back to a minimal
 *  object on any error so callers never have to handle null. */
export async function synthesizeJobOutput(
  kind: string,
  log: string,
): Promise<JobOutputSynthesis> {
  if (!log.trim()) return { summary: 'No log output captured.', data: {} }
  // Truncate to ~30k chars to stay well inside the context window (logs are rarely longer).
  const truncated = log.length > 30_000 ? log.slice(0, 30_000) + '\n…[truncated]' : log

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Job kind: ${kind}\n\nLogs:\n${truncated}\n\nRespond with a JSON object: { "summary": "...", "data": { ... } }`,
        },
      ],
    })
    const text = msg.content.find((b) => b.type === 'text')?.text ?? ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as { summary?: string; data?: Record<string, unknown> }
      return {
        summary: parsed.summary ?? 'No summary generated.',
        data: parsed.data ?? {},
      }
    }
    return { summary: text.slice(0, 500), data: {} }
  } catch {
    return { summary: 'Synthesis failed.', data: {} }
  }
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

/** Fetch + synthesize + persist output for a succeeded gen_job. Idempotent: skips if
 *  outputLog is already set. Called fire-and-forget from the reconcile paths. */
export async function captureJobOutput(
  jobId: string,
  cloudRunExecution: string,
  kind: string,
): Promise<void> {
  try {
    // Check idempotency — don't re-fetch if already captured.
    const existing = (
      await db.select({ outputLog: genJobs.outputLog }).from(genJobs).where(eq(genJobs.id, jobId)).limit(1)
    )[0]
    if (!existing || existing.outputLog != null) return

    const log = await fetchExecutionLog(cloudRunExecution)
    const { summary, data } = await synthesizeJobOutput(kind, log)

    await db
      .update(genJobs)
      .set({ outputLog: log || null, outputSummary: summary, outputData: data })
      .where(eq(genJobs.id, jobId))
  } catch {
    // Never throw — this is best-effort observability.
  }
}
