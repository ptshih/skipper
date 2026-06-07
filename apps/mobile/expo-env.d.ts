/// <reference types="expo/types" />

// EXPO_PUBLIC_* env vars are inlined at build time by Expo.
declare namespace NodeJS {
  interface ProcessEnv {
    EXPO_PUBLIC_API_URL?: string
  }
}
