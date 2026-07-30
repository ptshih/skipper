// Co-located POIs — two DIFFERENT Wikidata items claiming the EXACT same point.
//
// ⚠ WHY THIS IS A WARNING AND NOT A RULE. Found 2026-07-30: `UNLV Arboretum` (Q7865354) carries the
// UNR Arboretum's coordinates, so a released clip saying "…down in Paradise, Nevada" fires on the Reno
// campus, 700 km away. The failure is invisible to everything we already run:
//
//   · the fail-closed grounding gate verifies script ↔ fact sheet, and BOTH were correct — only the
//     PLACE was wrong, which is a dimension nothing scores;
//   · Wikidata P625 is wrong UPSTREAM (verified directly), so our import is faithful;
//   · P131 ("located in") is wrong the SAME way — it says Reno — so the obvious cross-check fails;
//   · the Wikipedia article's own coordinates are wrong too (they inherit from Wikidata).
//
// Every structured signal agrees with every other and all of them are wrong. The only correct
// statement is in the article PROSE ("on the campus of the University of Nevada, Las Vegas"). So there
// is no free, deterministic check that can DECIDE this one — a decisive check has to read the prose,
// which means model judgment, which belongs in the paid `enrich` step where the article is already
// being read. That is not built.
//
// What IS free and worth having is the TRIAGE: an exact coordinate collision is rare and anomalous.
// Measured over the Tahoe + Yosemite corpus: 13 pairs, of which 12 are genuine co-location (Glacier
// Point / Glacier Point Hotel, El Capitan / Salathé Wall, Genoa Historic District / Genoa) and 1 was
// this error. A 13-row list an operator can eyeball beats no signal at all, and catching it at
// DISCOVERY is what keeps us from paying to enrich and narrate a place that isn't there.
//
// ⚠ Do NOT auto-exclude on this. It would wrongly bury 12 real places to catch 1.

/** The minimum a row needs to take part in the check. */
export interface ColocationRow {
  qid: string | null
  name: string
  lat: number
  lng: number
}

export interface ColocationGroup {
  lat: number
  lng: number
  rows: ColocationRow[]
}

/**
 * Group rows that share a BYTE-IDENTICAL coordinate with at least one other distinct QID.
 *
 * Exact equality, deliberately — not a proximity threshold. Genuinely adjacent places (Harold's Club
 * and Harrah's Reno are 60 m apart) are normal and would flood any radius-based rule; what is
 * anomalous is two independent items resolving to the same point to the last decimal, which is the
 * signature of a copied coordinate. ⚠ It also has a benign cause: Wikidata rounds. Glacier Point and
 * its hotel differ in Wikipedia (37.7304 vs 37.73083) and collide only after Wikidata's 4-decimal
 * rounding — so a collision is a question, never a verdict.
 *
 * Rows with no QID can't be told apart from each other and are skipped.
 */
export function findColocations(rows: readonly ColocationRow[]): ColocationGroup[] {
  const byPoint = new Map<string, ColocationRow[]>()
  for (const r of rows) {
    if (!r.qid) continue
    if (!Number.isFinite(r.lat) || !Number.isFinite(r.lng)) continue
    const key = `${r.lat},${r.lng}`
    const list = byPoint.get(key)
    if (list) list.push(r)
    else byPoint.set(key, [r])
  }
  const out: ColocationGroup[] = []
  for (const [key, group] of byPoint) {
    const distinctQids = new Set(group.map((r) => r.qid))
    if (distinctQids.size < 2) continue // one place listed twice is a dedup question, not this one
    const [lat, lng] = key.split(',').map(Number) as [number, number]
    out.push({ lat, lng, rows: [...group].sort((a, b) => a.name.localeCompare(b.name)) })
  }
  // Widest groups first — a 3-way collision is likelier to be wrong than a pair.
  return out.sort((a, b) => b.rows.length - a.rows.length || a.lat - b.lat)
}

/** The operator-facing lines for a discovery/hygiene run. Empty when there is nothing to review. */
export function colocationReport(groups: readonly ColocationGroup[]): string[] {
  if (groups.length === 0) return []
  const lines = [
    `⚠ ${groups.length} exact coordinate collision(s) — two different Wikidata items on the same point.`,
    `  Most are genuine co-location. Check each against its article's stated location: a wrong`,
    `  coordinate is upstream and invisible to the grounding gate (see pipeline/colocation.ts).`,
  ]
  for (const g of groups) {
    lines.push(`  ${g.lat.toFixed(5)}, ${g.lng.toFixed(5)}  ${g.rows.map((r) => `${r.name} [${r.qid}]`).join('  |  ')}`)
  }
  return lines
}
