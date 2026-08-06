// SOURCE ASSERTIONS over the API client's anonymity decisions.
//
// ⚠ A DELIBERATE EXCEPTION, NOT A PATTERN — same rule as ./home-source.test.ts: asserting on source
// text normally pins spelling rather than behaviour. It earns its place only for defects with NO
// RUNTIME SYMPTOM, and it is used here for a second reason too: `./api` cannot be imported under
// `bun test` at all (it pulls `authClient` → expo-secure-store), so there is no behavioural seam to
// test against. The rule for adding to this file: if you can see the defect by launching the app, it
// does not go here.
//
// ⚠ THE DEFECT THIS WAS WRITTEN FOR, because it is the definition of "no runtime symptom".
// `getBootstrap` carried `anonymous: true` from 2026-08-04 (`5d842738`) to 2026-08-06. That flag
// omits the session cookie, so the server saw every cold open as anonymous and applied the release
// gate — `isAdmin` is its SOLE bypass and could never fire. The app quietly showed one region instead
// of two. Nothing threw, nothing logged, `bun run check` stayed green, and the screen looked
// completely normal: one region is a perfectly plausible state. It was found by a human noticing a
// region was missing, two days later, on both a dev build and TestFlight.
//
// The SERVER half of the same guarantee lives in `apps/api/test/regions-cache.test.ts`.
import { describe, expect, test } from 'bun:test'

const RAW = await Bun.file(new URL('./api.ts', import.meta.url)).text()
const PLANNER = await Bun.file(new URL('./planner.ts', import.meta.url)).text()

// ⚠ COMMENTS STRIPPED BEFORE ASSERTING, and this file would fail without it: the comment explaining
// the fix says `anonymous: true` several times, so an un-stripped search matches the prose that
// documents the rule rather than any code breaking it. (./home-source.test.ts hit the same thing.)
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const API = strip(RAW)

describe('the cold open must send the session', () => {
  // Isolate the declaration so this cannot be satisfied — or broken — by an unrelated call.
  const decl = API.slice(API.indexOf('export const getBootstrap'))
    .split('\n\n')[0]

  test('getBootstrap fetches /bootstrap', () => {
    expect(decl).toContain('/bootstrap?rotation=')
  })

  test('getBootstrap does NOT mark itself anonymous', () => {
    // The whole bug, in one assertion. `anonymous: true` here strips the cookie, which strips the
    // session, which strips `isAdmin`, which strips staged regions — with no error anywhere.
    expect(decl).not.toContain('anonymous')
  })
})

describe('the anonymity rule the fix must not erode', () => {
  // ⚠ The counterweight. The fix above loosens one call, so this pins the thing that must NOT be
  // loosened with it: the planner carries what the rider TYPED, and it is anonymous BY CONSTRUCTION
  // rather than by a flag someone can forget — it does not import the auth client at all.
  test('planTurn cannot send a cookie: planner.ts never imports authClient', () => {
    expect(strip(PLANNER)).not.toContain('authClient')
  })

  test('planTurn omits credentials explicitly', () => {
    // Belt to that brace: expo/fetch injects HTTPCookieStorage cookies natively on 'include'.
    expect(strip(PLANNER)).toContain("credentials: 'omit'")
  })
})
