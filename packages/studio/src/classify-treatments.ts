// classify-treatments — decide, ONCE per region, how each group of nearby places should be TOLD.
//
// The legibility layer's decision step (docs/ideas/poi-legibility-layer.md §4/§5). A Wikidata sweep
// answers "what is here"; this answers "is this one stop, one area, or several unrelated things", which
// is the part a competitor with an API key doesn't get for free.
//
//   SOLO     — near each other but unrelated. Leave them independent.
//   CLUSTER  — a driver experiences them as ONE place, few enough to NAME EACH (Emerald Bay).
//   DISTRICT — an area you drive THROUGH with more landmarks than a telling can name (downtown Reno).
//
// WHAT THIS WRITES: only the grouping — one `poi_clusters` row per group, with every member's
// `pois.cluster_id` pointing at it. It writes NO audio and changes nothing a rider hears; every POI
// keeps its own narration until phase 4 fuses them. That inertness is deliberate: it makes the design
// INSPECTABLE (look at the groupings in the console) for a couple of dollars, before any regeneration.
//
// ⚠ The group is a ROW, not three columns on an elected "anchor" poi — see the `poiClusters` schema
// comment for why that first cut was replaced. Practically: the SUBJECT (`pickSubject`) is the member
// that IS the group when one exists (a `…Historic District` QID), and NULL when none does, instead of
// whichever member happened to own the longest clip.
//
// ⚠ PRECOMPUTED, NEVER PER-ROUTE. Audio is synthesized ahead of time and a fused telling is one clip,
// so route-dependent membership would require audio per route — the thing V2 exists not to do.
//
// PROMPT: the `v4` wording, chosen by measurement, not taste — four variants were scored over 3 runs
// each (§4b). v2 scored better agreement (97% vs 95%) but had quietly reclassified Camp Richardson from
// CLUSTER to DISTRICT because it told the model to ignore member count; v4 restores the naming-capacity
// rule. ⚠ `temperature` is DEPRECATED on Opus 4.8 (the API 400s on it), so it is NOT a lever here.
//
// Blast radius: SPENDS (one Opus call per multi-member group — measured ~$0.82 for 64 groups) and
// MUTATES DB on --apply. Preview classifies and reports, writing nothing.
//
//   preview:  dotenvx run -f .env.development -- bun packages/studio/src/classify-treatments.ts
//   apply:    dotenvx run -f .env.development -- bun packages/studio/src/classify-treatments.ts --apply
//   --region <slug>   scope to a region's bbox (default: lake-tahoe)
//   --radius <m>      grouping radius around each anchor (default 600)
//   --clear           on --apply, only CLEAR the grouping in scope (the undo); makes no model calls

import type Anthropic from '@anthropic-ai/sdk'
import { and, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '@skipper/db'
import { poiClusters, pois } from '@skipper/db/schema'
import { announce, parseFlags } from './pipeline/ops'
import { mapLimit } from './pipeline/concurrency'
import { withRetry } from './pipeline/http'
import { resolveRegion, requireRegionBbox } from './pipeline/region'
import { leaderGroups, mergeDistricts, metersBetween, pickSubject, type ClassifiedGroup } from './pipeline/clustering'
import { isContainer } from './pipeline/containment'
import { getAnthropic, JUDGMENT_MODEL } from './models'
import { DEFAULT_REGION_SLUG, NARRATION_CONCURRENCY } from './config'

/** Default grouping radius. ⚠ NOT derived — 600 m produces sane group diameters (leader grouping bounds
 *  them to 2R) but the honest radius is an open question in the design doc §8. Flag-tunable so it can be
 *  re-tuned from a real drive rather than from here. */
const DEFAULT_RADIUS_M = 600

/** Two same-titled DISTRICT groups whose anchors are within this are the SAME district seen twice (the
 *  leader pass anchors more than once inside a big downtown). Beyond it they're two different places
 *  that happen to share a name. */
const DISTRICT_MERGE_GAP_M = 3_000

// Containment (may a place SEED a grouping?) is single-sourced in pipeline/containment.ts — the same
// predicate `prune-corpus` uses to decide whether it belongs in the corpus at all.

/** What actually needs a human look. ⚠ The first cut flagged everything under 0.85 confidence and that
 *  surfaced 25 of 55 groups — half the corpus, which is not a review queue, it's noise. The determinism
 *  runs say why: 2-4 member groups naturally sit at 0.72-0.85, so the threshold was measuring group SIZE
 *  dressed up as doubt. Every group that actually returned a DIFFERENT answer across three runs was a
 *  2-member pair. So flag on that shape instead — a handful of items, each genuinely ambiguous. */
const REVIEW_MAX_MEMBERS = 2
const REVIEW_MAX_CONFIDENCE = 0.85

const TREATMENTS = ['SOLO', 'CLUSTER', 'DISTRICT'] as const
type Treatment = (typeof TREATMENTS)[number]

const TOOL: Anthropic.Tool = {
  name: 'classify',
  description: 'Classify how a driver should experience this group of nearby places.',
  input_schema: {
    type: 'object',
    properties: {
      treatment: { type: 'string', enum: [...TREATMENTS] },
      title: { type: 'string', description: 'What a driver would call this place. 6 words or fewer.' },
      highlights: { type: 'array', items: { type: 'string' }, description: 'Members worth naming aloud, most recognisable first.' },
      drop: { type: 'array', items: { type: 'string' }, description: 'Members not worth speaking at all.' },
      why: { type: 'string', description: 'One sentence.' },
      confidence: { type: 'number', description: '0 to 1.' },
    },
    required: ['treatment', 'title', 'highlights', 'why', 'confidence'],
  },
}

const SYSTEM = `You decide how a GPS-triggered driving audio tour should present a group of nearby places.
The car passes at speed; one stop = one continuous piece of narration, roughly 60-180 seconds. That
length is the real constraint: a telling can NAME about five things well, not twenty.

Apply these tests IN ORDER and stop at the first that matches:

1. SOLO — is there NO shared subject? If the places are merely near each other (a church and a
   library; a water park and an outlet mall off the same exit), answer SOLO. Also answer SOLO when
   only one member is worth speaking at all and the rest are administrative abstractions (a
   census-designated place, a state-route number used as a place), never-built projects, or
   duplicates of another member.

2. DISTRICT — is there a shared subject, but MORE landmarks than one telling can name (roughly seven
   or more worth speaking)? Then it is an area you drive through: name the two or three most
   recognisable and let the rest be background. Downtowns, dense historic districts, campuses.

3. CLUSTER — there is a shared subject and few enough members (roughly five or fewer) to NAME EACH
   ONE in a single telling. A bay and what you see across it; a museum and its exhibits; a mountain
   and the tunnel through it; a resort and its grounds; a hamlet and its two landmarks.

The count is the deciding test between 2 and 3, NOT whether a settlement happens to be named. A
three-member resort community you pass in seconds is CLUSTER even though it is a place with a name;
a thirty-member downtown is DISTRICT. When a group sits near the boundary, prefer CLUSTER if every
member could still be named aloud.

Judge by what a passenger experiences, never by raw distance.`

interface Row {
  id: string
  name: string
  kind: string | null
  lat: number
  lng: number
  rank: number
  sheet: string | null
  seedable: boolean
}
interface Verdict {
  treatment: Treatment
  title: string
  highlights?: string[]
  drop?: string[]
  why: string
  confidence: number
}

async function classify(group: Row[]): Promise<Verdict | null> {
  let spread = 0
  for (const a of group) for (const b of group) spread = Math.max(spread, metersBetween(a.lat, a.lng, b.lat, b.lng))
  const body = group
    .map((x, i) => {
      const sheet = x.sheet ? ` — ${x.sheet.replace(/\s+/g, ' ').slice(0, 150)}` : ''
      return `${i + 1}. ${x.name}${x.kind ? ` (${x.kind})` : ''}${sheet}`
    })
    .join('\n')
  const res = await withRetry(
    () =>
      getAnthropic('treatment classify').messages.create({
        model: JUDGMENT_MODEL,
        max_tokens: 900,
        system: SYSTEM,
        tools: [TOOL],
        tool_choice: { type: 'tool', name: 'classify' },
        messages: [{ role: 'user', content: `${group.length} places within ${Math.round(spread)} m of each other:\n\n${body}` }],
      }),
    { label: `classify(${group[0]!.name})` },
  )
  const call = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  return (call?.input as Verdict | undefined) ?? null
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2), { valueFlags: ['region', 'radius'] })
  const apply = flags.has('apply')
  const clearOnly = flags.has('clear')
  const radiusM = Number(flags.value('radius') ?? DEFAULT_RADIUS_M)
  if (!Number.isFinite(radiusM) || radiusM <= 0) {
    console.error('--radius must be a positive number of metres.')
    process.exit(1)
  }
  announce({ tool: 'classify-treatments', blast: clearOnly ? ['MUTATES DB'] : ['SPENDS $', 'MUTATES DB'], apply })

  const region = await resolveRegion(flags.value('region') ?? DEFAULT_REGION_SLUG)
  const bbox = requireRegionBbox(region)
  console.log(`Region: ${region.displayName} (${region.slug})  ·  radius ${radiusM} m`)

  const inBbox = [
    sql`${pois.lat} between ${bbox.swLat} and ${bbox.neLat}`,
    sql`${pois.lng} between ${bbox.swLng} and ${bbox.neLng}`,
  ]

  // Clearing the grouping in scope is BOTH the undo and the first half of an apply: a re-run whose
  // groups came out differently would otherwise leave satellites pointing at anchors that are no longer
  // anchors. So a fresh classification always re-baselines rather than patching.
  // Deleting the cluster rows is enough: `pois.cluster_id` is ON DELETE SET NULL, so membership
  // unwinds itself. Scoped to clusters that actually have a member in this bbox, so clearing one
  // region never touches another's.
  const clearGrouping = () =>
    withRetry(
      () =>
        db.execute(sql`delete from ${poiClusters} where id in (
          select distinct ${pois.clusterId} from ${pois}
          where ${pois.clusterId} is not null and ${and(...inBbox)})`),
      { label: 'cluster.clear' },
    )

  if (clearOnly) {
    const [{ n } = { n: 0 }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(pois)
      .where(and(...inBbox, sql`${pois.clusterId} is not null`))
    console.log(`\n${n} POI(s) currently carry a grouping.`)
    if (!apply) return console.log('PREVIEW — no writes. Re-run with --apply --clear to clear them.')
    await clearGrouping()
    return console.log(`✓ grouping cleared for ${n} POI(s).`)
  }

  // Every non-excluded place with something to say — NOT just the narrated ones. An excluded poi is
  // already out of the corpus (hygiene runs FIRST; it is what makes the classifier stable, §4b).
  //
  // ⚠ Ranked by FACTS STRENGTH, and deliberately NOT joined to `narrations`. Two reasons:
  //
  //   1. Facts strength is the RIGHT signal and clip length was a noisy derivative of it — a richer
  //      fact sheet is what produces a longer clip. Ranking on the shadow picked worse seeds: measured
  //      against clip length it disagreed on 7 of 10 groups, and facts won the ones that mattered
  //      (downtown Reno seeded from the Riverside Hotel rather than an apartment block; Camp Richardson
  //      from the settlement rather than one estate inside it).
  //   2. Dropping the join removes the pipeline-ORDER trap. Requiring narration meant grouping could
  //      only run AFTER generation — which is why the Tahoe corpus has 181 satellite clips that fused
  //      generation would have to throw away. Grouping belongs BEFORE generation
  //      (discover → enrich → group → generate), so the discarded clips are never paid for. It also
  //      unblocks the region-agnosticism test: Yosemite has 837 POIs, 0 narrated, 292 with extracts.
  const rows: Row[] = (
    await db
      .select({
        id: pois.id,
        name: pois.name,
        kind: pois.kind,
        lat: pois.lat,
        lng: pois.lng,
        // Curated sheet entries first (the enricher's judgment about what is worth saying), then raw
        // article length as the pre-enrichment proxy. `* 10000` keeps sheet count dominant over chars.
        rank: sql<number>`(
          coalesce(case when jsonb_typeof(${pois.factSheet}) = 'array' then jsonb_array_length(${pois.factSheet}) else 0 end, 0) * 10000
          + coalesce(length(${pois.facts} ->> 'extract'), 0)
        )`,
        sheet: sql<string | null>`left(${pois.factSheet}::text, 180)`,
        areaKm2: pois.areaKm2,
        lengthKm: pois.lengthKm,
        wikidataTypes: pois.wikidataTypes,
      })
      .from(pois)
      .where(and(...inBbox, isNull(pois.excludedReason), sql`(
        ${pois.facts} ->> 'extract' is not null
        or (jsonb_typeof(${pois.factSheet}) = 'array' and jsonb_array_length(${pois.factSheet}) > 0)
      )`))
  ).map((r) => ({
    ...r,
    rank: Number(r.rank),
    // A container may JOIN a group but never define one: its coordinate is a nominal centroid, so a
    // group formed around it has an arbitrary centre. Un-backfilled POIs answer false → stay seedable.
    seedable: !isContainer({ areaKm2: r.areaKm2, lengthKm: r.lengthKm, types: r.wikidataTypes }),
  }))

  const blocked = rows.filter((r) => !r.seedable)
  if (blocked.length) {
    console.log(
      `\n${blocked.length} container(s) barred from SEEDING (still joinable as members): ` +
        blocked.slice(0, 6).map((b) => b.name).join(' · ') + (blocked.length > 6 ? ` +${blocked.length - 6}` : ''),
    )
  }
  const groups = leaderGroups(rows, radiusM)
  const multi = groups.filter((g) => g.length > 1)
  console.log(
    `\n${rows.length} POI(s) with facts → ${groups.length} group(s); ${multi.length} with 2+ members.\n` +
      `${multi.length} model call(s) ≈ $${(multi.length * 0.013).toFixed(2)} (measured ~$0.013/group).`,
  )
  if (multi.length === 0) return console.log('Nothing to classify.')

  const verdicts = await mapLimit(multi, NARRATION_CONCURRENCY(), async (g: Row[]) => ({ g, v: await classify(g) }))
  const failed = verdicts.filter((x) => !x.v).length
  if (failed) console.warn(`⚠ ${failed} group(s) returned no verdict — left ungrouped.`)

  const classified: ClassifiedGroup<Row>[] = verdicts
    .filter((x): x is { g: Row[]; v: Verdict } => x.v != null)
    .map(({ g, v }) => ({ members: g, treatment: v.treatment.toLowerCase(), title: v.title }))
  const byAnchor = new Map(classified.map((c) => [c.members[0]!.id, verdicts.find((x) => x.g[0]!.id === c.members[0]!.id)!.v!]))

  const beforeDistricts = classified.filter((c) => c.treatment === 'district').length
  const merged = mergeDistricts(classified, { districtTreatment: 'district', maxAnchorGapM: DISTRICT_MERGE_GAP_M })
  const afterDistricts = merged.filter((c) => c.treatment === 'district').length
  if (beforeDistricts !== afterDistricts) {
    console.log(`\ndistrict merge: ${beforeDistricts} → ${afterDistricts} (the leader pass anchors more than once inside a big district)`)
  }

  const groupable = merged.filter((c) => c.treatment !== 'solo' && c.members.length > 1)
  const solo = merged.filter((c) => c.treatment === 'solo')
  const lowConf = merged.filter(
    (c) =>
      c.members.length <= REVIEW_MAX_MEMBERS &&
      (byAnchor.get(c.members[0]!.id)?.confidence ?? 1) < REVIEW_MAX_CONFIDENCE,
  )
  const drops = merged.flatMap((c) => byAnchor.get(c.members[0]!.id)?.drop ?? [])

  for (const t of ['cluster', 'district'] as const) {
    const set = groupable.filter((c) => c.treatment === t)
    console.log(`\n${'='.repeat(74)}\n${t.toUpperCase()} — ${set.length} group(s)\n${'='.repeat(74)}`)
    for (const c of [...set].sort((a, b) => b.members.length - a.members.length)) {
      const v = byAnchor.get(c.members[0]!.id)!
      console.log(`\n▸ ${c.title}  [n=${c.members.length}, conf=${v.confidence}]`)
      console.log(`  anchor  : ${c.members[0]!.name}`)
      console.log(`  absorbs : ${c.members.slice(1).map((m) => m.name).join(' · ')}`)
      console.log(`  why     : ${v.why}`)
    }
  }
  console.log(
    `\n${'='.repeat(74)}\nSOLO — ${solo.length} group(s) left independent (nothing written for these).\n` +
      `${lowConf.length} group(s) worth a human look (${REVIEW_MAX_MEMBERS} members or fewer AND under ` +
      `${REVIEW_MAX_CONFIDENCE} confidence — the shape that actually flip-flopped across runs).\n` +
      (drops.length ? `${drops.length} member(s) the model would DROP entirely (reported only, not applied): ${drops.slice(0, 8).join(' · ')}\n` : ''),
  )

  const withSubject = groupable.filter((c) => pickSubject(c.members, c.title) != null).length
  const memberCount = groupable.reduce((a, c) => a + c.members.length, 0)
  console.log(
    `Writes: ${groupable.length} cluster row(s) covering ${memberCount} place(s); ${withSubject} have a real ` +
      `SUBJECT entity, ${groupable.length - withSubject} honestly have none. NO audio changes.`,
  )
  if (!apply) return console.log('\nPREVIEW — no writes. Re-run with --apply to persist the grouping.')

  await clearGrouping() // re-baseline: a changed grouping must not leave stale membership behind
  let n = 0
  await mapLimit(groupable, 8, async (c) => {
    const subject = pickSubject(c.members, c.title)
    const v = byAnchor.get(c.members[0]!.id)
    await withRetry(async () => {
      const [row] = await db
        .insert(poiClusters)
        .values({
          treatment: c.treatment,
          title: c.title,
          subjectPoiId: subject?.id ?? null,
          // The EVIDENCE. Fused generation reads these, not `treatment` — see the schema comment.
          highlights: v?.highlights ?? [],
          dropped: v?.drop ?? [],
        })
        .returning({ id: poiClusters.id })
      await db
        .update(pois)
        .set({ clusterId: row!.id })
        .where(inArray(pois.id, c.members.map((m) => m.id)))
    }, { label: `cluster(${c.title})` })
    n++
  })
  console.log(`\n✓ ${n} cluster(s) written, ${memberCount} membership(s) set. Undo: --apply --clear`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
