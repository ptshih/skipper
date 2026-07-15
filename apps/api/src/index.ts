// @skipper/api — Hono API (M2), served natively by bun.
//
//   GET  /health                     -> liveness (env-free)
//   GET  /sources                    -> data-source/license catalog (anonymous; env-free)
//   GET  /version                    -> per-platform app-version policy (anonymous; env-free)
//   *    /api/auth/*                  -> Better Auth (sign-up/in/out, session, OAuth)
//   GET  /regions                    -> pickable regions for the Create-a-Drive picker (anonymous)
//   POST /drives/propose             -> preview the route for a picked A→B (free account; no credit)
//   POST /drives                     -> generate + persist a user-owned drive (free account; counts a credit)
//   GET  /drives                     -> the caller's saved drives (one card each)
//   GET  /drives/:id                 -> replay a saved drive (frozen structure + live narration content)
//   POST /drives/:id/assets/sign     -> re-presigned clip URLs for offline refresh
//   GET  /roam                       -> free-roam pins near a point + presigned clips
//
// V2: the app runs on user-owned DRIVES (assembled from shared roam narrations) + free ROAM —
// hand-authored tours are gone. Anonymous riders get roam only; creating/playing a drive needs a
// free account (the /drives sub-app's requireAccount). Audio is private in R2 — presigned on
// demand after the tier check.

import { Hono } from 'hono'
import { and, asc, between, eq, isNotNull } from 'drizzle-orm'
import { db } from '@skipper/db'
import { narrations, pois, regions } from '@skipper/db/schema'
import { haversineMeters, triggerRadiusForKind } from '@skipper/engine'
import type { RoamPin } from '@skipper/shared'
import { auth } from './auth'
import { driveRoutes } from './drives'
import { isAdmin, withSession, type ApiEnv } from './entitlements'
import { rateLimit } from './rate-limit'
import { withRetry } from './retry'
import { DATA_SOURCES } from './sources'
import { contentTypeForKey, presignGet } from './storage'
import { VERSION_POLICIES } from './version-policy'

const app = new Hono<ApiEnv>()

// NO CORS by design. Every consumer is native (Expo/RN mobile) — CORS is a browser mechanism, so
// it doesn't apply — and the static site (skipper.fm) makes no client-side call here (its hero
// audio is a bundled same-origin asset). With no `Access-Control-Allow-Origin`, browsers already
// default-deny cross-origin reads, so the absence of CORS is the SAFE posture, not a gap; adding a
// policy would only OPEN access to a web client that doesn't exist. Add a strict allowlist here
// (and extend auth.ts `trustedOrigins`) ONLY if a real browser client appears — a web player, or a
// live (non-static) /t/:id share page that fetches this API from the browser.

// Defense-in-depth: any unhandled throw returns a clean JSON 500 with no internal
// details (DB messages etc.) leaked; the detail goes to the server log.
app.onError((err, c) => {
  console.error('[api] unhandled error', err)
  return c.json({ error: 'internal' }, 500)
})

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

// The pickable regions for the Create-a-Drive region selector. Anonymous + tiny (just
// id/slug/name) — the create FLOW is gated, but listing region names to pick from is open.
//
// RELEASE-GATED, same as /roam and the drive build: a region exists in the table from the moment
// discovery starts, long before it has a released corpus or a single endpoint anchor. Listing an
// unreleased one hands the rider a name they can pick and then a picker with nothing in it — a
// dead end that reads as a broken app, not as "coming soon". `withSession` (fail-open) so an admin
// still sees staged regions in-app and can check one before releasing. (region-release-gate)
app.use('/regions', withSession)
app.get('/regions', async (c) => {
  const canPreview = isAdmin(c.get('session'))
  const rows = await withRetry(
    () =>
      db
        .select({ id: regions.id, slug: regions.slug, displayName: regions.displayName })
        .from(regions)
        .where(canPreview ? undefined : isNotNull(regions.releasedAt))
        .orderBy(asc(regions.displayName)),
    { label: 'regions.list' },
  )
  return c.json({ regions: rows })
})

// Better Auth owns everything under /api/auth/* (its own handler).
app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw))

// Rate-limit the propose path BEFORE mounting the sub-app: POST /drives/propose fires ONE Google
// Routes call (+ a corpus read) per request and otherwise has no cap, so this is the spend/DB-load
// guard (per-instance in-memory first cut — see ./rate-limit). The heavier CREATE path (POST /drives:
// Routes + a credit consume + a write) is capped too, via route-level middleware in ./drives
// (createDriveLimiter) — kept there so it scopes to exactly POST / and not the cheap reads under /drives.
app.use('/drives/propose', rateLimit({ limit: 15, windowSec: 60, label: 'propose' }))

// Create-a-Drive (V2): user-owned, on-demand A→B drives over the shared narration corpus. The
// whole sub-app is behind a free account (anonymous = roam only) — see ./drives.
app.route('/drives', driveRoutes)

// FREE-ROAM manifest: every roam-narratable place near a point, with presigned clip URLs
// (shared schema: roamManifest). Roam is a MODE over the SHARED narration layer (V2): a roam
// encounter is a poi's 1:1 `narration` — audio_url is NOT NULL, so everything returned is
// playable. Geo filter runs in JS — the corpus is a few hundred rows per region at most, so a
// bbox prefilter + haversine beats dragging in PostGIS.
// ALPHA: OPEN to anyone (founder TestFlight toy; no UI links it for anyone else).
// When roam ships for real it takes the live-drive wall (free account), same as /drives.
// withSession runs (fail-open) so a logged-in admin is recognized — admins hear STAGED clips,
// everyone else gets released-only (the released_at filter below). See region-release-gate.
app.use('/roam', rateLimit({ limit: 60, windowSec: 60, label: 'roam' }), withSession)
app.get('/roam', async (c) => {
  const lat = Number(c.req.query('lat'))
  const lng = Number(c.req.query('lng'))
  // lat/lng must be real WGS84 coordinates (parity with /drives' endpoint validation); NaN fails too.
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return c.json({ error: 'bad_request', message: 'lat (−90..90) and lng (−180..180) are required numbers.' }, 400)
  }
  // Default generously (a basin is ~40 km across); cap at 100 so "near a point" stays honest. A
  // non-positive or non-finite radius — incl. `radiusKm=` (Number('') === 0) and a negative that would
  // INVERT the between() bounds into a silently-empty 200 — falls back to the 50 km default.
  const rawRadiusKm = Number(c.req.query('radiusKm') ?? 50)
  const radiusKm = Math.min(Number.isFinite(rawRadiusKm) && rawRadiusKm > 0 ? rawRadiusKm : 50, 100)

  // Bound the query to a lat/lng box (a cheap pois_lat_lng_idx prefilter) so we don't scan
  // every roam narration globally; the exact haversine pass below still trims the box's corners.
  const dLat = radiusKm / 111.32
  const cosLat = Math.cos((lat * Math.PI) / 180)
  const dLng = Math.abs(cosLat) > 1e-6 ? radiusKm / (111.32 * cosLat) : 180

  // Release gate: serve only RELEASED clips (released_at NOT NULL) to the public; an admin bypasses
  // it and hears staged content in-app. (region-release-gate)
  const canPreview = isAdmin(c.get('session'))

  const rows = await withRetry(
    () =>
      db
        .select({
          poiId: narrations.poiId,
          name: pois.name,
          kind: pois.kind,
          lat: pois.lat,
          lng: pois.lng,
          // The road-snapped "where to look" anchor (snap-speakable-anchors) — when present it's the
          // trigger center the pin reports, so RoamEngine fires off the ROAD point, not the centroid
          // (1b step 1). Null for off-road POIs → falls back to the pin, today's behavior.
          speakableLat: pois.speakableLat,
          speakableLng: pois.speakableLng,
          key: narrations.audioUrl,
          durationMs: narrations.audioDurationMs,
          // The frozen source credit — CC BY-SA obliges it wherever the adapted text is presented,
          // and roam presents it to anonymous riders (the front door). Same array driveClip carries.
          attribution: narrations.attribution,
        })
        .from(narrations)
        .innerJoin(pois, eq(pois.id, narrations.poiId))
        .where(
          and(
            between(pois.lat, lat - dLat, lat + dLat),
            between(pois.lng, lng - dLng, lng + dLng),
            canPreview ? undefined : isNotNull(narrations.releasedAt),
          ),
        ),
    { label: 'roam.pins' },
  )

  // audioUrl/audioDurationMs are NOT NULL at the DB boundary (a narration goes live only once it has
  // audio — schema.ts), so every joined row is already playable; the only trim left is the exact-radius
  // pass (the bbox prefilter above still includes the box's corners). [lng, lat] axis order per @skipper/engine.
  const near = rows.filter((r) => haversineMeters([lng, lat], [r.lng, r.lat]) <= radiusKm * 1000)

  try {
    return c.json({
      pins: near.map((r) => ({
        poiId: r.poiId,
        name: r.name,
        // Trigger center = the road-snapped anchor when we have one, else the centroid (1b step 1).
        lat: r.speakableLat ?? r.lat,
        lng: r.speakableLng ?? r.lng,
        durationMs: r.durationMs,
        // …and the radius tightens to match: an anchored center is ON the road, so it drops the fat
        // kind-aware floor that exists to bridge an off-road centroid (trigger-precision §2, 1b step 2).
        radiusM: triggerRadiusForKind(r.kind, r.speakableLat != null && r.speakableLng != null),
        url: presignGet(r.key),
        contentType: contentTypeForKey(r.key),
        attribution: (r.attribution ?? undefined) as RoamPin['attribution'],
      })),
    })
  } catch (e) {
    console.error('[api] roam presign failed', e)
    return c.json(
      {
        error: 'audio_unavailable',
        message: 'Audio is warming up. Give it a moment and try again.',
      },
      503,
    )
  }
})

const port = Number(process.env.PORT ?? 8787)

// Bun serves a default export of the shape { port, fetch }.
export default { port, fetch: app.fetch }
