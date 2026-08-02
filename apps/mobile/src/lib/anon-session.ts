// 1.1 D16 — the app mints an anonymous Better Auth session at app open, so a rider who has never
// signed up still has a stable identity for the /drives/propose limiter bucket and for better-auth's
// link-at-signup path.
//
// ⚠ It is a CONVENIENCE, never a precondition. POST /drives/plan sends no cookie at all by
// construction (planner.ts does not import authClient) and /drives/propose is open to anonymous
// after step 8a, so a mint that never lands degrades to exactly nothing. INV-12 already records that
// the session key "is a convenience, not a control — the IP key is the real bound." Nothing in the
// app may grow a dependency on this having succeeded.
//
// ⚠ INV-13: no logging, ever — not the outcome, not the error. ⚠ INV-4: the row this mints is
// HARD-DELETED at link with no cascade and no purgeUserData, so nothing anywhere may persist or key
// state on the id it produces. The RULE lives in ./anon-session-util (pure, tested); this file owns
// only the call.
import { useEffect } from 'react'
import { shouldMintAnonymous, hasAnySession } from './anon-session-util'
import { signIn, useSession } from './auth'
import { useIsOffline } from './connectivity'

// ⚠ MODULE-LEVEL, deliberately not a ref. It has to survive a remount of the mounting component and
// a Fast-Refresh cycle, and two renders in the same tick must not both fire — the second would earn
// a BAD_REQUEST at best (the server refuses a caller already holding an anonymous session) and a
// second orphan user row at worst. ⚠ Never reset it: a rider who signs OUT stays session-less until
// the next cold start, which is the only honest reading of an explicit sign-out.
let attempted = false

/** Fires the D16 mint at most once per process. Renders nothing, returns nothing, and has no
 *  rider-facing failure state by design — see the file header. */
export function useAnonymousMint(): void {
  const { data: session, isPending, error: sessionError } = useSession()
  const offline = useIsOffline()

  useEffect(() => {
    const hasSession = hasAnySession(session)

    // ⚠ A SESSION WE DID NOT MINT ALSO CONSUMES THE ONE SHOT, and this is a correctness fix, not
    // bookkeeping. Spending `attempted` only on an actual mint left the launch-signed-in path with it
    // still `false` — so the moment that rider signed out, or DELETED THEIR ACCOUNT, the effect
    // re-ran against `hasSession: false` and minted a brand-new server-side row. A rider who had just
    // exercised their App Store 5.1.1(v) erasure would immediately be handed a fresh identity they
    // cannot delete from inside the app (RISK-3). It also made the ⚠ above ("a rider who signs OUT
    // stays session-less until the next cold start") false in exactly the case it was written for.
    // Consuming the shot as soon as the session state SETTLES either way makes that sentence true.
    if (!isPending && hasSession) {
      attempted = true
      return
    }

    const inputs = { isPending, hasSession, offline, attempted, sessionErrored: !!sessionError }
    if (!shouldMintAnonymous(inputs)) return

    // ⚠ SET SYNCHRONOUSLY, BEFORE the await. Between an `await` and its resumption React can run
    // this effect again (a session tick, a connectivity tick), and both passes would read
    // `attempted: false`.
    attempted = true

    // Fire-and-forget, and BOTH outcomes are swallowed on purpose. The better-auth client resolves
    // `{ data, error }` rather than throwing on a 4xx, so the .catch() is only for a transport
    // failure; neither branch has anywhere to go. There is no retry (see `attempted` above) and
    // nothing to show the rider.
    //
    // No manual refetch() is needed on success: the expo client's onSuccess hook persists any
    // response carrying better-auth cookies and notifies $sessionSignal
    // (@better-auth/expo dist/client.js:294-304), and anonymousClient() registers its own
    // /sign-in/anonymous → $sessionSignal listener (better-auth dist/plugins/anonymous/client.mjs:13-16),
    // so useSession() re-reads on its own.
    void signIn.anonymous().catch(() => {})
  }, [isPending, session, offline, sessionError])
}
