import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { CLIENT_CAPS, CLIENT_IDENTITY_HEADER, clientCan } from '@skipper/shared'
import { withClient } from '../src/client'
import type { ApiEnv } from '../src/entitlements'

// The middleware in isolation: a throwaway app that echoes what it stashed on the context. Keeps the
// plumbing test independent of the real app's boot (auth secret, route ordering, etc.).
const probe = new Hono<ApiEnv>()
probe.use('*', withClient)
probe.get('/echo', (c) => {
  const id = c.get('client')
  return c.json({ version: id.version, caps: [...id.caps], area: clientCan(id, CLIENT_CAPS.area) })
})

interface Echo {
  version: string | null
  caps: string[]
  area: boolean
}

async function echo(headers?: Record<string, string>): Promise<Echo> {
  const res = await probe.fetch(new Request('http://localhost/echo', { headers }))
  return (await res.json()) as Echo
}

describe('withClient — per-request client identity', () => {
  test('parses a well-formed header onto the context', async () => {
    const body = await echo({ [CLIENT_IDENTITY_HEADER]: 'v=1.2.0; caps=area' })
    expect(body).toEqual({ version: '1.2.0', caps: ['area'], area: true })
  })

  // The permanent case, not a transitional one: every rider installed before this shipped sends
  // nothing and always will, so "absent" must read as the LEAST capable client.
  test('an absent header yields the least-capable client, never a permissive default', async () => {
    const body = await echo()
    expect(body).toEqual({ version: null, caps: [], area: false })
  })

  test('a malformed or hostile header degrades instead of erroring', async () => {
    for (const raw of ['', 'garbage', ';;;', 'v=', 'caps=', 'v=' + 'x'.repeat(400)]) {
      const res = await probe.fetch(
        new Request('http://localhost/echo', { headers: { [CLIENT_IDENTITY_HEADER]: raw } }),
      )
      expect(res.status).toBe(200)
      expect(((await res.json()) as Echo).area).toBe(false)
    }
  })

  test('a client may announce a capability this server has never heard of', async () => {
    const body = await echo({ [CLIENT_IDENTITY_HEADER]: 'v=9.9.9; caps=area,warpdrive' })
    expect(body.area).toBe(true)
    expect(body.caps).toContain('warpdrive')
  })
})

// A MOUNTED SUB-APP inherits the parent's context. `/drives` is a separate Hono instance
// (`app.route('/drives', driveRoutes)`, index.ts), and ApiEnv promises routes may read `client`
// unconditionally — so if a sub-app did NOT see what the parent's '*' middleware set, that promise
// would be a landmine for the first drive route that reads it. Proven, not assumed.
describe("withClient — a mounted sub-app sees the parent middleware value", () => {
  test('c.get(\'client\') is populated inside a sub-app mounted after the middleware', async () => {
    const sub = new Hono<ApiEnv>()
    sub.get('/inner', (c) => c.json({ area: clientCan(c.get('client'), CLIENT_CAPS.area) }))
    const parent = new Hono<ApiEnv>()
    parent.use('*', withClient)
    parent.route('/sub', sub)

    const res = await parent.fetch(
      new Request('http://localhost/sub/inner', {
        headers: { [CLIENT_IDENTITY_HEADER]: 'v=1.1.0; caps=area' },
      }),
    )
    expect(res.status).toBe(200)
    expect(((await res.json()) as { area: boolean }).area).toBe(true)
  })
})

describe('withClient — mounted globally, so it must never break a route', () => {
  // It runs ahead of EVERY route including /health, which is deliberately env-free and DB-free and is
  // the intended target of the uptime check. A throw here would 500 the whole API.
  test('GET /health still answers with a hostile identity header', async () => {
    process.env.BETTER_AUTH_SECRET ??= 'test-only-secret-that-signs-nothing-real'
    const origWarn = console.warn
    console.warn = () => {}
    const app = (await import('../src/index')).default
    console.warn = origWarn

    // ⚠ Not a whitespace-only value here: `new Request` rejects that at construction
    // ("invalid value"), so it is unreachable over the wire rather than untested.
    for (const raw of ['v=' + 'x'.repeat(9999), '!!!;;;===', 'caps=' + 'a,'.repeat(5000)]) {
      const res = await app.fetch(
        new Request('http://localhost/health', { headers: { [CLIENT_IDENTITY_HEADER]: raw } }),
      )
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true })
    }
  })
})
