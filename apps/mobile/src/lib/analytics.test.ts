// The privacy contract, AS TESTS. Two things live here and they guard the same claim — the App
// Privacy label's `Product Interaction: Linked = No` row, which is already filed with Apple:
//
//   1. sanitizeScreenPath — the one function keeping RECORD LOCATORS out of PostHog. A resolved
//      `/drives/<uuid>` carries a real `drives.id`, which sits beside `drives.user_id` and is
//      therefore joinable to a person server-side. That leak shipped once and was closed; it had no
//      test, so nothing but memory was holding it closed.
//   2. A source-text tripwire for the identify()/reset() ban. Both are wire-level product
//      invariants, not style: the anonymous auth row is HARD-DELETED at link-to-account, so
//      PostHog's per-device distinct_id is the only spine spanning the signup wall. See the long
//      comments in analytics.tsx.
//
// ⚠ These are the LOAD-BEARING half of the analytics work. Everything else in the instrumentation
// step is emitters, and an emitter that is missing looks exactly like one that fired (track() is
// `posthog?.capture(...)`, inert without a key) — so what CAN be tested must be.
//
// Runs under `bun test`, which the ROOT `bun run check` executes (`test` = `bun --filter '*' test`,
// and mobile's own `test` script is `bun test`). ⚠ That is why the tripwire lives here and NOT in
// scripts/check-tokens.ts: the root check does NOT run mobile's `lint:tokens`, so a guard placed
// there is invisible to the gate most agents actually run.
import { expect, mock, test } from 'bun:test'
import { Glob } from 'bun'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ⚠ WHY THE MOCKS. This module cannot be imported for real under `bun test`: analytics.tsx imports
// posthog-react-native and expo-router, and both pull in react-native, whose index.js is Flow-typed
// (`import typeof * as …`) and is a hard PARSE error for bun — not a missing native module, an
// unparseable file. That is exactly why every other tested module in src/lib is a pure `*-util.ts`;
// sanitizeScreenPath cannot follow that pattern because it is wired to the provider beside it.
//
// ⚠ mock.module is PROCESS-WIDE and outlives this file — a mock registered here is served to every
// later test file in the same run. That is acceptable ONLY because these two specifiers are
// unloadable under bun today, so the stub can never shadow a working import; it can only turn a
// crash into a stub. Do not extend this list to a module some other test could legitimately load.
//
// The stub implements ONLY the four methods analytics.tsx is allowed to call. That is deliberate
// belt-and-braces: a banned call added at module scope crashes this file's import outright, before
// the text tripwire below even gets a chance. (Verified: the tripwire catches it either way.)
mock.module('posthog-react-native', () => ({
  PostHog: class {
    register() {}
    capture() {}
    captureException() {}
    screen() {}
  },
  PostHogProvider: () => null,
}))
mock.module('expo-router', () => ({ usePathname: () => '/' }))

// Metro injects `__DEV__`; bun does not. analytics.tsx only reads it when a PostHog key is present,
// so this matters solely on a machine that has one — define it so the test is deterministic either
// way rather than green-by-absence-of-a-key.
;(globalThis as { __DEV__?: boolean }).__DEV__ = true

// Static ESM imports are hoisted ABOVE the mock.module calls above, so the real (unparseable)
// modules would load first. A dynamic import after registration is the only correct order.
const { sanitizeScreenPath } = await import('./analytics')

const UUID = '9ac50db5-1c2d-4e3f-8a9b-0123456789ab'

test('a uuid segment collapses to :id — the drives.id leak that shipped once', () => {
  expect(sanitizeScreenPath(`/drives/${UUID}`)).toBe('/drives/:id')
  // The regex is case-insensitive on purpose: an uppercased id is the same record locator.
  expect(sanitizeScreenPath(`/drives/${UUID.toUpperCase()}`)).toBe('/drives/:id')
})

test('a numeric segment collapses to :n', () => {
  expect(sanitizeScreenPath('/drives/42')).toBe('/drives/:n')
})

test('several id segments in one path all collapse', () => {
  expect(sanitizeScreenPath(`/drives/${UUID}/stops/7/play`)).toBe('/drives/:id/stops/:n/play')
})

test('a path with no ids is passed through unchanged — $screen must stay readable', () => {
  expect(sanitizeScreenPath('/settings')).toBe('/settings')
  expect(sanitizeScreenPath('/drives/new/confirm')).toBe('/drives/new/confirm')
})

test('the root path survives', () => {
  // '/'.split('/') is ['', ''] — the join must put it back, not return '' (an empty $screen name).
  expect(sanitizeScreenPath('/')).toBe('/')
})

// --- the identify()/reset() tripwire ---------------------------------------------------------
//
// Source text, not behaviour, because behaviour is untestable here: with no EXPO_PUBLIC_POSTHOG_KEY
// the client is `undefined` and EVERY call is a silent no-op, so a runtime assertion would pass on a
// machine where the ban had already been broken.
//
// ⚠ The needles are deliberately BROAD — any `.identify(` / `.reset(` on any receiver. A false
// positive (some unrelated `.reset()` — an Animated composite, say) is the intended cost: it forces
// a conscious edit of THIS rule with a reason, instead of a quiet re-broadening of the ban. If that
// happens, narrow the rule here; do not delete it.
const MOBILE_ROOT = resolve(import.meta.dir, '../..') // src/lib → apps/mobile
const SCAN_DIRS = ['app', 'src']
const BANNED: { re: RegExp; why: string }[] = [
  {
    re: /\.identify\s*\(/,
    why: 'PostHog person-identification is BANNED. The anonymous auth row is hard-deleted at link, so the per-device distinct_id is the only spine across the signup wall — and the filed App Privacy label asserts no such call exists (docs/guides/app-store-submission.md §8).',
  },
  {
    re: /\.reset\s*\(/,
    why: 'PostHog reset() is BANNED (founder call). It is NOT gated by personProfiles:"never", so it really would wipe the device spine the funnel runs on — while erasing nothing account-scoped, because nothing was ever linked. Account erasure is purgeUserData’s job.',
  },
]

/** Blank out comments so the prose EXPLAINING the ban can't trip the ban. Line-oriented, same shape
 *  as scripts/check-tokens.ts — good enough for source that never puts `//` inside a string. */
function stripComments(text: string): string[] {
  let inBlock = false
  return text.split('\n').map((raw) => {
    let line = raw
    if (inBlock) {
      const end = line.indexOf('*/')
      if (end === -1) return ''
      line = line.slice(end + 2)
      inBlock = false
    }
    line = line.replace(/\/\*.*?\*\//g, '')
    const open = line.indexOf('/*')
    if (open !== -1) {
      inBlock = true
      line = line.slice(0, open)
    }
    const lc = line.indexOf('//')
    return lc === -1 ? line : line.slice(0, lc)
  })
}

test('no identify()/reset() call anywhere in app/ or src/', () => {
  const hits: string[] = []
  for (const dir of SCAN_DIRS) {
    for (const rel of new Glob('**/*.{ts,tsx}').scanSync({ cwd: `${MOBILE_ROOT}/${dir}` })) {
      const path = `${dir}/${rel}`
      // Sync read: `scanSync` + a sync body keeps the whole tripwire inside one test body, so a
      // throw is a FAILED test rather than an unhandled rejection between tests.
      const text = readFileSync(`${MOBILE_ROOT}/${path}`, 'utf8')
      stripComments(text).forEach((line, i) => {
        for (const { re, why } of BANNED) {
          if (re.test(line)) hits.push(`${path}:${i + 1}  ${line.trim()}\n    → ${why}`)
        }
      })
    }
  }
  expect(hits).toEqual([])
})

test('the tripwire actually scans files — a zero-file scan would pass vacuously', () => {
  // Without this, deleting a directory or breaking the path math turns the guard above into a
  // green no-op. The exact count is volatile; that it is not zero is the invariant.
  let files = 0
  for (const dir of SCAN_DIRS) {
    files += Array.from(new Glob('**/*.{ts,tsx}').scanSync({ cwd: `${MOBILE_ROOT}/${dir}` })).length
  }
  expect(files).toBeGreaterThan(20)
})
