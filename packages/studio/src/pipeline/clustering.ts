// Spatial grouping for the legibility layer — pure, no I/O, so the two hard-won properties below are
// unit-testable instead of only observable in a paid run.
//
// docs/ideas/poi-legibility-layer.md §3 records why this is LEADER grouping and not the obvious
// transitive-closure kind. Single-linkage CHAINS: at a 400 m radius it produced a cluster with a
// 1623 m diameter and 60 members, because A-B-C-D each 400 m apart collapse into one blob. Leader
// grouping picks the strongest candidate and absorbs only what lies within R of THAT ANCHOR, never
// transitively, which bounds the diameter to 2R by construction (measured: 711 m at R=400).
//
// ⚠ Determinism is a REQUIREMENT here, not a nicety. The classifier's verdicts are persisted, so the
// groups they were computed over must be reproducible: a re-run that reshuffles group membership
// invalidates every stored treatment. The dry run's grouping was accidentally non-deterministic (an
// unordered query plus a sort with no tiebreak), which is why `rank` ties break on `id`.

/** The minimum a caller must supply per item. `rank` picks anchors — HIGHER wins (we use clip length:
 *  the richest telling in a group should be the one that speaks for it). */
export interface Groupable {
  id: string
  lat: number
  lng: number
  rank: number
  /** Whether this item may ANCHOR a group. Default true. A `false` item is still absorbed as a MEMBER —
   *  it just never defines a group's centre.
   *
   *  ⚠ This exists because ranking by facts strength (correctly) promotes big famous entities, and the
   *  biggest are CONTAINERS: a mountain range and a national park have enormous articles, so they
   *  outranked the places inside them and became seeds. Measured on Yosemite: the `Half Dome` group was
   *  seeded by `Yosemite National Park` and `Glacier Point` by the `Sierra Nevada` (63,118 km²). The
   *  subject resolver still recovered the right subject, but a seed's coordinate defines the group's
   *  CENTRE, and a park's nominal centroid is arbitrary relative to anything you can see. */
  seedable?: boolean
}

const R_EARTH = 6_371_008.8
const toRad = (d: number): number => (d * Math.PI) / 180

/** Great-circle metres between two lat/lng points. Local to keep this module dependency-free. */
export function metersBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const s1 = Math.sin(dLat / 2)
  const s2 = Math.sin(dLng / 2)
  const h = s1 * s1 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * s2 * s2
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Group items by proximity to a chosen ANCHOR (never transitively — see the header).
 *
 * Returns one array per group, each with its anchor FIRST. Every item appears exactly once, so a
 * singleton is a one-element group. Deterministic: items are ordered by `rank` descending with `id`
 * as the tiebreak, so identical input always yields identical groups.
 */
export function leaderGroups<T extends Groupable>(items: readonly T[], radiusM: number): T[][] {
  const pool = [...items].sort((a, b) => b.rank - a.rank || a.id.localeCompare(b.id))
  const taken = new Set<string>()
  const out: T[][] = []
  for (const anchor of pool) {
    if (taken.has(anchor.id) || anchor.seedable === false) continue
    taken.add(anchor.id)
    const members: T[] = [anchor]
    for (const c of pool) {
      if (taken.has(c.id)) continue
      if (metersBetween(anchor.lat, anchor.lng, c.lat, c.lng) <= radiusM) {
        members.push(c)
        taken.add(c.id)
      }
    }
    out.push(members)
  }
  // A non-seedable item that nothing absorbed still has to go SOMEWHERE — dropping it here would delete
  // it from the corpus silently, which is a different and worse bug than mis-seeding. It stands alone.
  for (const leftover of pool) if (!taken.has(leftover.id)) out.push([leftover])
  return out
}

/** Fold a classifier title to a comparison key: case- and punctuation-insensitive, whitespace
 *  collapsed. "Downtown Reno" and "downtown  Reno!" agree; "downtown Reno" and "Newlands" do not. */
export function titleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Whether two folded titles name the same place: equal, or one contains the other as a WHOLE-WORD
 *  run. Substring alone would fuse "Reno" into "Renoir"; padding both sides forces word boundaries. */
export function titlesOverlap(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  return ` ${a} `.includes(` ${b} `) || ` ${b} `.includes(` ${a} `)
}

/** The minimum a subject candidate must expose. */
export interface Subjectable {
  id: string
  name: string
  kind?: string | null
}

/**
 * Which member (if any) IS the subject of a group — the entity a fused telling is actually ABOUT.
 *
 * ⚠ This exists because the first cut got it wrong in production. Anchors were picked by longest
 * existing clip, a proxy for "richest telling", and that elected the wrong subject in 4 of 4 districts:
 * a real `…Historic District` QID sat in the group and was demoted to a satellite of an arbitrary
 * building — a FRATERNITY HOUSE ended up speaking for a university campus, and an apartment block for
 * 43 members of downtown Reno. Clip length says nothing about what a place IS.
 *
 * Returns null when no member names the group, which is the common and honest case: the Stateline
 * casino strip is a real grouping that is not itself a Wikidata place. A null subject says "this
 * grouping is ours" rather than electing a stand-in to impersonate it.
 */
export function pickSubject<T extends Subjectable>(members: readonly T[], title: string): T | null {
  // 1. An entity whose TYPE is the group: a historic district, a neighbourhood. The strongest signal,
  //    and the one the design doc always specified.
  const byKind = members.find(
    (m) => /district|neighborhood|neighbourhood/i.test(m.kind ?? '') || /historic district/i.test(m.name),
  )
  if (byKind) return byKind
  // 2. A member the classifier NAMED THE GROUP AFTER — "Genoa, Nevada" for "Genoa, Nevada's Oldest
  //    Town". Whole-word containment, with a length floor so a 2-3 character name can't match noise.
  const key = titleKey(title)
  const byTitle = members.find((m) => {
    const n = titleKey(m.name)
    return n.length >= 4 && ` ${key} `.includes(` ${n} `)
  })
  if (byTitle) return byTitle
  // 3. Nothing names it. Say so.
  return null
}

/** A classified group, as the district merge needs to see it. */
export interface ClassifiedGroup<T extends Groupable> {
  members: T[]
  treatment: string
  title: string
}

/**
 * Merge DISTRICT groups that are the same district seen twice.
 *
 * Why this exists: leader grouping anchors more than once inside a large district, so the dry run
 * returned "downtown Reno" as TWO groups (33 members and 10), UNR twice, and Carson City three times
 * — each an arbitrary slice of one place. Left alone, phase 4 would write two competing tellings about
 * the same downtown.
 *
 * The rule is deliberately conservative — same treatment, OVERLAPPING folded titles, and anchors within
 * `maxAnchorGapM` — because the failure modes are asymmetric. Merging two genuinely distinct districts
 * silently fuses unrelated content; failing to merge just leaves the duplicate that exists today. The
 * distance bound is what stops two same-named downtowns in different states from colliding.
 *
 * ⚠ Titles overlap by CONTAINMENT, not equality. Equality was the first cut and it under-merged on the
 * exact case this function exists for: the classifier returned "Downtown Reno and the Arch" (33 members)
 * and "Downtown Reno" (10) for one downtown, and those are not equal. Containment catches the model
 * elaborating a title on one pass and not the other, which it does freely, while still refusing to fuse
 * "Downtown Reno" with "Newlands Historic Neighborhood".
 *
 * Only groups whose `treatment` equals `districtTreatment` are considered; everything else passes
 * through untouched, order preserved. The merged group's anchor is the highest-ranked member across
 * all the groups that fused, so the strongest telling still speaks for the district.
 */
export function mergeDistricts<T extends Groupable>(
  groups: readonly ClassifiedGroup<T>[],
  opts: { districtTreatment: string; maxAnchorGapM: number },
): ClassifiedGroup<T>[] {
  const out: ClassifiedGroup<T>[] = []
  // Indices into `out` of district groups already emitted, in order. A flat list rather than a map
  // keyed by title, because CONTAINMENT matching can't be looked up by an exact key.
  const openDistricts: number[] = []

  for (const g of groups) {
    if (g.treatment !== opts.districtTreatment || g.members.length === 0) {
      out.push(g)
      continue
    }
    const key = titleKey(g.title)
    const anchor = g.members[0]!
    const hit = openDistricts.find((i) => {
      const other = out[i]!
      const otherKey = titleKey(other.title)
      if (!titlesOverlap(key, otherKey)) return false
      const oa = other.members[0]!
      return metersBetween(anchor.lat, anchor.lng, oa.lat, oa.lng) <= opts.maxAnchorGapM
    })
    if (hit === undefined) {
      out.push({ ...g, members: [...g.members] })
      openDistricts.push(out.length - 1)
      continue
    }
    // Fuse, then re-seat the anchor: the strongest member across BOTH groups speaks for the district.
    const merged = out[hit]!
    merged.members.push(...g.members)
    merged.members.sort((a, b) => b.rank - a.rank || a.id.localeCompare(b.id))
  }
  return out
}
