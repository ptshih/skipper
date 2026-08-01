// Pure, native-free coalescing for the skipper's streaming turn (no react-native / expo / api
// imports) so it unit-tests under `bun test` — same split as connectivity-util.ts / gps-util.ts.
//
// WHY buffer at all: the planner streams token-sized deltas, and rendering each one as it lands
// makes the skipper read like a teletype rather than someone talking. Flushing at SENTENCE
// granularity is what turns a token stream back into speech. It is also the a11y rule — a bubble
// that re-renders on every token floods TalkBack (the NowCard.tsx lesson), which is why the visible
// text only ever changes a sentence at a time and the one-shot announce waits for settle().
//
// ⚠ INV-13: nothing here logs. Every string that passes through is rider-facing model output.

/** Max time a fragment may sit unshown before it is flushed anyway. Without this a turn that ends
 *  mid-clause (or a long clause between terminators) freezes on screen while tokens are visibly
 *  still arriving. 600ms is short enough to read as "he's still talking", long enough that a normal
 *  sentence completes first and flushes on its own terminator. */
export const SAY_MAX_HOLD_MS = 600

export interface SayBuffer {
  /** What the bubble renders. Only ever grows, until settle() REPLACES it. */
  shown: string
  /** Received but not yet rendered — held for a sentence boundary or the max hold. */
  pending: string
  /** When the current fragment started waiting, or null if nothing is waiting. */
  heldSince: number | null
  /** The terminal frame landed; further deltas are ignored. */
  settled: boolean
}

export const emptySayBuffer = (): SayBuffer => ({
  shown: '',
  pending: '',
  heldSince: null,
  settled: false,
})

/** A sentence terminator, any closing quotes/brackets that belong to it, then whitespace or the end
 *  of what we have. The lookahead is what keeps "3.5" and "skipper.fm" from flushing mid-number.
 *
 *  Known false positive, and we accept it: "Mr. Smith" flushes early. It costs one extra flush and
 *  nothing else. Do NOT add an abbreviation list — it would be a second, drifting copy of English. */
const SENTENCE_END = /[.!?…]["')\]]*(?=\s|$)/g

/** Index just past the LAST sentence boundary in `s`, or -1. */
function lastSentenceEnd(s: string): number {
  SENTENCE_END.lastIndex = 0
  let end = -1
  for (;;) {
    const m = SENTENCE_END.exec(s)
    if (!m) break
    end = m.index + m[0].length
  }
  return end
}

/** Index just past the LAST whitespace character in `s`, or -1. */
function lastWhitespaceEnd(s: string): number {
  for (let i = s.length - 1; i >= 0; i--) {
    if (/\s/.test(s.charAt(i))) return i + 1
  }
  return -1
}

/**
 * Take one delta off the wire. Flushes everything up to the last sentence boundary; whatever is
 * left starts (or keeps) waiting on the max-hold clock.
 *
 * ⚠ A delta arriving mid-hold does NOT reset the clock. If it did, a steady token stream with no
 * terminator in sight would hold forever and the bubble would sit frozen while the turn ran.
 */
export function pushDelta(b: SayBuffer, delta: string, now: number): SayBuffer {
  // Deltas after the terminal frame are dropped: settle() already wrote the authoritative text, and
  // appending to it would resurrect words the server deliberately replaced (a refusal) — see
  // settle()'s note.
  if (b.settled) return b

  const pending = b.pending + delta
  const cut = lastSentenceEnd(pending)
  if (cut > 0) {
    const rest = pending.slice(cut)
    // heldSince goes null even when a tail remains: that tail has not been *held* yet, and its
    // clock starts on the next delta that fails to complete it.
    return { ...b, shown: b.shown + pending.slice(0, cut), pending: rest, heldSince: null }
  }
  return {
    ...b,
    pending,
    heldSince: b.heldSince ?? (pending.length > 0 ? now : null),
  }
}

/**
 * Called from a low-frequency interval while a turn is in flight. Once a fragment has waited
 * `maxHoldMs`, show as much of it as can be shown WITHOUT cutting a word in half.
 *
 * ⚠ Word boundary, not a raw flush. Cutting at "the Emer" reads as a rendering bug, not as speech —
 * which is the entire difference between this and just rendering `shown + pending`.
 */
export function tickHold(b: SayBuffer, now: number, maxHoldMs = SAY_MAX_HOLD_MS): SayBuffer {
  if (b.settled || b.heldSince === null) return b
  if (now - b.heldSince < maxHoldMs) return b

  const cut = lastWhitespaceEnd(b.pending)
  // A single unbroken word (or nothing) — there is no safe cut, so keep holding rather than emit a
  // half-word. Re-arm the clock so we re-check a whole hold later instead of on every tick.
  if (cut <= 0) return { ...b, heldSince: now }

  const rest = b.pending.slice(cut)
  return {
    ...b,
    shown: b.shown + b.pending.slice(0, cut),
    pending: rest,
    heldSince: rest.length > 0 ? now : null,
  }
}

/**
 * The terminal frame landed. Its `say` is AUTHORITATIVE and MAY DIFFER from the concatenated
 * deltas — a refusal REPLACES the streamed text wholesale, a truncation APPENDS a retry line — so
 * this assigns verbatim rather than appending, and the client never has to know which happened.
 * Assigning also repairs any delta the transport dropped.
 *
 * The previous buffer is taken and DELIBERATELY discarded — the parameter keeps the reducer shape
 * every other function here has, and reading it would be the bug (that is how a refusal ends up
 * with the refused text still on screen above it).
 */
export function settle(_prev: SayBuffer, terminalSay: string): SayBuffer {
  return { shown: terminalSay, pending: '', heldSince: null, settled: true }
}
