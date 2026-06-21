// @skipper/api — Hono API (M2), served natively by bun.
//
//   GET  /health                     -> liveness (env-free)
//   GET  /sources                    -> data-source/license catalog (anonymous; env-free)
//   GET  /version                    -> per-platform app-version policy (anonymous; env-free)
//   *    /api/auth/*                  -> Better Auth (sign-up/in/out, session, OAuth)
//   GET  /regions                    -> pickable regions for the Create-a-Drive picker (anonymous)
//   POST /drives/propose             -> resolve a free-text prompt + preview route (free account; no credit)
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
import { radiusForKind } from '@skipper/engine'
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

// The pickable regions for the Create-a-Drive region selector. Anonymous + tiny (just
// id/slug/name) — the create FLOW is gated, but listing region names to pick from is open.
app.get('/regions', async (c) => {
  const rows = await withRetry(
    () =>
      db
        .select({ id: regions.id, slug: regions.slug, displayName: regions.displayName })
        .from(regions)
        .orderBy(asc(regions.displayName)),
    { label: 'regions.list' },
  )
  return c.json({ regions: rows })
})

// Better Auth owns everything under /api/auth/* (its own handler).
app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw))

// Rate-limit the propose path BEFORE mounting the sub-app: POST /drives/propose fires ONE Google
// Routes call (+ a corpus read) per request and otherwise has no cap, so this is the spend/DB-load
// guard (per-instance in-memory first cut — see ./rate-limit).
app.use('/drives/propose', rateLimit({ limit: 15, windowSec: 60, label: 'propose' }))

// Create-a-Drive (V2): user-owned, on-demand A→B drives over the shared narration corpus. The
// whole sub-app is behind a free account (anonymous = roam only) — see ./drives.
app.route('/drives', driveRoutes)

// Straight-line distance (m) — the same haversine as @skipper/engine's; inlined here
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
// (shared schema: roamManifest). Roam is a MODE over the SHARED narration layer (V2): a roam
// encounter is a poi's 1:1 `narration` — audio_url is NOT NULL, so everything returned is
// playable. Geo filter runs in JS — the corpus is a few hundred rows per region at most, so a
// bbox prefilter + haversine beats dragging in PostGIS.
// ALPHA: OPEN, like ?preview=1 (founder TestFlight toy; no UI links it for anyone else).
// When roam ships for real it takes the live-drive wall (free account), same as /drives.
// withSession runs (fail-open) so a logged-in admin is recognized — admins hear STAGED clips,
// everyone else gets released-only (the released_at filter below). See region-release-gate.
app.use('/roam', rateLimit({ limit: 60, windowSec: 60, label: 'roam' }), withSession)
app.get('/roam', async (c) => {
  const lat = Number(c.req.query('lat'))
  const lng = Number(c.req.query('lng'))
  // Default generously (a basin is ~40 km across); cap so "near a point" stays honest.
  const radiusKm = Math.min(Number(c.req.query('radiusKm') ?? 50), 100)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(radiusKm)) {
    return c.json({ error: 'bad_request', message: 'lat and lng are required numbers.' }, 400)
  }

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
          key: narrations.audioUrl,
          durationMs: narrations.audioDurationMs,
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

  // A narration only goes live with script + audio filled, but audioUrl is nullable through
  // generation — drop any keyless row so a half-baked roam narration never surfaces a bad pin.
  const near = rows.filter(
    (r): r is typeof r & { key: string; durationMs: number } =>
      r.key != null &&
      r.durationMs != null &&
      haversineMeters(lat, lng, r.lat, r.lng) <= radiusKm * 1000,
  )

  try {
    return c.json({
      pins: near.map((r) => ({
        poiId: r.poiId,
        name: r.name,
        lat: r.lat,
        lng: r.lng,
        durationMs: r.durationMs,
        radiusM: radiusForKind(r.kind),
        url: presignGet(r.key),
        contentType: contentTypeForKey(r.key),
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
