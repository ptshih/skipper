import { describe, expect, test } from 'bun:test'
import { withRetry } from '../src/retry'

describe('withRetry (retry-then-rethrow for API reads)', () => {
  test('passes a resolved value straight through — no retry on success', async () => {
    let calls = 0
    const got = await withRetry(async () => {
      calls++
      return 'ok'
    })
    expect(got).toBe('ok')
    expect(calls).toBe(1)
  })

  test('a one-off transient throw is retried, then succeeds', async () => {
    let calls = 0
    const got = await withRetry(
      async () => {
        calls++
        if (calls === 1) throw new Error('neon cold-start blip')
        return 'recovered'
      },
      { baseMs: 0 },
    )
    expect(got).toBe('recovered')
    expect(calls).toBe(2)
  })

  test('RE-THROWS the last error after exhausting attempts (a read cannot fail open)', async () => {
    let calls = 0
    const run = withRetry(
      async () => {
        calls++
        throw new Error(`down #${calls}`)
      },
      { attempts: 3, baseMs: 0 },
    )
    // The LAST error surfaces (so an honest 500 carries the real failure), after exactly 3 tries.
    await expect(run).rejects.toThrow('down #3')
    expect(calls).toBe(3)
  })

  test('logs a per-attempt warning ONLY when a label is given', async () => {
    const origWarn = console.warn
    const warnings: string[] = []
    console.warn = (msg?: unknown) => {
      warnings.push(String(msg))
    }
    try {
      // Labeled → one warn per non-final failed attempt (3 attempts → 2 warns); the cold-start
      // signal the funnel reads opt into.
      await withRetry(
        async () => {
          throw new Error('x')
        },
        { attempts: 3, baseMs: 0, label: 'tours.list' },
      ).catch(() => {})
      expect(warnings.length).toBe(2)
      expect(warnings[0]).toContain('tours.list')

      // Unlabeled → silent (session resolution stays quiet, as it was before sharing this loop).
      warnings.length = 0
      await withRetry(
        async () => {
          throw new Error('x')
        },
        { attempts: 3, baseMs: 0 },
      ).catch(() => {})
      expect(warnings.length).toBe(0)
    } finally {
      console.warn = origWarn
    }
  })
})
