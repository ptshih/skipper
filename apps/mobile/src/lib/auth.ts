// Better Auth client for Expo — sessions stored in expo-secure-store, deep-link
// scheme `skipper` (must match app.json `scheme` and the server's trustedOrigins).
import { createAuthClient } from 'better-auth/react'
import { adminClient } from 'better-auth/client/plugins'
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

/** Admin gate — `role === 'admin'` (Better Auth admin plugin, server-set). The ONE client-side
 *  definition of "is this user an admin?", mirroring the API's isAdmin() in apps/api/src/tiers.ts.
 *  Pass the session from useSession(); structurally typed so it also accepts a null/loading session. */
export function isAdmin(
  session: { user?: { role?: string | null } | null } | null | undefined,
): boolean {
  return session?.user?.role === 'admin'
}
