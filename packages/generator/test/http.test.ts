// pipeline/http — the transient-retry primitives. withRetry guards the stateless neon-http
// reads (a cold-start blip on the first query otherwise kills a run at $0).

import { describe, expect, test } from 'bun:test'
import { withRetry } from '../src/pipeline/http'

describe('withRetry', () => {
  test('returns on first success without retrying', async () => {
    let calls = 0
    const out = await withRetry(async () => {
      calls++
      return 'ok'
    })
    expect(out).toBe('ok')
    expect(calls).toBe(1)
  })

  test('retries a transient failure then succeeds', async () => {
    let calls = 0
    const out = await withRetry(
      async () => {
        calls++
        if (calls < 3) throw new Error('transient blip')
        return calls
      },
      { baseDelayMs: 1 },
    )
    expect(out).toBe(3)
    expect(calls).toBe(3)
  })

  test('throws the LAST error after exhausting attempts', async () => {
    let calls = 0
    const run = withRetry(
      async () => {
        calls++
        throw new Error(`fail ${calls}`)
      },
      { attempts: 3, baseDelayMs: 1 },
    )
    await expect(run).rejects.toThrow('fail 3')
    expect(calls).toBe(3)
  })

  test('a non-retryable success value (incl. falsy) is returned as-is', async () => {
    expect(await withRetry(async () => 0, { baseDelayMs: 1 })).toBe(0)
    expect(await withRetry(async () => null, { baseDelayMs: 1 })).toBeNull()
  })
})
