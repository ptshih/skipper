// Dynamic Expo config — the layer over app.json for anything that must differ BETWEEN BUILDS.
// app.json stays the source of truth for everything static; only env-dependent config lives here.
//
// Two such things today:
//
// 1. The react-native-maps plugin + its Google Maps key, from EXPO_PUBLIC_GOOGLE_MAPS_API_KEY
//    (apps/mobile/.env locally, gitignored; eas.json `env` for builds). An EMPTY key degrades
//    gracefully: the plugin skips the Google Maps SDK setup and iOS falls back to Apple Maps
//    (untinted) instead of crashing.
//
// 2. App Transport Security. The Tailscale dev-build workflow serves the API over plain HTTP on a
//    *.ts.net host, and a Release-configuration build ENFORCES ATS — so that workflow needs an
//    NSExceptionDomains entry to reach the laptop. That entry used to sit in static app.json, which
//    meant every TestFlight and App Store binary shipped a standing cleartext-HTTP allowance for a
//    domain the app never contacts in production. Wrong default, and a fair question at review. Now
//    it's opt-IN via SKIPPER_LAN_HTTP=1 (set on the EAS `development` profiles; export it by hand for
//    a local `expo run:ios --device` against Tailscale). Shipped builds carry no exception at all.
//
// ⚠ A NATIVE REBUILD is required after either changes — both are baked into the Info.plist /
// AndroidManifest at prebuild time, not read at JS runtime.
import type { ConfigContext, ExpoConfig } from 'expo/config'

const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? ''

/** Opt IN to cleartext HTTP for LAN/Tailscale dev. Absent = secure (the shipped default). */
const LAN_HTTP = process.env.SKIPPER_LAN_HTTP === '1'

const TAILSCALE_ATS_EXCEPTION = {
  NSAppTransportSecurity: {
    NSExceptionDomains: {
      // Tailscale's magic-DNS suffix — the dev API host. Scoped to this domain on purpose:
      // NSAllowsArbitraryLoads would blanket-disable ATS and is a real review flag.
      'ts.net': {
        NSExceptionAllowsInsecureHTTPLoads: true,
        NSIncludesSubdomains: true,
      },
    },
  },
}

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  // name/slug are required on ExpoConfig; they come from app.json via `config`.
  name: config.name ?? 'Skipper',
  slug: config.slug ?? 'skipper',
  ios: {
    ...config.ios,
    infoPlist: {
      ...config.ios?.infoPlist,
      ...(LAN_HTTP ? TAILSCALE_ATS_EXCEPTION : {}),
    },
  },
  plugins: [
    ...(config.plugins ?? []),
    [
      'react-native-maps',
      { iosGoogleMapsApiKey: GOOGLE_MAPS_API_KEY, androidGoogleMapsApiKey: GOOGLE_MAPS_API_KEY },
    ],
  ],
})
