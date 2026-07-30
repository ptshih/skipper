// Per-request CLIENT IDENTITY — what build is asking, and what it says it can do.
//
// The grammar, the capability vocabulary and the (total, non-throwing) parser live in
// `@skipper/shared` so the app that emits the header and this server can never disagree about it.
// All that is here is the Hono plumbing.
//
// ⚠ MOUNTED GLOBALLY AND THEREFORE AHEAD OF EVERYTHING, including `GET /health`, which is
// deliberately env-free and DB-free. So this must be pure and non-throwing: `parseClientIdentity` is
// total by contract (see its doc comment), and there is no I/O here on purpose. Do not grow this into
// something that reads the DB or the session — that is what `withSession` is for, and it fails open
// for the same reason.

import type { MiddlewareHandler } from 'hono'
import { CLIENT_IDENTITY_HEADER, parseClientIdentity } from '@skipper/shared'
import type { ApiEnv } from './entitlements'

/**
 * Parse the client-identity header once per request and stash it on the context.
 *
 * An absent or malformed header yields the least-capable client (no version, no capabilities), which
 * is the honest reading: every rider installed before this shipped sends nothing and always will.
 */
export const withClient: MiddlewareHandler<ApiEnv> = async (c, next) => {
  c.set('client', parseClientIdentity(c.req.header(CLIENT_IDENTITY_HEADER)))
  await next()
}
