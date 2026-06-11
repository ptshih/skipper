// Create Tour — LLM-proposed, human-approved, then frozen (admin ops console spec §5b).
//
// Two phases so the human-approval gate is STRUCTURAL: proposeTour() drafts named waypoints
// (one forced-tool Anthropic call) + resolves coords (Google Geocoding, region-biased) for
// the map, writing NOTHING. freezeTour() takes the human-approved waypoints, materializes the
// frozen route, and inserts a `draft` tour + route_provenance. The LLM only drafts the RAILS;
// the narratable stops are still discovered by the generator (keeps principle #2 — never
// re-derived, and a person with taste approves before anything freezes).

import Anthropic from '@anthropic-ai/sdk'
import { eq } from 'drizzle-orm'
import { db } from '@skipper/db'
import { regions, tours } from '@skipper/db/schema'
import type { RouteProvenance } from '@skipper/db/schema'
import { materializeRoute } from '@skipper/db/seed/materialize'
import { HttpError } from './jobs'

const MODEL = process.env.ADMIN_PROPOSE_MODEL ?? 'claude-opus-4-8'
const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json'

function mapsKey(): string {
  const k = process.env.GOOGLE_MAPS_API_KEY
  if (!k) throw new HttpError(500, 'GOOGLE_MAPS_API_KEY is not set')
  return k
}

/* -------------------------------- propose -------------------------------- */

export interface ProposePrompt {
  regionSlug: string
  regionName?: string
  roughStart: string
  roughEnd: string
  loopOrDirection: string
  vibe?: string
}

interface LlmProposal {
  headline: string
  summary: string
  startAnchorName: string
  endAnchorName: string
  waypoints: { label: string; rationale?: string }[]
}

const PROPOSE_TOOL: Anthropic.Tool = {
  name: 'propose_drive',
  description:
    'Propose a great curated DRIVE: the ordered, named waypoints that pin the route to the ' +
    'roads we mean. This is the RAILS, not the narration — pick the points that SHAPE the road ' +
    'the car follows, not "interesting stops" (the tour discovers what to talk about separately). ' +
    'First waypoint = the start, last = the end. Use real, geocodable place names.',
  input_schema: {
    type: 'object',
    properties: {
      headline: { type: 'string', description: 'The marquee POI of the drive, e.g. "Emerald Bay".' },
      summary: { type: 'string', description: 'One non-volatile sentence (no hours/prices/live data).' },
      startAnchorName: { type: 'string', description: 'Clean spoken start name, e.g. "South Lake Tahoe".' },
      endAnchorName: { type: 'string', description: 'Clean spoken end name.' },
      waypoints: {
        type: 'array',
        description: 'Ordered; [0]=start, [last]=end. 3-10 real place names that keep the route honest.',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'A real, geocodable place name.' },
            rationale: { type: 'string', description: 'One short clause on why this point shapes the drive.' },
          },
          required: ['label'],
          additionalProperties: false,
        },
      },
    },
    required: ['headline', 'summary', 'startAnchorName', 'endAnchorName', 'waypoints'],
    additionalProperties: false,
  },
}

function promptText(p: ProposePrompt): string {
  return [
    `Region: ${p.regionName ?? p.regionSlug}.`,
    `Start near: ${p.roughStart}. End near: ${p.roughEnd}.`,
    `Shape: ${p.loopOrDirection}.`,
    p.vibe ? `Vibe: ${p.vibe}.` : '',
    '',
    'Propose the curated rails for this drive via the propose_drive tool. The waypoints define',
    'the ROUTE the car follows (snapped to real roads afterward), not the things the skipper will',
    'talk about. Pick a scenic, driveable line; keep it honest to real roads; the first and last',
    'waypoints are the start and end. Avoid private roads, ferries, and non-driveable points.',
  ]
    .filter((l) => l !== undefined)
    .join('\n')
}

async function llmPropose(p: ProposePrompt): Promise<LlmProposal> {
  const client = new Anthropic()
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    tools: [PROPOSE_TOOL],
    tool_choice: { type: 'tool', name: 'propose_drive' },
    messages: [{ role: 'user', content: promptText(p) }],
  })
  const call = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  if (!call) throw new HttpError(502, 'the model returned no proposal')
  return call.input as LlmProposal
}

async function geocode(address: string, bounds?: string): Promise<{ lat: number; lng: number } | null> {
  const url = new URL(GEOCODE_URL)
  url.searchParams.set('address', address)
  url.searchParams.set('key', mapsKey())
  if (bounds) url.searchParams.set('bounds', bounds)
  const res = await fetch(url)
  if (!res.ok) return null
  const json = (await res.json()) as {
    results?: { geometry?: { location?: { lat: number; lng: number } } }[]
  }
  const loc = json.results?.[0]?.geometry?.location
  return loc ? { lat: loc.lat, lng: loc.lng } : null
}

/** A "swLat,swLng|neLat,neLng" viewport padded around the given points, biasing geocoding to the
 *  region so an ambiguous name (e.g. "Inspiration Point") resolves to the local one. */
function boundsAround(points: { lat: number; lng: number }[], padDeg = 0.4): string | undefined {
  if (!points.length) return undefined
  const lats = points.map((p) => p.lat)
  const lngs = points.map((p) => p.lng)
  return `${Math.min(...lats) - padDeg},${Math.min(...lngs) - padDeg}|${Math.max(...lats) + padDeg},${Math.max(...lngs) + padDeg}`
}

export interface ProposedWaypoint {
  label: string
  rationale?: string
  lat: number | null
  lng: number | null
  geocoded: boolean
}

/** Phase 1: LLM drafts named waypoints + metadata; Geocoding resolves coords. No DB write. */
export async function proposeTour(p: ProposePrompt) {
  const region = p.regionName ?? p.regionSlug
  const llm = await llmPropose(p)
  const [startGeo, endGeo] = await Promise.all([
    geocode(`${p.roughStart}, ${region}`),
    geocode(`${p.roughEnd}, ${region}`),
  ])
  const bounds = boundsAround(
    [startGeo, endGeo].filter((g): g is { lat: number; lng: number } => g !== null),
  )
  const waypoints: ProposedWaypoint[] = []
  for (const w of llm.waypoints) {
    const geo = await geocode(`${w.label}, ${region}`, bounds)
    waypoints.push({
      label: w.label,
      ...(w.rationale ? { rationale: w.rationale } : {}),
      lat: geo?.lat ?? null,
      lng: geo?.lng ?? null,
      geocoded: geo !== null,
    })
  }
  return {
    model: MODEL,
    prompt: p,
    regionSlug: p.regionSlug,
    regionName: p.regionName ?? null,
    headline: llm.headline,
    summary: llm.summary,
    startAnchorName: llm.startAnchorName,
    endAnchorName: llm.endAnchorName,
    waypoints,
  }
}

/* --------------------------------- freeze -------------------------------- */

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const num = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

interface Anchor {
  name?: string
  lat?: unknown
  lng?: unknown
}

/** Phase 2: freeze the HUMAN-APPROVED waypoints into a draft tour. Validates, materializes the
 *  route (one Routes call), upserts the region, inserts a `draft` row + route_provenance. */
export async function freezeTour(raw: Record<string, unknown>): Promise<{ id: string; slug: string }> {
  const slug = typeof raw.slug === 'string' ? raw.slug.trim() : ''
  if (!SLUG_RE.test(slug)) throw new HttpError(400, 'slug must be kebab-case (a-z, 0-9, dashes)')
  const regionSlug = typeof raw.regionSlug === 'string' ? raw.regionSlug.trim() : ''
  const regionName = typeof raw.regionName === 'string' ? raw.regionName.trim() : ''
  if (!regionSlug || !regionName) throw new HttpError(400, 'regionSlug and regionName are required')
  const headline = typeof raw.headline === 'string' ? raw.headline.trim() : ''
  if (!headline) throw new HttpError(400, 'headline is required')
  const summary = typeof raw.summary === 'string' ? raw.summary : null

  const start = (raw.startAnchor ?? {}) as Anchor
  const end = (raw.endAnchor ?? {}) as Anchor
  const sLat = num(start.lat),
    sLng = num(start.lng),
    eLat = num(end.lat),
    eLng = num(end.lng)
  if (!start.name || sLat === null || sLng === null)
    throw new HttpError(400, 'startAnchor {name, lat, lng} is required')
  if (!end.name || eLat === null || eLng === null)
    throw new HttpError(400, 'endAnchor {name, lat, lng} is required')

  const rawWaypoints = Array.isArray(raw.waypoints) ? raw.waypoints : []
  const waypoints = rawWaypoints.map((w) => {
    const o = (w ?? {}) as { label?: unknown; lat?: unknown; lng?: unknown }
    return { label: typeof o.label === 'string' ? o.label : '', lat: num(o.lat), lng: num(o.lng) }
  })
  if (waypoints.length < 2 || waypoints.some((w) => w.lat === null || w.lng === null))
    throw new HttpError(400, 'at least 2 waypoints, each with numeric lat/lng, are required')
  const frozen = waypoints as { label: string; lat: number; lng: number }[]

  // A clean 409 instead of letting the unique-slug constraint surface as a 500.
  const existing = await db.select({ id: tours.id }).from(tours).where(eq(tours.slug, slug)).limit(1)
  if (existing.length) throw new HttpError(409, `a tour with slug "${slug}" already exists`)

  const route = await materializeRoute(frozen)

  const regionRow = (
    await db
      .insert(regions)
      .values({ slug: regionSlug, displayName: regionName })
      .onConflictDoUpdate({ target: regions.slug, set: { displayName: regionName, updatedAt: new Date() } })
      .returning({ id: regions.id })
  )[0]!

  const provenance: RouteProvenance = {
    source: 'google-routes-v2',
    waypoints: frozen,
    distanceMeters: route.distanceMeters,
    durationSeconds: route.durationSeconds,
    materializedAt: route.provenance.materializedAt,
    ...(raw.authoring ? { authoring: raw.authoring as RouteProvenance['authoring'] } : {}),
  }

  const id = crypto.randomUUID()
  await db.insert(tours).values({
    id,
    regionId: regionRow.id,
    slug,
    headline,
    summary,
    polyline: route.polyline,
    distanceMeters: Math.round(route.distanceMeters),
    durationSeconds: Math.round(route.durationSeconds),
    startAnchorName: start.name,
    startAnchorLat: sLat,
    startAnchorLng: sLng,
    endAnchorName: end.name,
    endAnchorLat: eLat,
    endAnchorLng: eLng,
    status: 'draft',
    routeProvenance: provenance,
  })
  return { id, slug }
}
