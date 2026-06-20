import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { requireAdmin, type AdminEnv } from './auth'

// requireAdmin is the entire IAP gate in front of every /admin/* route (the shared prod DB + the
// paid-job spend trigger). It must: be inert in prod even if ADMIN_DEV_BYPASS leaks, fail CLOSED when
// unconfigured, and reject a missing/mismatched IAP identity. Mount it on a tiny app and exercise the
// matrix via app.request(). (audit #2)

function app() {
  const a = new Hono<AdminEnv>()
  a.use('/admin/*', requireAdmin)
  a.get('/admin/ping', (c) => c.json({ email: c.get('adminEmail') }))
  return a
}
const HDR = 'x-goog-authenticated-user-email'

const KEYS = ['ADMIN_EMAIL', 'ADMIN_DEV_BYPASS', 'NODE_ENV'] as const
let saved: Record<string, string | undefined>
beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
  for (const k of KEYS) delete process.env[k]
})
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('requireAdmin — dev bypass', () => {
  test('admits in non-prod when ADMIN_DEV_BYPASS=1 (no IAP header needed)', async () => {
    process.env.ADMIN_DEV_BYPASS = '1'
    process.env.ADMIN_EMAIL = 'founder@skipper.fm'
    const res = await app().request('/admin/ping')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ email: 'founder@skipper.fm' })
  })

  test('falls back to dev@local when ADMIN_EMAIL is unset', async () => {
    process.env.ADMIN_DEV_BYPASS = '1'
    const res = await app().request('/admin/ping')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ email: 'dev@local' })
  })

  test('is INERT in production even with ADMIN_DEV_BYPASS=1 (no header → still forbidden)', async () => {
    process.env.NODE_ENV = 'production'
    process.env.ADMIN_DEV_BYPASS = '1'
    process.env.ADMIN_EMAIL = 'founder@skipper.fm'
    const res = await app().request('/admin/ping') // no IAP header
    expect(res.status).toBe(403)
  })
})

describe('requireAdmin — fail closed', () => {
  test('500 admin_not_configured when ADMIN_EMAIL is unset (prod, no bypass)', async () => {
    process.env.NODE_ENV = 'production'
    const res = await app().request('/admin/ping', { headers: { [HDR]: 'accounts.google.com:x@y.com' } })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'admin_not_configured' })
  })

  test('403 when the IAP header is missing', async () => {
    process.env.NODE_ENV = 'production'
    process.env.ADMIN_EMAIL = 'founder@skipper.fm'
    const res = await app().request('/admin/ping')
    expect(res.status).toBe(403)
  })

  test('403 when the asserted email does not match the allowed principal', async () => {
    process.env.NODE_ENV = 'production'
    process.env.ADMIN_EMAIL = 'founder@skipper.fm'
    const res = await app().request('/admin/ping', { headers: { [HDR]: 'accounts.google.com:intruder@evil.com' } })
    expect(res.status).toBe(403)
  })
})

describe('requireAdmin — accepts the matching IAP identity', () => {
  test('admits when the asserted email matches (strips the accounts.google.com: prefix)', async () => {
    process.env.NODE_ENV = 'production'
    process.env.ADMIN_EMAIL = 'founder@skipper.fm'
    const res = await app().request('/admin/ping', { headers: { [HDR]: 'accounts.google.com:founder@skipper.fm' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ email: 'founder@skipper.fm' })
  })

  test('match is case-insensitive on both the configured principal and the header', async () => {
    process.env.NODE_ENV = 'production'
    process.env.ADMIN_EMAIL = 'Founder@Skipper.FM'
    const res = await app().request('/admin/ping', { headers: { [HDR]: 'accounts.google.com:FOUNDER@skipper.fm' } })
    expect(res.status).toBe(200)
  })
})
