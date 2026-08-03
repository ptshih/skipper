import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { region, regionList } from '../src/schemas'

// GET /regions is CRITICAL PATH: it supplies the regionId every POST /drives/plan carries, so the
// conversation screen cannot open without it. The mobile client turns ANY DTO parse failure into a
// blocking "please update the app" wall (apps/mobile/src/lib/api.ts `parseDto` → ContractError), which
// means a cosmetic field that can FAIL to parse is a field that can brick the home screen.
// `exampleAnchors` is therefore `.catch([])`, and these tests exist to stop a future agent from
// "tightening" it back to `.default([])` — which covers a missing key but still throws on null.

const base = { id: '3582ed8a-a55e-4fb2-b8af-59dcd9eef16c', slug: 'lake-tahoe', displayName: 'Lake Tahoe' }

describe('region.exampleAnchors is un-brickable by construction', () => {
  test('OLD SERVER, new client: a missing key parses to []', () => {
    expect(region.parse(base).exampleAnchors).toEqual([])
  })

  test('null parses to [] — the row `.default()` would throw on', () => {
    expect(region.parse({ ...base, exampleAnchors: null }).exampleAnchors).toEqual([])
  })

  test('a malformed element degrades to [] rather than failing the whole region', () => {
    expect(region.parse({ ...base, exampleAnchors: ['ok', 5] }).exampleAnchors).toEqual([])
    expect(region.parse({ ...base, exampleAnchors: 'Tahoe City' }).exampleAnchors).toEqual([])
  })

  test('a well-formed list survives verbatim (order is the server’s, and it is deterministic)', () => {
    const names = ['Emerald Bay', 'Tahoe City', 'Zephyr Cove']
    expect(region.parse({ ...base, exampleAnchors: names }).exampleAnchors).toEqual(names)
  })

  test('`.catch` does NOT swallow a real contract break — a bad id still fails', () => {
    expect(region.safeParse({ ...base, id: 'not-a-uuid' }).success).toBe(false)
  })
})

describe('the rollout is additive in BOTH directions', () => {
  test('NEW SERVER, old client: an unknown extra key is stripped, not rejected', () => {
    // What a pre-1.1 build's schema looked like. Pinned because the deploy order (API first, app after)
    // rests on exactly this — it tests zod, but the claim is ours.
    const oldClientRegion = z.object({ id: z.uuid(), slug: z.string(), displayName: z.string() })
    const parsed = oldClientRegion.parse({ ...base, exampleAnchors: ['Tahoe City'] })
    expect(parsed).toEqual(base)
  })

  test('regionList round-trips a populated list', () => {
    const payload = { regions: [{ ...base, ready: true, exampleAnchors: ['Tahoe City'] }] }
    expect(regionList.parse(payload)).toEqual(payload)
  })
})

// `ready` answers a different question from `exampleAnchors` and carries the OPPOSITE bias, which is
// the whole reason it is a separate field: the anchors are decoration that degrades to "show nothing",
// this is a capability that degrades to "assume plannable". A false negative here hides the composer
// and tells a rider the skipper runs no roads where he does — so every unreadable input must land on
// `true`, and only an explicit `false` from a server that actually looked may turn the screen off.
describe('region.ready fails OPEN', () => {
  test('OLD SERVER, new client: a missing key parses to true, not false', () => {
    // The deploy-order guarantee. A client that knows this field talking to an API that does not yet
    // send it must degrade to the old always-on composer, never to a home screen with no input.
    expect(region.parse(base).ready).toBe(true)
  })

  test('null and a wrong type both degrade to true — the values `.default()` would throw on', () => {
    expect(region.parse({ ...base, ready: null }).ready).toBe(true)
    expect(region.parse({ ...base, ready: 'yes' }).ready).toBe(true)
    expect(region.parse({ ...base, ready: 0 }).ready).toBe(true)
  })

  test('an explicit false is HONOURED — the degrade must not swallow a real answer', () => {
    // The other half, and the one a `.catch(true)` could quietly break: a server that looked and found
    // nothing plannable has to be able to say so.
    expect(region.parse({ ...base, ready: false }).ready).toBe(false)
  })
})
