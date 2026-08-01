// THE PLANNER CLIENT — one conversational turn against POST /drives/plan, read as a live stream.
//
// The turn is delivered as SSE: zero or more `event: say` frames carrying one delta each, then
// exactly ONE `event: turn` frame carrying the whole DrivePlanResponse.
//
// ⚠ THE TERMINAL FRAME IS AUTHORITATIVE AND ITS `say` MAY DIFFER FROM THE DELTAS — a refusal
// REPLACES the streamed text entirely, a truncation APPENDS a retry line to it. So a caller
// REPLACES its buffer with the terminal `say`; it must never append the terminal frame to what it
// already animated. Deltas are a typing animation, the terminal frame is the message.
//
// ⚠ EOF WITH NO `turn` FRAME MEANS THE TURN FAILED. There is no `[DONE]` sentinel — the terminal
// frame IS the sentinel. A partial `say` from a failed turn must be DROPPED from the transcript and
// never re-sent: it is a transcript of something the model never actually said, and re-sending it
// both poisons the next turn's cached prompt prefix and lies to the rider.
//
// The socket half lives here rather than in api.ts because api.ts is a column of
// `parseDto(schema, await fetchJson(...))` one-liners over ONE buffered helper, and a streaming
// state machine with three timers destroys that shape. The pure SSE plumbing lives one file further
// out (./planner-util) so it unit-tests under `bun test` — same split as connectivity/gps/offline.
//
// ⚠ INV-13: NOTHING here logs. There is not one `console.*` in this file, deliberately — every
// value passing through is rider content or vendor prose, and neither may reach a log or disk. The
// transcript is React state in the conversation screen; this file caches nothing.
//
// ⚠ EventSource is not an option even where one exists: it is GET-only (it cannot carry the
// transcript) and it AUTO-RECONNECTS, which on a path that bills a model per request would silently
// re-spend after any drop.

import { drivePlanResponse } from '@skipper/shared'
import type { DrivePlanRequest, DrivePlanResponse } from '@skipper/shared'
// Imported EXPLICITLY even though expo already installs its fetch as the global one: an
// EXPO_PUBLIC_USE_RN_FETCH flag, a devtools network shim, or a change in expo's global-install order
// would silently swap in a buffering XHR-backed fetch, and the only symptom would be that every
// delta arrives at once at the end — a bug with no error and no stack.
import { fetch as expoFetch } from 'expo/fetch'
import { ApiError, ContractError, OfflineError, parseDto } from './api'
import { API_URL } from './auth'
import { noteNetworkReachable, shouldSkipRequest } from './connectivity'
import { createSseParser, parseSayDelta } from './planner-util'

/** Request start → response HEADERS. The server writes its SSE headers before it does anything
 *  billable, so this bounds DNS + TLS + a Cloud Run cold start and nothing else. Deliberately a
 *  SEPARATE number from api.ts's REQUEST_TIMEOUT_MS: that one bounds a whole buffered request
 *  including its body read, this one bounds only the handshake. */
const PLAN_FIRST_BYTE_TIMEOUT_MS = 20_000

/** Max GAP between bytes once the stream is open. ⚠ MUST EXCEED the server's own per-attempt model
 *  wall (PLANNER_TIMEOUT_MS in apps/api/src/limits.ts): the planner runs with thinking display
 *  'omitted', so the wire is legitimately SILENT for the entire thinking phase, and a tighter idle
 *  bound would kill a turn the rider already paid for and that was about to land. The server also
 *  writes a `: keep-alive` SSE comment on a timer, which the parser discards as a comment while
 *  still counting as a byte here — that is what makes 60 s a ceiling rather than the normal case. */
const PLAN_IDLE_TIMEOUT_MS = 60_000

/** Hard backstop on the whole turn, above the server's worst legitimate case (its model wall × its
 *  one retry, plus backoff), so we never truncate a turn that WILL land. This is the bound the idle
 *  timer cannot supply: a half-open socket trickling one byte every 59 s never goes idle and would
 *  hang the conversation forever. */
const PLAN_TOTAL_TIMEOUT_MS = 120_000

/** Why a stream ended without an authoritative terminal frame. Carried for the caller's telemetry
 *  and branching only — none of it is rider-facing copy. */
export type PlanStreamFailure = 'first_byte' | 'idle' | 'total' | 'no_terminal' | 'transport'

/** The stream produced no authoritative terminal frame. Carries NO server text (INV-13), which is
 *  why `errorMessage(e, fallback)` deliberately falls through to the caller's in-persona fallback
 *  line rather than growing a branch for this class. */
export class PlanStreamError extends Error {
  constructor(readonly reason: PlanStreamFailure) {
    super(`planner stream failed: ${reason}`)
    this.name = 'PlanStreamError'
  }
}

/** The CALLER's signal fired — the rider navigated away, backgrounded the app, or hit stop. Distinct
 *  from PlanStreamError because the UI must fail SILENTLY: the rider caused this and does not need a
 *  line of apology for it. */
export class PlanAbortedError extends Error {
  constructor() {
    super('aborted')
    this.name = 'PlanAbortedError'
  }
}

/** ⚠ THE ONLY CORRECT WAY TO DETECT A RIDER CANCEL. Do NOT key on the thrown error's name or type:
 *  aborting an expo/fetch stream rejects the in-flight read with a PLAIN `Error(string)`, not a
 *  `DOMException` named 'AbortError' (verified in expo's iOS Fetch source, 2026-08-01), so the usual
 *  `e.name === 'AbortError'` check silently never matches and every cancel reads as a transport
 *  failure — complete with an error card the rider never asked for. */
export const isPlanAborted = (e: unknown): boolean => e instanceof PlanAbortedError

export interface PlanTurnOptions {
  /** Called once per rider-visible token as `say` frames arrive. NEVER authoritative — see the
   *  terminal-frame note at the top of this file. A throw from here is SWALLOWED: a broken text sink
   *  must not cost a turn that has already been billed. */
  onDelta?: (delta: string) => void
  /** Caller cancellation. ⚠ This is a spend control, not tidiness: without it a rider who leaves the
   *  screen bills a model call to completion that nobody will ever read. */
  signal?: AbortSignal
}

/**
 * One planner turn. The conversation is STATELESS — the caller holds the transcript and re-sends it
 * whole every turn; nothing about a turn is remembered here or on the server.
 *
 * ⚠ NEVER RETRIES, and that is deliberate rather than an omission. Every attempt bills a model call
 * anonymously with no human in the loop, which is exactly why the server itself is tuned down to one
 * retry; doubling that from the client would be a cost regression wearing resilience as a costume.
 * A retry is a rider tap.
 *
 * ⚠ ANONYMOUS BY CONSTRUCTION, and that is the point (see the anonymous-call rule in api.ts). This
 * function does not import authClient, so there is no cookie to send and no `anonymous: true` flag a
 * future caller can forget to pass. `credentials: 'omit'` is the belt to that brace — expo/fetch
 * injects HTTPCookieStorage cookies natively when credentials is 'include'. Do NOT add a per-install
 * identifier "for rate limiting": it would relink preview activity to an identity and make the App
 * Privacy label wrong.
 *
 * Throws: `OfflineError` (never left the phone), `ApiError` (413/400/429/5xx — the server's own
 * in-persona message rides in it and is shown as-is), `ContractError` (terminal frame off-DTO →
 * "please update"), `PlanAbortedError` (the caller's signal — fail SILENTLY), `PlanStreamError`
 * (everything else — show the caller's fallback line plus a retry affordance).
 */
export async function planTurn(
  req: DrivePlanRequest,
  opts?: PlanTurnOptions,
): Promise<DrivePlanResponse> {
  // Pre-flight: with no network, don't spend two minutes of timers discovering it. Same gate every
  // other request in the app goes through, and it fails OPEN (see connectivity.ts).
  if (shouldSkipRequest()) throw new OfflineError()

  const caller = opts?.signal
  const controller = new AbortController()
  let failure: PlanStreamFailure | null = null
  const fail = (reason: PlanStreamFailure): void => {
    failure = reason
    controller.abort()
  }
  // Read through a function so the value is the DECLARED type at the catch, not whatever the
  // compiler narrowed it to at the point of initialization (every write happens in a timer closure).
  const failedAs = (): PlanStreamFailure => failure ?? 'transport'

  const total = setTimeout(() => fail('total'), PLAN_TOTAL_TIMEOUT_MS)
  let firstByte: ReturnType<typeof setTimeout> | null = setTimeout(
    () => fail('first_byte'),
    PLAN_FIRST_BYTE_TIMEOUT_MS,
  )
  let idle: ReturnType<typeof setTimeout> | null = null
  const bump = (): void => {
    if (idle) clearTimeout(idle)
    idle = setTimeout(() => fail('idle'), PLAN_IDLE_TIMEOUT_MS)
  }

  // AbortSignal.any so BOTH survive — the caller's cancel and our own timers. (Setting one as
  // `signal:` after spreading the other is the bug this construction exists to make impossible; see
  // the ⚠ at the fetch in api.ts.) It is a WinterCG global here: expo installs it when the engine
  // lacks it.
  const signal = caller ? AbortSignal.any([caller, controller.signal]) : controller.signal

  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  try {
    const res = await expoFetch(`${API_URL}/drives/plan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Content negotiation: this header alone is what asks for frames. Without it the same route
        // answers with the identical response as one buffered JSON body — which is the fallback
        // branch below, not a bug.
        Accept: 'text/event-stream',
      },
      credentials: 'omit',
      body: JSON.stringify(req),
      signal,
    })
    // A response of ANY status proves the device reached the network — correct a stale offline
    // verdict now rather than let it short-circuit the app for the rest of the process.
    noteNetworkReachable()
    clearTimeout(firstByte)
    firstByte = null
    bump()

    // ⚠ ORDERING RULE: decide ok + content-type BEFORE getReader(). Once a reader locks the stream,
    // .json() throws "body is already used" and both branches below become unreachable. (Merely
    // reading the `.body` getter is safe — the stream is lazy-pull.)
    if (!res.ok) {
      // Every rejection the server makes — an over-cap body, a malformed request, the rate limiter,
      // a 5xx — happens BEFORE streaming starts and answers as JSON on both Accepts. The `message`
      // is server-authored and already in persona, so it is shown as-is.
      const j = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
      throw new ApiError(res.status, j.error, j.message ?? `Request failed (${res.status})`)
    }

    const ctype = res.headers.get('content-type') ?? ''
    if (!ctype.includes('text/event-stream') || !res.body) {
      // ⚠ NOT DEAD CODE, and deleting it turns a routine deploy into "the conversation is broken":
      // Cloud Run splits traffic during a rollout, so an older revision can answer this exact
      // request with the unchanged buffered JSON body. One rider, one complete turn, zero deltas —
      // correct, just not animated. The server also answers this way for its two in-persona 200s
      // (the turn cap, an unknown region), on purpose, so this branch carries real turns too.
      return parseDto(drivePlanResponse, await res.json())
    }

    const parser = createSseParser()
    reader = res.body.getReader()
    let terminal: DrivePlanResponse | null = null

    for (;;) {
      const { done, value } = await reader.read()
      // Reset the idle timer on EVERY chunk, heartbeat comments included — liveness is bytes on the
      // wire, not `say` frames. A turn can legitimately emit no `say` at all for its whole thinking
      // phase, so treating "no delta yet" as hung would kill the slowest real turns first.
      bump()
      // ⚠ `value` can be undefined on the terminating read, and this decoder throws on a non-object
      // input rather than treating it as empty — hence the explicit falsy guard.
      const frames = done ? parser.end() : value ? parser.push(value) : []
      for (const f of frames) {
        if (f.event === 'say') {
          const delta = parseSayDelta(f.data)
          if (delta && opts?.onDelta) {
            try {
              opts.onDelta(delta)
            } catch {
              // The sink is broken, not the turn. We already paid for this turn; losing it because a
              // render threw would be the expensive way to report a UI bug.
            }
          }
        } else if (f.event === 'turn') {
          let raw: unknown
          try {
            raw = JSON.parse(f.data)
          } catch {
            // A terminal frame we can't even parse is a transport failure, not a crash.
            throw new PlanStreamError('transport')
          }
          terminal = parseDto(drivePlanResponse, raw) // a ZodError becomes ContractError
          break // FIRST terminal frame wins; nothing after it is contractual
        }
        // ⚠ Any OTHER event name is IGNORED, never an error — that is what lets the server add a
        // frame type (a liveness ping, say) without shipping a new app first.
      }
      if (terminal || done) break
    }
    if (!terminal) throw new PlanStreamError('no_terminal')
    return terminal
  } catch (e) {
    if (
      e instanceof ApiError ||
      e instanceof ContractError ||
      e instanceof OfflineError ||
      e instanceof PlanAbortedError
    ) {
      throw e
    }
    // ⚠ Discriminate on OUR OWN state, never on the thrown error — see isPlanAborted above. The
    // caller's cancel is checked first because it also aborts the fetch, so it arrives disguised as
    // a transport failure.
    if (caller?.aborted) throw new PlanAbortedError()
    if (e instanceof PlanStreamError) throw e
    throw new PlanStreamError(failedAs())
  } finally {
    clearTimeout(total)
    if (firstByte) clearTimeout(firstByte)
    if (idle) clearTimeout(idle)
    // Cancel the reader on the way out — including the success path, where we stopped reading at the
    // terminal frame with bytes possibly still in flight. This closes the socket promptly and emits
    // no error of its own.
    await reader?.cancel().catch(() => {})
  }
}
