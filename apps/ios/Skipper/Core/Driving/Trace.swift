import Foundation

/// Bump when the envelope shape changes in a way a reader must branch on.
public let TRACE_FORMAT_VERSION: Int = 1

/// Bound against a pathological session (~7 hours of 4 Hz fixes).
public let MAX_TRACE_FIXES: Int = 100_000

/// Metadata captured at the start of a drive for trace recording.
public struct TraceMeta: Equatable, Codable, Sendable {
    public var driveId: String
    public var label: String?
    public var recordedAt: String
    public var appVersion: String?
    public var polyline: [LngLat]

    public init(
        driveId: String,
        label: String? = nil,
        recordedAt: String,
        appVersion: String? = nil,
        polyline: [LngLat]
    ) {
        self.driveId = driveId
        self.label = label
        self.recordedAt = recordedAt
        self.appVersion = appVersion
        self.polyline = polyline
    }
}

/// The serialized trace format.
public struct TraceEnvelope: Equatable, Codable, Sendable {
    public var version: Int
    public var driveId: String
    public var label: String?
    public var recordedAt: String
    public var appVersion: String?
    public var routeVertices: Int
    public var routeHash: String
    public var truncated: Bool
    public var fixes: [RawFix]

    public init(
        version: Int = TRACE_FORMAT_VERSION,
        driveId: String,
        label: String? = nil,
        recordedAt: String,
        appVersion: String? = nil,
        routeVertices: Int,
        routeHash: String,
        truncated: Bool,
        fixes: [RawFix]
    ) {
        self.version = version
        self.driveId = driveId
        self.label = label
        self.recordedAt = recordedAt
        self.appVersion = appVersion
        self.routeVertices = routeVertices
        self.routeHash = routeHash
        self.truncated = truncated
        self.fixes = fixes
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.version = (try? c.decode(Int.self, forKey: .version)) ?? 0
        self.driveId = try c.decode(String.self, forKey: .driveId)
        self.label = try? c.decodeIfPresent(String.self, forKey: .label)
        self.recordedAt = (try? c.decode(String.self, forKey: .recordedAt)) ?? ""
        self.appVersion = try? c.decodeIfPresent(String.self, forKey: .appVersion)
        self.routeVertices = (try? c.decode(Int.self, forKey: .routeVertices)) ?? 0
        self.routeHash = (try? c.decode(String.self, forKey: .routeHash)) ?? ""
        self.truncated = (try? c.decode(Bool.self, forKey: .truncated)) ?? false
        self.fixes = try c.decode([RawFix].self, forKey: .fixes)
    }
}

/// FNV-1a 32-bit hash of polyline rounded to 5 decimal places (~1m precision).
public func polylineFingerprint(_ polyline: [LngLat]) -> String {
    var h: UInt32 = 0x811c9dc5
    for pt in polyline {
        let s = String(format: "%.5f,%.5f;", pt.longitude, pt.latitude)
        for b in s.utf8 {
            h ^= UInt32(b)
            h = h &* 0x01000193
        }
    }
    return String(format: "%08x", h)
}

/// In-memory black-box recorder for one drive session. Local-only (INV-13).
public final class TraceRecorder: @unchecked Sendable {
    private var buf: [RawFix] = []
    private var stopped: Bool = false
    private var truncatedAt: Bool = false
    private let lock = NSLock()

    public init() {}

    public func record(raw: RawFix) {
        lock.lock()
        defer { lock.unlock() }

        if stopped { return }
        if buf.count >= MAX_TRACE_FIXES {
            truncatedAt = true
            stopped = true
            return
        }
        buf.append(raw)
    }

    public func stop() {
        lock.lock()
        defer { lock.unlock() }
        stopped = true
    }

    public var count: Int {
        lock.lock()
        defer { lock.unlock() }
        return buf.count
    }

    public var truncated: Bool {
        lock.lock()
        defer { lock.unlock() }
        return truncatedAt
    }

    /// Wall-clock span of what was captured (seconds). 0 for < 2 fixes.
    public var spanSec: Double {
        lock.lock()
        defer { lock.unlock() }
        guard buf.count >= 2, let first = buf.first, let last = buf.last else { return 0.0 }
        return (last.timestamp - first.timestamp) / 1000.0
    }

    /// Produce sealed trace envelope with provided start metadata.
    public func envelope(meta: TraceMeta) -> TraceEnvelope {
        lock.lock()
        defer { lock.unlock() }
        return TraceEnvelope(
            version: TRACE_FORMAT_VERSION,
            driveId: meta.driveId,
            label: meta.label,
            recordedAt: meta.recordedAt,
            appVersion: meta.appVersion,
            routeVertices: meta.polyline.count,
            routeHash: polylineFingerprint(meta.polyline),
            truncated: truncatedAt,
            fixes: buf
        )
    }
}

/// Reader for a serialized trace envelope. Returns nil rather than throwing.
public func parseTraceEnvelope(json: String) -> TraceEnvelope? {
    guard let data = json.data(using: .utf8) else { return nil }
    guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
    guard let _ = obj["driveId"] as? String, let fixesArray = obj["fixes"] as? [[String: Any]] else {
        return nil
    }

    // Shape-check first fix
    if let firstFix = fixesArray.first {
        guard let timestamp = firstFix["timestamp"] as? Double,
              let coords = firstFix["coords"] as? [String: Any],
              let _ = coords["latitude"] as? Double else {
            return nil
        }
        _ = timestamp
    }

    let decoder = JSONDecoder()
    return try? decoder.decode(TraceEnvelope.self, from: data)
}

public struct RouteMatchResult: Equatable, Sendable {
    public var ok: Bool
    public var reason: String?

    public init(ok: Bool, reason: String? = nil) {
        self.ok = ok
        self.reason = reason
    }
}

/// Validate whether a recorded trace matches a route polyline.
public func traceMatchesRoute(env: TraceEnvelope, polyline: [LngLat]) -> RouteMatchResult {
    if env.routeVertices != polyline.count {
        return RouteMatchResult(
            ok: false,
            reason: "route has \(polyline.count) vertices, trace was recorded on \(env.routeVertices)"
        )
    }
    let hash = polylineFingerprint(polyline)
    if env.routeHash != hash {
        return RouteMatchResult(
            ok: false,
            reason: "route fingerprint \(hash) ≠ trace's \(env.routeHash)"
        )
    }
    return RouteMatchResult(ok: true)
}

/// Standard filename for exported trace envelope.
public func traceFileName(env: TraceEnvelope) -> String {
    let stamp = env.recordedAt
        .replacingOccurrences(of: ":", with: "-")
        .replacingOccurrences(of: ".", with: "-")
    let prefix = String(env.driveId.prefix(8))
    return "trace-\(prefix)-\(stamp).json"
}
