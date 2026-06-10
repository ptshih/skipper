import { describe, expect, test } from 'bun:test'
import { resolveSessionSafely } from '../src/session'

// A stand-in session value — resolveSessionSafely is generic and never inspects it.
const SESSION = { user: { tier: 'paid' } }

describe('resolveSessionSafely (fail-open session resolution)', () => {
  test('passes a resolved session straight through', async () => {
    expect(await resolveSessionSafely(async () => SESSION)).toBe(SESSION)
  })

  test('a null result (the normal anonymous case) returns immediately — no retry', async () => {
    let calls = 0
    const got = await resolveSessionSafely(async () => {
      calls++
      return null
    })
    expect(got).toBeNull()
    expect(calls).toBe(1) // only a THROW retries; a null result is a valid answer
  })

  test('a one-off transient throw is retried, then succeeds', async () => {
    let calls = 0
    const got = await resolveSessionSafely(
      async () => {
        calls++
        if (calls === 1) throw new Error('auth-db cold-start blip')
        return SESSION
      },
      { baseMs: 0 },
    )
    expect(got).toBe(SESSION)
    expect(calls).toBe(2)
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
