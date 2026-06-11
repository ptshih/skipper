// IAP-asserted founder-only gate for /admin/*.
//
// The skipper-admin Cloud Run service sits behind Google IAP (spec §7), reachable ONLY
// through the IAP service agent (Cloud Run invoker locked to it), so the request has already
// passed Google login by the time it reaches us. IAP forwards the verified identity as
//   X-Goog-Authenticated-User-Email: accounts.google.com:<email>
// We assert it equals the single allowed principal (ADMIN_EMAIL) as belt-and-suspenders.
// The hardened upgrade is verifying the signed X-Goog-IAP-JWT-Assertion against the
// direct-Cloud-Run audience (/projects/<num>/locations/<region>/services/skipper-admin).

import type { MiddlewareHandler } from 'hono'

export type AdminEnv = { Variables: { adminEmail: string } }

export const requireAdmin: MiddlewareHandler<AdminEnv> = async (c, next) => {
  const allowed = process.env.ADMIN_EMAIL?.toLowerCase()

  // Local-dev escape hatch — INERT in production (NODE_ENV=production is baked into the
  // image), so it can never weaken the deployed wall even if the env var leaks to prod.
  if (process.env.NODE_ENV !== 'production' && process.env.ADMIN_DEV_BYPASS === '1') {
    c.set('adminEmail', allowed ?? 'dev@local')
    return next()
  }

  if (!allowed) return c.json({ error: 'admin_not_configured' }, 500)
  const header = c.req.header('x-goog-authenticated-user-email')
  const email = header?.split(':').pop()?.toLowerCase()
  if (!email || email !== allowed) return c.json({ error: 'forbidden' }, 403)
  c.set('adminEmail', email)
  await next()
}
