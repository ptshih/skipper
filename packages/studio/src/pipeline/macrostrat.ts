// Macrostrat geology — coordinate-keyed bedrock facts layered onto narrated stops.
//
// Wikipedia is keyed on a PAGE; Macrostrat is keyed on a POINT, so it can ground a
// stop that has no Wikipedia article at all (a scenic pullout, a bend in the road)
// with the one true thing that is always there: the rock you are driving through.
// One keyless GET to the public Macrostrat API returns the geologic map unit under
// any lat/lng — its lithology and its age — sourced from USGS/state geologic maps.
//
// Grounding (the cardinal invariant): the lines this builds ARE the well of facts —
// the narrator may say what is on them and nothing more. So they state only what the
// data gives (the unit's lithology + age band). Mixed map units cannot establish one
// formation process for every constituent. Ages are ROUGH RANGES, never exact dates.
//
// License: Macrostrat data is CC BY 4.0 (the API echoes "CC-BY 4.0"); the underlying
// USGS maps are US public domain. A Macrostrat AttributionSnapshot is frozen onto the
// clip alongside Wikipedia's, so a multi-source clip credits every source it drew on.

import { MACROSTRAT_USER_AGENT } from '../config'
import type { AttributionSnapshot } from '@skipper/db/schema'
import { fetchWithRetry } from './http'

const API = 'https://macrostrat.org/api/v2/geologic_units/map'
/** Cap a hung university-service request so it can't stall a whole tour run. */
const REQUEST_TIMEOUT_MS = 10_000

/** One geologic map unit at a point (the fields we read from the Macrostrat response). */
interface MapUnit {
  map_id: number
  name: string
  strat_name: string
  lith: string
  best_int_name: string | null
  t_age: number | null // younger bound (Ma)
  b_age: number | null // older bound (Ma)
}

interface MacrostratResponse {
  success?: { license?: string; data?: MapUnit[] }
}

export interface GeologyResult {
  /** Plain, grounded fact lines for the fact sheet (the entire well for this layer). */
  facts: string[]
  /** Frozen credit for the clip's attribution array (CC BY 4.0). */
  attribution: AttributionSnapshot
}

/** A unit is usable only if it has a real lithology AND an age band — water/cover units have neither. */
function isUsable(u: MapUnit): boolean {
  if (!u.lith || u.lith.trim() === '') return false
  if (/^water$/i.test(u.name.trim())) return false
  return u.t_age != null && u.b_age != null
}

/**
 * Macrostrat returns overlapping units from maps at different scales (a fine state
 * map first, a coarse world map last). The most useful is the most SPECIFIC: prefer
 * the narrowest age band (a "Late Cretaceous" granite over a "Phanerozoic" catch-all),
 * tie-broken by array order (finest scale first). Returns null if nothing is usable.
 */
function pickUnit(units: MapUnit[]): MapUnit | null {
  const usable = units.filter(isUsable)
  if (usable.length === 0) return null
  return usable.reduce((best, u) => {
    const span = (u.b_age ?? 0) - (u.t_age ?? 0)
    const bestSpan = (best.b_age ?? 0) - (best.t_age ?? 0)
    return span < bestSpan ? u : best
  })
}

/** Pull the primary lithology out of Macrostrat's two formats: "Major:{a,b}, Minor:{…}" or a plain phrase. */
function readLith(u: MapUnit): string {
  const major = u.lith.match(/Major:\{([^}]*)\}/i)
  const raw = (major ? major[1]! : u.lith).trim()
  // "plutonic: undivided granitic rocks" → drop a leading texture qualifier for readability.
  const cleaned = raw
    .replace(/^[a-z ]+:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || raw
}

/** A rough, range-safe spoken age — never an invented precise figure. */
function agePhrase(u: MapUnit): string | null {
  const young = u.t_age
  const old = u.b_age
  if (young == null || old == null) return null
  if (old < 1) return 'less than a million years old'
  const y = Math.round(young)
  const o = Math.round(old)
  if (y === o || y === 0) return `roughly ${o} million years old`
  return `roughly ${y} to ${o} million years old`
}

/** Build 1–2 grounded fact lines from the chosen unit. */
function buildFacts(u: MapUnit): string[] {
  const facts: string[] = []
  const rock = readLith(u) || u.name
  // A broad unit name may mix sedimentary and volcanic rocks. Appending a single
  // inferred formation process here once turned Ferguson's mudstone into cooled lava.
  facts.push(`The bedrock at this spot is ${rock}.`)
  const age = agePhrase(u)
  if (u.best_int_name && age) facts.push(`This rock unit dates to the ${u.best_int_name} — ${age}.`)
  else if (u.best_int_name) facts.push(`This rock unit dates to the ${u.best_int_name}.`)
  else if (age) facts.push(`This rock unit is ${age}.`)
  return facts
}

/**
 * Geology facts for a point, or null when there is nothing groundable (the point is
 * over water, or only coarse cover units). Non-fatal by contract: any error returns
 * null so a flaky geology lookup never fails a tour (mirrors fetchFullExtracts).
 */
export async function geologyFacts(lat: number, lng: number): Promise<GeologyResult | null> {
  let json: MacrostratResponse
  try {
    const res = await fetchWithRetry(
      `${API}?lat=${lat}&lng=${lng}`,
      { headers: { 'User-Agent': MACROSTRAT_USER_AGENT } },
      { attempts: 3, timeoutMs: REQUEST_TIMEOUT_MS },
    )
    if (!res.ok) return null
    json = (await res.json()) as MacrostratResponse
  } catch (e) {
    console.warn(
      `Macrostrat lookup failed at ${lat},${lng} (${(e as Error).message}) — skipping geology.`,
    )
    return null
  }

  const unit = pickUnit(json.success?.data ?? [])
  if (!unit) return null

  return {
    facts: buildFacts(unit),
    attribution: {
      source: 'macrostrat',
      sourceId: String(unit.map_id),
      title: unit.name,
      url: `${API}?lat=${lat}&lng=${lng}`,
      license: 'CC BY 4.0',
      retrievedAt: new Date().toISOString(),
    },
  }
}
