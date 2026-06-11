// @skipper/api — Hono API (M2), served natively by bun.
//
//   GET  /health                     -> liveness (env-free)
//   GET  /sources                    -> data-source/license catalog (anonymous; env-free)
//   GET  /version                    -> per-platform app-version policy (anonymous; env-free)
//   *    /api/auth/*                  -> Better Auth (sign-up/in/out, session, OAuth)
//   GET  /tours                      -> list ready tours, one card per drive (anonymous OK)
//   GET  /tours/:tourId              -> a ready drive: route + region + host + intro/outro + stops
//   POST /tours/:tourId/assets/sign  -> presigned R2 URLs for the drive's audio (stops + brackets)
//   GET  /roam                       -> free-roam pins near a point + presigned clips (ALPHA: open)
//   GET  /t/:tourId                  -> shareable tour link: in-app universal link + OG web fallback
//
// A tour is the whole self-contained drive now (corridors merged in; zero-reuse:
// narration is tour-owned). Freemium gating: a `?preview=1` fetch/sign is OPEN for any
// ready tour (the couch preview is the funnel — anyone can stream any tour), while a
// request WITHOUT the flag needs a free account — so the LIVE DRIVE
// + OFFLINE download stay walled. Tours stay anonymous/shareable — gating is on access,
// not ownership.

import { Hono, type Context } from 'hono'
import { asc, desc, eq, inArray } from 'drizzle-orm'
import { db } from '@skipper/db'
import { pois, regions, roamClips, tourBrackets, tourStops, tours } from '@skipper/db/schema'
import type { Tour as TourRow } from '@skipper/db/schema'
import { auth } from './auth'
import { FEATURES, meetsTier, withSession, type ApiEnv } from './entitlements'
import { hostForRegion } from './host'
import { shareLandingHtml } from './share'
import { DATA_SOURCES } from './sources'
import { contentTypeForKey, presignGet } from './storage'
import { VERSION_POLICIES } from './version-policy'

const app = new Hono<ApiEnv>()

// Defense-in-depth: any unhandled throw returns a clean JSON 500 with no internal
// details (DB messages etc.) leaked; the detail goes to the server log.
app.onError((err, c) => {
  console.error('[api] unhandled error', err)
  return c.json({ error: 'internal' }, 500)
})

// uuid columns reject non-UUID input with a DB error (500); validate ids up front.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Health check — used by infra / local smoke tests.
app.get('/health', (c) => c.json({ ok: true }))

// Public data-source/license catalog for the in-app "Sources & Licenses" screen.
// Anonymous + env-free (no DB) — served from code so a NEW fact source credits without
// an App Store release (the app bundles only an offline fallback).
app.get('/sources', (c) => c.json({ sources: DATA_SOURCES }))

// Per-platform app-version policy for the client's update gate. Anonymous + env-free (no
// DB) — served from code so the minimum/recommended floor is raised by a backend deploy,
// never an App Store release. The client compares its own version (@skipper/shared
// `gateFor`) and shows a dismissible nudge or a blocking "update required" wall.
app.get('/version', (c) => c.json({ policies: VERSION_POLICIES }))

// NOTE: the iOS universal-links AASA is served by the apex site (apps/site → skipper.fm)
// as a static file at /.well-known/apple-app-site-association. The API is api.skipper.fm,
// which is NOT an associated domain, so it does not serve the AASA — single source of truth.

// Human/crawler fallback for a shared tour link — the app intercepts it on an installed
// iPhone; everyone else (Android, desktop, iMessage/social unfurlers) lands here. Open, since
// tours are shareable/anonymous. Names the tour so the link unfurls with Open Graph tags;
// falls back to generic copy on a bad id, a missing/not-ready tour, or a DB hiccup — the
// share page never 500s.
app.get('/t/:id', async (c) => {
  const id = c.req.param('id')
  let title = 'Skipper'
  let description = 'An AI-narrated, GPS-triggered road-trip audio tour.'
  if (UUID_RE.test(id)) {
    try {
      const rows = await db
        .select({
          headline: tours.headline,
          summary: tours.summary,
          status: tours.status,
          region: regions.displayName,
        })
        .from(tours)
        .innerJoin(regions, eq(tours.regionId, regions.id))
        .where(eq(tours.id, id))
        .limit(1)
      const t = rows[0]
      if (t && t.status === 'ready') {
        title = t.headline ?? title
        description = t.summary ?? `A Skipper road-trip tour of ${t.region}.`
      }
    } catch (e) {
      console.error('[api] /t/:id share-page lookup failed', e) // fall through to generic copy
    }
  }
  return c.html(shareLandingHtml({ title, description, url: `https://skipper.fm/t/${id}` }))
})

// Better Auth owns everything under /api/auth/* (its own handler).
app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw))

// List READY tours — one card per drive (no polyline; that comes with the tour). A tour
// carries its own route + region now, so this replaces the old /corridors + per-corridor
// tour list. Anonymous browsing is free; playing a tour is gated via /tours/:id.
app.get('/tours', async (c) => {
  const rows = await db
    .select({
      id: tours.id,
      slug: tours.slug,
      headline: tours.headline,
      regionSlug: regions.slug,
      regionName: regions.displayName,
      startAnchorName: tours.startAnchorName,
      endAnchorName: tours.endAnchorName,
      summary: tours.summary,
      distanceMeters: tours.distanceMeters,
      durationSeconds: tours.durationSeconds,
    })
    .from(tours)
    .innerJoin(regions, eq(tours.regionId, regions.id))
    .where(eq(tours.status, 'ready'))
    .orderBy(asc(regions.displayName), desc(tours.createdAt))

  // Build a glanceable place teaser per tour from its marquee anchors, so the catalog
  // card has an identity ("Emerald Bay & Vikingsholm") without forcing a tap. We take
  // the first couple of STORY/SCENIC stops (the real named places); breaks are skipped
  // so a café never headlines, and no volatile data is involved (just the frozen name).
  const teaserByTour = new Map<string, string>()
  const tourIds = rows.map((r) => r.id)
  if (tourIds.length) {
    const stopRows = await db
      .select({ tourId: tourStops.tourId, stopType: tourStops.stopType, name: pois.name })
      .from(tourStops)
      .innerJoin(pois, eq(tourStops.poiId, pois.id))
      .where(inArray(tourStops.tourId, tourIds))
      .orderBy(asc(tourStops.seq))
    const byTour = new Map<string, { stopType: string; name: string }[]>()
    for (const s of stopRows) {
      const arr = byTour.get(s.tourId) ?? []
      arr.push({ stopType: s.stopType, name: s.name })
      byTour.set(s.tourId, arr)
    }
    for (const [tid, stops] of byTour) {
      const named = stops.filter((s) => s.stopType === 'story' || s.stopType === 'scenic')
      const pick = (named.length ? named : stops).slice(0, 2).map((s) => s.name)
      if (pick.length) teaserByTour.set(tid, pick.join(' & '))
    }
  }

  return c.json({ tours: rows.map((r) => ({ ...r, teaser: teaserByTour.get(r.id) ?? null })) })
})

/**
 * Load a tour and enforce the freemium gate:
 *   - 404 if missing, 409 if not `ready`
 *   - `?preview=1` requests are OPEN for any ready tour — the couch preview is the funnel
 *     (anyone can stream any tour's clips; "the audio is the funnel"). The wall moved to the
 *     LIVE DRIVE + OFFLINE: a request WITHOUT the flag needs a free account (gated for EVERY
 *     tour now — no demo exception), so the drive/download stay walled (401 → AccountGate). A
 *     determined client could pass `preview=1` to stream — that's intended, not a leak.
 * Returns the tour, or a ready-to-return error Response.
 */
async function loadTourGated(c: Context<ApiEnv>): Promise<{ tour: TourRow } | { res: Response }> {
  const tourId = c.req.param('tourId')
  if (!tourId || !UUID_RE.test(tourId)) return { res: c.json({ error: 'not_found' }, 404) }
  const rows = await db.select().from(tours).where(eq(tours.id, tourId)).limit(1)
  const tour = rows[0]
  if (!tour) return { res: c.json({ error: 'not_found' }, 404) }
  if (tour.status !== 'ready')
    return { res: c.json({ error: 'not_ready', message: 'Tour is still generating.' }, 409) }
  const preview = c.req.query('preview') === '1'
  if (!preview && !meetsTier(c.get('tier'), FEATURES.playTour)) {
    return {
      res: c.json(
        { error: 'account_required', message: 'Create a free account to play this tour.' },
        401,
      ),
    }
  }
  return { tour }
}

// Fetch a single drive: route + endpoints + region + host + intro/outro + ordered stops
// (with coordinates for the player's geofencing). Audio URLs come from the /sign endpoint.
app.get('/tours/:tourId', withSession, async (c) => {
  const gated = await loadTourGated(c)
  if ('res' in gated) return gated.res
  const { tour } = gated

  // Region, stops, and brackets are INDEPENDENT reads (each keyed only on the already-loaded
  // tour, none on another's result). neon-http is one HTTP round-trip per query, so serial
  // awaits would pay that latency three times back-to-back — fan them out and collapse to ~the
  // slowest single query. (A reject still surfaces as a 500 via onError, same as serial.)
  const [regionRows, stops, brackets] = await Promise.all([
    db
      .select({ slug: regions.slug, displayName: regions.displayName })
      .from(regions)
      .where(eq(regions.id, tour.regionId))
      .limit(1),
    db
      .select({
        seq: tourStops.seq,
        stopType: tourStops.stopType,
        name: pois.name,
        lat: pois.lat,
        lng: pois.lng,
        triggerRadiusM: tourStops.triggerRadiusM,
        approachHeadingDeg: tourStops.approachHeadingDeg,
        audioDurationMs: tourStops.audioDurationMs,
        // The offline-staleness token (Date → ISO via c.json). Bumps on any clip re-synth/regen,
        // so a downloaded drive can detect it's behind the server. See shared `tourStopView.revisedAt`.
        revisedAt: tourStops.updatedAt,
      })
      .from(tourStops)
      .innerJoin(pois, eq(tourStops.poiId, pois.id))
      .where(eq(tourStops.tourId, tour.id))
      .orderBy(asc(tourStops.seq)),
    db
      .select({
        kind: tourBrackets.kind,
        audioDurationMs: tourBrackets.audioDurationMs,
        revisedAt: tourBrackets.updatedAt,
      })
      .from(tourBrackets)
      .where(eq(tourBrackets.tourId, tour.id)),
  ])
  // tours.regionId is a NOT NULL FK with onDelete: restrict, so the region always exists.
  const region = regionRows[0]!
  const intro = brackets.find((b) => b.kind === 'intro')
  const outro = brackets.find((b) => b.kind === 'outro')

  return c.json({
    tour: {
      id: tour.id,
      slug: tour.slug,
      headline: tour.headline,
      regionId: tour.regionId,
      status: tour.status,
      polyline: tour.polyline,
      distanceMeters: tour.distanceMeters,
      durationSeconds: tour.durationSeconds,
      summary: tour.summary,
      startAnchor: {
        name: tour.startAnchorName,
        lat: tour.startAnchorLat,
        lng: tour.startAnchorLng,
      },
      endAnchor: { name: tour.endAnchorName, lat: tour.endAnchorLat, lng: tour.endAnchorLng },
    },
    region: { slug: region.slug, displayName: region.displayName },
    // The narrating host, resolved from the region server-side so the app renders identity
    // rather than bundling it (host-agnostic: a new host ships without an app update).
    host: hostForRegion(region.slug),
    intro: intro
      ? { kind: 'intro', audioDurationMs: intro.audioDurationMs, revisedAt: intro.revisedAt }
      : null,
    outro: outro
      ? { kind: 'outro', audioDurationMs: outro.audioDurationMs, revisedAt: outro.revisedAt }
      : null,
    stops,
  })
})

// Issue short-lived presigned R2 URLs for the drive's audio: every stop (story/scenic/break)
// plus the intro/outro brackets. Same gate as fetch: `?preview=1` streams any ready tour
// (the funnel); without it, the bytes stay walled behind a free account (drive + offline).
app.post('/tours/:tourId/assets/sign', withSession, async (c) => {
  const gated = await loadTourGated(c)
  if ('res' in gated) return gated.res
  const { tour } = gated

  // Independent reads → fan out (see /tours/:tourId): two neon-http round-trips become one.
  const [stopClips, bracketClips] = await Promise.all([
    db
      .select({
        seq: tourStops.seq,
        key: tourStops.audioUrl,
        durationMs: tourStops.audioDurationMs,
      })
      .from(tourStops)
      .where(eq(tourStops.tourId, tour.id))
      .orderBy(asc(tourStops.seq)),
    db
      .select({
        kind: tourBrackets.kind,
        key: tourBrackets.audioUrl,
        durationMs: tourBrackets.audioDurationMs,
      })
      .from(tourBrackets)
      .where(eq(tourBrackets.tourId, tour.id)),
  ])

  try {
    const stops = stopClips
      .filter((clip) => clip.key)
      .map((clip) => ({
        seq: clip.seq,
        url: presignGet(clip.key!),
        // Format derived from the actual key — so the client never hardcodes/guesses it.
        contentType: contentTypeForKey(clip.key!),
        durationMs: clip.durationMs,
      }))
    const signBracket = (kind: 'intro' | 'outro') => {
      const b = bracketClips.find((x) => x.kind === kind && x.key)
      return b
        ? { url: presignGet(b.key!), contentType: contentTypeForKey(b.key!), durationMs: b.durationMs }
        : null
    }
    return c.json({ stops, intro: signBracket('intro'), outro: signBracket('outro') })
  } catch (e) {
    // R2 not configured / presign failed — don't leak which config var is missing,
    // but give the client a human message so the player can show real copy + a retry
    // (not a raw "Request failed (503)").
    console.error('[api] presign failed', e)
    return c.json(
      { error: 'audio_unavailable', message: 'Audio is warming up. Give it a moment and try again.' },
      503,
    )
  }
})

// Kind-aware roam trigger radius (m). Roam pins are raw POI centroids — never road-snapped
// (no route exists to snap to) — so an areal place needs a floor that matches its body: a
// peak's pin is its SUMMIT, a lake's is open water, while a building sits near the curb.
// Measured on the first live drive: at a flat 250 m only 8 of 77 basin pins were reachable
// from the highway. The client's speed-adaptive lead still extends these at speed.
function roamRadiusM(kind: string | null): number {
  if (!kind) return 600
  if (/mountain|peak|summit|ridge|hill/.test(kind)) return 1500
  if (/lake|reservoir|bay|valley|canyon|island|peninsula/.test(kind)) return 1200
  if (/park|recreation area|beach|cove|meadow|historic district/.test(kind)) return 1000
  return 600
}

// Straight-line distance (m) — the same haversine as @skipper/drive-core's; inlined here
// because the API's only geo need is this one filter (keep the dep graph flat).
function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLng = ((bLng - aLng) * Math.PI) / 180
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

// FREE-ROAM manifest: every roam-narratable place near a point, with presigned clip URLs
// (shared schema: roamManifest). Roam narration is ROAM-owned (`roam_clips` — the third
// owner beside pois/tour_stops; docs/ideas/free-roam-mode.md); a row exists only complete,
// so everything returned is playable. Geo filter runs in JS — the corpus is a few hundred
// rows per region at most, so a bbox prefilter + haversine beats dragging in PostGIS.
// ALPHA: OPEN, like ?preview=1 (founder TestFlight toy; no UI links it for anyone else).
// When roam ships for real it takes the live-drive wall (free account), same as tours.
app.get('/roam', async (c) => {
  const lat = Number(c.req.query('lat'))
  const lng = Number(c.req.query('lng'))
  // Default generously (a basin is ~40 km across); cap so "near a point" stays honest.
  const radiusKm = Math.min(Number(c.req.query('radiusKm') ?? 50), 100)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(radiusKm)) {
    return c.json({ error: 'bad_request', message: 'lat and lng are required numbers.' }, 400)
  }

  const rows = await db
    .select({
      poiId: roamClips.poiId,
      name: pois.name,
      kind: pois.kind,
      lat: pois.lat,
      lng: pois.lng,
      key: roamClips.audioUrl,
      durationMs: roamClips.audioDurationMs,
    })
    .from(roamClips)
    .innerJoin(pois, eq(roamClips.poiId, pois.id))

  const near = rows.filter((r) => haversineMeters(lat, lng, r.lat, r.lng) <= radiusKm * 1000)

  try {
    return c.json({
      pins: near.map((r) => ({
        poiId: r.poiId,
        name: r.name,
        lat: r.lat,
        lng: r.lng,
        durationMs: r.durationMs,
        radiusM: roamRadiusM(r.kind),
        url: presignGet(r.key),
        contentType: contentTypeForKey(r.key),
      })),
    })
  } catch (e) {
    console.error('[api] roam presign failed', e)
    return c.json(
      { error: 'audio_unavailable', message: 'Audio is warming up. Give it a moment and try again.' },
      503,
    )
  }
})

const port = Number(process.env.PORT ?? 8787)

// Bun serves a default export of the shape { port, fetch }.
export default { port, fetch: app.fetch }
