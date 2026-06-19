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

import Anthropic from '@anthropic-ai/sdk'
import { format } from 'node:util'
import { SUMMARY_MODEL } from '../models'

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
 *  nothing). The generator logs exclusively via console.*, so this catches it all. */
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

// Lazy so importing this module never constructs the client — sweep/refetch run without a
// narration key locally, and local CLI never synthesizes anyway (STUDIO_JOB_ID unset).
let _client: Anthropic | undefined
const client = (): Anthropic => (_client ??= new Anthropic())

const SYSTEM = `You are a concise technical analyst for Skipper, an AI-narrated driving audio tour app.
You will be given stdout logs from a Cloud Run gen job. Extract:
1. A plain-English summary (2–3 sentences) of what the job did and whether it succeeded cleanly.
2. A structured JSON object of key metrics — be kind-specific and practical. Common fields:
   dryRun (bool), itemsProcessed (int), clipsGenerated (int), totalDurationSec (float),
   estimatedCostUsd (float), warnings (string[]), errors (string[]).
   Include any kind-specific fields you can reliably extract (wpm, tailCollapses, groundingScore, etc.).
   Omit fields you cannot determine.`

/** Summarize the captured log + extract structured metrics. Falls back to a minimal object on
 *  any error so the caller never has to handle null. Bounded by a request timeout so a hung
 *  call can't keep the job process alive past settling. */
export async function synthesizeJobOutput(kind: string, log: string): Promise<JobOutputSynthesis> {
  if (!log.trim()) return { summary: 'No log output captured.', data: {} }
  // Keep the TAIL (~30k chars) — the buffer is already tail-capped, and a failed run's terminal
  // error lands at the END, so a HEAD slice would drop the very thing the summary needs to report.
  const truncated = log.length > 30_000 ? '…[truncated]\n' + log.slice(-30_000) : log

  try {
    const msg = await client().messages.create(
      {
        model: SUMMARY_MODEL,
        max_tokens: 1024,
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content: `Job kind: ${kind}\n\nLogs:\n${truncated}\n\nRespond with a JSON object: { "summary": "...", "data": { ... } }`,
          },
        ],
      },
      { timeout: 20_000, maxRetries: 1 },
    )
    const text = msg.content.find((b) => b.type === 'text')?.text ?? ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as { summary?: string; data?: Record<string, unknown> }
      return { summary: parsed.summary ?? 'No summary generated.', data: parsed.data ?? {} }
    }
    return { summary: text.slice(0, 500), data: {} }
  } catch {
    return { summary: 'Synthesis failed.', data: {} }
  }
}
