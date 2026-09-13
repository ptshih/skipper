import Foundation

/// Closed analytics event tracker callback.
/// INV-13: No rider personal prose, URLs, or sensitive data.
typealias AnalyticsTracker = @Sendable (String, [String: Any]) -> Void

enum AnalyticsEvents {
    static func driveCreated(track: AnalyticsTracker?) {
        track?("drive_created", [:])
    }

    static func plannerReady(track: AnalyticsTracker?) {
        track?("planner_ready", [:])
    }

    static func planTurnSent(turnIndex: Int, retry: Bool = false, track: AnalyticsTracker?) {
        track?("plan_turn_sent", [
            "turn_index": NSNumber(value: turnIndex),
            "retry": NSNumber(value: retry)
        ])
    }

    static func proposalShown(
        stopCount: Int?,
        durationMin: Double,
        roundTrip: Bool,
        hasClip: Bool,
        track: AnalyticsTracker?
    ) {
        var props: [String: Any] = [
            "duration_min": NSNumber(value: durationMin),
            "round_trip": NSNumber(value: roundTrip),
            "has_clip": NSNumber(value: hasClip)
        ]
        if let stopCount {
            props["stop_count"] = NSNumber(value: stopCount)
        } else {
            props["stop_count"] = NSNull()
        }
        track?("proposal_shown", props)
    }

    static func wallShown(source: String, track: AnalyticsTracker?) {
        track?("wall_shown", ["source": source])
    }

    static func signupCompleted(track: AnalyticsTracker?) {
        track?("signup_completed", [:])
    }
}
