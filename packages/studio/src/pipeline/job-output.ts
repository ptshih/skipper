// In-job output capture for the studio_jobs operational record.
//
// The Cloud Run job tees its OWN stdout/stderr into a capped buffer and, at finish, asks
// Claude (Haiku) for a plain-English summary + structured metrics. job-progress.ts writes
// all three (outputLog / outputSummary / outputData) onto the terminal row in the same
// update that settles status — so the admin never has to reconstruct a job's logs from
// Cloud Logging (that admin-side path now survives only as a fallback for kinds not wired
// to the job-progress hook + hard crashes that never reach finishJob).
//
// EVERYTHING here is best-effort: capture must never corrupt real output, and a synthesis
// failure must never block the job from settling (job-progress swallows it).

import { format } from 'node:util'
import { z } from 'zod'
import { SUMMARY_MODEL } from '../models'
import { callTool } from './tool-call'

// Cap the in-memory tail we keep (synth truncates further). Bounds memory on a chatty run;
// the head of a very long log is the least useful part, so we keep the TAIL.
const MAX_LOG_CHARS = 64_000

let buffer = ''
let installed = false

/** Tee console output (log/info/warn/error/debug) into a capped buffer while still printing
 *  through untouched. Idempotent; call once at job begin.
 *
 *  We patch the CONSOLE methods, NOT process.stdout.write: Bun's console writes to the fd
 *  natively and BYPASSES the stream wrapper (Cloud Run still captures the fd — which is why
 *  Cloud Logging saw these lines — but an in-process stdout.write monkeypatch captures
 *  nothing). The studio pipeline logs exclusively via console.*, so this catches it all. */
export function installLogCapture(): void {
  if (installed) return
  installed = true
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const
  const sink = console as unknown as Record<string, (...a: unknown[]) => void>
  for (const m of methods) {
    const orig = console[m].bind(console) as (...a: unknown[]) => void
    sink[m] = (...args: unknown[]): void => {
      try {
        const line = format(...args) + '\n'
        buffer += line
        if (buffer.length > MAX_LOG_CHARS) buffer = buffer.slice(buffer.length - MAX_LOG_CHARS)
      } catch {
        // capture must never break the real log
      }
      orig(...args)
    }
  }
}

/** The captured stdout/stderr so far (oldest dropped past the cap). */
export function capturedLog(): string {
  return buffer
}

export interface JobOutputSynthesis {
  summary: string
  data: Record<string, unknown>
}

// ⚠ This module used to build its OWN `new Anthropic()`, which quietly made models.ts's promise of
// "ONE lazily-built singleton for every call site" false — two clients, two retry policies. It now goes
// through `callTool`, i.e. the shared `getAnthropic()`, which is lazy for the same reason the local
// client was: importing this module must not require a key, because sweep/refetch run without one
// locally and a local CLI never synthesizes anyway (STUDIO_JOB_ID unset). A missing key now surfaces as
// a thrown error inside the try below and lands in the same fallback an API failure does.
const REPORT = z.object({
  summary: z.string(),
  /** Free-form on purpose — the useful metrics differ per job kind, and the SYSTEM prompt asks for
   *  whatever this run can support rather than a fixed set. */
  data: z.record(z.string(), z.unknown()).optional(),
})

const SYSTEM = `You are a concise technical analyst for Skipper, an AI-narrated driving audio tour app.
You will be given stdout logs from a Cloud Run gen job. Extract:
1. A plain-English summary (2–3 sentences) of what the job did and whether it succeeded cleanly.
2. A structured JSON object of key metrics — be kind-specific and practical. Common fields:
   dryRun (bool), itemsProcessed (int), clipsGenerated (int), totalDurationSec (float),
   estimatedCostUsd (float), warnings (string[]), errors (string[]).
   Include any kind-specific fields you can reliably extract (wpm, tailCollapses, groundingScore, etc.).
   Omit fields you cannot determine.`

/** Summarize the captured log + extract structured metrics. Falls back on any error so the caller never
 *  has to handle null. Bounded by a request timeout so a hung call can't keep the job process alive past
 *  settling.
 *
 *  ⚠ This used to ask for free text and then scrape it: `text.match(/\{[\s\S]*\}/)` — a GREEDY match from
 *  the first brace to the last, so any prose brace broke it — then `JSON.parse`, inside a catch-all that
 *  returned `{ summary: 'Synthesis failed.', data: {} }`. Two failures compounded: nothing forced the
 *  shape, and a SYSTEMATICALLY broken extraction was indistinguishable from a job that simply had no
 *  metrics to report. A forced tool call fixes the first; naming the failure in the summary fixes the
 *  second. The fallback itself is kept, deliberately — this runs while a job is SETTLING, so throwing
 *  here could take down the reporting of an otherwise successful run. */
export async function synthesizeJobOutput(kind: string, log: string): Promise<JobOutputSynthesis> {
  if (!log.trim()) return { summary: 'No log output captured.', data: {} }
  // Keep the TAIL (~30k chars) — the buffer is already tail-capped, and a failed run's terminal
  // error lands at the END, so a HEAD slice would drop the very thing the summary needs to report.
  const truncated = log.length > 30_000 ? '…[truncated]\n' + log.slice(-30_000) : log

  try {
    const report = await callTool({
      model: SUMMARY_MODEL,
      system: SYSTEM,
      messages: [{ role: 'user', content: `Job kind: ${kind}\n\nLogs:\n${truncated}\n\nCall the report tool.` }],
      maxTokens: 1024,
      tool: { name: 'report', description: 'Report the plain-English summary and the extracted metrics.' },
      schema: REPORT,
      label: 'job output synthesis',
      // Per-request, so this short leash wins over the shared client's maxRetries: 5 — that default is
      // tuned for narration surviving a sustained overload, which is the wrong trade for a settling job.
      requestOptions: { timeout: 20_000, maxRetries: 1 },
    })
    return { summary: report.summary, data: report.data ?? {} }
  } catch (e) {
    // Say WHAT went wrong. The old 'Synthesis failed.' read the same whether the model was down, the key
    // was missing, or the reply was malformed — and an operator reading the job row could not tell any of
    // those from a job with nothing to report.
    const why = e instanceof Error ? e.message : String(e)
    return { summary: `Job output synthesis failed — ${why.slice(0, 200)}`, data: {} }
  }
}
