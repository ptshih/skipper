import { describe, expect, test } from 'bun:test'
import { resolveSessionSafely } from '../src/session'

describe('resolveSessionSafely (fail-open session resolution)', () => {
  // The success + retry-then-recover paths are pure delegation to withRetry (covered directly in
  // retry.test.ts); these two pin the logic UNIQUE to the wrapper: the null short-circuit and the
  // fail-open-to-anonymous on exhaustion (the latter also exercises the full retry loop through it).
  test('a null result (the normal anonymous case) returns immediately — no retry', async () => {
    let calls = 0
    const got = await resolveSessionSafely(async () => {
      calls++
      return null
    })
    expect(got).toBeNull()
    expect(calls).toBe(1) // only a THROW retries; a null result is a valid answer
  })

  test('FAILS OPEN to null (anonymous) when getSession keeps throwing — never propagates a 500', async () => {
    // The exhaustion path logs an expected degradation warning — silence it for clean output.
    const origError = console.error
    console.error = () => {}
    try {
      let calls = 0
      const got = await resolveSessionSafely(
        async () => {
          calls++
          throw new Error('auth db down')
        },
        { attempts: 3, baseMs: 0 },
      )
      expect(got).toBeNull() // degraded → tierOf(null) = 'anonymous', preview funnel survives
      expect(calls).toBe(3) // exhausted exactly the bounded attempts
    } finally {
      console.error = origError
    }
  })
})
