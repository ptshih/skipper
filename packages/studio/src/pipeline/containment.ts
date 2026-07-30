// Is this place something a driver PASSES, or something they are INSIDE?
//
// Pure, no I/O, because the answer governs two irreversible-ish behaviours — whether a place may seed a
// grouping (`classify-treatments`) and whether it belongs in the corpus at all (`prune-corpus`) — and
// both deserve tests rather than a hand-check of one region.
//
// ⚠ WHY THREE SIGNALS AND NOT ONE. Each catches a shape the others cannot, measured over 1687 real POIs:
//
//   AREA (P2046) — big areal things. Yosemite NP 3079 km², Lake Tahoe 502, Desolation Wilderness 259.
//     Blind to linear extents: `Carson Range` claims no area at all.
//   LENGTH (P2043) — linear things. Carson Range 84 km, US-50 658, CA-89 391, Glacier Point Road 25.
//     Blind to compact-but-areal things and to ranges that claim neither (Cathedral Range: 16 km).
//   TYPE (P31) — the semantic answer, and the only one that is size-independent. The corpus holds 13
//     `mountain range` entities; area caught 11 of them, type catches all 13.
//
// And nothing OUTSIDE Wikidata works. `Sierra Nevada` and `Half Dome` both carry `kind = 'mountain'` with
// article lengths within 15% of each other (11.6k vs 10.1k chars), while `Carson Range` is a container
// with a SHORT article — so neither the local `kind` nor prose length separates them at either end.
// Name patterns fail too: "Sierra Nevada" gives nothing away.

/** The claims a containment decision reads. All optional — an un-backfilled poi answers `false`, which
 *  is the safe direction (a stop wrongly kept is visible; a stop wrongly deleted is silent). */
export interface ContainmentClaims {
  /** Wikidata P2046, km². Null/undefined = no claim, which for a poi means small-or-unknown. */
  areaKm2?: number | null
  /** Wikidata P2043, km. Null/undefined = no claim, NEVER "short". */
  lengthKm?: number | null
  /** Wikidata P31 labels, lowercased. Null/undefined = never fetched. */
  types?: string[] | null
}

/** At or above this extent a place is somewhere you are INSIDE for an hour, not somewhere you pass.
 *  Read off the observed distribution: it catches every real areal container across two regions (min
 *  caught: Mount Rose Wilderness 126 km²) while leaving SETTLEMENTS alone — Truckee 87, Incline Village
 *  56, South Lake Tahoe 43, Wawona 16 — because a town's centroid IS roughly the town. A 500 km² bar
 *  would readmit the roadless wildernesses. */
export const CONTAINER_AREA_KM2 = 100

/** At or above this LENGTH a place is a corridor, not a point. 25 km catches Carson Range (84), the
 *  through-highways (US-50 658, CA-89 391, I-580 48, NV-431 39) and Glacier Point Road (25.3), while
 *  leaving the short state routes and `Panorama Trail` (13.7) to be judged on their type instead —
 *  deliberately, because `Mist Trail` is a GOOD cluster subject and a blanket trail ban would break it. */
export const CONTAINER_LENGTH_KM = 25

/**
 * P31 labels that are containers REGARDLESS of stated size — the size-independent catch, and the only
 * signal that gets `Cathedral Range` (16 km, no area claim).
 *
 * ⚠ Matched as whole labels, not substrings. Substring matching on "national park" would swallow
 * `National Park Service visitor center` (5 in the corpus) and `ranger station` — which are good stops.
 * ⚠ `census-designated place` (44) and `unincorporated community` (40) are deliberately ABSENT: those
 * are the settlements that make the best district subjects (Camp Richardson, Tahoe Vista). Whether a CDP
 * duplicating a real town is worth speaking is a separate judgment the classifier's drop-list already makes.
 */
export const CONTAINER_TYPES: ReadonlySet<string> = new Set([
  'mountain range',
  'mountain system',
  'national park',
  'national park of the united states',
  'us wilderness area',
  'wilderness area',
  'national forest',
  // ⚠ `protected area` is NOT here, deliberately. Wikidata applies it to TRAILHEADS and field stations —
  // a preview flagged `Eagle Falls trailhead` (a member of the Emerald Bay cluster) and
  // `Glen Alpine Springs trailhead`, both of which are exactly the point stops this tour wants. A large
  // protected area carries an area claim and is caught by extent instead, so nothing is lost by the
  // omission. Same trap as 'national park' vs 'national park service visitor center': match whole
  // labels, and keep the set narrow enough that a facility inside a container isn't mistaken for one.
  'drainage basin',
  'basin',
  'watershed',
  'county of the united states',
  'diocese of the catholic church',
  // LINEAR by nature: a road's coordinate is an arbitrary point on a line you are ON for miles, so no
  // proximity trigger is meaningful. Authoritative replacement for a route-number name pattern, and it
  // catches `Glacier Point Road`, which no route-number regex would.
  'road',
  'state highway',
  'highway',
  'interstate highway',
])

/**
 * Types that make a place a SETTLEMENT — somewhere you drive through that is ALSO the thing a district
 * telling is about. A settlement overrides the container verdict, however large.
 *
 * ⚠ Why an override and not just a smaller threshold: `Carson City, Nevada` is 407 km², so extent alone
 * prunes it — and pruning it removes the natural SUBJECT of the "Historic Carson City" district AND its
 * fact sheet, which is that district's evidence. A range or a wilderness has no such role; a town does.
 * So the rule is "you are inside it, but it is what the telling is ABOUT", which is a district, not a
 * container. Matched as a PREFIX-ish membership because Wikidata is granular here: `city of california`,
 * `town in california`, `independent city in the united states`, `unincorporated town in nevada`.
 */
const SETTLEMENT_PATTERNS: readonly RegExp[] = [
  /^(city|town|village|hamlet|borough|municipality)\b/,
  /\b(city|town|village|community|municipality)\b.*\b(in|of)\b/,
  /^census-designated place/,
  /^unincorporated/,
  /capital of/,
]

/** Whether these P31 labels describe a settlement (which is a DISTRICT, never a container). */
export function isSettlement(types?: string[] | null): boolean {
  return (types ?? []).some((raw) => {
    const t = raw.toLowerCase().trim()
    return SETTLEMENT_PATTERNS.some((re) => re.test(t))
  })
}

/** Why a place was judged a container — surfaced so an operator reading an exclusion sees the evidence,
 *  not just the verdict. Null when it isn't one. */
export function containmentReason(c: ContainmentClaims): string | null {
  // A settlement is somewhere you drive THROUGH and is what a district telling is about — never a
  // container, at any size. Checked first so extent can't overrule it.
  if (isSettlement(c.types)) return null
  const t = (c.types ?? []).map((x) => x.toLowerCase().trim()).find((x) => CONTAINER_TYPES.has(x))
  if (t) return `container: Wikidata type "${t}"`
  if (c.areaKm2 != null && c.areaKm2 >= CONTAINER_AREA_KM2) {
    return `container: ${Math.round(c.areaKm2).toLocaleString()} km² extent (>= ${CONTAINER_AREA_KM2})`
  }
  if (c.lengthKm != null && c.lengthKm >= CONTAINER_LENGTH_KM) {
    return `container: ${Math.round(c.lengthKm)} km long (>= ${CONTAINER_LENGTH_KM})`
  }
  return null
}

/** Whether this place is somewhere you are inside/along rather than somewhere you pass. */
export function isContainer(c: ContainmentClaims): boolean {
  return containmentReason(c) != null
}
