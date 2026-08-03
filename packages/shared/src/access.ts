// ACCESS LEVEL — the one definition of "what may this caller do", shared by the API and the app.
//
// anonymous (no session, or a guest one) → free (a signed-in account). There is no paid tier:
// premium is bought as CREDITS, so every account is `free` and the credit ledger governs what it can
// do (docs/decisions/cut-tiers.md).
//
// ⚠ WHY THIS LIVES IN @skipper/shared RATHER THAN NEXT TO EITHER AUTH. It was two files —
// `apps/api/src/tiers.ts` and a mirror in `apps/mobile/src/lib/auth.ts` — whose agreement was a
// comment ("mirroring the server's tierOf") rather than a fact. That agreement is load-bearing:
// INV-9 says a truthy session is NOT "signed in", because the Better Auth anonymous plugin mints a
// REAL user row, so this predicate decides what every rider sees AND whether the server hands them a
// gated route. A drift between the two sides is invisible on both — and one had already happened:
// the client's `isAdmin` did not exclude anonymous sessions until step 8b. Now there is one
// implementation and one test.
//
// It is deliberately PURE and dependency-free — no Better Auth import, no Zod, no DB. That is what
// lets `apps/api` use it inside a request path that must stay env-free at module load, and what keeps
// it out of the app's bundle-size conversation.

import type { AccessTier } from './enums'

/**
 * The only session fields access decisions read. Structurally satisfied by Better Auth's session on
 * the server and by `useSession()`'s on the client, and by a null/loading one.
 *
 * ⚠ Both fields are optional AND nullable on purpose. `isAnonymous` is absent entirely on a session
 * cached before the anonymous plugin was registered, and `role` is absent unless the admin plugin is
 * installed on that side — so the predicates below must read a MISSING field as the safe answer
 * rather than assuming the shape is complete.
 */
export interface AccessSession {
  user?: { isAnonymous?: boolean | null; role?: string | null } | null
}

/**
 * Derive the access level: no session or a guest one → `anonymous`; any real account → `free`.
 *
 * ⚠ THE THREE BRANCHES ARE NOT STYLE. Unifying the API's and the app's copies forced a choice between
 * two DIFFERENT correctness rules, and each side needs one of them:
 *
 *   - THE CLIENT worries about the field being ABSENT. A session cached in SecureStore before the
 *     anonymous plugin was registered carries no `isAnonymous` at all, and reading that as anonymous
 *     would log a real rider out of their own drives on upgrade. So absent ⇒ `free`.
 *   - THE SERVER worries about it being PRESENT AND WRONG. `entitlements.ts` states the requirement
 *     outright — a degraded session must fail toward `anonymous`, "the secure direction", because
 *     `free` is the tier that opens the five gated routes, mints a FREE_DRIVE_CAP grant, and takes
 *     drive ownership. Written against an anonymous row, those become `credit_entries` and `drives`
 *     rows stranded forever: the plugin HARD-DELETES that user at link with no cascade and no
 *     `purgeUserData` (INV-4), and there is no session left to retry with. So present-and-not-exactly-
 *     `false` ⇒ `anonymous`.
 *
 * ⚠ The first version of this shared helper used `isAnonymous === true` — the client's rule, applied
 * to both — which quietly moved the SERVER in the fail-OPEN direction: any truthy-but-not-`true` value
 * (`1`, `"true"`, even the string `"false"`) resolved to `free`. Better Auth on Postgres yields a real
 * boolean, so it was not reachable; the point is that the rationale was one-sided and nothing would
 * have failed if it flipped again. The two intents do not actually collide — absent and
 * present-but-malformed are different questions — so both are answered here, separately, on purpose.
 */
export function tierOf(session: AccessSession | null | undefined): AccessTier {
  const user = session?.user
  if (!user) return 'anonymous'
  // Absent (never written) ⇒ a real account. The client's rule.
  if (user.isAnonymous == null) return 'free'
  // Present ⇒ only an exact `false` is an account. The server's rule.
  return user.isAnonymous === false ? 'free' : 'anonymous'
}

/**
 * May this caller OWN things — create a drive, hold a credit, list their drives?
 *
 * ⚠ THIS IS INV-9, and it exists as its own name because `session ?` reads like it means this and does
 * not. After the anonymous mint every rider on a warm launch carries a truthy session and owns
 * nothing; worse, the row behind it is HARD-DELETED at link with no cascade (INV-4), so anything
 * written or persisted against it is stranded forever. A bare `session ?` in a screen is a bug.
 */
export function isSignedIn(session: AccessSession | null | undefined): boolean {
  return tierOf(session) === 'free'
}

/**
 * Region-release-gate preview check: an admin hears STAGED (not-yet-released) content, and `isAdmin`
 * is the SOLE bypass of the release filter on every public read path.
 *
 * ⚠ It requires a real account, not merely the role. An anonymous session cannot be an admin because
 * the role lives on an account row — but stating that here rather than relying on it is the point:
 * the client's copy of this check did NOT exclude anonymous until 1.1 step 8b, which put it one
 * server-side role write away from showing staged content to a session nobody authenticated.
 * See docs/decisions/region-release-gate.md.
 */
export function isAdmin(session: AccessSession | null | undefined): boolean {
  return isSignedIn(session) && session?.user?.role === 'admin'
}
