// Pure, native-free SSE plumbing for the live planner stream (no expo/fetch, no ./api, no ./auth
// imports) so it unit-tests under `bun test` — the same split as connectivity-util.ts / gps-util.ts.
// planner.ts owns the socket and the timers; this file owns the bytes.
//
// ⚠ There is no EventSource in React Native, and we would not want one anyway: EventSource is
// GET-only (it cannot carry the transcript body) and it auto-RECONNECTS — on a path that bills a
// model on EVERY request (INV-11) a silent reconnect is a second paid turn nobody asked for.
//
// ⚠ INV-13: nothing in this file logs. Every value that passes through is rider content.

/** One dispatched SSE event. `event` defaults to `'message'` per the spec; `data` is the frame's
 *  `data:` lines joined with '\n' (the spec's rule — a multi-line payload is legal, even though
 *  apps/api never emits one; see parseSayDelta). */
export interface SseFrame {
  event: string
  data: string
}

/** Parse ONE frame block (the text between blank lines). Returns null for a block that dispatches
 *  nothing — a comment-only block (the `: keep-alive` heartbeat) or a block with no `data:` field. */
function parseBlock(block: string): SseFrame | null {
  let event = 'message'
  const data: string[] = []
  for (const line of block.split('\n')) {
    // A line starting with ':' is a COMMENT — the heartbeat's shape. A blank line cannot occur
    // inside a block (it is what ended the block) but skipping it costs nothing.
    if (line === '' || line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    // Exactly ONE leading space is stripped, per the spec — `data:{"x":1}` and `data: {"x":1}` must
    // parse identically, and a payload that legitimately begins with a space keeps the rest of it.
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') event = value
    else if (field === 'data') data.push(value)
    // `id:` and `retry:` are ignored DELIBERATELY: both exist to drive EventSource's automatic
    // reconnect, and reconnecting a paid turn is the one thing we must never do. Any UNKNOWN field
    // is ignored too, so the server can add one without shipping a new app.
  }
  return data.length > 0 ? { event, data: data.join('\n') } : null
}

/**
 * Incremental SSE reader. Feed it raw `Uint8Array` chunks in arrival order; each call returns
 * whichever complete frames that chunk finished.
 *
 * Bytes go in, not strings, because chunk boundaries are whatever URLSession hands us — TCP/HTTP
 * framing, never SSE frame boundaries — so a UTF-8 continuation byte held across a boundary is THIS
 * module's problem, and it is covered by a unit test.
 */
export function createSseParser(): {
  push(chunk: Uint8Array): SseFrame[]
  end(): SseFrame[]
} {
  const decoder = new TextDecoder('utf-8')
  let buf = ''
  // ⚠ A '\r' at the very END of a chunk is AMBIGUOUS: alone it is a line terminator, but followed
  // by the next chunk's '\n' it is one CRLF. Normalising per-chunk without this carry turns a
  // straddling '\r\n\r\n' into '\n\n\n\n' — a FALSE frame boundary that splits one frame in two and
  // drops the terminal `turn`. Hold the '\r' back until we can see the next byte.
  let pendingCR = false

  const normalize = (s: string, final: boolean): string => {
    if (pendingCR) {
      s = '\r' + s
      pendingCR = false
    }
    if (!final && s.endsWith('\r')) {
      pendingCR = true
      s = s.slice(0, -1)
    }
    // On the final pass a re-attached trailing '\r' falls through to here and becomes '\n', which
    // is correct: a lone CR at EOF IS a line terminator.
    return s.replace(/\r\n?/g, '\n')
  }

  const drain = (final: boolean): SseFrame[] => {
    const out: SseFrame[] = []
    for (;;) {
      const i = buf.indexOf('\n\n')
      if (i < 0) break
      const frame = parseBlock(buf.slice(0, i))
      buf = buf.slice(i + 2)
      if (frame) out.push(frame)
    }
    if (final && buf.trim() !== '') {
      // A last frame the server did not terminate with a blank line. Accept it — a TRUNCATED
      // terminal frame then fails its JSON.parse / DTO parse upstream, which is the correct and
      // legible outcome; discarding it here would surface as the much vaguer 'no_terminal'.
      const frame = parseBlock(buf)
      buf = ''
      if (frame) out.push(frame)
    }
    return out
  }

  return {
    push(chunk) {
      buf += normalize(decoder.decode(chunk, { stream: true }), false)
      return drain(false)
    },
    end() {
      // A bare decode() flushes whatever partial code point the decoder is still holding.
      // ⚠ Never pass null/undefined here — expo's pure-JS TextDecoder evaluates `'buffer' in input`
      // and throws a TypeError on it (planner.ts already skips falsy chunks for the same reason).
      buf += normalize(decoder.decode(), true)
      return drain(true)
    },
  }
}

/** `event: say` payload → the delta text, or null if the frame is malformed.
 *
 *  The payload is a JSON OBJECT rather than the bare delta string on purpose: SSE `data:` lines are
 *  newline-delimited, and JSON.stringify escapes every control char below U+0020, so a rider- or
 *  model-authored newline can never become a second `data:` line. Do not "simplify" the server to
 *  `data: ${delta}`.
 *
 *  ⚠ NEVER throws. A bad `say` frame costs the rider one token of animation; the TERMINAL frame is
 *  authoritative and its `say` may differ from the deltas anyway, so there is nothing to salvage
 *  here and nothing worth failing a paid turn over. */
export function parseSayDelta(data: string): string | null {
  try {
    const v = JSON.parse(data) as unknown
    if (typeof v !== 'object' || v === null) return null
    const d = (v as { delta?: unknown }).delta
    return typeof d === 'string' && d.length > 0 ? d : null
  } catch {
    return null
  }
}
