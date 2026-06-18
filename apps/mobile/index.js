// Custom app entry — pulls expo-network into the MAIN bundle before the router loads.
//
// Why: @better-auth/expo's client does a dynamic `import("expo-network")` in setup()
// (dist/client.js — registers a network-state listener to refetch the session on
// reconnect). With Metro's DEV lazy-bundling, that dynamic import splits expo-network
// into a separate async chunk that the auth client then reaches synchronously during
// useSession — throwing "Requiring unknown module" in dev. expo-network was only added
// to the app recently (it's a transitive need of @better-auth/expo), which is why this
// started. A bare side-effect import here — in the always-eager entry, before
// expo-router/entry — keeps expo-network in the main bundle, so the dynamic import
// resolves from the registry with no async chunk. Lazy bundling stays on for everything
// else; production (expo export) never lazy-splits, so this is a dev-only correctness guard.
import 'expo-network'
import 'expo-router/entry'
