// Grounding fingerprints — the hashes that key the narration STALENESS contract.
//
// Lives in `@skipper/db` (subpath `@skipper/db/hash`) rather than in the studio pipeline, because
// staleness has readers on BOTH sides of a package boundary the studio can't cross: the paid pipeline
// WRITES `narrations.facts_hash`, and the admin console READS it to render fresh/stale. For a POI that
// read is a comparison of two STORED columns, so admin never needed a hasher — but a CLUSTER's
// fingerprint is an aggregate over its members (there is deliberately no materialized column; see
// `clusterFactsHash`), so admin has to COMPUTE it, and `apps/admin` cannot import `@skipper/studio`
// (no dependency; `apps/admin/server/places.ts` documents the standing policy of duplicating rather
// than pulling studio's graph in). One hasher in a package both already depend on is the only shape
// that doesn't end in two implementations of the same digest.
//
// ⚠ Side-effect-free by construction, per the `@skipper/db` invariant: `node:crypto` plus TYPE-only
// imports from `./schema`. It must never reach `./client` — importing a hash helper cannot be allowed
// to require `DATABASE_URL`.

import { createHash } from 'node:crypto'
import type { PoiFacts, FactSheetEntry } from './schema'

/**
 * Deterministic JSON serialization with object keys sorted recursively — so a hash taken over a
 * facts object is INVARIANT to key ORDER. This is load-bearing because `pois.facts` is `jsonb`:
 * Postgres does NOT preserve object key order, so the SAME logical facts serialize one way
 * in-memory (a writer's freshly-built object, stamped onto `pois.facts_hash`) and a DIFFERENT way
 * read back from the DB (what drives/roam stamp onto `narrations.facts_hash` — e.g. `{text,source,…}`
 * comes back as `{url,text,…}`). Plain `JSON.stringify` would make those two hashes diverge, so a
 * read-back-hashed clip would read as perpetually stale against the staleness contract
 * (`narrations.facts_hash IS DISTINCT FROM pois.facts_hash`). Sorting keys normalizes both sides to one
 * canonical form. ARRAY order is PRESERVED (significant — the well's spans are in reading order, and a
 * cluster's `highlights` are "most recognisable first"); only object keys are reordered. Mirrors
 * `JSON.stringify`'s treatment of `undefined` (object entries dropped, array holes → null) so an
 * omitted-vs-undefined key never shifts the hash.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined ? 'null' : stableStringify(v))).join(',')}]`
  }
  const obj = value as Record<string, unknown>
  const parts: string[] = []
  for (const k of Object.keys(obj).sort()) {
    const v = obj[k]
    if (v === undefined) continue // JSON.stringify omits undefined-valued object entries
    parts.push(`${JSON.stringify(k)}:${stableStringify(v)}`)
  }
  return `{${parts.join(',')}}`
}

/** sha256 over the canonical form — the ONE place the digest algorithm and encoding are chosen.
 *  Private on purpose: every fingerprint in this file has to agree on it, and a caller that picked its
 *  own would produce a hash that silently never matches the stored one. */
function digest(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}

/** Order-invariant hash of a poi's facts — the change-detector for narration staleness. Null when
 *  no facts. Canonicalizes via `stableStringify` so the hash survives the `pois.facts` jsonb
 *  round-trip: a writer's in-memory `pois.facts_hash` equals a reader's read-back `narrations.facts_hash`
 *  for the same content (the staleness contract compares those two STORED columns by inequality). */
export function hashFacts(facts: PoiFacts | null): string | null {
  if (!facts) return null
  return digest(facts)
}

/**
 * The GROUNDING fingerprint for a story poi — the hash a narration's `facts_hash` is compared against for
 * staleness. THE SWITCH (corpus-enrichment-spec §3/§8), now reading the typed `pois.fact_sheet` column:
 *   - ENRICHED (a non-empty fact sheet) → hash the SHEET ONLY. Narration grounds on it, so a
 *     re-`discover` that rewrites `extract` but keeps the SAME sheet must NOT stale narrations; the
 *     `enriched_at` stamp can't churn it either (it isn't in the hash). The true "did the narration
 *     input change" detector. Byte-identical to the pre-column well-hash, so existing rows stay valid.
 *   - UN-ENRICHED (no sheet) → hash the whole facts object (`hashFacts`), so existing rows + the
 *     extract-head fallback keep their current hash exactly. Both WRITERS (sweep/enrich) and READERS
 *     (drives/roam) call THIS, canonicalized (`stableStringify`), so a clip's stamped hash can never
 *     diverge from `pois.facts_hash` across the in-memory ↔ jsonb-read-back boundary.
 */
export function storyFactsHash(
  facts: PoiFacts | null,
  factSheet: FactSheetEntry[] | null | undefined,
): string | null {
  if (factSheet && factSheet.length > 0) return digest(factSheet)
  // No null guard: hashFacts is already null-in/null-out. Don't re-add one — a second guard here
  // would have to be kept in step with that one for no gain.
  return hashFacts(facts)
}

/* -------------------------------------------------------------------------- */
/*  Fused CLUSTER tellings                                                      */
/* -------------------------------------------------------------------------- */

/** One member's contribution to a cluster's fingerprint: WHICH place, and what it currently says. */
export interface ClusterHashMember {
  poiId: string
  /** The member's `pois.facts_hash` (`storyFactsHash`). Null is tolerated, never dropped — see below. */
  factsHash: string | null
}

/** Everything a fused telling is generated FROM. Deliberately not a `poi_clusters` row: the caller
 *  must pass the members it actually grounded on, which is a strict subset of `pois.cluster_id`. */
export interface ClusterHashInput {
  /** ONLY the members that reach the grounding well — narratable AND not excluded. Passing raw
   *  membership is the defect this type exists to make visible; see `clusterFactsHash`. */
  members: readonly ClusterHashMember[]
  /** `poi_clusters.title` — what the skipper calls the place, and a generation input. */
  title: string
  /** `poi_clusters.highlights` / `.dropped` — the model's naming evidence. Order is SIGNIFICANT
   *  (highlights are "most recognisable first"), so these are hashed as given, not sorted. */
  highlights: readonly string[]
  dropped: readonly string[]
}

/**
 * The grounding fingerprint for a FUSED cluster telling — `narrations.facts_hash` for a row whose
 * subject is a `poi_clusters` id rather than a poi.
 *
 * WHAT IS IN IT, and why each is not optional:
 *   - the MEMBER SET as `poiId:factsHash` pairs, sorted. Sorted (not XOR) so it stays deterministic,
 *     collision-resistant and PRINTABLE — you can dump the input and diff it. The `poiId` is in the
 *     payload because the hashes alone do not make membership part of the identity: a member whose
 *     `facts_hash` is null would be invisible, and `{h1}` would equal `{h1, null}`. It also makes an
 *     `excluded_reason` toggle — a free admin action that moves no member's facts — move the digest,
 *     which is the whole reason a member can leave the telling without any article changing.
 *   - `title` / `highlights` / `dropped`. §3.1 of the fused-generation spec makes `highlights` the
 *     naming set, so moving a member from highlights to dropped rewrites the telling while every
 *     member's facts stay byte-identical. A facts-only hash would call that clip fresh.
 *
 * WHAT IS DELIBERATELY OUT:
 *   - `treatment` — a CONCLUSION derived from `highlights.length` against the current clip band; the
 *     `poi_clusters` schema comment is explicit that evidence is persisted and conclusions are derived.
 *   - `subject_poi_id` — derived by `pickSubject` from the members and the title, both already covered.
 *   - the delivery REGISTER (and so the length band). A poi's own `facts_hash` doesn't cover
 *     `pois.delivery_register` either, so a `classify-registers` re-run silently re-bands every solo
 *     clip too. That gap is real and repo-wide; fixing it inside a cluster helper would leave the two
 *     subject kinds on different contracts. One gap, one future fix.
 *
 * Returns NULL — never `sha256('')` — when no member contributes facts, mirroring `storyFactsHash`'s
 * null-when-nothing-to-ground-on. A constant digest shared by every empty cluster would read as FRESH
 * in the admin verdict (`clip.factsHash === poi.factsHash`) for a clip grounded on nothing. ⚠ The
 * caller must therefore SKIP a null-hash cluster before freshness is consulted, exactly as
 * `generate-narrations.ts` skips a sheet-less poi before reading `hasFreshClip` — a null hash reads as
 * permanently stale, so a cluster queued on it is re-narrated and re-synthesized on every run.
 */
export function clusterFactsHash(input: ClusterHashInput): string | null {
  const members = input.members
    .map((m) => `${m.poiId}:${m.factsHash ?? ''}`)
    .sort()
  if (members.length === 0) return null
  return digest({
    members,
    title: input.title,
    highlights: [...input.highlights],
    dropped: [...input.dropped],
  })
}
