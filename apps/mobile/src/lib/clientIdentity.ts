// What THIS build tells the server about itself — the app's half of the client-identity channel.
// The grammar and the capability vocabulary live in `@skipper/shared`; this file supplies the two
// values that are specific to the app, and pre-builds the header string once.
//
// ⚠ WHAT GOES IN HERE IS A PROMISE. A capability token asserts that this build can actually DO the
// thing, and the server may hand over content on the strength of it. Add a token in the SAME change
// that ships the behaviour, never ahead of it — announcing `area` before the polygon trigger worked
// would have earned exactly the failure the server's withhold exists to prevent.

import Constants from 'expo-constants'
import { CLIENT_CAPS, clientIdentityHeader, type ClientCap } from '@skipper/shared'

/**
 * This build's semver, single-sourced from `app.json`'s `expo.version`.
 *
 * ⚠ `Constants.expoConfig`, NOT `Application.nativeApplicationVersion`, and the difference is not
 * cosmetic. expoConfig resolves to the app config attached to the JS bundle that is actually running
 * (for an EAS Update it is the published manifest's, falling back to the embedded config only on an
 * embedded launch); nativeApplicationVersion is `CFBundleShortVersionString` — the store BINARY's
 * version, which an OTA update cannot change. Capabilities live in the JS, so the JS bundle's own
 * version is the honest answer.
 *
 * There is no `expo-updates` in the project today, so the two would agree — which is precisely why
 * this comment exists: the wrong choice would not fail until OTA lands, and would then quietly report
 * a stale version for a bundle with newer JS. (Reaching for nativeApplicationVersion also means
 * adding `expo-application`, i.e. a new native dep and a native rebuild.)
 *
 * Can be undefined — `Constants.expoConfig` is nullable and VersionGate already fails open on it.
 */
export const APP_VERSION: string | undefined = Constants.expoConfig?.version

/**
 * What this build can do that an older one cannot.
 *
 * `area` — the roam player fires AREA triggers (containment in a convex hull), wired through
 * `useRoam`'s `adoptPins` into @skipper/engine's area branch. Shipped 2026-07-30.
 */
const CAPABILITIES: readonly ClientCap[] = [CLIENT_CAPS.area]

/** Computed once at module scope: `Constants.expoConfig` is a synchronous native constant read and
 *  the value cannot change while the app runs, so per-request work would be pure waste. */
export const CLIENT_IDENTITY_VALUE = clientIdentityHeader(APP_VERSION, CAPABILITIES)
