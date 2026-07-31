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
import { cors } from 'hono/cors'
import { and, asc, between, eq, isNotNull, isNull, not } from 'drizzle-orm'
import { db } from '@skipper/db'
import { narrations, pois, regions } from '@skipper/db/schema'
import { haversineMeters, triggerRadiusForKind } from '@skipper/engine'
import type { Region, RoamPin } from '@skipper/shared'
import { auth, SITE_ORIGIN } from './auth'
import { withClient } from './client'
import { loadClusterTellings, notSupersededByServedCluster } from './clusters'
import { driveRoutes } from './drives'
import { isAdmin, withSession, type ApiEnv } from './entitlements'
import { rateLimit } from './rate-limit'
import { withRetry } from './retry'
import { DATA_SOURCES } from './sources'
import { audioUnavailable, contentTypeForKey, presignGet } from './storage'
import { VERSION_POLICIES } from './version-policy'

const app = new Hono<ApiEnv>()

// CORS is CLOSED except on ONE route (the reset POST — see the `cors()` mount above the Better Auth
// handler below). Every other consumer is native (Expo/RN mobile), where CORS doesn't apply at all,
// so the absence of `Access-Control-Allow-Origin` everywhere else is the SAFE posture, not a gap:
// browsers already default-deny cross-origin reads, and a broader policy would only OPEN access to
// web clients that don't exist. Widen it (and auth.ts `trustedOrigins`) only when one does appear —
// a web player, or a live (non-static) /t/:id share page that fetches this API from the browser.

// Defense-in-depth: any unhandled throw returns a clean JSON 500 with no internal
// details (DB messages etc.) leaked; the detail goes to the server log.
app.onError((err, c) => {
  console.error('[api] unhandled error', err)
  return c.json({ error: 'internal' }, 500)
})

// What build is asking, and what it says it can do. Mounted FIRST and on '*' deliberately, for two
// reasons this file has been bitten by before: `app.use('/roam', …)` matches that EXACT path only
// (hence /roam/sample's own mount further down), and Hono runs handlers in REGISTRATION order, so a
// late mount silently skips everything above it. Pure, no I/O, total parser — safe ahead of /health,
// which is deliberately env-free and DB-free.
//
// ⚠ NOT wired into Better Auth's client, so /api/auth/* carries no identity. That is a decision, not
// an oversight: auth routes serve no capability-shaped CONTENT, and adding a custom header to the
// browser's cross-origin reset-password POST would make it fail preflight unless it were also added
// to the `allowHeaders` list below — i.e. it would risk the ONE route back into a locked-out account
// in exchange for nothing. Revisit only if the header ever feeds telemetry rather than content.
app.use('*', withClient)

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
  // Typed against the WIRE DTO, not just returned raw: the select happens to match `Region` today, and
  // "happens to match" is how a shape drifts out of the contract without a test failing. Its sibling
  // `loadRegionAnchors` already annotates its return for the same reason.
  const payload: Region[] = rows
  return c.json({ regions: payload })
})

// ⚠ The one exception to the no-CORS posture above, and it must be registered BEFORE the auth mount
// (Hono runs matching handlers in registration order — behind it, the POST/GET route below would
// answer first and this would never run).
//
// skipper.fm/reset-password is this API's only browser client: a static page on a DIFFERENT origin
// (Firebase Hosting vs this Cloud Run service), so its "save the new password" fetch is cross-origin,
// and its `content-type: application/json` makes it PREFLIGHTED. The preflight OPTIONS matched
// nothing (the mount below is POST/GET only) and 404'd, so the browser blocked the POST before it was
// ever sent and the page fell into its transport-error branch. A rider could open a perfectly valid
// link, type a new password, and never save it — on the ONLY route back into a locked-out account,
// where the token stays unspent and every retry fails identically.
//
// Deliberately narrow: one exact path, one origin, no credentials. `SITE_ORIGIN` is the same const
// auth.ts trusts for the redirect, so a local `dev:site` override moves both together. Credentials
// stay OFF because the reset authenticates with its one-time TOKEN, not a session — no ambient cookie
// should ever ride a cross-origin request here.
app.use(
  '/api/auth/reset-password',
  cors({
    origin: SITE_ORIGIN,
    allowMethods: ['POST'],
    allowHeaders: ['content-type'],
    maxAge: 86_400,
  }),
)

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

  // ⚠ ORDER MATTERS: the fused tellings load FIRST, because which ones we are actually serving is what
  // decides which member POIs to suppress. Deriving that the other way round is how an area-unaware
  // client ends up with a hole where downtown used to be.
  //
  // ⚠ Area tellings go to EVERY client — founder call 2026-07-30 (66435e9), risks acknowledged —
  // and `areaCapable: true` here is that call, written down, not a default.
  //
  // The capability CHANNEL now exists (`c.get('client')`), so withholding is finally possible; this
  // stays open because flipping it is a CONTENT change, not a refactor. Every rider installed today
  // sends no header, so `clientCan(...)` would be false for all of them and the flip would silently
  // take three districts away from the entire installed base and hand back their member pins. What
  // protects an area-unaware client meanwhile is the CAPPED point fallback in loadClusterTellings.
  //
  // TO GATE IT, when a real drive says the fallback is not good enough, this is the one line (plus
  // importing the two names from @skipper/shared):
  //     areaCapable: clientCan(c.get('client'), CLIENT_CAPS.area),
  const clusterRows = await withRetry(
    () => loadClusterTellings({ includeStaged: canPreview, areaCapable: true }),
    { label: 'roam.clusterPins' },
  )
  const servedClusterIds = clusterRows.map((r) => r.clusterId)

  const rows = await withRetry(
    () =>
      db
        .select({
          // `pois.id`, not `narrations.poi_id` — identical under the innerJoin below but NOT NULL, so a
          // CLUSTER telling (poi_id null) can never surface as a roam pin with no place. Same idiom as
          // the drive corpus in ./drives.
          poiId: pois.id,
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
            // Legibility gate (same rule as the drive BUILD path): a poi with an `excluded_reason`
            // exists but can't be told as a stop. Roam applies it unconditionally — including for an
            // admin, since this is about the SHAPE of the place, not about staged-vs-released content,
            // and roam has no frozen artifact to protect (every session resolves pins live).
            isNull(pois.excludedReason),
            // …and a place whose CLUSTER already speaks for it is no longer its own pin (spec §4.2).
            // Self-gating: with every fused clip staged this matches nothing, so shipping it ahead of
            // a release is a no-op rather than a coverage hole.
            notSupersededByServedCluster(servedClusterIds),
          ),
        ),
    { label: 'roam.pins' },
  )

  // audioUrl/audioDurationMs are NOT NULL at the DB boundary (a narration goes live only once it has
  // audio — schema.ts), so every joined row is already playable; the only trim left is the exact-radius
  // pass (the bbox prefilter above still includes the box's corners). [lng, lat] axis order per @skipper/engine.
  const near = rows.filter((r) => haversineMeters([lng, lat], [r.lng, r.lat]) <= radiusKm * 1000)
  // Clusters get no bbox prefilter (poi_clusters stores no coordinates), so the radius pass is the
  // ONLY trim — it runs against the derived trigger point, which is what the rider would drive to.
  const nearClusters = clusterRows.filter((r) => haversineMeters([lng, lat], [r.lng, r.lat]) <= radiusKm * 1000)

  try {
    return c.json({
      pins: [
        ...near.map((r) => ({
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
        // ⚠ `poiId` carries the CLUSTER's uuid here. The wire field is required and typed as a bare
        // uuid that asserts nothing about its table, and the client treats it as an opaque token
        // throughout (a Map/Set key and a React key — it never looks a poi up), so this is additive:
        // installed clients keep working. Renaming it would be a hard break, since `roamManifest`
        // parses with `.parse` over `z.array`, where ONE bad pin rejects every pin.
        // ⚠ Consequence to know: `roam-history.json` is keyed by this id and never pruned, and cluster
        // ids are re-minted by a `--force-regroup`, so a regroup orphans a rider's heard/muted state
        // for that cluster. Acceptable — it degrades to hearing it once more.
        ...nearClusters.map((r) => ({
          poiId: r.clusterId,
          name: r.name,
          lat: r.lat,
          lng: r.lng,
          durationMs: r.durationMs,
          radiusM: r.triggerRadiusM,
          // Present only for a group too spread out to be a point. Sent to EVERY client: an
          // area-unaware one strips it in Zod and fires the CAPPED `radiusM` above instead, which is
          // the whole protection (the `?caps=area` withhold was built and then removed — see above).
          ...(r.area ? { area: r.area } : {}),
          url: presignGet(r.key),
          contentType: contentTypeForKey(r.key),
          attribution: (r.attribution ?? undefined) as RoamPin['attribution'],
        })),
      ],
    })
  } catch (e) {
    return audioUnavailable(c, 'roam', e)
  }
})

// GET /roam/sample — the anonymous "taste" for a user OUTSIDE any coverage. The corpus is Tahoe-only,
// so a first-timer (or an Apple reviewer in Cupertino) who taps "Ride Along" gets 0 pins and a
// dead-end; this serves ONE curated, always-iconic clip so they hear the Skipper regardless of where
// they are. Anonymous, like /roam — no account, no location. Resolves SAMPLE_NARRATION_QID to its
// released narration and presigns the private clip. Fails SOFT (404 with a friendly code) when the
// QID is unset / not found / unreleased, so the client shows a reachable retry, never a white screen.
// Additive wire contract (post-v1 safe).
//
// Its own rate limiter: the `/roam` limiter above is `app.use('/roam', …)`, which in Hono matches the
// EXACT path only — NOT this subpath. Without this line /roam/sample would be an uncapped anonymous
// DB-lookup + presign, while its sibling is 60/min. One indexed limit-1 query, so 30/min is ample.
app.use('/roam/sample', rateLimit({ limit: 30, windowSec: 60, label: 'roam-sample' }))
app.get('/roam/sample', async (c) => {
  const qid = process.env.SAMPLE_NARRATION_QID
  // Unset config is an OPERATOR miss, not a rider error — but the rider still gets a clean, retryable
  // surface rather than a 500. Setting the QID is an explicit go-live gate (see the submission guide).
  if (!qid) {
    return c.json({ error: 'no_sample', message: 'No sample is cued up just yet — check back soon.' }, 404)
  }
  const rows = await withRetry(
    () =>
      db
        .select({
          qid: pois.qid,
          name: pois.name,
          key: narrations.audioUrl,
          durationMs: narrations.audioDurationMs,
          attribution: narrations.attribution,
        })
        .from(narrations)
        .innerJoin(pois, eq(pois.id, narrations.poiId))
        // RELEASED only — the taste is public, so it must clear the same gate as any anonymous clip.
        .where(and(eq(pois.qid, qid), isNotNull(narrations.releasedAt)))
        .limit(1),
    { label: 'roam.sample' },
  )
  const row = rows[0]
  if (!row) {
    return c.json({ error: 'no_sample', message: 'No sample is cued up just yet — check back soon.' }, 404)
  }
  try {
    return c.json({
      qid: row.qid,
      name: row.name,
      url: presignGet(row.key),
      contentType: contentTypeForKey(row.key),
      durationMs: row.durationMs,
      attribution: (row.attribution ?? undefined) as RoamPin['attribution'],
    })
  } catch (e) {
    return audioUnavailable(c, 'roam sample', e)
  }
})

const port = Number(process.env.PORT ?? 8787)

// Bun serves a default export of the shape { port, fetch }.
export default { port, fetch: app.fetch }
