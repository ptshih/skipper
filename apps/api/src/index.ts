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
//   POST /drives/plan                -> one turn of planning a drive by talking (ANONYMOUS; spends)
//   GET  /sample                     -> one curated "taste" clip (anonymous; no location)
//
// The app runs on ONE rider artifact: the user-owned DRIVE, assembled from the region's shared
// narration corpus. Hand-authored tours are deferred and free-roam was removed in 1.1. Creating or
// playing a drive needs a free account (the /drives sub-app's requireAccount); the open anonymous
// front door is the planner plus /sample. Audio is private in R2 — presigned on demand after the
// tier check.

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { and, asc, eq, isNotNull } from 'drizzle-orm'
import { db } from '@skipper/db'
import { narrations, pois, regions } from '@skipper/db/schema'
import type { AttributionList, Region } from '@skipper/shared'
import { auth, SITE_ORIGIN } from './auth'
import { driveRoutes } from './drives'
import { PLAN_RATE_HOUR, PLAN_RATE_MINUTE, PROPOSE_RATE, SERVER_MAX_BODY_BYTES } from './limits'
import { planRoutes } from './plan-route'
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

// ⚠ TWO MOUNT RULES THIS FILE HAS BEEN BITTEN BY, kept here now that the mount they annotated is
// gone: `app.use('/x', …)` matches that EXACT path only, NOT its subpaths (which is why /sample
// carries its own limiter below rather than inheriting one), and Hono runs handlers in REGISTRATION
// order, so a late mount silently skips everything registered above it.

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
// RELEASE-GATED, same as the drive build: a region exists in the table from the moment
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
app.use('/drives/propose', rateLimit(PROPOSE_RATE))

// ⚠ REGISTERED ABOVE THE /drives MOUNT, AND THAT IS THE WHOLE POINT. Hono matches in REGISTRATION
// ORDER, so below `app.route('/drives', driveRoutes)` this path would be swallowed by that sub-app's
// blanket `requireAccount` and every anonymous plan would 401 — a failure that reads like an auth bug
// rather than a routing one. The planner is the open anonymous front door (D14/D15): a rider plans a
// whole drive before ever meeting the wall at POST /drives. A test pins the 200-without-session.
//
// ⚠ BOTH rate limiters, in order. Each rateLimit() call closes over its own bucket map, so two mounts
// give two independent windows — verified. The per-minute one alone permits ~28,800 requests/day per
// IP per instance on a path that bills a frontier model every time; the hourly window is what makes
// that a bounded number. No session middleware: the planner has NO corpus access at all (D9), so
// there is nothing an admin could be shown that a stranger could not.
app.use('/drives/plan', rateLimit(PLAN_RATE_MINUTE), rateLimit(PLAN_RATE_HOUR))
app.route('/drives/plan', planRoutes)

// Create-a-Drive (V2): user-owned, on-demand A→B drives over the shared narration corpus. The
// whole sub-app is behind a free account — see ./drives. ⚠ 1.1 moves requireAccount OFF this mount
// onto the individual owner routes (D15/INV-15), so do NOT re-add a blanket wall here.
app.route('/drives', driveRoutes)

// GET /sample — the anonymous "taste" for a user OUTSIDE any coverage. The corpus is Tahoe-only,
// so a first-timer (or an Apple reviewer in Cupertino) who taps "Ride Along" gets 0 pins and a
// dead-end; this serves ONE curated, always-iconic clip so they hear the Skipper regardless of where
// they are. Anonymous — no account, no location. Resolves SAMPLE_NARRATION_QID to its
// released narration and presigns the private clip. Fails SOFT (404 with a friendly code) when the
// QID is unset / not found / unreleased, so the client shows a reachable retry, never a white screen.
// Additive wire contract (post-v1 safe).
//
// Its own rate limiter — one indexed limit-1 query plus a presign, so 30/min is ample. ⚠ It carried
// one when it lived at /roam/sample because `app.use('/roam', …)` did NOT cover the subpath; keep it
// now for the plainer reason that every anonymous, uncapped DB-touching route is a standing invitation.
app.use('/sample', rateLimit({ limit: 30, windowSec: 60, label: 'sample' }))
app.get('/sample', async (c) => {
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
    { label: 'sample' },
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
      attribution: (row.attribution ?? undefined) as AttributionList,
    })
  } catch (e) {
    return audioUnavailable(c, 'sample', e)
  }
})

const port = Number(process.env.PORT ?? 8787)

// Bun serves a default export of the shape { port, fetch }.
//
// `maxRequestBodySize` is the only guard that stops bytes at the SOCKET, before any JS runs — a floor
// under the per-route caps in ./limits rather than a replacement for them (Bun's 413 carries an empty
// body, so the friendly JSON still comes from readJsonBody). It is process-wide, so it also bounds the
// /api/auth/* handler mount, which has no body limit of its own.
export default { port, fetch: app.fetch, maxRequestBodySize: SERVER_MAX_BODY_BYTES }
