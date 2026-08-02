import { describe, expect, test } from 'bun:test'
import {
  decidePump,
  decideStall,
  clampSeekSec,
  seekTargetReached,
  POST_START_STALL_MS,
  CLIP_END_GRACE_SEC,
} from '../src/player'

// The fire-queue pump — what plays next, and when the drive is allowed to end. Its failure modes are
// two clips talking at once, and a drive that ends while a stop the rider already drove past is still
// queued. Neither is recoverable by the rider and neither shows up in a typecheck.
describe('decidePump', () => {
  test('a playing clip blocks everything — clips never overlap', () => {
    expect(decidePump({ clipBusy: true, queue: [4, 5], reachedEnd: false })).toEqual({ kind: 'wait' })
    // ⚠ Including when the road is done: finishing mid-clip would cut the skipper off in the last
    // sentence of the last stop.
    expect(decidePump({ clipBusy: true, queue: [], reachedEnd: true })).toEqual({ kind: 'wait' })
  })

  test('plays the HEAD of the queue — stops are told in the order the road passed them', () => {
    expect(decidePump({ clipBusy: false, queue: [7, 8, 9], reachedEnd: false })).toEqual({
      kind: 'play',
      seq: 7,
    })
  })

  test('a queued stop outranks finishing, even once the road has ended', () => {
    // THE REGRESSION THIS EXISTS FOR: reaching the end of the route is not permission to stop
    // talking. A drive that finishes here swallows a stop the rider drove past and paid for.
    expect(decidePump({ clipBusy: false, queue: [12], reachedEnd: true })).toEqual({
      kind: 'play',
      seq: 12,
    })
  })

  test('finishes only when the queue is drained AND the road is done', () => {
    expect(decidePump({ clipBusy: false, queue: [], reachedEnd: true })).toEqual({ kind: 'finish' })
  })

  test('drained queue mid-route is idle, not finished', () => {
    // The ordinary case between stops — the player waits for the next GPS trigger. Returning
    // 'finish' here would end the drive at the first quiet stretch of road.
    expect(decidePump({ clipBusy: false, queue: [], reachedEnd: false })).toEqual({ kind: 'idle' })
  })

  test('seq 0 is a real stop, not an absent one', () => {
    // A truthiness check instead of `!== undefined` would treat the first stop of every drive as an
    // empty queue and finish the drive before it started.
    expect(decidePump({ clipBusy: false, queue: [0], reachedEnd: true })).toEqual({
      kind: 'play',
      seq: 0,
    })
  })

  test('does not mutate the queue it was given', () => {
    // The caller dequeues. A pure function that shifted its input would work once and diverge on the
    // second call — and the pump is called on every fix, every clip end, and every route end.
    const queue = [1, 2, 3]
    decidePump({ clipBusy: false, queue, reachedEnd: false })
    expect(queue).toEqual([1, 2, 3])
  })
})

// The post-start stall watchdog's decision ladder — the safety-critical core (its failure mode is
// "the skipper goes silent for the rest of the drive"). Both players run this identically.
describe('decideStall', () => {
  const base = { now: 100_000, lastProgressAt: 100_000, lastProgressTime: 30, duration: 120, resumeTried: false }
  const stalled = base.now - POST_START_STALL_MS // long enough ago to be "no progress"

  test('wait while progress is still recent (under the threshold)', () => {
    expect(decideStall({ ...base, lastProgressAt: base.now - (POST_START_STALL_MS - 1) })).toBe('wait')
  })

  test('completeAtEnd when the frozen clock is within the end grace of duration', () => {
    expect(decideStall({ ...base, lastProgressAt: stalled, lastProgressTime: 120 - CLIP_END_GRACE_SEC })).toBe(
      'completeAtEnd',
    )
    // just SHORT of the grace boundary is still a mid-clip stall, not the end
    expect(decideStall({ ...base, lastProgressAt: stalled, lastProgressTime: 120 - CLIP_END_GRACE_SEC - 0.1 })).not.toBe(
      'completeAtEnd',
    )
  })

  test('resume once when stalled mid-clip and not yet tried', () => {
    expect(decideStall({ ...base, lastProgressAt: stalled, lastProgressTime: 30, resumeTried: false })).toBe('resume')
  })

  test('giveUp when stalled mid-clip and resume already tried', () => {
    expect(decideStall({ ...base, lastProgressAt: stalled, lastProgressTime: 30, resumeTried: true })).toBe('giveUp')
  })

  test('unknown duration (0) never short-circuits to completeAtEnd', () => {
    expect(decideStall({ ...base, lastProgressAt: stalled, duration: 0, resumeTried: false })).toBe('resume')
    expect(decideStall({ ...base, lastProgressAt: stalled, duration: 0, resumeTried: true })).toBe('giveUp')
  })
})

describe('clampSeekSec', () => {
  test('converts ms→sec and clamps to [0, duration]', () => {
    expect(clampSeekSec(30_000, 120)).toBe(30)
    expect(clampSeekSec(-5_000, 120)).toBe(0)
    expect(clampSeekSec(999_000, 120)).toBe(120)
  })
})

describe('seekTargetReached', () => {
  test('true once the clock lands within the epsilon, false outside', () => {
    expect(seekTargetReached(30.0, 30.2)).toBe(true)
    expect(seekTargetReached(30.0, 30.5)).toBe(false)
  })
})
