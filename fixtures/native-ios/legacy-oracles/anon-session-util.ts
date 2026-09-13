// The DECISION half of the D16 anonymous mint (1.1 step 8c). Pure and native-free — no expo, no
// better-auth, no ./auth import — so it runs under `bun test`, the same split as connectivity-util.ts
// / gps-util.ts / planner-util.ts. ./anon-session owns the CALL; this file owns the RULE.
//
// ⚠ INV-13: nothing here logs. A session object is rider identity.

/** The ONE mapping from a Better Auth session to `MintInputs.hasSession`.
 *
 *  ⚠ THIS IS THE FILE'S MOST DANGEROUS LINE, and it exists as its own exported function so it is
 *  testable — inlined at the call site as `!!session` it would look too obvious to test, which is
 *  exactly how it would come to be rewritten.
 *
 *  The rule is ANY session — anonymous OR real. The bug it forecloses is the one the plugin itself
 *  invites: `/sign-in/anonymous` guards ONLY on `isAnonymous`
 *  (better-auth 1.6.23 dist/plugins/anonymous/index.mjs:44 — it throws
 *  ANONYMOUS_USERS_CANNOT_SIGN_IN_AGAIN_ANONYMOUSLY) and performs NO check whatsoever for a real
 *  one: it goes straight to `internalAdapter.createUser` → `createSession` → `setSessionCookie`
 *  (index.mjs:47-62). So a client that mirrors the server's guard — "don't mint if already
 *  anonymous" — mints over a SIGNED-IN rider and overwrites their cookie. From the app's side that
 *  rider has just lost their account, their drives and their credits, with no error and nothing in
 *  the UI to explain it. Read as `!!session?.user`, there is no such path.
 *
 *  ⚠ Note what this deliberately is NOT: `isSignedIn()` (INV-9). That helper answers a different
 *  question — "may this rider own things?" — and using it here would invert the anonymous case into
 *  a mint loop against a server that will only ever answer BAD_REQUEST.
 *
 *  Structurally typed (not the plugin's `User`) so this file stays native-free; `isAnonymous` is
 *  named only to document that its VALUE is intentionally ignored. */
export function hasAnySession(
  session: { user?: { isAnonymous?: boolean | null } | null } | null | undefined,
): boolean {
  return !!session?.user
}

export interface MintInputs {
  /** Better Auth's `useSession().isPending` — true until the first /get-session settles. */
  isPending: boolean
  /** Is there ANY session, anonymous OR real? Always via `hasAnySession()`. ⚠ NOT "is signed in". */
  hasSession: boolean
  /** `useIsOffline()`'s verdict. Fails OPEN — unknown reads as online (connectivity-util.ts). */
  offline: boolean
  /** Has an attempt already been made in this process? (the module-level guard in ./anon-session) */
  attempted: boolean
  /** Did the session read itself FAIL? (`useSession().error`) ⚠ An error means "we do not KNOW
   *  whether a session exists", which is not the same as "there is none" — see the clause below. */
  sessionErrored: boolean
}

/** ⚠ EVERY CLAUSE IS LOAD-BEARING.
 *
 *  `hasSession` — see `hasAnySession` above. This is the clause standing between a rider and losing
 *  their own account.
 *
 *  `isPending` must be false FIRST, and a pending read is NOT "no session". The expo client seeds
 *  the session atom synchronously from its local cache but never clears `isPending` while doing so
 *  (@better-auth/expo 1.6.23 dist/client.js:274-284 sets only `data`/`error`), and it seeds only
 *  when the CACHED copy's `expiresAt` is still in the future. So on a cold start there is a window
 *  where `data` is null purely because the cache was stale — the cookie, and the real session behind
 *  it, are fine. Acting on that window mints over a live account.
 *
 *  `attempted` never retries in-process. A mint loop is exactly what INV-14's `/sign-in/anonymous`
 *  rule exists to stop, and a failed mint costs the rider nothing: POST /drives/plan sends no cookie
 *  at all (src/lib/planner.ts) and /drives/propose is open to anonymous after 8a. The mint is a
 *  CONVENIENCE — a limiter-bucket key and better-auth's link-at-signup path — never a precondition.
 *
 *  `offline` is judged here, but the CALLER sets `attempted` only when an attempt is actually made.
 *  That split is the whole self-heal: a launch in a dead zone does not burn the one shot, and the
 *  offline→online edge re-runs the effect naturally. No retry machinery needed.
 *
 *  `sessionErrored` closes the gap `isPending` cannot: once the read has SETTLED, better-auth reports
 *  a failed /get-session as `{ data: null, error }` — indistinguishable, on `data` alone, from an
 *  honest "no session". A fetch that threw with no usable local cache seed therefore reads as "this
 *  rider has nothing" and mints, even though their cookie and their account are perfectly fine. The
 *  same shape covers a locked device, where SecureStore is unreadable
 *  (WHEN_UNLOCKED_THIS_DEVICE_ONLY, ./auth) and both the cookie and the cache read null. Minting is
 *  the irreversible direction — an orphan row nothing may ever reap (INV-14) — so an UNKNOWN answer
 *  must behave like "yes, there is one", never like "no". Not minting costs nothing (see `attempted`). */
export const shouldMintAnonymous = (i: MintInputs): boolean =>
  !i.attempted && !i.isPending && !i.hasSession && !i.offline && !i.sessionErrored
