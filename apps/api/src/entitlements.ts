// Freemium entitlements middleware — resolves the Better Auth session per request
// and stashes the derived tier on the Hono context. The pure tier math lives in
// @skipper/shared (`tierOf`/`isAdmin`) — unit-testable without constructing the auth
// instance, and shared with the CLIENT, which is the point: the app's "am I signed in"
// check and this server gate read the same function rather than two lookalikes.

import type { MiddlewareHandler } from 'hono'
import type { AccessTier } from '@skipper/shared'
import { auth } from './auth'
import { resolveSessionSafely } from './session'
import { tierOf } from '@skipper/shared'

/** Better Auth's inferred session shape ({ session, user }), incl. role + isAnonymous (admin plugin). */
type AuthSession = typeof auth.$Infer.Session

export type ApiEnv = {
  Variables: {
    session: AuthSession | null
    tier: AccessTier
  }
}

/** Resolve the session + tier once and stash on context. Apply to gated data routes.
 *
 *  FAIL-OPEN: resolving the session reads the auth DB, and this middleware runs BEFORE the
 *  per-route gate — so a transient auth-DB blip must not 500 the request (it would needlessly
 *  take down an open endpoint that needs no session). resolveSessionSafely retries
 *  the read, then degrades to null → tierOf(null) = 'anonymous': the secure direction (a gated
 *  route falls back to its AccountGate 401, never a leak; open routes keep serving). See ./session. */
export const withSession: MiddlewareHandler<ApiEnv> = async (c, next) => {
  const session = await resolveSessionSafely(() => auth.api.getSession({ headers: c.req.raw.headers }))
  c.set('session', session)
  c.set('tier', tierOf(session))
  await next()
}

/** Re-resolve the session WITHOUT the cookie cache, for routes that INSERT rows keyed on a user id.
 *
 *  ⚠ WHY THIS EXISTS AT ALL. `session.cookieCache` (./auth) lets `getSession` answer from a signed
 *  cookie instead of the auth DB, which means a DELETED account still authenticates elsewhere until
 *  the cached copy expires. A read in that window is harmless — `purgeUserData` already removed the
 *  rows, so it finds nothing and 404s. An INSERT is not: it writes a row against a user id that no
 *  longer exists, into tables with no FK across the auth-pool boundary and, for `credit_entries`, no
 *  second copy. That is precisely the orphan INV-4 and App Store 5.1.1(v) exist to prevent.
 *
 *  ⚠ APPLIED TO EXACTLY TWO ROUTES, and the second one is the surprise: `POST /` (drives + a consume
 *  + `ensureFreeGrant`) and **`GET /`**, which looks like a pure read but calls `ensureFreeGrant` and
 *  therefore INSERTS the free-allotment row. It is also the likelier vector of the two — the home
 *  screen hits it on every launch, while creating a drive is rare and rate-limited. The other three
 *  owner routes only touch rows the purge already deleted, so they keep the cache and keep the win.
 *
 *  ⚠ IT RUNS AFTER the blanket `driveRoutes.use('*', withSession)` and OVERWRITES what that set. The
 *  double resolve is deliberate and nearly free: the first one is the cookie read this exists to
 *  distrust, so the only real cost is the one auth-DB round-trip we are choosing to pay here.
 *
 *  ⚠ AND IT GOES LAST IN THE CHAIN, AFTER `requireAccount` (and after `createDriveLimiter` on POST) —
 *  NOT first. Leading with it would be simpler to reason about, and wrong: `requireAccount` is a pure
 *  in-memory check placed first precisely so an anonymous flood costs LITTLE, and an auth-DB read
 *  ahead of it hands that flood a GUARANTEED query per request. Running last means only a caller who
 *  already cleared the cheap gate pays for freshness.
 *  ⚠ "little", not "nothing", and the difference is a recorded gap rather than a quibble: the blanket
 *  `driveRoutes.use('*', withSession)` still runs ahead of `requireAccount` — it has to, since
 *  `requireAccount` READS the session it sets — and while that resolve is usually answered from the
 *  cookie cache, a caller who sends a minted anonymous token WITHOUT `sessionData` forces it to the
 *  auth DB every time. None of the owner routes carry a rate limit, so that path is uncapped. See the
 *  `/drives` owner-routes item in TODO.md (2026-08-03 guard-ordering audit); capping it is a founder
 *  call, and this ordering is still the right one either way.
 *  ⚠ WHICH MAKES THE HANDLERS' TIER-KEYED BACKSTOPS LOAD-BEARING IN A NEW WAY. A deleted account still
 *  passes `requireAccount`, because that decided on the cached session — what rejects it is
 *  `c.get('tier') === 'free' ? … : undefined` inside the handler, reading the session THIS middleware
 *  just replaced. Those backstops were written as defence-in-depth against a dropped gate; they are
 *  now also the thing that catches an erased user, and deleting one as "unreachable" would silently
 *  reopen the orphan.
 *
 *  ⚠ A MIDDLEWARE, NEVER A FLAG ON `withSession`. test/drive-access.test.ts enforces INV-15 by reading
 *  the route table in drives.ts; a per-route middleware is visible to that test — and to a human
 *  scanning the routes — in a way a boolean argument buried in a call is not.
 *
 *  Fail-open like `withSession`, for the same reason: a transient auth-DB blip degrades to anonymous,
 *  which a gated route turns into its 401 rather than a leak. */
export const withFreshSession: MiddlewareHandler<ApiEnv> = async (c, next) => {
  const session = await resolveSessionSafely(() =>
    // `disableCookieCache` is read off the query by better-auth's session route (verified in the
    // installed 1.6.23 source; test/auth-cookie-cache.test.ts pins that the flag still exists).
    auth.api.getSession({ headers: c.req.raw.headers, query: { disableCookieCache: true } }),
  )
  c.set('session', session)
  c.set('tier', tierOf(session))
  await next()
}

/** The ONE body the account wall answers with — this middleware AND both tier-keyed backstops in
 *  ./drives (`POST /` and `GET /`).
 *
 *  ⚠ IT IS ONE CONST BECAUSE THE WALL WAS SPEAKING WITH TWO VOICES. There were three copies: the
 *  middleware's, a verbatim duplicate in `POST /drives`, and a third in `GET /drives` that carried NO
 *  `message` at all. The mobile client renders an ApiError's `message` VERBATIM, so a rider who tripped
 *  the GET backstop got the client's generic fallback line while the identical refusal on POST got the
 *  friendly copy — one wall, one rider, two different answers depending which route they hit first.
 *  ⚠ The backstops are NOT dead code (see the note above `withFreshSession`: they are now also what
 *  catches an erased account whose cached session still passes the gate), so all three are reachable. */
export const ACCOUNT_REQUIRED = {
  error: 'account_required',
  message: 'Create a free account to make a drive.',
} as const

/**
 * Free-account wall: reject anonymous callers. (Requires withSession upstream.)
 * Applied PER-ROUTE on the five owner routes in drives.ts (D15/INV-15, 1.1 step 8a) — `POST /`,
 * `GET /`, `GET /:id`, `POST /:id/assets/sign`, `DELETE /:id`. It is NOT on the `/drives*` mount,
 * which carries `withSession` alone.
 * ⚠ NEVER PUT IT BACK ON THE MOUNT. `POST /drives/propose` is the anonymous preview (D14) and a
 * blanket wall silently re-walls it — as a 401 that reads like an auth bug rather than a routing
 * one. The route table is pinned by test/drive-access.test.ts, which also fails when a NEW route is
 * added without a gate; that test, not deploy ordering, is INV-15's control.
 * (The planned `POST /drives/:id/ask` route will be a future ADDITIONAL caller, not the first.)
 * The 401 shape + message mirror the per-drive wall in `loadOwnedDrive` (drives.ts) so the two
 * gates stay aligned. Do NOT "remove the unused gate" — it is load-bearing.
 */
export const requireAccount: MiddlewareHandler<ApiEnv> = async (c, next) => {
  if (c.get('tier') === 'anonymous') return c.json(ACCOUNT_REQUIRED, 401)
  await next()
}

