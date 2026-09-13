import Foundation
import GoogleMaps
import PostHog

@MainActor
enum NativeSDKs {
    private static let maps = MapSDKBootstrap()
    static var mapsReady: Bool { maps.isReady }

    /// UI scenarios use the real native renderer, but only after their isolated dependencies
    /// validate. This never enables PostHog, auth, or the production app API for a test launch.
    static func configureMaps(_ configuration: AppConfiguration, launch: AppLaunchConfiguration) {
        maps.configure(apiKey: configuration.googleMapsAPIKey, allowed: launch.allowsMapsSDK) {
            GMSServices.provideAPIKey($0)
        }
    }

    /// Product analytics are restricted to the live dependency graph.
    static func configure(_ configuration: AppConfiguration, launch: AppLaunchConfiguration) {
        guard launch.allowsLiveServices else { return }
        configureMaps(configuration, launch: launch)
        if let key = configuration.postHogKey {
            let config = PostHogConfig(projectToken: key, host: configuration.postHogHost)
            config.personProfiles = .never
            config.enableSwizzling = false
            config.sendFeatureFlagEvent = false
            config.captureScreenViews = false
            config.captureElementInteractions = false
            config.captureApplicationLifecycleEvents = false
            config.capturePushNotificationSubscriptions = false
            config.capturePushNotificationOpened = false
            config.sessionReplay = false
            config.preloadFeatureFlags = false
            config.surveys = false
            config.errorTrackingConfig.autoCapture = true
            config.setBeforeSend { event in
                // Native crashes keep their SDK diagnostic envelope. Automatic product events
                // (including deep-link URLs) are excluded; custom events use AnalyticsContract.
                if event.event == "$exception" { return event }
                let custom = event.properties.filter { !$0.key.hasPrefix("$") && $0.key != "app_env" }
                return AnalyticsContract.validate(event.event, properties: custom) != nil ? event : nil
            }
            PostHogSDK.shared.setup(config)
            #if DEBUG
            PostHogSDK.shared.register(["app_env": "development"])
            #else
            PostHogSDK.shared.register(["app_env": "production"])
            #endif
        }
    }
}

/// Google requires successful key registration before any map object is constructed. Keep
/// the result process-wide and idempotent; a missing key must not become a later NSException.
@MainActor final class MapSDKBootstrap {
    private(set) var isReady = false
    func configure(apiKey: String?, allowed: Bool, register: (String) -> Bool) {
        guard allowed, !isReady, let apiKey, !apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !apiKey.contains("$(") else { return }
        isReady = register(apiKey)
    }
}
