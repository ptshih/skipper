// Better Auth client for Expo — sessions stored in expo-secure-store, deep-link
// scheme `skipper` (must match app.json `scheme` and the server's trustedOrigins).
import { createAuthClient } from 'better-auth/react'
import { adminClient, anonymousClient } from 'better-auth/client/plugins'
import { expoClient } from '@better-auth/expo/client'
import * as SecureStore from 'expo-secure-store'
// ⚠ AN IMPORT CYCLE, TAKEN KNOWINGLY: auth → offline → api → auth. It is benign under exactly one
// condition — none of the three may use a binding from the other two at MODULE-EVALUATION time
// (`api.ts` reads `API_URL`/`authClient` inside `fetchJson`; `offline.ts` calls `getDrive` inside
// functions), so the live bindings all resolve at call time under either
// entry order. Break that and the cycle stops being free: it becomes an `undefined` at boot in
// whichever module happened to load second, which reads as a mystery crash rather than as a cycle.
// The acyclic alternative is a separate `sign-out.ts` — rejected because it files `signOut` where no
// reader looks for auth, and the guarantee below is only worth having if it is the obvious import.
import { deleteAllDriveDownloads } from './offline'

/** Backend base URL. Override per-environment with EXPO_PUBLIC_API_URL. */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8787'

// Keep the session token DEVICE-ONLY: WHEN_UNLOCKED_THIS_DEVICE_ONLY isn't migrated to a new
// device on restore and isn't synced to iCloud Keychain, so the token doesn't survive an
// uninstall/reinstall or leak to another device. Default keychain accessibility would do both.
// (Option key is `keychainAccessible` per expo-secure-store ~56's SecureStoreOptions.) We only
// need getItem/setItem for the expoClient storage contract; the write carries the option.
const secureStorage = {
  getItem: (key: string) => SecureStore.getItem(key),
  setItem: (key: string, value: string) =>
    SecureStore.setItem(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
}

export const authClient = createAuthClient({
  baseURL: API_URL,
  plugins: [
    // Admin plugin client — mirrors the server `admin()` plugin so `session.user.role` (+ ban fields)
    // is typed. `role === 'admin'` gates the dev-tools screen (and is the server's staged-content
    // preview role, isAdmin). Also exposes admin methods (set-role, ban, …) for a future admin surface.
    adminClient(),
    // Anonymous plugin client — mirrors the server's `anonymous()` (apps/api/src/auth.ts). Two things
    // it buys, both load-bearing: (1) it TYPES `session.user.isAnonymous`, which is what lets
    // isSignedIn() below be a plain structural helper instead of the cast step 7 had to write; (2) it
    // exposes `signIn.anonymous()` — the 1.1 D16 mint — and registers a `/sign-in/anonymous` →
    // `$sessionSignal` atom listener, so useSession() refetches after the mint with no manual refetch.
    // ⚠ It does NOT make an anonymous session "signed in" (INV-9). An anonymous session is a REAL user
    // row that owns nothing and is hard-DELETED at link, so `session` truthiness answers the wrong
    // question; every check goes through isSignedIn() below. Registered BEFORE expoClient() so the
    // storage/deep-link plugin stays last, as it was.
    anonymousClient(),
    expoClient({
      scheme: 'skipper',
      storagePrefix: 'skipper',
      storage: secureStorage,
    }),
  ],
})

export const { signIn, signUp, useSession, updateUser, deleteUser, requestPasswordReset } =
  authClient

/** Better Auth's raw sign-out. PRIVATE on purpose: the wrapped `signOut` below must be the only one
 *  importable from anywhere, or the guarantee it exists to make is opt-in again. */
const clientSignOut = authClient.signOut

/**
 * Sign out — and take this device's saved drives with it.
 *
 * ⚠ THE WRAPPER *IS* THE ENFORCEMENT, which is the whole reason it exists. A downloaded drive is a
 * signed-in rider's private audio sitting in the document dir, and home's signed-out branch still
 * reads disk — so drives left behind are handed to whoever picks the phone up next. Purging at the
 * call sites makes that something every present and future caller has to remember; purging here means
 * a third call site cannot be added that forgets.
 *
 * ⚠ PURGE FIRST, DELEGATE SECOND — never after the await. `@better-auth/expo`'s fetch plugin clears
 * the local session in its `init`, i.e. BEFORE the request leaves the device, so a dead-zone sign-out
 * signs the rider out locally and then rejects. A purge placed after the await is skipped in exactly
 * that case, stranding the audio with no signed-in UI left able to reach it. `deleteAllDriveDownloads`
 * is fully synchronous, so "first" costs nothing and cannot interleave with the request.
 *
 * ⚠ A DISK ERROR MUST NEVER BLOCK SIGN-OUT — hence the swallowed catch. Residue is recoverable (the
 * next sign-out, or the account-deletion flow, re-runs the purge); a rider stuck signed in because a
 * file would not delete is not. Today a throw would be a surprise — `downloadedDriveIds`,
 * `removeDriveDir` and `deleteAllStoredClips` each already swallow their own IO errors — so the catch
 * is here to stop a future edit to that chain from quietly converting itself into "sign-out is broken".
 *
 * ⚠ WHAT THIS MUST NOT PURGE, stated so nobody helpfully adds it: `region-cache.json` (public place
 * names for display — deleting it degrades the offline card for zero privacy gain) and
 * `client-flags.json` (DEVICE facts about what this phone has already shown, never account state —
 * clearing it resurrects a row the rider has already been shown). The anonymous session needs no work:
 * `anon-session.ts`'s attempted latch is module-level and deliberately never reset, so a signed-out
 * rider stays session-less until the next cold start.
 *
 * ⚠ Double-purge is safe, and `settings.tsx`'s explicit call in the deletion flow STAYS: the second
 * pass is a no-op, and a 5.1.1(v) erasure must not silently become a side effect of a `signOut()` that
 * someone could defensibly delete from that function later.
 *
 * The cast is deliberate and preserves Better Auth's signature exactly: it is generic, and its return
 * type is CONDITIONAL on `FetchOptions['throw']` (`throw: true` resolves the data rather than
 * `{ data, error }`). Hand-writing `Promise<void>` would silently narrow a future caller, and the
 * contextually-typed form cannot prove the body's instantiated return assignable to that deferred
 * conditional. Rejection and `{ data, error }` behaviour are untouched — this is a strict superset, so
 * no call site changes.
 */
export const signOut = ((...args: Parameters<typeof clientSignOut>) => {
  try {
    deleteAllDriveDownloads()
  } catch {}
  return clientSignOut(...args)
}) as typeof clientSignOut

/** Where a password-reset link lands. Reset resolves on the WEB, not in the app: a link opened from
 *  a mail client can't be relied on to hand off to a specific app, and a reset that only works on the
 *  device that still has a session isn't a reset at all. The page posts the new password back to this
 *  API. Must be listed in the server's `trustedOrigins` or the request is rejected outright. */
export const PASSWORD_RESET_URL = 'https://skipper.fm/reset-password'

// ⚠ `isSignedIn`, `isAdmin` and their session shape moved to `@skipper/shared` in the 1.1 sweep
// (packages/shared/src/access.ts). They lived here AND in apps/api/src/tiers.ts, and their agreement
// was a comment rather than a fact — while INV-9 makes this predicate decide what every rider sees.
// One implementation, one test, both sides. Re-exported so screens keep importing them from '@/lib/auth',
// which is where a reader looks for "is this rider signed in".
export { isAdmin, isSignedIn } from '@skipper/shared'

