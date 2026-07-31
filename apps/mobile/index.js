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
// The app-wide connectivity verdict, imported ABOVE expo-router/entry so its listener is registered
// before anything the router pulls in can touch expo-network. (Import declarations are hoisted and
// evaluated in source order, so it is this LINE's position that establishes the ordering —
// connectivity.ts arms itself on import; the call below is idempotent and just makes the intent
// legible at the call site.)
//
// It is not merely "as early as possible for freshness". expo-modules-core's `removeAllListeners`
// fires `stopObserving` whenever the prior listener count was >= 1 — not only when it reaches zero
// (common/cpp/EventEmitter.cpp) — and expo-network's `OnStopObserving` CANCELS its NWPathMonitor,
// which is a final state for that instance. @better-auth/expo registers its own network listener
// and tears it down on session-refresh cleanup. Registering ours first, and never removing it,
// holds the count above zero so someone else's teardown can't take the whole stream with it.
// See src/lib/connectivity.ts.
import { armConnectivity } from './src/lib/connectivity'
import 'expo-router/entry'

armConnectivity()
