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

  test('the resolve cap is DERIVED from the draft cap, and still clears it', () => {
    // The bug this guards is on the record in the constant's own comment: the two were independent
    // literals, the draft cap moved 60 → 120, this one stayed at 60, and a 103-place draft could not be
    // resolved at all — the flow rejecting the very draft it had just produced and been billed for.
    // Deriving it is the fix; this asserts the derivation is still a derivation (not re-inlined to a
    // literal by a later edit) and that it still clears the draft cap with room for the overshoot.
    const server = read('apps/admin/server/index.ts')
    expect(server).toMatch(/^const MAX_CURATE_DRAFTS = Math\.round\(\(MAX_DRAFT_TARGET \* 4\) \/ 3\)$/m)

    const draftCap = Number(server.match(/^const MAX_DRAFT_TARGET = (\d+)$/m)?.[1])
    expect(Number.isFinite(draftCap)).toBe(true)
    // ⚠ STRICTLY greater, not >=: equal is the failing case, since `target` is guidance and the model
    // comes back over it. The margin is what makes an overshot draft resolvable at all.
    expect(Math.round((draftCap * 4) / 3)).toBeGreaterThan(draftCap)
  })

  test('the draft call STREAMS — the token ceiling must not silently become a timeout again', () => {
    // The 16k ceiling this replaced was an artifact of a NON-streaming call (the SDK's HTTP timeout,
    // not the model), and it was propping up MAX_DRAFT_TARGET. If someone reverts to
    // `messages.create` while leaving max_tokens high, the request does not error — the SDK stretches
    // its default timeout instead, and a long draft parks past the point anyone is waiting for it and
    // bills to completion. So: streaming and an explicit client timeout are asserted together.
    const places = read('apps/admin/server/places.ts')
    expect(places).toContain('client.messages.stream({')
    expect(places).toContain('stream.finalMessage()')
    expect(places).toMatch(/new Anthropic\(\{ maxRetries: 1, timeout: 90_000 \}\)/)
  })

  test('the draft count is NOT AN INPUT — no field, no wire param, no clamp (founder, 2026-08-04)', () => {
    // It went from a number the operator picked, to a number defaulting to the maximum, to nothing —
    // because it only ever had one right answer. This pins all three halves of that removal together,
    // because reintroducing any ONE of them alone is the broken state: a field with no clamp lets an
    // untrusted body through, and a clamp with no field guards an input that cannot arrive.
    const server = read('apps/admin/server/index.ts')

    // The route asks for the constant directly — no body-derived count, no clamp around it.
    expect(server).toContain('targetN: MAX_DRAFT_TARGET')
    expect(server).not.toContain('body.target')
    expect(server).not.toContain('MIN_DRAFT_TARGET')

    // ...and the console offers nothing to type into.
    expect(placesView).not.toContain('curate-target')
    expect(placesView).not.toMatch(/DRAFT_(MIN|MAX)/)
    expect(read('apps/admin/client/src/lib/api.ts')).not.toMatch(/draftPlaces:.*target/)
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
