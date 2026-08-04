// THE PLANNER'S ROSTER CAP — that truncation is RANK-AWARE, and that it is REPORTED.
//
// ⚠ THE BUG THIS FILE EXISTS FOR, because it was invisible in exactly the way that matters.
// `MAX_PLAN_ANCHORS` is applied TWICE: once as a SQL `LIMIT` in `loadRegionAnchors` (../src/drives) and
// once in `buildRosterBlock` (../src/planner), which re-sorts by `byAnchorRank` — `featured` FIRST — before
// trimming. The SQL used to order by name alone, so:
//   1. the cap kept the 200 alphabetically-first rows, and a curator's `featured` pick whose name sorts
//      late was deleted from the skipper's world BECAUSE OF ITS SPELLING, silently inverting the one
//      ranking a curator controls; and
//   2. because the query fetched EXACTLY the cap, `buildRosterBlock`'s truncation warning — the only
//      operator signal for this — could never fire from production. The test that proved that warning
//      worked called the function directly with cap + 1, so it was green while the path was unreachable.
// Both halves read as "covered". Neither was.
//
// ⚠ WHY THERE IS A SOURCE ASSERTION IN HERE. The ORDER BY and the LIMIT are a SQL clause, so pinning them
// behaviourally needs a drizzle builder fixture — and the one file in this suite that has one
// (anchor-allowlist.test.ts) carries an explicit "do NOT widen this to a no-op" warning on its db proxy,
// because that fixture IS the INV-1 guard. Destabilising the allowlist's own harness to test a roster cap
// is a bad trade. This file instead pairs a PURE test of the RULE (rank-aware truncation keeps a featured
// row) with a NARROW source assertion that the query implements it — the same "assert the source and say
// why" pattern the suite already uses where mocking would cost more than it buys.
// ⚠ Needs no secret, no db, no network and NO MODULE MOCKS — which is the other reason it is its own file
// rather than a block inside one that mocks `@skipper/db` process-wide.

import { describe, expect, test } from 'bun:test'
import { byAnchorRank, type RankableAnchor } from '../src/anchor-format'
import { MAX_PLAN_ANCHORS } from '../src/limits'

/* -------------------------------------------------------------------------- */
/* The RULE: truncating a roster must never drop a TOP-RANKED row for an unranked one. */
/* -------------------------------------------------------------------------- */

describe('roster truncation is RANK-aware, not alphabetical', () => {
  /** A top-ranked place whose name sorts LAST — the row the old alphabetical LIMIT threw away. */
  const ZEBRA_RANKED: RankableAnchor = { id: 'aaaaaaaa-0000-4000-8000-00000000000f', name: 'Zebra Cove', rank: 1 }
  /** ⚠ `rank: null` is the UNRANKED case, not "ranked zero" — a hand-added row. It must sort LAST, and
   *  a naive `a.rank - b.rank` on null would coerce it to 0 and sort it FIRST, ahead of rank 1. */
  const plain = (i: number): RankableAnchor => ({
    id: `bbbbbbbb-0000-4000-8000-${String(i).padStart(12, '0')}`,
    name: `Anchor ${String(i).padStart(4, '0')}`,
    rank: null,
  })

  test('sorting by byAnchorRank BEFORE trimming keeps the ranked row', () => {
    const rows = [...Array.from({ length: 20 }, (_, i) => plain(i)), ZEBRA_RANKED]
    const kept = [...rows].sort(byAnchorRank).slice(0, 5)
    expect(kept.map((a) => a.id)).toContain(ZEBRA_RANKED.id)
    // And it is FIRST, not merely present — `rank` is the primary key of the comparator.
    expect(kept[0]!.id).toBe(ZEBRA_RANKED.id)
  })

  test('a LOWER rank number wins, and null loses to every number', () => {
    // The sign flipped when `featured` became `rank` (true-first → 1-first). A test that only checked
    // "the special row comes first" would pass under either, so pin the direction explicitly.
    const r = (n: number | null, id: string): RankableAnchor => ({ id, name: 'Same Name', rank: n })
    const sorted = [r(5, 'c'), r(null, 'd'), r(1, 'a'), r(3, 'b')].sort(byAnchorRank)
    expect(sorted.map((x) => x.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  // ⚠ THE MUTATION CHECK, and the reason the test above is not enough on its own: trimming on the
  // ALPHABETICAL order — which is exactly what the SQL used to hand over — silently loses it. This is the
  // production bug, reproduced as an assertion so nobody can reintroduce the old order and stay green.
  test('trimming on NAME order loses it — the defect, pinned', () => {
    const rows = [...Array.from({ length: 20 }, (_, i) => plain(i)), ZEBRA_RANKED]
    const byName = [...rows].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).slice(0, 5)
    expect(byName.map((a) => a.id)).not.toContain(ZEBRA_RANKED.id)
  })
})

/* -------------------------------------------------------------------------- */
/* The IMPLEMENTATION: the query orders the same way, and over-fetches by one.   */
/* -------------------------------------------------------------------------- */

// ⚠ Read at MODULE scope, not inside `describe` — a describe callback cannot be async, and bun parses the
// `await` as a syntax error rather than a failing test. Top-level await in a module is fine.
const driveSource = await Bun.file(new URL('../src/drives.ts', import.meta.url)).text()
/** Just the anchor query — scoped so an ORDER BY elsewhere in this large file cannot satisfy these. */
const anchorQuery = driveSource.slice(
  driveSource.indexOf('export async function loadRegionAnchors'),
  driveSource.indexOf('interface ResolvedEndpoint'),
)

describe('loadRegionAnchors implements that rule, and reports when it truncates', () => {
  test('the slice under test really is loadRegionAnchors', () => {
    // ⚠ The role filter is GONE (2026-08-04): `places` is destinations only, so membership IS
    // eligibility and the query must NOT carry an extra predicate that could drift from that.
    expect(anchorQuery).not.toContain('endpointEligible')
    expect(anchorQuery.length).toBeGreaterThan(200)
  })

  // ⚠ `rank` MUST COME FIRST IN THE ORDER BY. Whatever rows this query drops are gone before
  // `byAnchorRank` is ever applied, so the SQL order has to AGREE with it — see the rule block above.
  test('the ORDER BY leads with rank ASC NULLS LAST, matching byAnchorRank', () => {
    const orderBy = anchorQuery.match(/\.orderBy\(([\s\S]*?)\)\s*$/m)?.[1] ?? anchorQuery
    expect(orderBy).toContain('rank')
    expect(orderBy).toContain('name')
    expect(orderBy.indexOf('rank')).toBeLessThan(orderBy.indexOf('name'))
    // ⚠ NULLS LAST IS THE WHOLE POINT AND IS NOT THE DEFAULT. Postgres sorts NULLs FIRST on ASC, so
    // without this an unranked hand-add would lead the roster and, past the cap, DELETE the drafted
    // rows it displaced. `places.rank` is nullable, unlike the NOT NULL boolean it replaced.
    expect(orderBy).toMatch(/NULLS LAST/i)
  })

  // ⚠ CAP + 1 IS WHAT MAKES TRUNCATION OBSERVABLE AT ALL. Fetching exactly the cap makes a truncated
  // region byte-identical to one that fits, which is how this went unnoticed. Ask for one more than we
  // will use, report it, then trim.
  test('it over-fetches by one so truncation can be detected', () => {
    expect(anchorQuery).toMatch(/\.limit\(\s*MAX_PLAN_ANCHORS\s*\+\s*1\s*\)/)
  })

  test('and it emits a queryable, name-free line when it truncates', () => {
    expect(anchorQuery).toContain('anchor_roster_truncated')
    // Single-line JSON, so `evt` is a field a log-based metric can read rather than a substring.
    expect(anchorQuery).toMatch(/JSON\.stringify\(/)
    // ⚠ INV-13: counts and the cap only. A place name here is a rider's destination.
    expect(anchorQuery).toContain('cap:')
    expect(anchorQuery).toContain('at_least:')
    expect(anchorQuery).not.toMatch(/evt: 'anchor_roster_truncated'[\s\S]*names:/)
  })

  test('the cap is still a ceiling far above any curated region', () => {
    // Not a magic number check — a floor under the ceiling. Lake Tahoe measured 109 eligible on
    // 2026-08-03; a cap that ever drops near that stops being a ceiling and starts being a page size.
    expect(MAX_PLAN_ANCHORS).toBeGreaterThan(120)
  })
})
