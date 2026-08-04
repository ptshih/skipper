// curate-places — build a region's CURATED set of Google Places. SPENDS $ (Anthropic draft + Google
// Places resolve) + MUTATES DB on --apply.
//
// The offline, ONE-TIME-per-region step that feeds the Create-a-Drive picker (and, later, break
// pitstops). An LLM drafts the region's popular start/end HUBS (towns, marinas, scenic lookouts,
// trailhead gateways) + good break PITSTOPS (coffee/gas/rest/viewpoint pull-offs); each draft is
// resolved against Google Places (Autocomplete + Details, bbox-restricted) into a canonical
// place_id + name + coords + primaryType; the resolved rows are upserted into `places`, ROLE-tagged
// (endpoint-eligible / break-eligible) and with a `featured` popular-subset flag. The founder then
// reviews / prunes in the admin console.
//
// WHY curated (not open autocomplete): coords are resolved + STORED here, ONCE, so the RUNTIME picker
// reads a stored short list with ZERO live Places calls — no proxy, no session tokens, no Details.
// Charm over scale: every option is an intentional, recognizable place. See
// docs/designs/places-endpoints-spec.md.
//
// SOP (docs/guides/ops-scripts-sop.md): PREVIEWS by default (the dry run makes NO paid calls — it just
// explains what --apply will do); --apply spends (Anthropic + Places) and writes. FOUNDER-GATED: a paid
// run needs an explicit "go" (CLAUDE.md), never inferred.
//
// Usage:
//   dotenvx run -f .env.development -- bun packages/studio/src/curate-places.ts
//   ... --apply                  run it (drafts + resolves + upserts role-tagged `places`)
//   ... --region <slug>          curate a region (REQUIRED — no default; resolves to its bbox)
//   ... --model sonnet           draft with Sonnet instead of the default Opus (cheaper A/B)
//   ... --target 100             roughly how many places to draft (guidance to the model; 8-120)
//   ... --max-cost 1             abort before any spend if the LLM estimate exceeds this

import { sql } from 'drizzle-orm'
import { db } from '@skipper/db'
import { places } from '@skipper/db/schema'
import Anthropic from '@anthropic-ai/sdk'
import { announce, maxCostFlag, parseFlags } from './pipeline/ops'
import { requireRegionBbox, requireRegionKey, resolveRegion, type RegionBbox } from './pipeline/region'
import { runJob } from './pipeline/job-progress'
import { withRetry, sleep } from './pipeline/http'
import { isAddressLike, isParkingLike, nameDisagrees, resolveCuratedPlace, type CuratedPlace, type PlacesBbox } from './pipeline/places'
import { ENRICH_MODELS, getAnthropic, type EnrichModelChoice } from './models'
import { llmSpendLines, llmSpentUsd, recordModelUsage, usageUsd } from '@skipper/shared'
import { ANTHROPIC_READY, GOOGLE_READY, requireEnv } from './config'

/** The draft call's pre-run estimate, priced through the SAME `usageUsd` the real tally uses rather
 *  than a hand-kept dollar constant (pre-run estimate only; the real tally prints after).
 *
 *  ⚠ IT SCALES WITH `--target`, which is the whole point. This was a flat `{sonnet: 0.03, opus: 0.08}` —
 *  correct while a draft was always ~30 places, and quietly wrong the moment the default became 100:
 *  the dry run would promise $0.08 for a call costing several times that, and `--max-cost` would
 *  authorise a spend it had mis-measured. Bounding one quantity with a number derived from a DIFFERENT
 *  quantity is the bug this repo keeps re-paying for, so the estimate reads the same `targetN` the
 *  prompt asks for.
 *
 *  Token figures are deliberately generous — one drafted place is a name + Places query + role +
 *  featured + a short rationale, and an estimate that UNDER-promises ahead of a paid run is the failure
 *  that actually costs money. */
const EST_INPUT_TOKENS = 1_400
const EST_TOKENS_PER_PLACE = 80

/** ⚠ FAILS CLOSED on an unpriced model. `usageUsd` returns 0 for one it does not recognise — honest
 *  for a post-hoc tally, but as a PRE-SPEND bound a $0 estimate silently clears every `--max-cost`,
 *  which is the opposite of what this number exists for. */
function estimateDraftUsd(modelId: string, targetN: number): number {
  const usd = usageUsd(modelId, { input_tokens: EST_INPUT_TOKENS, output_tokens: targetN * EST_TOKENS_PER_PLACE })
  if (usd === 0) {
    throw new Error(
      `curate-places: ${modelId} is not in MODEL_PRICING — refusing to estimate a paid draft at $0. Add it in @skipper/shared (spend.ts).`,
    )
  }
  return usd
}

const flags = parseFlags(process.argv.slice(2), { valueFlags: ['region', 'model', 'target', 'max-cost'] })
const apply = flags.has('apply')
// ⚠ Resolved at PARSE time, before `runJob` opens a row — and this value IS the run's `targetId`
// (the per-region in-flight lock), so a defaulted one would lock the wrong region as well as curate it.
const regionKey = requireRegionKey(flags.value('region'))
const modelChoice: EnrichModelChoice = flags.value('model') === 'sonnet' ? 'sonnet' : 'opus'
const model = ENRICH_MODELS[modelChoice]
// ⚠ THE CEILING IS COUPLED TO TWO THINGS, so do not raise it alone.
// (1) `max_tokens` on the draft call below — the whole candidate list is ONE forced tool call, and a
//     truncated one is HTTP 200 carrying a half-parsed list. Raised to 120 from 60 when curation moved
//     to bbox scoping (a box spanning Tahoe AND Reno AND the Comstock needs a bigger budget than a
//     shoreline ring did), and max_tokens went up with it + a stop_reason guard.
// (2) MAX_PLAN_ANCHORS (apps/api/src/limits.ts) — the curated endpoint set rides in the planner's
//     CACHED prompt prefix on every rider turn, so the region's total must stay well under it. 120 per
//     RUN with an OR-merge upsert keeps a couple of passes clear of that ceiling.
// ⚠ THE DEFAULT WAS SIZED FOR A UI THAT NO LONGER EXISTS. 30 was right when this set fed the
// tap-to-pick create form — a list a human THUMB-SCROLLED, where 120 is a wall. `GET /drives/anchors`
// was deleted end to end in 1.1 and the set's only consumer is now the PLANNER's roster, which Opus
// reads whole from a cached prefix. Thumb-scrolling stopped binding; MAX_PLAN_ANCHORS (200) and model
// attention are what bind, and every name added is one fewer in-persona "do not know that one".
const targetCount = Math.max(8, Math.min(120, Number(flags.value('target')) || 100))
const maxCostUsd = maxCostFlag(flags)

announce({ tool: 'curate-places', blast: ['SPENDS $', 'MUTATES DB'], apply })

/** One LLM-drafted candidate DESTINATION — a name, a precise search query, and how likely a visitor is
 *  to say the name out loud. The model NAMES places it knows; Google Places RESOLVES them to coords (the
 *  model never invents a coordinate).
 *  ⚠ `role` is gone with the break concept (2026-08-04) and `featured` became `rank`: this list is
 *  destinations only, and "iconic" was never a two-valued property. */
interface PlaceDraft {
  name: string
  query: string
  rank: number
  rationale?: string
}

const DRAFT_TOOL: Anthropic.Tool = {
  name: 'draft_curated_places',
  description:
    'Return the curated set of real, recognizable DESTINATIONS for this region — places a drive can start at or finish at.',
  input_schema: {
    type: 'object',
    properties: {
      places: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'The place name a rider would recognize (e.g. "Tahoe City").' },
            query: {
              type: 'string',
              description:
                'A precise Google Places search string that uniquely pins THIS place — include the locality/state when the bare name is ambiguous (e.g. "Emerald Bay State Park, California").',
            },
            rank: {
              type: 'integer',
              description:
                'How likely a visitor is to NAME this place out loud, 1 being the most. Ties are fine. A low rank is not a criticism — it means real, but less asked-for.',
            },
            rationale: { type: 'string', description: 'One short phrase on why this place earns a spot.' },
          },
          required: ['name', 'query', 'rank'],
        },
      },
    },
    required: ['places'],
  },
}

/**
 * The draft prompt.
 *
 * ⚠ SCOPE IS THE BBOX, NEVER THE DISPLAY NAME — that is why this takes a `RegionBbox` at all.
 * It used to read "Stay strictly inside ${regionName}", and a model told "strictly inside Lake Tahoe"
 * correctly excludes Truckee, Reno, Carson City and Virginia City: none of them are in the Tahoe Basin.
 * But the lake-tahoe bbox reaches every one of them, `discover-pois` swept them, and 28 released fused
 * tellings sat out there with no curated endpoint a rider could name to drive to one — finished audio
 * nobody could route to. The name is prose and is routinely NARROWER than the geometry; a region IS a
 * bbox (geometry-first regions), so the bounds do the scoping and the name is demoted to flavour.
 *
 * ⚠ THE NAME ANCHORS HARDER THAN IT LOOKS — MEASURED, not theorised. The first bbox-scoped run
 * (2026-08-03, target 100 → 103 drafted, 93 written) reached NORTH into the Donner corridor (Truckee,
 * Donner Lake, Soda Springs, Norden, Sugar Bowl) but NOT EAST: no survivor landed past lng -119.90,
 * so Reno (-119.81), Carson City (-119.77) and Virginia City (-119.65) were all still missed — the
 * exact towns holding the orphaned fused tellings. Stating the bounds was not enough while the opening
 * line still read "a driving audio tour of ${regionName}": Truckee reads as Tahoe, Reno reads as
 * somewhere else. Hence the current shape — the region name is NEVER the subject of the tour, it
 * appears once, explicitly labelled a NICKNAME, after the box has already been given as the area.
 * If you reintroduce the name as the tour's subject, expect the east side to empty out again.
 *
 * ⚠ The "never a latitude or longitude" clause is load-bearing now that coordinates appear in this
 * prompt at all. The model's job is still to NAME places; `resolveCuratedPlace` is what turns a name
 * into a canonical pin, and a drafted coordinate would route around that resolve entirely.
 *
 * ⚠ DUPLICATED ON PURPOSE: apps/admin/server/places.ts carries a byte-identical copy, because the admin
 * server deliberately does not pull in the @skipper/studio graph (see that file's header). The two must
 * move TOGETHER — there is no shared home for it, since @skipper/shared and @skipper/engine both ship
 * into the mobile bundle and this is operator-only prose.
 */
function draftSystem(regionName: string, bbox: RegionBbox, targetN: number): string {
  return `You are curating the set of real-world PLACES a rider can pick to start, end, or break a self-guided driving audio tour, narrated by a charming Jungle-Cruise-style skipper.

== The area you are curating ==

The tour area is a BOX on the map: southwest corner ${bbox.swLat}, ${bbox.swLng} to northeast corner ${bbox.neLat}, ${bbox.neLng} (decimal degrees). The box is the area — all of it, and nothing beyond it.

Riders call this area "${regionName}". That is a NICKNAME, not a boundary. A box this size routinely covers ground nobody would file under that name: a neighboring city, the next valley over, a mountain pass, another state line. Those places are in scope exactly as much as the ones the nickname obviously covers, and they are the ones most often left out. Work the WHOLE box, corner to corner — if your list only contains what the nickname brings to mind, you have missed most of the area.

A place just OUTSIDE the box is the one thing that cannot be used at all, so never spend a slot on one. Check each name against the four corners above before you include it: a town south of the southern edge, or west of the western edge, is a wasted slot however good it is. If you cannot place somewhere on the map with confidence, leave it out and name something you can — a near-miss is worse than an omission here.

⚠ WORK THE BOX CORNER BY CORNER, AND NAME THE CITIES AND TOWNS IN EACH ONE FIRST. A box this size usually spans more than one state, and the settlements on the far side are the ones that get missed — not because they are marginal, but because they are not what the nickname brings to mind. A state capital, a county seat, an old mining town or a small city inside these corners belongs on this list ahead of any lake or lookout. If your finished list has no towns from some corner of the box, you have not worked that corner: go back and name them.

== What to draft ==

Draft roughly ${targetN} places. Every one is somewhere a driver could START a drive or FINISH one. There is no other category here -- no pitstops, no coffee stops, no gas stations, no rest areas.

TWO tests, and a place needs BOTH.

FIRST: would somebody actually SAY it? "Let's drive from ___ to ___." Towns, villages and cities count -- a city's downtown, a historic district or a main street is a destination exactly as much as a lake is -- and so do the famous beaches, state-park gateways, marinas, ski resorts, mountain passes and lookouts a visitor names by heart. If the box holds a city, a county seat or an old mining town, it belongs here. This is not about whether a place is scenic or outdoorsy; it is about whether its name is on a visitor's lips.

SECOND: can a car actually stop there, with the drive over? This rules out the famous things you reach on foot or by boat, however recognizable -- an island, a summit with no road, a mansion a mile down a trail, a beach you scramble down to. A mountain PASS, or a summit the ROAD ITSELF crosses, is the opposite case and belongs here: the highway goes over the top and you can pull over. Name the place a car arrives AT -- the town, the park, the marina, the pass -- never the thing you walk to from it.

== Ranking ==

Rank every place by how likely a visitor is to name it out loud, 1 being the most. The first handful should be what anyone who has been here would say without thinking. Ties are fine. A low rank is not a criticism -- it means real, but less asked-for.

Optimize for CHARM: every place intentional, recognizable, a real place a visitor would actually name -- never a gazetteer of everything with a signpost. Length is not the virtue here. Never pad to reach the number: if the box honestly holds fewer good ones, return fewer.

For each place give a precise Google Places \`query\` that uniquely identifies it (add the town/state when the name alone is ambiguous), so it resolves to the right pin. Do NOT invent coordinates — name the place, never a latitude or longitude; resolution happens separately.`
}

/** One forced-tool draft call → the candidate list. Records token usage for the spend tally. */
async function draftCuratedPlaces(regionName: string, bbox: RegionBbox, targetN: number): Promise<PlaceDraft[]> {
  const response = await getAnthropic('curate-places needs it to draft the candidate set').messages.create({
    model,
    // Sized for the LARGEST draft the clamp allows (120 places, each a name + Places query + role +
    // rationale), not for the default 30. A ceiling is not a charge — only tokens actually emitted are
    // billed — so headroom here is free, while too little silently truncates the list.
    max_tokens: 16_000,
    system: draftSystem(regionName, bbox, targetN),
    tools: [DRAFT_TOOL],
    tool_choice: { type: 'tool', name: DRAFT_TOOL.name },
    messages: [{ role: 'user', content: `Draft the curated places for ${regionName}.` }],
  })
  recordModelUsage(model, response.usage)
  // ⚠ CHECK THIS BEFORE READING THE TOOL BLOCK. The entire candidate list is ONE tool call, so a
  // max_tokens stop leaves a half-written JSON list that the SDK still surfaces as a `tool_use` block —
  // HTTP 200, no error, and a SHORTER list than asked for, which is indistinguishable from the model
  // simply being selective. That is exactly the "a run that did nothing must not settle green" trap:
  // the operator would prune and resolve a truncated set believing it was the whole draft.
  if (response.stop_reason === 'max_tokens') {
    throw new Error(
      `curate-places: the draft was TRUNCATED at max_tokens (asked for ~${targetN} places) — the list is incomplete. Raise max_tokens or lower --target.`,
    )
  }
  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  if (!toolUse) throw new Error('curate-places: the draft model returned no tool call.')
  const out = toolUse.input as { places?: PlaceDraft[] }
  // ⚠ `rank` is validated as a NUMBER, not for truthiness — rank 0 would be falsy and a model that
  // 0-indexes its own ranking would have its best places silently dropped.
  const drafts = (out.places ?? []).filter((p) => p && p.name && p.query && typeof p.rank === 'number')
  if (drafts.length === 0) throw new Error('curate-places: the draft model returned an empty place list.')
  return drafts
}

/** A resolved curated destination + its rank — the upsert unit (deduped by place_id).
 *  ⚠ On a duplicate place_id the BEST (lowest) rank wins: two drafts naming one place disagree about
 *  how famous it is, and taking the max would let a passing mention demote the model's own headline. */
interface ResolvedRow {
  place: CuratedPlace
  rank: number
}

async function main(): Promise<void> {
  const region = await resolveRegion(regionKey)
  const bbox: RegionBbox = requireRegionBbox(region)
  const placesBbox: PlacesBbox = bbox // structurally identical corners
  console.log(`Region: ${region.displayName} (${region.slug})\n`)

  const estUsd = estimateDraftUsd(model, targetCount)
  if (!apply) {
    console.log(
      `DRY RUN — no paid calls made. --apply will:\n` +
        `  1. draft ~${targetCount} places with ${model} (${modelChoice}) — ~$${estUsd.toFixed(2)}\n` +
        `  2. resolve each against Google Places (Autocomplete + Details, bbox-restricted) — a few cents, one-time\n` +
        `  3. upsert the resolved rows into \`places\`, role-tagged (endpoint/break) + featured\n` +
        `Then review / prune in the admin console. FOUNDER-GATED — this is a paid run.`,
    )
    return
  }

  // --apply spends. Fail LOUD + EARLY on missing creds rather than deep inside the draft/resolve.
  if (!ANTHROPIC_READY()) throw new Error('ANTHROPIC_API_KEY is not set — `curate-places --apply` needs it.')
  if (!GOOGLE_READY()) throw new Error('GOOGLE_MAPS_API_KEY is not set — `curate-places --apply` needs Places (New) enabled on it.')
  const apiKey = requireEnv('GOOGLE_MAPS_API_KEY')
  if (estUsd > maxCostUsd) {
    // THROW (not return) so runJob settles the studio_jobs row as FAILED, not a clean "succeeded".
    throw new Error(`⛔ Estimated draft spend ~$${estUsd.toFixed(2)} exceeds --max-cost=$${maxCostUsd.toFixed(2)} — aborting before any spend.`)
  }

  console.log(`Drafting ~${targetCount} places with ${model}...`)
  const drafts = await draftCuratedPlaces(region.displayName, bbox, targetCount)
  console.log(`  drafted ${drafts.length} candidates. Resolving against Google Places (bbox-restricted)...\n`)

  // Resolve sequentially (one-time, ~30 places) and merge by place_id — two drafts can pin the same
  // canonical place (OR the roles, keep featured if either says so). An unresolved / out-of-bbox draft
  // is logged + dropped (non-fatal — break stops + hubs are a curated nicety, not the core bet).
  const byId = new Map<string, ResolvedRow>()
  let unresolved = 0
  for (const d of drafts) {
    let place: CuratedPlace | null = null
    try {
      place = await resolveCuratedPlace(d.query, placesBbox, apiKey)
    } catch (e) {
      console.warn(`  ⚠ ${d.name}: Places resolve failed (${(e as Error).message}) — skipped.`)
      unresolved++
      continue
    }
    if (!place) {
      console.log(`  ·  ${d.name}: no in-region match — skipped.`)
      unresolved++
      continue
    }
    // ⚠ ENDPOINTS ONLY — see isAddressLike. A street resolve is a rider destination we would route to,
    // so it must be a real place; a BREAK is a pull-off, where a `route` is a legitimate answer.
    if (isAddressLike(place.types)) {
      console.log(`  ·  ${d.name}: resolved to a street address ("${place.name}") — skipped, not a real endpoint.`)
      unresolved++
      continue
    }
    // ⚠ The draft was RIGHT and the resolve substituted — "Heavenly Mountain Resort" comes back as its
    // parking structure. See isParkingLike; no prompt can prevent this.
    if (isParkingLike(place.types)) {
      console.log(`  ·  ${d.name}: resolved to a car park ("${place.name}") — skipped, that is not the destination.`)
      unresolved++
      continue
    }
    // ⚠ The general case the two guards above are corners of — see nameDisagrees. Both names are printed
    // because a legitimate RENAME (Squaw Valley → Palisades Tahoe) lands here too and is an operator's
    // call to add back, not a silent loss.
    if (nameDisagrees(d.name, place.name)) {
      console.log(`  ·  ${d.name}: resolved to something else entirely ("${place.name}") — skipped.`)
      unresolved++
      continue
    }
    const prev = byId.get(place.placeId)
    byId.set(place.placeId, {
      place,
      // ⚠ LOWEST rank wins on a duplicate — see ResolvedRow.
      rank: Math.min(prev?.rank ?? Number.POSITIVE_INFINITY, d.rank),
    })
    console.log(`  ✓  ${place.name}${place.primaryType ? ` [${place.primaryType}]` : ''} — rank ${d.rank}`)
    await sleep(150) // gentle pacing between Places calls
  }

  const rows = [...byId.values()]
  const topRanked = rows.filter((r) => r.rank <= 3).length
  console.log(
    `\nResolved ${rows.length} unique destinations (${topRanked} at rank 1-3); ${unresolved} drafts dropped.`,
  )
  if (rows.length === 0) {
    console.log('Nothing resolved — nothing written.')
    return
  }

  // Upsert into `places` (dedup by place_id). name/coords/primaryType/rank are last-write-wins — a
  // re-curation refreshes the snapshot AND the model's judgement of how asked-for a place is.
  // ⚠ There are no role flags to OR-merge any more (2026-08-04): `places` is destinations only, so
  // membership is the eligibility and pruning is a DELETE.
  let wrote = 0
  for (const r of rows) {
    await withRetry(
      () =>
        db
          .insert(places)
          .values({
            placeId: r.place.placeId,
            name: r.place.name,
            primaryType: r.place.primaryType ?? null,
            lat: r.place.lat,
            lng: r.place.lng,
            rank: r.rank,
          })
          .onConflictDoUpdate({
            target: places.placeId,
            set: {
              name: sql`excluded.name`,
              primaryType: sql`excluded.primary_type`,
              lat: sql`excluded.lat`,
              lng: sql`excluded.lng`,
              rank: sql`excluded.rank`,
              // ⚠ `accessLat`/`accessLng` ARE DELIBERATELY ABSENT, and their absence is the mechanism —
              // an access point (where a car is sent when the pin is not drivable) is OPERATOR-OWNED,
              // like `pois.speakable_lat/lng`. `lat`/`lng` right above ARE last-write-wins, so this run
              // already reverts a hand-corrected pin; that is precisely why the correction lives in its
              // own columns now. Adding them here re-opens the hole and nothing fails — the drives just
              // quietly route up the gated road again. docs/decisions/undrivable-endpoint-anchors.md
              updatedAt: new Date(),
            },
          }),
      { label: `curate(${r.place.name})` },
    )
    wrote++
  }

  console.log(`\nUpserted ${wrote} curated places into \`places\`. Review / prune in the admin console.`)
  for (const line of llmSpendLines()) console.log(line)
  console.log(`LLM spend this run: ~$${llmSpentUsd().toFixed(2)} (+ a few cents of Google Places, one-time).`)
}

await runJob('curate_places', { dryRun: !apply, targetId: regionKey }, main)
