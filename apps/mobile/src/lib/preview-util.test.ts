import { describe, expect, test } from 'bun:test'
import {
  decideFail,
  decideToggle,
  PREVIEW_END_EPS_SEC,
  sawFreshAudio,
  type PreviewPlayback,
} from './preview-util'

const at = (o: Partial<PreviewPlayback>): PreviewPlayback => ({
  playing: false,
  positionSec: 0,
  durationSec: 0,
  didJustFinish: false,
  ...o,
})

describe('decideToggle', () => {
  test('playing → pause, whatever else is true', () => {
    expect(decideToggle(at({ playing: true }))).toBe('pause')
    // Even at the very end: pausing a clip about to finish is still a pause, not a replay.
    expect(decideToggle(at({ playing: true, positionSec: 120, durationSec: 120 }))).toBe('pause')
  })

  test('paused mid-clip → resume', () => {
    expect(decideToggle(at({ positionSec: 30, durationSec: 120 }))).toBe('resume')
  })

  test('didJustFinish → replay, even when the clock says otherwise', () => {
    // The edge fires while position/duration can still read mid-clip; the flag wins.
    expect(decideToggle(at({ didJustFinish: true, positionSec: 5, durationSec: 120 }))).toBe('replay')
  })

  test('parked at the end without didJustFinish → replay', () => {
    // THE CASE didJustFinish ALONE MISSES: expo-audio can drop the edge across an OS interruption
    // (a phone call over the last seconds). Without the clock comparison this returns 'resume' and
    // the rider's second tap does nothing at all, because the player is parked at the end.
    expect(decideToggle(at({ positionSec: 120, durationSec: 120 }))).toBe('replay')
  })

  test('the epsilon is a window, not an equality', () => {
    const dur = 120
    // Just inside the window counts as ended...
    expect(decideToggle(at({ positionSec: dur - PREVIEW_END_EPS_SEC, durationSec: dur }))).toBe('replay')
    // ...and just outside it does not.
    expect(decideToggle(at({ positionSec: dur - PREVIEW_END_EPS_SEC - 0.01, durationSec: dur }))).toBe('resume')
  })

  test('unknown duration never reads as ended', () => {
    // durationSec 0 means "not loaded far enough to know". Treating that as ended would make the
    // FIRST tap on a slow-loading clip a replay-from-zero of nothing.
    expect(decideToggle(at({ positionSec: 0, durationSec: 0 }))).toBe('resume')
  })
})

describe('sawFreshAudio', () => {
  test('playing but not yet advanced is NOT fresh', () => {
    // The frame or two where the player reports `playing` before any sound exists. Treating this as
    // fresh would disarm a pre-start watchdog on a clip that never actually plays — the exact hang
    // the watchdog exists to catch.
    expect(sawFreshAudio({ playing: true, positionSec: 0 })).toBe(false)
    expect(sawFreshAudio({ playing: true, positionSec: PREVIEW_END_EPS_SEC })).toBe(false)
  })

  test('playing and advanced is fresh', () => {
    expect(sawFreshAudio({ playing: true, positionSec: 1 })).toBe(true)
  })

  test('a position without playing is not fresh', () => {
    // A paused player parked mid-clip has a position but is producing nothing.
    expect(sawFreshAudio({ playing: false, positionSec: 30 })).toBe(false)
  })
})

describe('decideFail', () => {
  test('the failing clip owns the player and had played → clear and release', () => {
    expect(decideFail({ activeId: 'a', failingId: 'a', playbackAttempted: true })).toEqual({
      clearActive: true,
      releaseSession: true,
      markFailed: true,
    })
  })

  test('never attempted playback → clear, but hold no session to give back', () => {
    // An unresolved uri: the id was an optimistic highlight only, play() was never called.
    expect(decideFail({ activeId: 'a', failingId: 'a', playbackAttempted: false })).toEqual({
      clearActive: true,
      releaseSession: false,
      markFailed: true,
    })
  })

  test('a newer tap already owns the player → touch neither the active id nor the session', () => {
    // THE REGRESSION THIS GUARDS: a slow first tap failing must not clear the highlight of, or
    // deactivate the session under, the clip the rider is now actually hearing. setIsAudioActiveAsync
    // is process-wide, so an unguarded release here silences a working clip.
    expect(decideFail({ activeId: 'b', failingId: 'a', playbackAttempted: true })).toEqual({
      clearActive: false,
      releaseSession: false,
      markFailed: true,
    })
  })

  test('nothing active → still surfaces the hint, still releases nothing', () => {
    expect(decideFail({ activeId: null, failingId: 'a', playbackAttempted: true })).toEqual({
      clearActive: false,
      releaseSession: false,
      markFailed: true,
    })
  })

  test('works on numeric ids too (useStopPreview keys by seq, useRoutePreview by card id)', () => {
    expect(decideFail({ activeId: 3, failingId: 3, playbackAttempted: true }).releaseSession).toBe(true)
    expect(decideFail({ activeId: 3, failingId: 4, playbackAttempted: true }).releaseSession).toBe(false)
  })
})
