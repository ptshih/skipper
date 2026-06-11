// Dynamic Expo config — layers the runtime-injected Google Maps key onto the static
// app.json. app.json stays the source of truth for everything; this only appends the
// react-native-maps config plugin with the key from EXPO_PUBLIC_GOOGLE_MAPS_API_KEY
// (apps/mobile/.env, gitignored). An EMPTY key degrades gracefully: the plugin skips the
// Google Maps SDK setup and iOS falls back to Apple Maps (untinted) instead of crashing.
// (A NATIVE REBUILD is required after the key changes — the plugin bakes it into the
// Info.plist / AndroidManifest at prebuild time, not at JS runtime.)
import type { ConfigContext, ExpoConfig } from 'expo/config'

const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? ''

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  // name/slug are required on ExpoConfig; they come from app.json via `config`.
  name: config.name ?? 'Skipper',
  slug: config.slug ?? 'skipper',
  plugins: [
    ...(config.plugins ?? []),
    [
      'react-native-maps',
      { iosGoogleMapsApiKey: GOOGLE_MAPS_API_KEY, androidGoogleMapsApiKey: GOOGLE_MAPS_API_KEY },
    ],
  ],
})
