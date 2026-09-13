# Native iOS development

Read root `CLAUDE.md` and `docs/designs/native-ios-conversion.md`. This native client is
implemented and available in TestFlight (build 27); physical device acceptance and cutover
remain pending. `apps/mobile` remains the shipped app until acceptance and coordinated cutover.

- `Skipper.xcodeproj` is the tracked source of truth. Do not introduce a project generator.
  One designated owner edits project configuration. Synchronized `Skipper`, `SkipperTests`,
  and `SkipperUITests` groups pick up new files automatically without project edits.
- SwiftUI + Observation on iPhone, iOS 17 minimum. Small injectable services and Swift
  concurrency; UIKit is appropriate for native Google Maps. No shared Android client layer.
- `Models` contains wire DTOs, independent of pure `Core/Driving` and `Core/Storage` models.
  Adapters belong at service boundaries. Preserve the server DTO's missing/null/fallback
  behavior. Never change the backend contract to simplify a Swift decoder.
- Networking owns no implicit cookies, cache, credential store, automatic retries, or
  redirects. Planner has no credential provider. Never log or persist transcripts.
- Read `DESIGN.md` for semantic colors, typography, native controls, and accessibility.
- Keep bundle ID, signing team, default Keychain group, URL scheme, and associated domains
  continuous with the installed app. Owner requests wait for migration; public bootstrap/version/
  proposals can proceed without a cookie while credentials are deferred. Never mint from an error.
- `bun run ios:configure` writes ignored `.scratch/ios/Debug.xcconfig`; `--release` writes
  Release config and requires SDK keys plus the canonical production API origin. Inputs are
  native-only: explicit `SKIPPER_API_URL`, `SKIPPER_GOOGLE_MAPS_API_KEY`, `SKIPPER_POSTHOG_KEY`,
  and `SKIPPER_POSTHOG_HOST` override the matching keys in `.scratch/ios/client-config.json`.
  `SKIPPER_IOS_CONFIG_PATH` selects another JSON file (relative paths resolve from the repo root).
  An absent default file permits environment-only setup; an explicitly selected missing or
  malformed file fails. Empty environment values stay explicit. No `EXPO_PUBLIC_*` or mobile
  `.env` fallback exists. Preserve local files with mode 0600; never print or commit SDK values.
  Use the bundle-restricted iOS Maps key, never the server Routes key. For isolated release builds,
  capture local JSON and effective environment before checkout; the release helper owns that step.
- `bun run ios:check` builds all native test targets and runs unit + UI tests on an available
  iPhone simulator. `SKIPPER_IOS_SIMULATOR_ID` chooses a specific device. `--unit` scopes to
  unit tests; `--foundation` scopes to transport/foundation tests during shared integration.
  `SKIPPER_IOS_DERIVED_DATA` selects a separate build directory for concurrent workers.
  The default uses `CODE_SIGNING_ALLOWED=YES` and `CODE_SIGN_IDENTITY=-`; normal ad-hoc simulator
  signing embeds the entitlement SystemKeychain needs without distribution certificates/profiles.
  Unsigned builds may prove compilation or mocks, never real Keychain persistence.
  Scoped green is never complete app acceptance. Root `bun run check` is also required; its
  release fixtures currently require macOS `plutil`. Existing Linux Cloud Build jobs do not
  invoke that script suite; preserve their commands and see the conversion plan's CI audit.
- Native release tooling has passed independent code review. Root `ios:release`/`asc:builds`
  are the intended workflow, not evidence of accepted distribution. Preserve `apps/mobile`
  and backend `@better-auth/expo` compatibility until the coordinated cutover.
- Auth's `canRecoverCredentials` permits explicit recovery only for corrupt data; transient
  Keychain failures defer. Unknown-owner recovery preserves original bytes. Use async
  `session.canAccessLocalDrive(id)` for local detail, preview, and playback access; successful
  owner-scoped list/detail responses establish per-drive evidence without purging old files.
- Custom analytics use `AnalyticsContract` and the injected tracker. No identify/reset calls,
  rider prose, URLs, coordinates, account IDs, or drive IDs. SDK native crash capture is separate.
- Debug UI fixtures use `SKIPPER_UI_TESTING`, `SKIPPER_UI_SCENARIO`, `SKIPPER_UI_RUN_ID`, and
  `SKIPPER_UI_THEME`, read before any SDK/auth/network initialization. Unknown scenarios fail
  closed. Fixture services feed production views; no duplicate test-only product behavior.
  After valid fixture construction, UI scenarios initialize Maps alone with the existing public
  bundle key; PostHog/app API/credentials stay isolated. Unit/rejected launches skip Maps. Map
  views require `NativeSDKs.mapsReady`; absent/rejected registration shows the production
  unavailable state instead of constructing GMS objects. No map IDs or Street View are used.
  The fixture phase selects its output file list by configuration: Debug declares bundled
  JSON/audio paths, while Release declares none. A shell-only Debug guard is insufficient:
  Xcode can create declared output parents before executing the script. Keep Release's list
  empty so even the fixture directory skeleton stays outside the product. See Apple's
  [script output guidance](https://developer.apple.com/documentation/xcode/running-custom-scripts-during-a-build).

Current package APIs were checked through Context7 and vendor sources on 2026-09-12:
[Google setup](https://developers.google.com/maps/documentation/ios-sdk/config),
[Google package](https://github.com/googlemaps/ios-maps-sdk/blob/11.1.0/Package.swift),
[PostHog package](https://github.com/PostHog/posthog-ios/blob/3.74.0/Package.swift),
[PostHog configuration](https://github.com/PostHog/posthog-ios/blob/3.74.0/PostHog/PostHogConfig.swift).
Versions are exact in the project and locked in `Package.resolved`.

[Apple URLSession](https://developer.apple.com/documentation/foundation/urlsessionconfiguration/ephemeral)
and [privacy API reasons](https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api)
were also checked. The manifest declares app-only preferences, app-container file metadata,
and disk-space checks for user-visible download behavior; audit declarations again at release.

Brand SVG masters live in `BrandSources/`, outside the app bundle. Run `scripts/ios-brand.sh`
from the repository root to regenerate native icons and badge, or pass `--output <directory>`
for isolated verification. The generator requires librsvg's `rsvg-convert`; it does not edit
asset catalog metadata. Music provenance and mastering instructions are retained in
`Skipper/Resources/Music-Licenses.md` and app credits belong to `Features/Settings`.

A fresh checkout may create its ignored local JSON with these four string fields, then fill
SDK values from the existing approved configuration without committing them:

```json
{
  "SKIPPER_API_URL": "https://api.skipper.fm",
  "SKIPPER_GOOGLE_MAPS_API_KEY": "",
  "SKIPPER_POSTHOG_KEY": "",
  "SKIPPER_POSTHOG_HOST": "https://us.i.posthog.com"
}
```

Keep the file mode 0600. Empty SDK keys deliberately fail Release configuration; environment-only
setup can supply all four keys instead. SDK app keys and PostHog symbol-upload credentials have
different purposes: private ASC/signing/upload credentials never belong in this client JSON.

Maps registration must precede every map object ([GMSServices reference](https://developers.google.com/maps/documentation/ios-sdk/reference/objc/Classes/GMSServices)).
Current [Google SKU definitions](https://developers.google.com/maps/billing-and-pricing/sku-details#maps-sdk)
and [pricing](https://developers.google.com/maps/billing-and-pricing/pricing) list unlimited no-charge
Maps SDK loads without a map ID; map IDs and Street View use separate priced SKUs. Native QA
rendering is authorized; app API/corpus spend is not part of that authorization.
