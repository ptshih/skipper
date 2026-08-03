// Shared, INERT test fixtures.
//
// ⚠ NOTHING IN THIS FILE MAY HAVE A SIDE EFFECT — no `mock.module`, no imports of `../src/*`, no
// top-level await. Bun's module-mock registry is PROCESS-WIDE (one registry for the whole run — the
// 96-pass/9-fail incident), so a mock installed from a shared helper would apply to every file that
// transitively imports it, including the ones asserting the REAL behaviour. The per-file `driving`
// flag plus the spread-and-delegate rule is what makes those mocks safe, and both only work when they
// stay in the file that owns them. This module holds only values.
//
// It is deliberately NOT named `*.test.ts`, so `bun test` does not collect it as a suite.

/** The session shape the API's mocks answer with — structurally what `tierOf` reads. */
export type FakeSession = { user: { id: string; isAnonymous: boolean; role: string | null } }

/**
 * ⚠ THE ANONYMOUS FIXTURE IS LOAD-BEARING IN TWO DIFFERENT WAYS, AND THEY ARE NOT THE SAME FIELD.
 *
 * `isAnonymous: true` is what makes the access tests real TODAY: it is what `tierOf` reads, so it is
 * what every gate and every backstop keys on. MUTATION-CHECKED 2026-08-01 — flipping it to `false`
 * against an UNMODIFIED drives.ts turns 8 tests red. If it ever stops doing that, the session mock is
 * not driving `tierOf` and those files are theatre.
 *
 * The TRUTHY `id` is the other half, and it guards a FUTURE regression rather than a present one.
 * After the anonymous mint (D16) an anonymous session IS a real `user` row with a real id, so an
 * id-PRESENCE backstop (`!session?.user.id`) is `false` forever and refuses nobody — that is INV-15's
 * whole sentence. drives.ts keys its backstops on TIER instead (E-E), which is why an empty id here
 * does NOT currently mask a dropped gate (checked: it stays red). Keep the id truthy anyway: the day
 * someone "simplifies" a backstop back to `!userId`, an empty-id fixture would make that revert look
 * green. Do not zero it out to "keep the fixture minimal".
 *
 * ⚠ SHARED BY THREE FILES ON PURPOSE. These three constants were written out identically in
 * anchor-allowlist / drive-body-caps / drive-access, but this reasoning existed in only ONE of them —
 * so two of the three read as arbitrary strings a later edit could "tidy" without ever seeing why the
 * id is not empty.
 */
export const ANON: FakeSession = {
  user: { id: 'anon-00000000-0000-4000-8000-000000000000', isAnonymous: true, role: 'user' },
}

/** An ACCOUNT — `POST /drives` is reachable only by one (D15/INV-15). */
export const ACCOUNT: FakeSession = {
  user: { id: 'acct-00000000-0000-4000-8000-000000000000', isAnonymous: false, role: 'user' },
}
