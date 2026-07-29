import { describe, expect, test } from 'bun:test'

// The app and auth modules boot at IMPORT time, and auth.ts deliberately throws without a secret, so
// seed one before importing. Never a real value — nothing here exercises auth crypto, and both db
// clients are lazy proxies (see @skipper/db + ./auth-db), so no DATABASE_URL is needed either.
process.env.BETTER_AUTH_SECRET ??= 'test-only-secret-that-signs-nothing-real'

// Booting auth without a mailer logs its expected "RESET WILL FAIL" warning — real and correct
// there, just noise here. Silence it across the import only.
const origWarn = console.warn
console.warn = () => {}
const { SITE_ORIGIN } = await import('../src/auth')
const app = (await import('../src/index')).default
console.warn = origWarn

const preflight = (path: string, origin: string) =>
  app.fetch(
    new Request(`http://localhost${path}`, {
      method: 'OPTIONS',
      headers: {
        origin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    }),
  )

describe('CORS — open on exactly one route, closed everywhere else', () => {
  // Regression guard for a bug that broke the ONLY route back into a locked-out account. The site's
  // reset form lives on a different origin and POSTs JSON, so the browser PREFLIGHTS it — and the
  // Better Auth mount answers POST/GET only, so the OPTIONS matched nothing and 404'd. The browser
  // then blocked the POST before sending it, and the page fell into its "couldn't reach" branch: a
  // valid link, a typed password, and no way to save it. Nothing fails loudly when this regresses —
  // the API keeps serving every native client perfectly — which is why it needs a test.
  test('the reset POST preflight is allowed from the site origin', async () => {
    const res = await preflight('/api/auth/reset-password', SITE_ORIGIN)
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe(SITE_ORIGIN)
    expect(res.headers.get('access-control-allow-methods')).toContain('POST')
    // The JSON content-type is what forces the preflight in the first place; if it isn't allowed the
    // browser still blocks the POST, even though the OPTIONS itself came back 204.
    expect(res.headers.get('access-control-allow-headers')).toContain('content-type')
  })

  test('any other origin gets NO allow-origin — the allowlist is exact, never a wildcard', async () => {
    const res = await preflight('/api/auth/reset-password', 'https://evil.example')
    // The deny is the ABSENT header, not the status: it's the missing allow-origin that makes the
    // browser refuse, so asserting on the status alone would pass even with the door wide open.
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  test('the rest of /api/auth/* stays closed to browsers', async () => {
    // Sign-in is the one that would matter most if it leaked: it takes credentials, and it has no
    // business being callable from a page. Only the reset route was ever opened.
    const res = await preflight('/api/auth/sign-in/email', SITE_ORIGIN)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  test('the data routes stay closed too', async () => {
    // /health is env-free (no DB), so this asserts the posture without touching Neon.
    const res = await app.fetch(new Request('http://localhost/health', { headers: { origin: SITE_ORIGIN } }))
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })
})
