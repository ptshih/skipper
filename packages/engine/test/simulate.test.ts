import { describe, expect, test } from 'bun:test'
import { runDrive } from '../src/simulate'
import type { DriveStopRef } from '../src/trigger'
import type { LngLat } from '../src/geo'

// ~11.1 km straight north (0.001 deg lat ≈ 111.19 m). At 45 mph ≈ 20.117 m/s the whole drive is
// ≈ 552 s, and a stop at lat 38.0+x fires ≈ 12 s before the car reaches it (the speed-adaptive lead
// dominates the 120 m floor at this speed).
const route: LngLat[] = Array.from({ length: 101 }, (_, i) => [0, 38.0 + i * 0.001] as LngLat)
const MPH = 45

const stop = (seq: number, lat: number, durationMs: number): DriveStopRef => ({
  seq,
  lat,
  lng: 0.0003,
  triggerRadiusM: 120,
  durationMs,
  name: `stop ${seq}`,
})

// QUIET WINDOWS — the measurement downtime-callouts-spec.md §0.6 is gated on. It has to be trustworthy
// enough to RETIRE a feature, which is a higher bar than "runs", so both properties below are the ones
// that would make it lie rather than merely be imprecise.
describe('runDrive quietWindows', () => {
  test('windows tile the drive: quiet + played audio = drive length, head and tail included', () => {
    const r = runDrive(route, [stop(0, 38.02, 20_000), stop(1, 38.07, 20_000)], { mph: MPH, tickHz: 4 })
    const q = r.quietWindows

    // Before the first clip, between the two, and after the last.
    expect(q).toHaveLength(3)
    expect(q[0]!.afterSeq).toBeNull() // the drive opens in silence
    expect(q[0]!.beforeSeq).toBe(0)
    expect(q[2]!.beforeSeq).toBeNull() // ...and ends in it; 1.1 deleted the outro
    expect(q[2]!.afterSeq).toBe(1)

    // Ordered and non-overlapping.
    for (let i = 1; i < q.length; i++) expect(q[i]!.startSec).toBeGreaterThanOrEqual(q[i - 1]!.endSec)

    // The tiling identity. Both clips fire and run to completion inside the drive, so every second is
    // either narration or quiet — an off-by-one anywhere in the cursor walk breaks this.
    const quietSec = q.reduce((a, w) => a + w.sec, 0)
    expect(quietSec + 40).toBeCloseTo(r.driveSec, 1)
  })

  // ⚠ THE ONE THAT MATTERS. Clips play through a sequential FIFO, so a clip that fires while another is
  // playing starts LATE and eats the silence that would have followed it. Differencing TRIGGER times
  // instead — the obvious implementation — over-reports quiet by exactly the queue lag, which is a bias
  // toward "yes, there is room for a callout" in the one measurement that exists to answer that.
  test('a queued clip shortens the window after it (play schedule, not trigger schedule)', () => {
    const r = runDrive(
      route,
      [
        stop(0, 38.02, 120_000), // fires ≈ 98 s, plays 98 → 218
        stop(1, 38.03, 120_000), // fires ≈ 154 s — mid-playback, so it QUEUES: plays 218 → 338
        stop(2, 38.075, 20_000), // fires ≈ 402 s
      ],
      { mph: MPH, tickHz: 4 },
    )
    expect(r.stops.every((s) => s.fired)).toBe(true)

    // The window between the queued clip and the last stop.
    const mid = r.quietWindows.find((w) => w.afterSeq === 1 && w.beforeSeq === 2)
    expect(mid).toBeDefined()
    // ≈ 402 − 338 = 64 s of real silence.
    expect(mid!.sec).toBeGreaterThan(50)
    expect(mid!.sec).toBeLessThan(80)
    // ⚠ The trigger-differenced answer here is ≈ 402 − (154 + 120) = 129 s — twice the truth, and
    // comfortably over the 75 s floor it would need to clear. This bound is what rejects it.
    expect(mid!.sec).toBeLessThan(100)

    // Stop 1 queues behind stop 0, so there is NO window between them at all.
    expect(r.quietWindows.some((w) => w.afterSeq === 0 && w.beforeSeq === 1)).toBe(false)
  })
})
