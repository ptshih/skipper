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

// ⚠ `isSignedIn`, `isAdmin` and their session shape moved to `@skipper/shared` in the 1.1 sweep
// (packages/shared/src/access.ts). They lived here AND in apps/api/src/tiers.ts, and their agreement
// was a comment rather than a fact — while INV-9 makes this predicate decide what every rider sees.
// One implementation, one test, both sides. Re-exported so screens keep importing them from '@/lib/auth',
// which is where a reader looks for "is this rider signed in".
export { isAdmin, isSignedIn } from '@skipper/shared'

