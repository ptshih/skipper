// Better Auth client for Expo — sessions stored in expo-secure-store, deep-link
// scheme `skipper` (must match app.json `scheme` and the server's trustedOrigins).
import { createAuthClient } from 'better-auth/react'
import { adminClient, anonymousClient } from 'better-auth/client/plugins'
import { expoClient } from '@better-auth/expo/client'
import * as SecureStore from 'expo-secure-store'

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

export const { signIn, signUp, signOut, useSession, updateUser, deleteUser, requestPasswordReset } =
  authClient

/** Where a password-reset link lands. Reset resolves on the WEB, not in the app: a link opened from
 *  a mail client can't be relied on to hand off to a specific app, and a reset that only works on the
 *  device that still has a session isn't a reset at all. The page posts the new password back to this
 *  API. Must be listed in the server's `trustedOrigins` or the request is rejected outright. */
export const PASSWORD_RESET_URL = 'https://skipper.fm/reset-password'

/** The session fields the two gates below read. Structurally satisfied by useSession()'s session, and
 *  by a null/loading one. Deliberately the same shape as the server's `TierSession`
 *  (apps/api/src/tiers.ts) — these helpers are that file's client-side mirror. */
interface GateSession {
  user?: { isAnonymous?: boolean | null; role?: string | null } | null
}

/** ⚠ THE ONE client-side "is this rider signed in?" (INV-9), mirroring the server's `tierOf`
 *  (apps/api/src/tiers.ts). Moved here from app/index.tsx in 1.1 step 8b, which is where it was
 *  written to end up.
 *
 *  ⚠ A truthy `session` is NOT "signed in": the Better Auth anonymous plugin mints a REAL user row,
 *  so after D16's mint every rider on a warm launch has a perfectly truthy session and owns nothing —
 *  they cannot list drives and cannot hold a credit (INV-4: that row is hard-deleted at link, so
 *  nothing may be written or persisted against it). A bare `session ?` in a screen is a bug.
 *
 *  `isAnonymous !== true` rather than `!isAnonymous` so a MISSING field reads as "a real account" —
 *  the correct answer for a pre-1.1 session cached in SecureStore and for any row written before the
 *  column existed. The field is typed here only because `anonymousClient()` is registered above. */
export function isSignedIn(session: GateSession | null | undefined): boolean {
  const user = session?.user
  return !!user && user.isAnonymous !== true
}

/** Admin gate — a signed-in account whose `role === 'admin'` (Better Auth admin plugin, server-set).
 *  The ONE client-side definition of "is this user an admin?", mirroring the API's isAdmin()
 *  (apps/api/src/tiers.ts), which gates the dev-tools screen and is also the server's staged-content
 *  preview role (docs/decisions/region-release-gate.md).
 *
 *  ⚠ The `isSignedIn` clause is not belt-and-braces — the server's isAdmin() has always excluded
 *  anonymous and this one did not (1.1 step 8b closed the gap). No live defect today, because the
 *  anonymous plugin leaves an anon row's `role` at the admin plugin's default 'user'; but it was one
 *  server-side role write away from handing dev tools and STAGED content to an anonymous session. */
export function isAdmin(session: GateSession | null | undefined): boolean {
  return isSignedIn(session) && session?.user?.role === 'admin'
}
