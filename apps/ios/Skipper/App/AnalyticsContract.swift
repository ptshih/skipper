import Foundation
import CoreFoundation

/// The only custom-event payloads allowed to leave the app. No IDs, coordinates, URLs or prose.
enum AnalyticsScalar: Sendable {
    case string(String), number(Double), bool(Bool), null
    var raw: Any {
        switch self { case .string(let value): value; case .number(let value): value; case .bool(let value): value; case .null: NSNull() }
    }
}
struct ValidatedAnalyticsEvent: Sendable { let name: String; let properties: [String: AnalyticsScalar] }
enum AnalyticsContract {
    private enum Rule { case flag, count, number, nullableCount, choice(Set<String>) }
    private static let stop: [String: Rule] = ["mode": .choice(["live", "sim"]), "elapsed_sec": .number,
        "stop_index": .count, "stop_form": .choice(["story", "scenic", "break", "other"])]
    private static let rules: [String: [String: Rule]] = [
        "planner_ready": [:], "drive_created": [:], "signup_completed": [:],
        "plan_turn_sent": ["turn_index": .count, "retry": .flag],
        "proposal_shown": ["stop_count": .nullableCount, "duration_min": .number, "round_trip": .flag, "has_clip": .flag],
        "preview_clip_played": ["completed": .flag],
        "wall_shown": ["source": .choice(["create_drive", "propose", "drive_detail", "drive_play"])],
        "drive_started": ["mode": .choice(["live", "sim"])],
        "stop_fired": stop,
        "stop_skipped": stop.merging(["reason": .choice(["no_audio", "load_timeout", "stalled_mid_clip", "off_route"])]) { _, new in new },
        "drive_completed": ["mode": .choice(["live", "sim"]), "elapsed_sec": .number,
            "stops_total": .count, "stops_played": .count, "stops_skipped": .count],
    ]
    static var names: Set<String> { Set(rules.keys) }
    static func validate(_ name: String, properties: [String: Any]) -> ValidatedAnalyticsEvent? {
        guard let schema = rules[name], Set(schema.keys) == Set(properties.keys) else { return nil }
        var checked: [String: AnalyticsScalar] = [:]
        for (key, rule) in schema {
            guard let value = properties[key] else { return nil }
            switch rule {
            case .choice(let allowed):
                guard let string = value as? String, allowed.contains(string) else { return nil }
                checked[key] = .string(string)
            case .flag:
                guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { return nil }
                checked[key] = .bool(number.boolValue)
            case .count, .number, .nullableCount:
                if case .nullableCount = rule, value is NSNull { checked[key] = .null; continue }
                guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
                      number.doubleValue.isFinite, number.doubleValue >= 0 else { return nil }
                let raw = number.doubleValue
                if case .number = rule {} else if raw.rounded(.down) != raw { return nil }
                checked[key] = .number(raw)
            }
        }
        return .init(name: name, properties: checked)
    }
}
