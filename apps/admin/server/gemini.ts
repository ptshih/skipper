// The admin console's model client — Gemini on Vertex AI (provider, auth and location: VERTEX in
// @skipper/shared; the why: docs/decisions/gemini-3-8-flash.md).
//
// ⚠ ONE lazy client for the two model calls this server makes (the region bbox proposal and the curated
// places draft), so their credentials and request budget cannot drift apart. Lazy for the reason every
// client in this repo is: importing the server must not need Google credentials, and a constructor at
// import time is a latent credential probe on every boot.

import { GoogleGenAI } from '@google/genai'
import { VERTEX } from '@skipper/shared'
import { keyFilename } from './jobs'

/**
 * The per-request budget for an OPERATOR-CLICK model call, passed as `config.httpOptions`.
 *
 * ⚠ EXPLICIT TIMEOUT + ONE RETRY, and this is a rule, not a preference (CLAUDE.md: a model call in a
 * request path gets "low maxRetries (0-1) + an explicit timeout inside the Cloud Run budget — do NOT copy
 * studio's retries, tuned for a batch run that already spent"). The Gen AI SDK sets NO timeout by default
 * and retries nothing unless asked, so an unset budget would park a request past the point anyone is
 * waiting, billing to completion. 90s × 2 attempts stays inside this server's 240s idleTimeout as well
 * as Cloud Run's 300s. `timeout` bounds each ATTEMPT, body included.
 */
export const ADMIN_MODEL_HTTP = { timeout: 90_000, retryOptions: { attempts: 2 } } as const

/**
 * The curated-places DRAFT's budget — ONE long attempt instead of two short ones.
 *
 * ⚠ MEASURED at HIGH thinking (founder rule, 2026-09-23), 120 places: 80.7 s on one run; on another the
 * first 90 s attempt timed out and the retry finished at 155.8 s total. Under ADMIN_MODEL_HTTP that is a
 * coin flip between a slow success and a failure — and a timed-out attempt is STILL BILLED (the Gen AI
 * SDK documents abort as client-only; the service finishes the generation). One 220 s attempt clears the
 * measured tail and stays inside this server's 240 s idleTimeout and Cloud Run's 300 s; the trade is that
 * a transient 429 is not retried — the operator clicks Draft again, which is what the retry would have
 * done, minus a second paid generation racing the first.
 */
export const ADMIN_DRAFT_HTTP = { timeout: 220_000, retryOptions: { attempts: 1 } } as const

/** Whether the model calls can run at all — the project is the one env var they need by name. */
export function adminModelConfigured(): boolean {
  return Boolean(process.env[VERTEX.projectEnv])
}

let client: GoogleGenAI | null = null

/** The shared client. Callers check `adminModelConfigured()` first and answer with their own error
 *  shape; this throws only for a caller that skipped that. ⚠ On Cloud Run the runtime service account
 *  (skipper-admin) needs `roles/aiplatform.user`, or every call is a 403. */
export function adminGemini(): GoogleGenAI {
  const project = process.env[VERTEX.projectEnv]
  if (!project) throw new Error(`${VERTEX.projectEnv} is not set.`)
  return (client ??= new GoogleGenAI({
    vertexai: true,
    project,
    location: VERTEX.location,
    googleAuthOptions: { keyFilename: keyFilename() },
  }))
}
