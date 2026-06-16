import { describe, expect, test } from 'bun:test'
import {
  decideStall,
  clampSeekSec,
  seekTargetReached,
  POST_START_STALL_MS,
  CLIP_END_GRACE_SEC,
} from '../src/player'

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
