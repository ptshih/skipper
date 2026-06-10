import { describe, expect, test } from 'bun:test'
import { mapLimit } from '../src/pipeline/concurrency'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('mapLimit', () => {
  test('returns results in ITEM order even when later items finish first', async () => {
    const out = await mapLimit([30, 5, 1], 3, async (ms) => {
      await sleep(ms)
      return ms * 2
    })
    expect(out).toEqual([60, 10, 2])
  })

  test('never exceeds the concurrency limit', async () => {
    let inFlight = 0
    let peak = 0
    await mapLimit(Array.from({ length: 12 }, (_, i) => i), 3, async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await sleep(5)
      inFlight--
    })
    expect(peak).toBeLessThanOrEqual(3)
    expect(peak).toBeGreaterThan(1) // it actually ran concurrently
  })

  test('fails fast: the first rejection propagates and no NEW items start after it', async () => {
    const started: number[] = []
    const promise = mapLimit([0, 1, 2, 3, 4], 1, async (i) => {
      started.push(i)
      if (i === 1) throw new Error('boom')
      return i
    })
    await expect(promise).rejects.toThrow('boom')
    // limit 1 ⇒ strictly serial ⇒ items after the failing one were never pulled
    expect(started).toEqual([0, 1])
  })

  test('empty input resolves to an empty array without invoking fn', async () => {
    let calls = 0
    const out = await mapLimit([], 4, async () => {
      calls++
    })
    expect(out).toEqual([])
    expect(calls).toBe(0)
  })

  test('limit larger than the item count is clamped (all items processed once)', async () => {
    const seen: number[] = []
    const out = await mapLimit([1, 2], 16, async (n) => {
      seen.push(n)
      return n
    })
    expect(out).toEqual([1, 2])
    expect(seen.sort()).toEqual([1, 2])
  })
})
