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
//   ... --region <slug>          curate a region (default: lake-tahoe; resolves to its bbox)
//   ... --model sonnet           draft with Sonnet instead of the default Opus (cheaper A/B)
//   ... --target 30              roughly how many places to draft (guidance to the model)
//   ... --max-cost 1             abort before any spend if the LLM estimate exceeds this

import { sql } from 'drizzle-orm'
import { db } from '@skipper/db'
import { places } from '@skipper/db/schema'
import Anthropic from '@anthropic-ai/sdk'
import { announce, maxCostFlag, parseFlags } from './pipeline/ops'
import { resolveRegion, requireRegionBbox, type RegionBbox } from './pipeline/region'
import { runJob } from './pipeline/job-progress'
import { withRetry, sleep } from './pipeline/http'
import { resolveCuratedPlace, type CuratedPlace, type PlacesBbox } from './pipeline/places'
import { ENRICH_MODELS, getAnthropic, type EnrichModelChoice } from './models'
import { llmSpendLines, llmSpentUsd, recordModelUsage } from '@skipper/shared'
import { ANTHROPIC_READY, DEFAULT_REGION_SLUG, GOOGLE_READY, requireEnv } from './config'

/** Rough USD for the single draft call, by model (pre-run estimate only; the real tally prints after). */
const EST_USD_DRAFT: Record<EnrichModelChoice, number> = { sonnet: 0.03, opus: 0.08 }

const flags = parseFlags(process.argv.slice(2), { valueFlags: ['region', 'model', 'target', 'max-cost'] })
const apply = flags.has('apply')
const regionKey = flags.value('region') ?? DEFAULT_REGION_SLUG
const modelChoice: EnrichModelChoice = flags.value('model') === 'sonnet' ? 'sonnet' : 'opus'
const model = ENRICH_MODELS[modelChoice]
const targetCount = Math.max(8, Math.min(60, Number(flags.value('target')) || 30))
const maxCostUsd = maxCostFlag(flags)

announce({ tool: 'curate-places', blast: ['SPENDS $', 'MUTATES DB'], apply })

/** One LLM-drafted candidate place — a name + a precise search query + its role + featured flag. The
 *  model NAMES places it knows; Google Places is what RESOLVES them to coords (the model never invents
 *  a coordinate). `role` maps to the eligibility flags; `both` = a hub that's also a good pitstop. */
interface PlaceDraft {
  name: string
  query: string
  role: 'endpoint' | 'break' | 'both'
  featured: boolean
  rationale?: string
}

const DRAFT_TOOL: Anthropic.Tool = {
  name: 'draft_curated_places',
  description:
    'Return the curated set of real, recognizable places for this region: drive START/END/MIDPOINT hubs and good break pitstops.',
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
            role: {
              type: 'string',
              enum: ['endpoint', 'break', 'both'],
              description:
                'endpoint = a place a rider would START or END a drive at (town, marina, scenic lookout, trailhead gateway). break = a pitstop along the way (coffee, gas, rest area, viewpoint pull-off). both = a hub that is also a natural pitstop.',
            },
            featured: {
              type: 'boolean',
              description: 'true for the handful of most iconic, popular start points — floated to the top of the picker.',
            },
            rationale: { type: 'string', description: 'One short phrase on why this place earns a spot.' },
          },
          required: ['name', 'query', 'role', 'featured'],
        },
      },
    },
    required: ['places'],
  },
}

function draftSystem(regionName: string, targetN: number): string {
  return `You are curating the set of real-world PLACES a rider can pick to start, end, or break a self-guided driving audio tour of ${regionName}, narrated by a charming Jungle-Cruise-style skipper.

Optimize for CHARM, not coverage: every place must be intentional, recognizable, and a real place a visitor would actually name. A short list of beloved hubs beats an exhaustive directory.

Draft roughly ${targetN} places:
- ENDPOINT hubs (most of the list): towns and villages, marinas and boat launches, famous scenic lookouts and state-park gateways, major trailheads — the kind of place someone says "let's drive from ___ to ___".
- BREAK pitstops (a handful): well-known coffee spots, gas stations at natural stopping points, rest areas, and viewpoint pull-offs along the main routes.
- Mark role="both" for a hub that is also a natural pitstop.
- Mark featured=true for ONLY the few most iconic, popular start points (think 4–8).

Stay strictly inside ${regionName}. For each place give a precise Google Places \`query\` that uniquely identifies it (add the town/state when the name alone is ambiguous), so it resolves to the right pin. Do NOT invent coordinates — name the place; resolution happens separately.`
}

/** One forced-tool draft call → the candidate list. Records token usage for the spend tally. */
async function draftCuratedPlaces(regionName: string, targetN: number): Promise<PlaceDraft[]> {
  const response = await getAnthropic('curate-places needs it to draft the candidate set').messages.create({
    model,
    max_tokens: 4_000,
    system: draftSystem(regionName, targetN),
    tools: [DRAFT_TOOL],
    tool_choice: { type: 'tool', name: DRAFT_TOOL.name },
    messages: [{ role: 'user', content: `Draft the curated places for ${regionName}.` }],
  })
  recordModelUsage(model, response.usage)
  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  if (!toolUse) throw new Error('curate-places: the draft model returned no tool call.')
  const out = toolUse.input as { places?: PlaceDraft[] }
  const drafts = (out.places ?? []).filter((p) => p && p.name && p.query && p.role)
  if (drafts.length === 0) throw new Error('curate-places: the draft model returned an empty place list.')
  return drafts
}

/** A resolved curated place + its merged role/featured flags — the upsert unit (deduped by place_id). */
interface ResolvedRow {
  place: CuratedPlace
  endpointEligible: boolean
  breakEligible: boolean
  featured: boolean
}

const roleFlags = (role: PlaceDraft['role']): { endpoint: boolean; break: boolean } => ({
  endpoint: role === 'endpoint' || role === 'both',
  break: role === 'break' || role === 'both',
})

async function main(): Promise<void> {
  const region = await resolveRegion(regionKey)
  const bbox: RegionBbox = requireRegionBbox(region)
  const placesBbox: PlacesBbox = bbox // structurally identical corners
  console.log(`Region: ${region.displayName} (${region.slug})\n`)

  const estUsd = EST_USD_DRAFT[modelChoice]
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
  const drafts = await draftCuratedPlaces(region.displayName, targetCount)
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
    const rf = roleFlags(d.role)
    const prev = byId.get(place.placeId)
    byId.set(place.placeId, {
      place,
      endpointEligible: (prev?.endpointEligible ?? false) || rf.endpoint,
      breakEligible: (prev?.breakEligible ?? false) || rf.break,
      featured: (prev?.featured ?? false) || d.featured,
    })
    const role = [rf.endpoint && 'endpoint', rf.break && 'break'].filter(Boolean).join('+')
    console.log(`  ✓  ${place.name}${place.primaryType ? ` [${place.primaryType}]` : ''} — ${role}${d.featured ? ' ★' : ''}`)
    await sleep(150) // gentle pacing between Places calls
  }

  const rows = [...byId.values()]
  const endpoints = rows.filter((r) => r.endpointEligible).length
  const breaks = rows.filter((r) => r.breakEligible).length
  const featured = rows.filter((r) => r.featured).length
  console.log(
    `\nResolved ${rows.length} unique places (${endpoints} endpoint, ${breaks} break, ${featured} featured); ${unresolved} drafts dropped.`,
  )
  if (rows.length === 0) {
    console.log('Nothing resolved — nothing written.')
    return
  }

  // Upsert into `places` (dedup by place_id). OR-merge the role flags so a role, once curated, persists
  // until an admin prunes it (a later curate run for the OTHER role never clears this one); name/coords/
  // primaryType/featured are last-write-wins (re-curation refreshes the snapshot + the popular judgment).
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
            endpointEligible: r.endpointEligible,
            breakEligible: r.breakEligible,
            featured: r.featured,
          })
          .onConflictDoUpdate({
            target: places.placeId,
            set: {
              name: sql`excluded.name`,
              primaryType: sql`excluded.primary_type`,
              lat: sql`excluded.lat`,
              lng: sql`excluded.lng`,
              endpointEligible: sql`${places.endpointEligible} OR excluded.endpoint_eligible`,
              breakEligible: sql`${places.breakEligible} OR excluded.break_eligible`,
              featured: sql`excluded.featured`,
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
