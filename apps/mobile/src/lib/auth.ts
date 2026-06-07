// Better Auth client for Expo — sessions stored in expo-secure-store, deep-link
// scheme `skipper` (must match app.json `scheme` and the server's trustedOrigins).
import { createAuthClient } from 'better-auth/react'
import { expoClient } from '@better-auth/expo/client'
import * as SecureStore from 'expo-secure-store'

/** Backend base URL. Override per-environment with EXPO_PUBLIC_API_URL. */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8787'

export const authClient = createAuthClient({
  baseURL: API_URL,
  plugins: [
    expoClient({
      scheme: 'skipper',
      storagePrefix: 'skipper',
      storage: SecureStore,
    }),
  ],
})

export const { signIn, signUp, signOut, useSession } = authClient
