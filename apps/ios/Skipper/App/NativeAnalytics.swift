import Foundation
import PostHog

@MainActor
enum NativeAnalytics {
    static func tracker(session: SessionStore) -> AnalyticsTracker {
        { name, properties in
            guard let event = AnalyticsContract.validate(name, properties: properties) else { return }
            Task { @MainActor in
                // The shipped OTP endpoint doesn't distinguish signup from login. Retain its
                // five-minute createdAt heuristic instead of counting returning riders as signups.
                if event.name == "signup_completed", !session.wasRecentlyCreated { return }
                PostHogSDK.shared.capture(event.name, properties: event.properties.mapValues(\.raw))
            }
        }
    }
}
