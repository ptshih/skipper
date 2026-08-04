/**
 * The curate route's fan-out rests entirely on this pool, and it runs on the PAID path that seeds the
 * planner's endpoint allowlist. Two of its three properties are the kind that look fine in review and
 * are wrong in production, so they get asserted rather than argued:
 *
 *   ORDER — the route zips these results back against its draft list to build the operator's per-draft
 *   report. If the pool returned completion order, every dropped/error line would be attributed to the
 *   wrong place name, which is a silent, plausible-looking lie about a paid run.
 *
 *   THE BOUND — the entire reason this isn't `Promise.all(items.map(…))`. A pool that quietly runs
 *   everything at once still passes an order test and still returns the right answers; it only shows up
 *   as rate-limit errors partway through a run that has already billed.
 */
import { describe, expect, test } from 'bun:test'
import { mapWithConcurrency } from './concurrency'

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))

describe('mapWithConcurrency', () => {
  test('returns results in INPUT order even when later items finish first', async () => {
    // Reverse-graded delays: the last item resolves first, so completion order is the exact reverse of
    // input order. Anything that collects by completion fails here.
    const items = [0, 1, 2, 3, 4, 5]
    const out = await mapWithConcurrency(items, 6, async (n) => {
      await tick((items.length - n) * 5)
      return n * 10
    })
    expect(out).toEqual([0, 10, 20, 30, 40, 50])
  })

  test('never exceeds the limit in flight, and still processes every item', async () => {
    let inFlight = 0
    let peak = 0
    const seen: number[] = []
    const items = Array.from({ length: 40 }, (_, i) => i)

    const out = await mapWithConcurrency(items, 6, async (n) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await tick(1)
      seen.push(n)
      inFlight -= 1
      return n
    })

    expect(peak).toBeLessThanOrEqual(6)
    // ...and it really did run wide — a serial implementation would also pass the ceiling assertion.
    expect(peak).toBeGreaterThan(1)
    expect(seen.sort((a, b) => a - b)).toEqual(items)
    expect(out).toEqual(items)
  })

  test('a limit at or above the item count is fine, and an empty list spawns no workers', async () => {
    expect(await mapWithConcurrency([1, 2], 99, async (n) => n)).toEqual([1, 2])
    let called = false
    expect(
      await mapWithConcurrency([], 6, async () => {
        called = true
        return 1
      }),
    ).toEqual([])
    expect(called).toBe(false)
  })

  test('a limit below 1 still makes progress rather than hanging', async () => {
    // Guards the `Math.max(1, …)`: a 0-width pool spawns no workers, so the await would resolve
    // instantly with an array of holes and the caller would silently curate nothing.
    expect(await mapWithConcurrency([1, 2, 3], 0, async (n) => n * 2)).toEqual([2, 4, 6])
  })

  test('documents the no-throw contract: a rejecting fn does NOT quietly drop the remaining work', async () => {
    // The contract is "fn must not throw". This pins what happens if someone breaks it, so the failure
    // is loud (the call rejects) rather than a partially-completed fan-out reported as success.
    const attempted: number[] = []
    const run = mapWithConcurrency([1, 2, 3], 1, async (n) => {
      attempted.push(n)
      if (n === 2) throw new Error('boom')
      return n
    })
    await expect(run).rejects.toThrow('boom')
    // The sole worker died on item 2, so item 3 was never attempted — the caller sees a rejection, not
    // a short result array it might mistake for "everything that could be curated was".
    expect(attempted).toEqual([1, 2])
  })
})
