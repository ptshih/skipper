// POST /account/password — let a signed-in rider SET a password on an account that has none.
//
// WHY THIS ROUTE EXISTS AT ALL, given better-auth already implements the logic: `setPassword` is
// declared `createAuthEndpoint.serverOnly` (better-auth 1.6.23 `api/routes/update-user.mjs`), so it
// is deliberately NOT reachable from `authClient` — it sets a credential without proving knowledge
// of an old one, which is not something a browser/app should be able to call directly. `auth.api.*`
// is the sanctioned server-side path, so this is a thin, gated wrapper and nothing more.
//
// WHY THE FEATURE EXISTS (founder ask 2026-08-05, docs/designs/lowest-friction-signup.md §8.6): email
// OTP is now the default way in, which makes mail DELIVERABILITY load-bearing on sign-IN rather than
// only on recovery. A rider whose code lands in spam has no way into their account at all. A password
// they deliberately set is the way back that does not depend on mail arriving — this is the hedge for
// that, not a preference toggle.
//
// ⚠ THIS DOES NOT REOPEN PASSWORD SIGNUP. No signup path mints a password; this is opt-in, after the
// fact, by a rider who already holds a session.
import { Hono } from 'hono'
import { auth } from './auth'
import { requireAccount, withSession, type ApiEnv } from './entitlements'

/** Rejections this route can answer with, as ONE map — the client renders `message` verbatim, so a
 *  second copy of any of these strings is a second voice for the same refusal (the mistake
 *  `ACCOUNT_REQUIRED` in ./entitlements exists to have stopped happening). */
const ERRORS = {
  already_set: {
    error: 'password_already_set',
    message: 'This account already has a password. Use “Forgot your password?” to change it.',
  },
  too_short: {
    error: 'password_too_short',
    message: 'That password is too short.',
  },
  failed: {
    error: 'password_set_failed',
    message: 'Could not set your password.',
  },
} as const

/** better-auth throws `APIError`s carrying a `body.code`; that code is the only stable discriminator
 *  (the message is prose and the HTTP status is shared by several causes). Read defensively — an
 *  upgrade that renames a code must degrade to the generic refusal, never to a 500. */
function codeOf(err: unknown): string | undefined {
  const body = (err as { body?: { code?: unknown } } | undefined)?.body
  return typeof body?.code === 'string' ? body.code : undefined
}

export const passwordRoutes = new Hono<ApiEnv>()

/**
 * POST /account/password  { newPassword }
 *
 * ⚠ `requireAccount` is PER-ROUTE here, matching the drives convention (D15/INV-15) — never a
 * `.use('*')` mount. It is what rejects an ANONYMOUS session, which matters more than usual on this
 * route: an anonymous row is hard-deleted at link (INV-4), so a password set against one would be
 * silently destroyed moments later, and the rider would be left believing they had a credential.
 *
 * ⚠ NO FRESHNESS BAR, and that is a decision rather than an omission. better-auth's `setPassword`
 * carries `sensitiveSessionMiddleware`, which resolves an AUTHORITATIVE session but — unlike
 * `freshSessionMiddleware` — does NOT check `freshAge` (verified in the installed source; the two
 * middlewares are adjacent in `api/routes/session.mjs` and are easy to confuse). So the library
 * imposes no re-auth here and neither do we, because this action is ADDITIVE and recoverable: the
 * worst case is a rider setting a password they can then reset by email. ⚠ Account DELETION is the
 * opposite case and is gated by a code on purpose — see ./drives-adjacent settings flow and
 * docs/designs/lowest-friction-signup.md §8.3. Do not "make these consistent" by dropping that one.
 */
passwordRoutes.post('/password', requireAccount, async (c) => {
  const body = await c.req.json().catch(() => null)
  const newPassword = (body as { newPassword?: unknown } | null)?.newPassword
  if (typeof newPassword !== 'string' || newPassword.length === 0) {
    return c.json(ERRORS.failed, 400)
  }

  try {
    // Headers ride through so better-auth resolves THIS rider's session — `auth.api` with no headers
    // would have no session at all and throw UNAUTHORIZED.
    await auth.api.setPassword({ body: { newPassword }, headers: c.req.raw.headers })
  } catch (err) {
    const code = codeOf(err)
    if (code === 'PASSWORD_ALREADY_SET') return c.json(ERRORS.already_set, 409)
    if (code === 'PASSWORD_TOO_SHORT' || code === 'PASSWORD_TOO_LONG') {
      return c.json(ERRORS.too_short, 400)
    }
    // ⚠ Never echo the thrown message: it is vendor prose that can name internals, and this sits on
    // a rider-facing path. Log for the operator, answer with the one generic refusal.
    console.error('[api] setPassword failed', err)
    return c.json(ERRORS.failed, 400)
  }

  // No body worth returning — the client re-reads `listAccounts()` to learn the account now has a
  // credential, which keeps ONE source of truth for that fact rather than a boolean echoed here.
  return c.json({ ok: true })
})

/** Mounted at /account in ./index. `withSession` first (it sets what `requireAccount` reads). */
export const accountRoutes = new Hono<ApiEnv>()
accountRoutes.use('*', withSession)
accountRoutes.route('/', passwordRoutes)
