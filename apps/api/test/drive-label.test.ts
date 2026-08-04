// The title a saved drive carries into MY DRIVES — and the shape it kept getting wrong.
//
// ⚠ THE BUG THIS PINS IS A ROUND TRIP, AND NOTHING ABOUT A ONE-WAY DRIVE CAN SEE IT. The wire encodes
// "down to Emerald Bay and back" as `end === start` with the turnaround as the LAST `via`
// (toPlannedRoute, ../src/plan-route.ts), so a title built from start+end alone is `Stateline →
// Stateline` — correct about the endpoints, and useless: it drops the only name the rider would
// recognise the drive by, the one they said out loud, while the map on the same card draws the whole
// loop. Every non-loop assertion below was green against the broken expression too, which is exactly
// why the loop cases carry their own block.
//
// ⚠ NEEDS NO SECRET, NO DB, NO NETWORK. `driveLabel` is pure and ../src/drives is importable without
// env by construction (the auth instance is lazy — see auth-lazy.test.ts, which pins that). No module
// mock is registered here on purpose: they are process-wide under bun, and this file needs none.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Waypoint } from '@skipper/routing'
import { driveLabel } from '../src/drives'

/** A frozen waypoint as `materializeRoute` records it. Coordinates are irrelevant to a title and
 *  deliberately not varied — the label is a function of the LABELS and their ORDER. */
const wp = (label: string): Waypoint => ({ label, lat: 38.96, lng: -119.94 })

describe('driveLabel — one-way', () => {
  test('names both endpoints', () => {
    expect(driveLabel([wp('Tahoe City'), wp('South Lake Tahoe')])).toBe('Tahoe City → South Lake Tahoe')
  })

  test('names a midpoint the rider asked to pass through', () => {
    // The via is on the route and billed for; a title that hides it describes a different drive.
    expect(driveLabel([wp('Tahoe City'), wp('Emerald Bay State Park'), wp('South Lake Tahoe')])).toBe(
      'Tahoe City → Emerald Bay State Park → South Lake Tahoe',
    )
  })
})

describe('driveLabel — round trip (the shape start+end could not describe)', () => {
  test('names the turnaround, not the start twice', () => {
    // The planner's `round_trip: true` lands on the wire exactly like this.
    const label = driveLabel([wp('Stateline'), wp('Emerald Bay State Park'), wp('Stateline')])
    expect(label).toBe('Stateline → Emerald Bay State Park → Stateline')
    expect(label).not.toBe('Stateline → Stateline')
  })

  test('keeps every place on a round trip with midpoints of its own', () => {
    // ⚠ The turnaround is the LAST via, never the first — a title (or a card) that reaches for
    // `via[0]` names a place the drive merely passes through and calls it the destination.
    expect(
      driveLabel([wp('Stateline'), wp('Zephyr Cove'), wp('Emerald Bay State Park'), wp('Stateline')]),
    ).toBe('Stateline → Zephyr Cove → Emerald Bay State Park → Stateline')
  })

  test('a degenerate loop with nothing to turn around at stays honest', () => {
    // Start == end and no midpoint is a zero-distance route. It reads as what it is rather than
    // inventing a destination; POST /drives rejects it for having no stops before any title persists.
    expect(driveLabel([wp('Stateline'), wp('Stateline')])).toBe('Stateline → Stateline')
  })
})

describe('driveLabel — the raw name is preserved', () => {
  test("Wikipedia's disambiguator is NOT stripped here", () => {
    // Display-only cleanup is the client's job (`cleanPlaceName`, apps/mobile/src/lib/labels.ts) and
    // it runs on every surface that shows a label. Doing it server-side too would fork the rule and
    // bake a half-cleaned string into a stored row.
    expect(driveLabel([wp('Tahoe Keys, California'), wp('Rubicon, California')])).toBe(
      'Tahoe Keys, California → Rubicon, California',
    )
  })
})

/* ------------------------- the call site, not just the helper ------------------------- */

// A green helper proves nothing if POST /drives stops calling it. The regression is a one-line edit
// back to the endpoints, it typechecks, every request still 200s, and the only symptom is a title —
// so this asserts the SOURCE, which is the one layer that survives that edit.
const SRC = readFileSync(join(import.meta.dir, '../src/drives.ts'), 'utf8')

describe('POST /drives titles from the frozen waypoints', () => {
  test('the persisted label comes from route.provenance.waypoints', () => {
    expect(SRC).toContain('const label = driveLabel(route.provenance.waypoints)')
  })

  test('the title is never assigned from the endpoints', () => {
    // The exact expression that produced "Stateline → Stateline". Matched WITH its assignment, not
    // as a bare substring: the same interpolation appears in the 0-stop warning below it, where it is
    // correct (a log line naming what failed to route is not a title). The `??` fallbacks on the READ
    // paths are a third thing again — they interpolate `startName`/`endName` off a stored row that has
    // no label at all, and are deliberately untouched.
    expect(SRC).not.toContain('const label = `${start.name}')
  })
})
