/**
 * Pins the VENDOR assumption that account erasure now rests on.
 *
 * `purgeUserData` moved off `user.deleteUser.beforeDelete` and onto
 * `databaseHooks.user.delete.before` (2026-08-02) because the former fires on the two SELF-SERVE
 * delete routes only, while `POST /api/auth/admin/remove-user` — mounted and live, since the admin
 * plugin is registered unconditionally — went straight to `internalAdapter.deleteUser` and orphaned
 * the rider's `drives` and `credit_entries` behind a vanished user id. No FK spans the auth-pool
 * boundary, so nothing cascades and nothing else would ever clean them up.
 *
 * ⚠ THAT FIX DEPENDS ON AN IMPLEMENTATION DETAIL OF BETTER AUTH, not on its public contract:
 * `internalAdapter.deleteUser` happens to route through `deleteWithHooks(..., 'user')`, which runs
 * `hooks.user.delete.before`. If an upgrade changes that, erasure silently stops running on every
 * path — no error, no failing request, just orphaned personal data and an App Store 5.1.1(v)
 * problem discovered by someone else. A green typecheck would not notice.
 *
 * So this reads the INSTALLED source and asserts the chain still holds, in the same shape as
 * `apps/admin/server/jobs.test.ts` (which greps its dispatch targets off disk). It is deliberately
 * a source-text assertion: there is no way to exercise this without a real database and a real
 * Better Auth instance, and a test that needed both would not run in this suite.
 *
 * If this fails after a dependency bump: re-read `better-auth/dist/db/internal-adapter.mjs` and
 * decide where the purge belongs now — do NOT relax the assertions to make it pass.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const PKG = dirname(Bun.resolveSync('better-auth/package.json', import.meta.dir))
const read = (rel: string) => readFileSync(join(PKG, rel), 'utf8')

describe('better-auth: the delete path our purge hangs off', () => {
  test('internalAdapter.deleteUser routes the user row through deleteWithHooks', () => {
    const src = read('dist/db/internal-adapter.mjs')
    const body = src.slice(src.indexOf('deleteUser: async (userId)'))
    expect(body).toContain('deleteWithHooks')
    // the 'user' model specifically — sessions/accounts go through deleteManyWithHooks and are
    // Better Auth's own rows, not ours.
    expect(body.slice(0, body.indexOf('createSession'))).toMatch(/deleteWithHooks\(\[[\s\S]*?\],\s*["']user["']/)
  })

  test('deleteWithHooks invokes the delete.before database hook', () => {
    const src = read('dist/db/with-hooks.mjs')
    const fn = src.slice(src.indexOf('async function deleteWithHooks'))
    expect(fn).toMatch(/hooks\[model\]\?\.delete\?\.before/)
  })

  test('the admin plugin removeUser goes through internalAdapter.deleteUser (so the hook covers it)', () => {
    const src = read('dist/plugins/admin/routes.mjs')
    expect(src).toContain('internalAdapter.deleteUser')
  })

  test('the anonymous plugin link-cleanup uses the same call (so the hook covers it too)', () => {
    const src = read('dist/plugins/anonymous/index.mjs')
    expect(src).toContain('internalAdapter.deleteUser')
  })

  test('deleteUser.beforeDelete still fires ONLY on the self-serve routes — the reason we moved', () => {
    const selfServe = read('dist/api/routes/update-user.mjs')
    expect(selfServe).toContain('deleteUser?.beforeDelete')
    // If a future version starts calling beforeDelete from the admin plugin too, this flips and the
    // move becomes belt-and-braces rather than the fix. Worth knowing either way.
    expect(read('dist/plugins/admin/routes.mjs')).not.toContain('beforeDelete')
  })
})

describe('our wiring', () => {
  const auth = readFileSync(join(import.meta.dir, '..', 'src', 'auth.ts'), 'utf8')

  test('purgeUserData is wired to the database delete hook, not the lifecycle hook', () => {
    // the databaseHooks path is present…
    expect(auth).toMatch(/delete:\s*\{\s*[\s\S]{0,200}?before:\s*async \(user\)/)
    expect(auth).toContain('purgeUserData')
    // …and the old home is gone, so the purge cannot silently run only on self-serve again.
    expect(auth).not.toMatch(/beforeDelete:\s*async/)
  })
})
