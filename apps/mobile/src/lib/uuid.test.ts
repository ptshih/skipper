// uuidV4 AS TESTS — the create idempotency key. It needs UNIQUENESS to dedupe a retry, not
// unguessability, and Hermes ships no guaranteed crypto global, so BOTH paths must produce a shape the
// server's `z.uuid()` accepts. Runs under `bun test`.
import { expect, test } from 'bun:test'
import { uuidV4 } from './uuid'

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

test('the platform-crypto path yields a v4 shape', () => {
  expect(globalThis.crypto?.randomUUID).toBeDefined() // bun has it; Hermes may not — hence the fallback
  expect(uuidV4()).toMatch(V4)
})

test('the Math.random fallback yields a v4 shape when crypto.randomUUID is absent', () => {
  const real = globalThis.crypto
  try {
    // Hermes' shape: a crypto global may exist without randomUUID, which is the branch that matters.
    Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true, writable: true })
    for (let i = 0; i < 50; i++) expect(uuidV4()).toMatch(V4)
  } finally {
    Object.defineProperty(globalThis, 'crypto', { value: real, configurable: true, writable: true })
  }
})

test('two keys never collide — a second create must be a second drive', () => {
  const keys = new Set(Array.from({ length: 500 }, uuidV4))
  expect(keys.size).toBe(500)
})
