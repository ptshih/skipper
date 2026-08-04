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

/** POST /drives/propose and POST /drives carry at most 10 endpoints (start + end + `via`'s max of 8)
 *  plus an idempotency key. The SHAPE is owned by packages/shared/src/schemas.ts, not restated here.
 *  ⚠ THE HEADROOM IS ENORMOUS AND THAT IS DELIBERATE, NOT SLACK TO BE RECLAIMED. Since the step-4 wire
 *  commit an endpoint is a bare UUID — `anchorId`, the only thing a request may name an endpoint by —
 *  so the worst-case LEGAL body is a few hundred bytes and this cap clears it by orders of magnitude.
 *  It is a parse/DoS guard, not a fitted bound: tightening it toward the real worst case would buy
 *  nothing (nothing is billed per byte here) and would put a 413 one schema change away from a rider
 *  who did nothing wrong. test/drive-body-caps.test.ts derives the worst-case legal body FROM the
 *  schema and asserts it clears — so this stays true when the shape moves, without a number in prose.
 *  ⚠ An earlier version of this comment justified the value from a body carrying a 200-character NAME
 *  per endpoint. That shape has not existed since step 4 (`schemas.ts`: "a request can no longer carry
 *  one"), which is why the derivation now points at the schema instead of restating it.
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
/* Transport bounds. Not rider-facing caps — they are here because each one     */
/* must CLEAR another, and a relationship you cannot assert is a relationship    */
/* that drifts. The drift guard lives in test/limits.test.ts.                    */
/* -------------------------------------------------------------------------- */

/** The socket's patience, wired into the Bun server export in ./index.ts.
 *  ⚠ Bun's default is 10 SECONDS (bun-types serve.d.ts, `idleTimeout` @default 10) and it fires WHILE A
 *  HANDLER IS STILL RUNNING, not only between requests — which silently capped POST /drives/plan at ten
 *  seconds against a 45-second model wall clock, returning the rider a dead socket while the Opus call
 *  kept generating and billing to completion. VERIFIED by probe 2026-08-01: a 12 s handler returned 200,
 *  a 16 s handler had its socket closed at ~12 s, and the same handler under `idleTimeout: 60` returned
 *  200 at 25 s.
 *  ⚠ PROCESS-WIDE, so it must clear the SLOWEST route rather than the planner alone (POST /drives does a
 *  Routes call plus a corpus read plus a write). 120 s sits well under Cloud Run's 300 s request timeout
 *  (cloudbuild.yaml passes no --timeout) and well above PLANNER_TIMEOUT_MS below.
 *  ⚠ Not reachable by any test — an in-process app.fetch(new Request(...)) never touches a socket, the
 *  same limitation SERVER_MAX_BODY_BYTES has. The relationship assert against PLANNER_TIMEOUT_MS is the
 *  entire guard. The SSE comment heartbeat on the streaming path (./plan-route.ts) is the belt to this
 *  file's braces, and the only thing that also covers an intermediary we do not control. */
export const SERVER_IDLE_TIMEOUT_SEC = 120

/** The planner's hard wall clock, passed as an AbortSignal on the model request.
 *  ⚠ It lives HERE rather than beside the call because SERVER_IDLE_TIMEOUT_SEC has to clear it, and a
 *  number in another file is a number nobody re-checks. The SDK's own per-ATTEMPT socket timeout is set
 *  from this same value in ./planner.ts, but that one IS retried — so the worst case without this signal
 *  is roughly this x (maxRetries + 1) plus backoff. This is the bound that is actually true. */
export const PLANNER_TIMEOUT_MS = 45_000

/* -------------------------------------------------------------------------- */
/* Planner conversation caps. Consumed by POST /drives/plan (./plan-route.ts).  */
/* Decided here rather than at the call site so the route inherits an argued     */
/* number instead of inventing one under deadline — the whole point of INV-12.   */
/* -------------------------------------------------------------------------- */

/** The BACKSTOP a rider should never reach, because the in-persona wrap-up (D12) has already landed the
 *  conversation by then. A real "plan me a drive" runs 3-8 exchanges.
 *  ⚠ The turn count the CLIENT asserts is advisory; this is the one that is true.
 *  ⚠ UNITS, because they were mixed here and it matters: this counts MESSAGES (both roles), so the
 *  3-8 exchanges above is 6-16 messages. An earlier note called 24 "~2x the wrap-up point", which reads
 *  as ~2x in EXCHANGES; against the number it actually compares to, it is 1.5x the top of normal. */
export const MAX_PLAN_MESSAGES = 24

/** Where the in-persona wrap-up STARTS riding (D12) — the producer for `wrapUpNotice` in ./planner.
 *
 *  ⚠ NOT A GUARD, and the distinction is the whole of D12: `MAX_PLAN_MESSAGES` is the guard (INV-3) and
 *  answers with a hard stop. This one is the UX that means a rider never meets it — the skipper starts
 *  bowing out on his own, in character, several exchanges early. Both are needed: prose cannot enforce a
 *  cap, and a cap cannot be charming.
 *
 *  WHY 16, derived rather than picked: it is the TOP of the normal band (8 exchanges = 16 messages), so
 *  the nudge can never fire on a healthy conversation — it only ever sees one that has already run past
 *  what planning a drive takes. That leaves 24 - 16 = 8 messages, about 4 exchanges, to land it warmly,
 *  which is real runway rather than a one-turn scramble.
 *
 *  ⚠ IT ALSO COSTS MONEY TO BE WRONG DOWNWARD. The notice is a THIRD system block rendered AFTER the
 *  cache breakpoint (./planner), so every turn it rides is uncached input tokens. Lowering this makes an
 *  ordinary conversation pay that on most of its turns; raising it past the cap disables D12 silently.
 *  Keep it strictly between the normal band and MAX_PLAN_MESSAGES — there is a test pinning exactly that. */
export const PLAN_WRAP_UP_AFTER_MESSAGES = 16

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

/** How long `POST /drives/plan` may reuse a region's cached name + anchor roster (./roster-cache).
 *
 *  ⚠ A LOAD CAP, NOT A SPEND CAP — but it sits beside the spend ones deliberately, because the
 *  resource it protects is the one they share. Without it the planner paid TWO SEQUENTIAL Neon
 *  round-trips on every rider MESSAGE (the anchor query needs the bbox the region query returns) to
 *  re-read something that changes only when an operator releases a region or runs `curate-places`.
 *  `/regions` is hit once per app launch and already has REGIONS_MEMO_TTL_MS; this path is hit once
 *  per message and had nothing.
 *
 *  ⚠ A SEPARATE CONSTANT FROM REGIONS_MEMO_TTL_MS, same value today by agreement rather than by
 *  derivation — and they must stay separate because they answer to different pressures. That one
 *  trades against how fast an operator sees a release in the PICKER; this one also governs how long a
 *  roster stays byte-stable inside the CACHED system-prompt prefix, so lowering it toward zero starts
 *  re-billing prefixes mid-conversation. Raising either only ever delays an operator.
 *
 *  ⚠ ITS COST IS OPERATOR-VISIBLE, NEVER RIDER-VISIBLE: after curating places, an operator waits up
 *  to this long PER LIVE INSTANCE before the skipper can send anyone to the new one. */
export const PLAN_ROSTER_MEMO_TTL_MS = 60_000

/** How many curated anchors the planner is handed in its system prompt.
 *  ⚠ THIS IS NOW A SERVE CAP, NOT A CEILING THE DATA MUST STAY UNDER — read this before treating a
 *  truncation as a bug. It was written as the latter, on the assumption that a region holding more rows
 *  than this meant something had gone wrong. That assumption is retired: curation deliberately drafts
 *  DEEPER than this and stores the tail (founder, 2026-08-04, "store deep, serve shallow"), because the
 *  alternative made the draft's cut-off irreversible — a place the model left out was simply never
 *  named, recoverable only by paying for another draft, while a place ranked past this cap sits in the
 *  table and is promotable by editing ONE field.
 *  So a region exceeding this is an ORDINARY operating state. What still holds is why a cap exists at
 *  all: the roster rides in a per-request prompt on every rider turn, so an unbounded list is an
 *  unbounded per-request bill, and a planner cannot hold hundreds of names in useful attention anyway.
 *  ⚠ It is only a safe cap while the order is MEANINGFUL — it must be by `rank`, so what gets dropped
 *  is the least-asked-for rather than an arbitrary tail. Pair it with a stable ORDER BY; see
 *  loadRegionAnchors. ⚠ Truncation is now invisible to an operator unless something SHOWS it, which is
 *  why the admin Places page surfaces the count against this number — "it is in the table" is only a
 *  promise if someone can check it. */
export const MAX_PLAN_ANCHORS = 200

/* -------------------------------------------------------------------------- */
/* Rate-limiter buckets — the NUMBERS only (mechanism: ./rate-limit.ts).        */
/* Keyed per-IP and per-INSTANCE, so the effective ceiling is limit x live       */
/* instances (RISK-4, accepted while unlaunched).                                */
/*                                                                              */
/* ⚠ EVERY BUCKET'S `label` MUST BE UNIQUE, and that is no longer only cosmetic:  */
/* it is the bucket-map key prefix AND the only field a 429 emits, because the    */
/* rider's IP may never be logged (INV-13). Two buckets sharing a label makes a   */
/* rejection unattributable with nothing left to join on. Asserted in            */
/* test/limits.test.ts.                                                          */
/* -------------------------------------------------------------------------- */

/** POST /drives/propose — one Google Routes call per request. Unchanged value, moved here from index.ts. */
export const PROPOSE_RATE = {
  limit: 15,
  windowSec: 60,
  label: 'propose',
  message: "Still got my pencil out from the last one. Give me a second and ask me again.",
} as const

/** POST /drives — Routes + a credit consume + a write. Unchanged value, moved here from drives.ts. */
export const DRIVE_CREATE_RATE = {
  limit: 15,
  windowSec: 60,
  label: 'drives-create',
  message: "One at a time, friend. I'm still hitching up the last one.",
} as const

/** POST /drives/plan, per minute — LOOSER than propose on purpose: the INTENT COUNT differs, not the
 *  cost. Propose fires once per conversation; plan fires 5-10 times, and a fast typist can plausibly
 *  reach a dozen turns in a minute. Matching propose's 15 would put a real rider one retry away from a
 *  429 mid-conversation, holding the only copy of the transcript. */
export const PLAN_RATE_MINUTE = {
  limit: 20,
  windowSec: 60,
  label: 'plan-min',
  message: "You're quicker than I am, friend. Give me a breath and say that again.",
} as const

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
export const PLAN_RATE_HOUR = {
  limit: 120,
  windowSec: 3600,
  label: 'plan-hour',
  message: "That's a fair bit of planning for one sitting. Rest the voice a spell and come back to me.",
} as const

/** GET /sample — the anonymous "taste" clip. The LOOSEST bucket here, and the only one whose number is
 *  not argued from a vendor bill: the handler runs one indexed limit-1 query and then SIGNS the R2 URL
 *  in-process (presign is a local computation, not a request — packages/storage), so unlike propose and
 *  plan there is no per-request Google Routes or model charge behind it. What it caps is DB load and the
 *  standing invitation any anonymous, uncapped, DB-touching route represents — not spend. That is the
 *  whole reason it may sit above the paid buckets rather than beside them.
 *  ⚠ VALUE UNCHANGED from the inline literal it replaces at the ./index.ts mount. A RE-HOMING, never a
 *  re-pricing: a rider-facing cap moves only on an explicit founder call (CLAUDE.md STOP), so the commit
 *  that gives a cap a home must never also be the commit that changes its number. */
export const SAMPLE_RATE = {
  limit: 30,
  windowSec: 60,
  label: 'sample',
  message: 'Let me catch my breath, friend. Try that again in a moment.',
} as const

/** GET /regions — the last anonymous, uncapped, DB-touching route.
 *
 *  ⚠ WHAT IT CAPS IS NOT THE QUERIES THE MEMO ALREADY COVERS. `REGIONS_MEMO_TTL_MS` bounds the two
 *  corpus reads to one pair per instance per minute, so those were never the exposure. The other cost
 *  is `withSession`, which runs on every request BEFORE the memo is consulted, on the separate
 *  neon-serverless auth Pool.
 *
 *  ⚠ AND BE PRECISE ABOUT THAT COST, because the first version of this comment was NOT — it claimed
 *  every request pays an auth-DB round-trip, inherited from a ./index.ts paragraph that `7bd7614`
 *  obsoleted five minutes after it was written. Read off the installed better-auth 1.6.23
 *  (`dist/api/routes/session.mjs`), with `cookieCache: { enabled: true, maxAge: 60 }` in ./auth:
 *  no session-token cookie or a bad signature returns null with NO DB read; a valid token plus a
 *  valid `sessionData` cookie is answered FROM THE COOKIE with no DB read. The DB is reached only
 *  when a validly-signed token arrives WITHOUT usable `sessionData`.
 *
 *  That is still worth capping, and it is the sharper reason rather than the weaker one: the missing
 *  half is ATTACKER-CONTROLLED. Anyone may mint an anonymous session (D16) and then send only the
 *  session-token cookie, omitting `sessionData`, forcing a fresh auth-DB lookup on every request for
 *  as long as they like. Honest riders mostly ride the cookie; a deliberate caller does not have to.
 *  It is also why the mount order in ./index.ts is load-bearing rather than cosmetic: registered
 *  BELOW `app.use('/regions', withSession)` this limiter would cap nothing that matters, because the
 *  resolve it exists to bound would already have run.
 *
 *  ⚠ THE LOOSEST BUCKET IN THIS FILE, DELIBERATELY — 4x SAMPLE_RATE, and the reason is the failure
 *  mode, not the cost. Limits key on CLIENT IP, and CGNAT / corporate NAT put many unrelated riders
 *  behind one address; `/regions` is on the LAUNCH path, so a 429 here is not a graceful degrade but
 *  an empty region picker — an app that reads as broken, for people doing nothing wrong. At 120/min a
 *  single abusive host still resolves to ~2 auth-DB round-trips a second, which is the actual thing
 *  worth bounding. There is no vendor charge behind this route at all (INV-12 spend caps are propose
 *  and plan); this is a LOAD cap, in the same family as SAMPLE_RATE.
 *
 *  Number set by founder call 2026-08-03 — a new rider-facing cap, not a re-homing of an existing
 *  literal, which is the one thing the ⚠ on SAMPLE_RATE says a commit may not do quietly. */
export const REGIONS_RATE = {
  limit: 120,
  windowSec: 60,
  label: 'regions',
  message: "Easy there. I'm still unrolling the map, so try me again in a moment.",
} as const

/** How long `GET /regions` may serve its memoized ANONYMOUS payload before re-reading.
 *
 *  Not a spend cap — a LOAD cap, and it belongs beside the others because it governs the same shared
 *  resource they do. `/regions` is hit on every app launch and its answer changes only when an
 *  operator releases a region or re-runs `curate-places`, so without a memo every cold start pays two
 *  queries to learn something that has not changed in days. DB capacity is shared with the paid
 *  endpoints, which is the real reason this matters: hammering the free route degrades
 *  `/drives/plan` and `/drives/propose`.
 *
 *  ⚠ THE COST OF THE NUMBER IS OPERATOR-VISIBLE, not rider-visible: after releasing a region an
 *  operator waits up to this long, PER LIVE INSTANCE, to see it in the app. 60s keeps that inside the
 *  time it takes to switch windows. Raising it trades a slower release feedback loop for load nobody
 *  is currently short of. */
export const REGIONS_MEMO_TTL_MS = 60_000

/* -------------------------------------------------------------------------- */
/* The bounded read.                                                            */
/* -------------------------------------------------------------------------- */

/** Does this transcript fit the planner's caps? Returns a machine reason, or null when it fits.
 *
 *  ⚠ IT LIVES HERE, NOT WITH THE ROUTE, AND THAT IS NOT TIDINESS. The route module imports the anchor
 *  loader from ./drives, which reaches ./entitlements -> ./auth, which THROWS at module load without
 *  BETTER_AUTH_SECRET — so a cap rule defined there is unreachable from a test that has no secret. The
 *  rule is also simply a cap, and caps live in this file. Zero imports here is what keeps it testable.
 *
 *  ⚠ Checks the PER-MESSAGE bound as well as the total: without it a single wall-of-text turn eats the
 *  whole budget, which is simultaneously the best prompt-injection payload shape and the least
 *  diagnosable failure ("too long", with no indication of which turn). */
export function checkTranscript(
  turns: readonly { text: string }[],
): 'too_many_turns' | 'turn_too_long' | 'transcript_too_long' | null {
  if (turns.length > MAX_PLAN_MESSAGES) return 'too_many_turns'
  let total = 0
  for (const t of turns) {
    if (t.text.length > MAX_PLAN_MESSAGE_CHARS) return 'turn_too_long'
    total += t.text.length
  }
  return total > MAX_PLAN_TOTAL_CHARS ? 'transcript_too_long' : null
}

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
