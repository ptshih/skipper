/**
 * Pins the admin grant ceiling to ONE value across the server/client boundary.
 *
 * `MAX_ADMIN_GRANT` lives in server/index.ts and is the authority — the route 400s above it whatever
 * the UI allows. The dialog needs the same number for its validator, its `max` attribute and its
 * "1–N" copy, and it CANNOT import it: the client tsconfig includes only `src`, and the root tsconfig
 * excludes `client`. So the value is written twice on purpose.
 *
 * Two literals that must agree, with no type connecting them, is exactly the drift this repo has been
 * bitten by before — so it gets the same treatment as jobs.test.ts (which greps its dispatch targets
 * off disk): read both files as text and assert they still say the same thing.
 *
 * Drift is not loud. If the client's number goes UP, grants above the server's ceiling look valid,
 * submit, and come back 400 with the operator unable to tell why. If it goes DOWN, headroom the
 * server allows is silently unreachable. Neither shows up in a typecheck or a build.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (rel: string) => readFileSync(join(import.meta.dir, '..', rel), 'utf8')

describe('admin grant ceiling', () => {
  const server = read('server/index.ts')
  const client = read('client/src/views/UsersView.tsx')

  test('server declares exactly one MAX_ADMIN_GRANT', () => {
    const decls = server.match(/^const MAX_ADMIN_GRANT = (\d+)$/gm) ?? []
    expect(decls).toHaveLength(1)
  })

  test('the client dialog uses the same number, and no bare literal beside it', () => {
    const serverVal = server.match(/^const MAX_ADMIN_GRANT = (\d+)$/m)?.[1]
    const clientVal = client.match(/^const MAX_GRANT = (\d+)$/m)?.[1]
    expect(serverVal).toBeDefined()
    expect(clientVal).toBeDefined()
    expect(clientVal).toBe(serverVal!)

    // the three places that used to hardcode it must go through the const
    expect(client).toContain('n <= MAX_GRANT')
    expect(client).toContain('max={MAX_GRANT}')
    expect(client).toContain('1–{MAX_GRANT}')
  })

  test('the grant route still refuses an anonymous account', () => {
    // INV-4: a credit written against an anonymous id is unspendable and is deleted at signup.
    expect(server).toContain('anonymous_account')
    expect(server).toMatch(/if \(account\.isAnonymous\)/)
  })

  test('the grant is exactly-once: a client-supplied key plus ON CONFLICT DO NOTHING', () => {
    const from = server.indexOf("app.post('/admin/users/:id/credits'")
    const whole = server.slice(from)
    const route = whole.slice(0, whole.indexOf('\napp.'))
    // ⚠ Strip comments first. The route's own ⚠ note QUOTES the old random-key line to explain why it
    // went, so a naive grep over the raw text matches the prose and fails on correct code — which is
    // exactly what happened when this test was written.
    const code = route.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

    expect(code).toContain('admin_grant:${clientKey}')
    expect(code).toContain('onConflictDoNothing')
    // the random-per-request key that made this the one non-idempotent ledger write is gone
    expect(code).not.toContain('crypto.randomUUID()')
  })
})
