/**
 * The console had no CSRF protection of any kind, and `bun run dev:admin` runs with the auth bypass
 * on — so any page the founder's browser happened to open could drive the production corpus.
 *
 * These are the two halves that matter: the exploit is refused, and nothing the SPA actually sends is.
 * The second half is why this is worth a test rather than a one-line mount — a CSRF middleware that
 * breaks the console would be reverted within a day, and the "does it still work?" question is not
 * obvious here (dev goes through a vite proxy on a DIFFERENT origin than the API).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Hono } from 'hono'
import { csrf } from 'hono/csrf'

/** A stand-in for the real mount: csrf() in front of a state-changing route. */
const app = new Hono()
app.use('*', csrf())
app.post('/admin/regions/:slug/release', (c) => c.json({ released: c.req.param('slug') }))
app.get('/admin/regions', (c) => c.json({ ok: true }))

const post = (init?: RequestInit) =>
  app.request('http://localhost:8788/admin/regions/lake-tahoe/release', { method: 'POST', ...init })

describe('the attack', () => {
  // The exact shape from the audit: a bare form needs no body, no confirm flag and no JSON — and the
  // release route reads only a path param, so there was nothing else to satisfy.
  test('a cross-site FORM post to the irreversible release route is refused', async () => {
    const res = await post({
      headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
    })
    expect(res.status).toBe(403)
  })

  test('…including the default form enctype, and text/plain', async () => {
    for (const ct of ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain']) {
      const res = await post({
        headers: { 'content-type': ct, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
      })
      expect(res.status, ct).toBe(403)
    }
  })

  test('…and a request carrying no Origin or Sec-Fetch-Site at all (a plain curl / form navigation)', async () => {
    // A MISSING content-type counts as text/plain, which is the whole point: the CORS-simple set is
    // exactly what skips the preflight this server never answers.
    expect((await post()).status).toBe(403)
  })
})

describe('the console', () => {
  // apps/admin/client/src/lib/api.ts `req()` sets this header on EVERY request, including bodyless
  // POSTs like cancelJob and the two release routes. That is what makes the mount safe.
  test('a JSON post is allowed — which is everything the SPA sends', async () => {
    const res = await post({ headers: { 'content-type': 'application/json' } })
    expect(res.status).toBe(200)
  })

  test('a JSON post is allowed even cross-origin — the browser blocks that one on the preflight', async () => {
    const res = await post({
      headers: { 'content-type': 'application/json', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
    })
    // csrf() deliberately does not guard this: a cross-origin JSON POST is NOT a simple request, so it
    // needs a preflight, and this server answers none. Asserting it here so nobody "hardens" it later
    // by rejecting JSON and silently breaks every console write.
    expect(res.status).toBe(200)
  })

  test('same-origin form posts still work (dev goes through vite on another port, prod is same-origin)', async () => {
    const res = await post({
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': 'same-origin' },
    })
    expect(res.status).toBe(200)
  })

  test('GET is never touched — Cloud Run probes and every read path', async () => {
    const res = await app.request('http://localhost:8788/admin/regions', {
      headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
    })
    expect(res.status).toBe(200)
  })
})

describe('the wiring', () => {
  const src = readFileSync(join(import.meta.dir, 'index.ts'), 'utf8')

  test('csrf() is mounted on /admin/*, BEFORE requireAdmin', () => {
    const c = src.indexOf("app.use('/admin/*', csrf())")
    const a = src.indexOf("app.use('/admin/*', requireAdmin)")
    expect(c).toBeGreaterThan(-1)
    expect(a).toBeGreaterThan(-1)
    // Order matters for what a rejected request costs: refuse the forgery before doing identity work.
    expect(c).toBeLessThan(a)
  })
})
