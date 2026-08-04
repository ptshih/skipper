/**
 * Pins the two RIDER-facing numbers the Places page hand-copies out of `apps/api`.
 *
 * `apps/admin` does not depend on `apps/api` (nor should it — they are separate services), so both
 * values are written twice on purpose, each under a comment that says "keep them equal". Nothing
 * enforced it. This is the same treatment `grant-ceiling.test.ts` gives the admin grant ceiling and
 * `jobs.test.ts` gives its dispatch targets: read both files as text and assert they still agree.
 *
 * Why these two specifically — both are the console TELLING AN OPERATOR SOMETHING ABOUT THE RIDER:
 *
 *   TOP_RANK ↔ EXAMPLE_ANCHOR_MAX_RANK — the band a place must be in to be offered as a cold-open
 *   example. It drives the star, the pin colour, the "N top-ranked" badge and the map legend. If the
 *   console's copy drifts UP, the page stars places the planner will never name; if it drifts DOWN,
 *   places the planner does use look ordinary.
 *
 *   PLANNER_ROSTER_CAP ↔ MAX_PLAN_ANCHORS — how many of a region's places the planner is actually
 *   served. Its badge ("planner sees top 200 · N below the line") exists precisely because curation
 *   now stores deeper than the planner reads, and the tail is only defensible while an operator can
 *   SEE where the line falls. A drifted copy makes that badge assert a boundary that isn't there.
 *
 * Neither drift is loud: no typecheck, no build, no test fails today — the page just quietly reports
 * a rule the rider's side does not follow.
 *
 * ⚠ If this fails after a deliberate change on the api side, the fix is to move the console's copy,
 * not to loosen the test. (Single-sourcing EXAMPLE_ANCHOR_MAX_RANK through `@skipper/shared` would
 * delete half of this file; MAX_PLAN_ANCHORS cannot follow without a founder call, because
 * `apps/api/src/limits.ts` documents a deliberate zero-import rule.)
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const repoRoot = join(import.meta.dir, '..', '..', '..')
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8')

describe('console copies of the planner-facing numbers', () => {
  const placesView = read('apps/admin/client/src/views/PlacesView.tsx')

  test('TOP_RANK still equals the api EXAMPLE_ANCHOR_MAX_RANK', () => {
    const apiVal = read('apps/api/src/example-anchors.ts').match(/^const EXAMPLE_ANCHOR_MAX_RANK = (\d+)$/m)?.[1]
    const consoleVal = placesView.match(/^const TOP_RANK = (\d+)$/m)?.[1]
    expect(apiVal).toBeDefined()
    expect(consoleVal).toBeDefined()
    expect(consoleVal).toBe(apiVal!)
  })

  test('PLANNER_ROSTER_CAP still equals the api MAX_PLAN_ANCHORS', () => {
    const apiVal = read('apps/api/src/limits.ts').match(/^export const MAX_PLAN_ANCHORS = (\d+)$/m)?.[1]
    const consoleVal = placesView.match(/^const PLANNER_ROSTER_CAP = (\d+)$/m)?.[1]
    expect(apiVal).toBeDefined()
    expect(consoleVal).toBeDefined()
    expect(consoleVal).toBe(apiVal!)
  })

  test('the page reads both through the const, with no bare literal beside them', () => {
    // The point of a single const is defeated the moment a second copy appears in the JSX, which is how
    // the badge and the legend drifted apart from the star in the first place.
    expect(placesView).toContain('TOP_RANK')
    expect(placesView).toContain('PLANNER_ROSTER_CAP')
    expect(placesView).not.toMatch(/top\s+200/i)
    expect(placesView).not.toMatch(/rank\s+1[–-]3\b/)
  })
})
