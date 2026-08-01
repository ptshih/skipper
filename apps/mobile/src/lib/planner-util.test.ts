import { describe, expect, test } from 'bun:test'
import { createSseParser, parseSayDelta } from './planner-util'

const enc = new TextEncoder()
const feed = (p: ReturnType<typeof createSseParser>, s: string) => p.push(enc.encode(s))

describe('createSseParser', () => {
  test('one complete frame in one chunk', () => {
    const p = createSseParser()
    expect(feed(p, 'event: say\ndata: {"delta":"Well"}\n\n')).toEqual([
      { event: 'say', data: '{"delta":"Well"}' },
    ])
  })

  // Chunk boundaries are whatever URLSession hands us — TCP/HTTP framing, NEVER SSE frames.
  test('a frame split across two chunks emits nothing until it completes', () => {
    const p = createSseParser()
    expect(feed(p, 'event: say\nda')).toEqual([])
    expect(feed(p, 'ta: {"delta":"x"}\n\n')).toEqual([{ event: 'say', data: '{"delta":"x"}' }])
  })

  test('two frames in ONE chunk come back in order', () => {
    const p = createSseParser()
    expect(feed(p, 'event: say\ndata: {"delta":"a"}\n\nevent: say\ndata: {"delta":"b"}\n\n')).toEqual([
      { event: 'say', data: '{"delta":"a"}' },
      { event: 'say', data: '{"delta":"b"}' },
    ])
  })

  test('\\r\\n line endings parse identically to \\n', () => {
    const p = createSseParser()
    expect(feed(p, 'event: turn\r\ndata: {"done":true}\r\n\r\n')).toEqual([
      { event: 'turn', data: '{"done":true}' },
    ])
  })

  // ⚠ THE test that pays for itself. Without the pendingCR carry, a per-chunk
  // `.replace(/\r\n?/g,'\n')` turns a straddling '\r' + '\n' into TWO newlines — a FALSE frame
  // boundary mid-frame, which severs the `event:` line from its `data:` line. The terminal frame
  // then arrives unnamed, the client never matches `event: turn`, and a turn the rider already
  // paid for dies as 'no_terminal'.
  //
  // ⚠ The straddle MUST be tested mid-frame. A carry lost at the frame's own trailing '\r\n\r\n'
  // is benign (the false boundary lands where the real one already was) — that variant passes even
  // with the naive replace, which is exactly why it is not the case pinned here.
  test('a CRLF straddling a chunk boundary MID-FRAME yields exactly ONE named frame', () => {
    const p = createSseParser()
    const first = feed(p, 'event: turn\r')
    const second = feed(p, '\ndata: {"done":true}\r\n\r\n')
    expect([...first, ...second]).toEqual([{ event: 'turn', data: '{"done":true}' }])
  })

  test('a CRLF straddling the blank line that ENDS a frame yields exactly one frame', () => {
    const p = createSseParser()
    const first = feed(p, 'event: turn\r\ndata: {"done":true}\r')
    const second = feed(p, '\n\r\n')
    expect([...first, ...second]).toEqual([{ event: 'turn', data: '{"done":true}' }])
  })

  test('exactly one leading space is stripped from a field value', () => {
    const p = createSseParser()
    const withSpace = feed(p, 'data: {"delta":"x"}\n\n')
    const without = feed(p, 'data:{"delta":"x"}\n\n')
    expect(withSpace).toEqual(without)
    expect(withSpace[0]?.data).toBe('{"delta":"x"}')
  })

  test('a payload that legitimately starts with a space keeps it', () => {
    const p = createSseParser()
    expect(feed(p, 'data:  x\n\n')[0]?.data).toBe(' x')
  })

  test('multi-line data: is joined with a newline', () => {
    const p = createSseParser()
    expect(feed(p, 'event: say\ndata: one\ndata: two\n\n')[0]?.data).toBe('one\ntwo')
  })

  // The `: keep-alive` heartbeat. It exists so the idle timer can tell a thinking model from a dead
  // socket, and it must never look like an event.
  test('a comment-only block dispatches nothing and leaves the buffer clean', () => {
    const p = createSseParser()
    expect(feed(p, ': keep-alive\n\n')).toEqual([])
    expect(feed(p, 'event: turn\ndata: {}\n\n')).toEqual([{ event: 'turn', data: '{}' }])
  })

  test('an unknown event name is returned, not dropped and not an error', () => {
    const p = createSseParser()
    expect(feed(p, 'event: thinking\ndata: {}\n\n')).toEqual([{ event: 'thinking', data: '{}' }])
  })

  // id:/retry: drive EventSource's auto-reconnect, which we must never do on a billed turn.
  test('id: and retry: are ignored but the frame still dispatches', () => {
    const p = createSseParser()
    expect(feed(p, 'id: 7\nretry: 3000\nevent: say\ndata: {"delta":"x"}\n\n')).toEqual([
      { event: 'say', data: '{"delta":"x"}' },
    ])
  })

  test('a frame with no event: field defaults to "message"', () => {
    const p = createSseParser()
    expect(feed(p, 'data: {"delta":"x"}\n\n')[0]?.event).toBe('message')
  })

  // A multi-byte character split across chunks must not decode as two replacement chars.
  test('a UTF-8 sequence split across a chunk boundary decodes correctly', () => {
    const p = createSseParser()
    const bytes = enc.encode('data: {"delta":"café"}\n\n')
    // 'é' is two bytes in UTF-8; cut BETWEEN them.
    const cut = 'data: {"delta":"caf'.length + 1
    const out = [...p.push(bytes.slice(0, cut)), ...p.push(bytes.slice(cut))]
    expect(out).toEqual([{ event: 'message', data: '{"delta":"café"}' }])
    expect(out[0]?.data).not.toContain('�')
  })

  test('end() flushes a trailing frame the server never terminated with a blank line', () => {
    const p = createSseParser()
    expect(feed(p, 'event: turn\ndata: {"done":true}')).toEqual([])
    expect(p.end()).toEqual([{ event: 'turn', data: '{"done":true}' }])
  })

  test('end() on an empty or whitespace-only buffer yields nothing', () => {
    const empty = createSseParser()
    expect(empty.end()).toEqual([])
    const ws = createSseParser()
    feed(ws, '\n\n  \n')
    expect(ws.end()).toEqual([])
  })

  test('an empty chunk is a no-op, not a throw', () => {
    const p = createSseParser()
    expect(p.push(new Uint8Array(0))).toEqual([])
    expect(feed(p, 'data: {"delta":"x"}\n\n')).toEqual([
      { event: 'message', data: '{"delta":"x"}' },
    ])
  })
})

describe('parseSayDelta', () => {
  test('a well-formed say payload yields the delta', () => {
    expect(parseSayDelta('{"delta":"hi"}')).toBe('hi')
  })

  // A bad frame costs one token of animation; the terminal frame is authoritative regardless, so
  // there is nothing worth failing a paid turn over.
  test('malformed JSON yields null and never throws', () => {
    expect(parseSayDelta('{"delta":')).toBeNull()
    expect(parseSayDelta('')).toBeNull()
  })

  test('a non-string, empty, or shapeless payload yields null', () => {
    expect(parseSayDelta('{"delta":123}')).toBeNull()
    expect(parseSayDelta('{"delta":""}')).toBeNull()
    expect(parseSayDelta('null')).toBeNull()
    expect(parseSayDelta('[]')).toBeNull()
    expect(parseSayDelta('{}')).toBeNull()
  })
})
