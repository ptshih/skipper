// Every rider-facing cap, in ONE place (INV-12) — plus the bounded body read that enforces the byte ones.
//
// WHY A MODULE AT ALL: rider-triggered spend is governed by CAPS, not by a founder go-per-run (INV-11,
// CLAUDE.md STOP). POST /drives/plan and POST /drives/propose bill an external vendor on EVERY request,
// forever, anonymously, with no `--apply` and no human in the loop. There is no approval step in which a
// bad number gets caught, so the numbers themselves ARE the control — and a control scattered as inline
// literals across four call sites is a control nobody can audit or review as a whole.
//
// WHY NOT BUILD THE CAPS ON rateLimit(): ./rate-limit.ts returns next() unconditionally under
// NODE_ENV=test, which is every sanctioned test invocation (bun test sets NODE_ENV=test unless it is
// already set — https://bun.com/docs/test/runtime-behavior). A cap built on it is untestable BY
// CONSTRUCTION. The body caps below are enforced in the request path instead, so a test can assert the
// 413 (D32). This module owns the NUMBERS for the rate limiters; ./rate-limit.ts owns the mechanism.
//
// ⚠ WHY THIS FILE IMPORTS NOTHING: ./auth.ts throws at MODULE LOAD without BETTER_AUTH_SECRET, and
// ./entitlements value-imports it — so anything importing ./drives transitively needs a secret just to
// load. Zero imports here keeps that question permanently closed, which is also why readBoundedText
// takes a `Request` rather than a hono `Context` (the call site pays one `.raw`). If a future edit makes
// a limits test need an env seed, that edit added an import to this file and IS the bug.
//
// ⚠ Caps that are rider-facing but deliberately DO NOT live here, because each has a real home and a
// second copy is exactly the drift this module exists to stop. Pointers, never re-exports — a re-export
// is a second import path that invites the next agent to "change it in limits.ts", where it isn't:
//   - request SHAPE caps (`via` count, endpoint name length, WGS84 bounds) → packages/shared/src/schemas.ts.
//     apps/mobile imports those same Zod schemas; @skipper/shared cannot import apps/api.
//   - the lifetime free-drive grant → ./credits.ts. Its value is FROZEN INTO the grant row at write time,
//     which makes it ledger semantics rather than a request cap.
//   - the Google Routes call timeout → packages/routing.
//   - the presigned-URL TTL → packages/storage (deliberately overridden by an operator QA pass).
//   - drive pacing / trigger geometry → @skipper/engine, which is zero-dep and RN-safe on purpose so
//     mobile can re-pace a drive OFFLINE with identical math. A second copy breaks that agreement.

/* -------------------------------------------------------------------------- */
/* Request-body byte ceilings — enforced on the ACTUAL stream (readBoundedText). */
/* -------------------------------------------------------------------------- */

/** The planner transcript is CLIENT-HELD and re-sent whole on every turn (D10), so the body grows with
 *  the conversation. This is the DoS/parse guard, not the wallet guard — MAX_PLAN_TOTAL_CHARS is what
 *  bounds tokens, and is sized to bind first for ordinary Latin text.
 *  Deliberately generous: there is no server copy of the transcript to recover from (INV-4 — the
 *  anonymous user row is deleted at link), so a hard reject mid-conversation is unrecoverable and the
 *  worst UX failure available on this surface. Loose enough never to reject a real rider; tight enough
 *  that no single request is worth real money.
 *  ⚠ For dense scripts (CJK, emoji) where one char is 3-4 bytes AND ~1 token, THIS is the guard that
 *  binds rather than the char cap. That is why both exist rather than either alone. */
export const MAX_PLAN_BODY_BYTES = 16 * 1024

/** POST /drives/propose and POST /drives carry two endpoints plus a few midpoints. Worst-case LEGAL body
 *  is ~6.6 KB: 10 endpoints (start + end + `via`'s max of 8) each with a 200-CHARACTER name — characters,
 *  not bytes, so up to ~600 bytes of UTF-8 apiece — plus coordinates and an idempotency key. This is
 *  ~2.4x that, so a valid drive can never 413.
 *  ⚠ Same value as the plan cap today by coincidence, not by derivation — keep them separate constants.
 *  The plan cap moves when planner spend is measured; this one moves only if the request SHAPE changes. */
export const MAX_DRIVE_BODY_BYTES = 16 * 1024

/** Socket-level backstop, wired into the Bun server export in ./index.ts. The only guard that stops
 *  bytes BEFORE any JS runs; Bun's own default is 128 MiB, three orders of magnitude above anything here.
 *  Deliberately an order of magnitude ABOVE every per-route cap: it is a floor under the process, not a
 *  substitute for them — its 413 carries an EMPTY body, so the friendly JSON still has to come from
 *  readBoundedText.
 *  ⚠ Process-wide, so it also covers the Better Auth handler mount (./index.ts), whose body is otherwise
 *  completely unbounded. That is a bonus, not the reason for the number.
 *  ⚠ Not reachable by any test — an in-process app.fetch(new Request(...)) never touches a socket.
 *  VERIFIED by probe 2026-07-31 that Bun honours this key in the `export default { … }` object form and
 *  not only via Bun.serve({ … }): a 5 KB body against a 1 KB cap returned 413, a 10 B body returned 200. */
export const SERVER_MAX_BODY_BYTES = 1024 * 1024

/* -------------------------------------------------------------------------- */
/* Planner conversation caps.                                                   */
/* No consumer yet — POST /drives/plan arrives in build step 6. Decided here so  */
/* the route author inherits an argued number instead of inventing one under     */
/* deadline, which is the whole point of INV-12 existing before the planner does.*/
/* -------------------------------------------------------------------------- */

/** ~2x the point where the in-persona wrap-up (D12) should already have ended the conversation, so the
 *  skipper always bows out in character before a rider can ever see this. A real "plan me a drive" runs
 *  3-8 exchanges. ⚠ The turn count the CLIENT asserts is advisory; this is the one that is true. */
export const MAX_PLAN_MESSAGES = 24

/** The cap that maps to dollars: chars / ~4 ~= input tokens. Set deliberately BELOW what
 *  MAX_PLAN_BODY_BYTES permits (12k chars + 24 message envelopes ~= 13.1 KB) so that for ordinary Latin
 *  text THIS is the effective guard and the byte cap stays pure parse protection.
 *  ⚠ The /4 is optimistic — JSON punctuation tokenizes worse than prose. Treat 12k chars as ~3-4k tokens. */
export const MAX_PLAN_TOTAL_CHARS = 12_000

/** A per-message bound as well as a total. Without it, one wall-of-text turn eats the entire budget —
 *  which is simultaneously the best prompt-injection payload shape and the least diagnosable error
 *  ("too long", with no indication of which turn). */
export const MAX_PLAN_MESSAGE_CHARS = 2_000

/** Hard ceiling on the planner's model call.
 *  ⚠ On this model that bounds THINKING PLUS visible output in one budget — there is no separate
 *  thinking budget to size against, and thinking stays ON (INV-8). Visible output is deterministic and
 *  tiny (one short `say` plus a small typed route object, ~200 tok); the rest is headroom for thinking.
 *  ⚠ TOO LOW IS THE DANGEROUS DIRECTION AND DOES NOT RAISE AN ERROR: the call returns HTTP 200 with
 *  stop_reason 'max_tokens' and either a truncated tool_use block or none at all — a paid call that
 *  silently produced nothing, indistinguishable from "the planner chose not to route this turn". The
 *  step-6 handler must branch on stop_reason explicitly.
 *  Raising it costs nothing unless the model actually generates the tokens: max_tokens is a ceiling, not
 *  a reservation. Tighten only after logging real p99 output. */
export const PLANNER_MAX_TOKENS = 2_048

/** Ceiling on the curated anchors handed to the planner in its system prompt.
 *  ⚠ A CEILING, NOT A PAGE SIZE — deliberately far above today's 26 endpoint-eligible places, so it
 *  can never silently truncate a real region's allowlist and make a legitimate endpoint unaskable.
 *  It exists because the set grows with every paid `curate-places` run and rides in a per-request
 *  prompt: unbounded list, unbounded per-request bill. If a region ever approaches this, that is a
 *  product decision (a planner cannot hold hundreds of names in useful attention anyway), not a
 *  number to quietly raise. Pair it with a stable ORDER BY — see loadRegionAnchors. */
export const MAX_PLAN_ANCHORS = 200

/* -------------------------------------------------------------------------- */
/* Rate-limiter buckets — the NUMBERS only (mechanism: ./rate-limit.ts).        */
/* Keyed per-IP and per-INSTANCE, so the effective ceiling is limit x live       */
/* instances (RISK-4, accepted while unlaunched).                                */
/* -------------------------------------------------------------------------- */

/** POST /drives/propose — one Google Routes call per request. Unchanged value, moved here from index.ts. */
export const PROPOSE_RATE = { limit: 15, windowSec: 60, label: 'propose' } as const

/** POST /drives — Routes + a credit consume + a write. Unchanged value, moved here from drives.ts. */
export const DRIVE_CREATE_RATE = { limit: 15, windowSec: 60, label: 'drives-create' } as const

/** POST /drives/plan, per minute — LOOSER than propose on purpose: the INTENT COUNT differs, not the
 *  cost. Propose fires once per conversation; plan fires 5-10 times, and a fast typist can plausibly
 *  reach a dozen turns in a minute. Matching propose's 15 would put a real rider one retry away from a
 *  429 mid-conversation, holding the only copy of the transcript. */
export const PLAN_RATE_MINUTE = { limit: 20, windowSec: 60, label: 'plan-min' } as const

/** POST /drives/plan, per hour — the highest-leverage number in this file, and the reason a per-minute
 *  bucket alone is not enough: 20/min permits ~28,800 requests/day per IP per instance, which at the
 *  worst-case per-request cost is real money from one anonymous caller. This collapses that by ~10x
 *  while still sitting ~15x above any human conversation rate.
 *  ⚠ Enforce it by mounting BOTH, in order — a second rateLimit() is a second independent bucket map
 *  because each call closes over its own, and the distinct label keeps the counts separate:
 *      app.use('/drives/plan', rateLimit(PLAN_RATE_MINUTE), rateLimit(PLAN_RATE_HOUR))
 *  VERIFIED by probe 2026-07-31 (3/min + 5/hr stacked: 200,200,200,429,… — the tighter window wins and
 *  neither leaks into the other). An earlier read of ./rate-limit.ts concluded a second window "cannot
 *  be enforced without extending the limiter"; that is wrong, and it mattered — it was the difference
 *  between accepting the exposure and writing one more line. */
export const PLAN_RATE_HOUR = { limit: 120, windowSec: 3600, label: 'plan-hour' } as const

/* -------------------------------------------------------------------------- */
/* The bounded read.                                                            */
/* -------------------------------------------------------------------------- */

export type BoundedBody = { ok: true; text: string } | { ok: false; bytes: number }

/**
 * Read a request body as UTF-8 text, aborting the moment it exceeds `maxBytes`.
 *
 * ⚠ Measures the ACTUAL STREAM, and must never consult Content-Length: that header is caller-supplied
 * and a lie survives verbatim into the handler (INV-3). This is also why hono's own `bodyLimit` was
 * rejected — when Content-Length is present and Transfer-Encoding is absent it short-circuits on the
 * HEADER and never measures a byte, which would put the guarantee in the transport instead of here.
 * (Its default onError also throws an HTTPException, which ./index.ts's error handler turns into a 500.)
 *
 * ⚠ Measures BYTES, never String.length. `.length` is UTF-16 code units: 10 CJK characters are
 * `.length === 10` and 30 bytes, so a length-based cap is ~3x bypassable.
 *
 * ⚠ CONSUMES req.body. Nothing may call c.req.json()/text() afterwards — hono only caches bodies read
 * through its OWN accessors, so a downstream read throws ERR_BODY_ALREADY_USED. Parse the returned
 * string instead. Do not "fix" that by seeding c.req.bodyCache: its declared type is `text: string`
 * while the runtime stores a Promise, so a plain-string assignment typechecks and then throws.
 *
 * ⚠ The cancel() on the reject path is load-bearing, not tidiness — it aborts the producer instead of
 * leaving a large body undrained on a keep-alive connection.
 *
 * The cap bounds what reaches JSON.parse and the model, NOT bytes read off the socket: a single read can
 * overshoot before the counter trips, so callers and tests assert `ok === false`, never an exact count.
 */
export async function readBoundedText(req: Request, maxBytes: number): Promise<BoundedBody> {
  const body = req.body
  if (!body) return { ok: true, text: '' }

  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8')
  let bytes = 0
  let text = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      bytes += value.byteLength
      if (bytes > maxBytes) {
        await reader.cancel()
        return { ok: false, bytes }
      }
      // `stream: true` so a multi-byte character split across two chunks decodes correctly instead of
      // becoming two replacement chars — a real rider message ("café", an emoji) would otherwise fail
      // JSON.parse depending only on where the chunk boundary happened to land.
      text += decoder.decode(value, { stream: true })
    }
  } finally {
    reader.releaseLock()
  }
  return { ok: true, text: text + decoder.decode() }
}
