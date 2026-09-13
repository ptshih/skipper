import Foundation

/// Horizontal accuracy threshold (meters) at rest/slow.
public let MAX_FIX_ACCURACY_M: Double = 50.0

/// Fraction of effective lead radius used to loosen accuracy gate at speed.
public let ACCURACY_LEAD_FRACTION: Double = 0.5

/// Fire onEnd once projected position is within this of the final route vertex (meters).
public let ROUTE_END_EPSILON_M: Double = 25.0

/// Forward search window for monotonic projection (in polyline vertices).
public let PROJECT_WINDOW_VERTS: Int = 400

/// Clamps negative or nullish value to 0. SPEED-SAFE: 0 is sane unknown speed.
/// Do NOT use for heading (-1 is unknown, 0 is due north).
public func saneNonNeg(_ v: Double?) -> Double {
    guard let v = v, v >= 0.0 else { return 0.0 }
    return v
}

/// Accuracy ceiling (meters) a fix must beat to be trusted, loosened with speed.
public func accuracyCeilingM(speedMps: Double) -> Double {
    return max(MAX_FIX_ACCURACY_M, speedMps * DEFAULT_TRIGGER.leadSeconds * ACCURACY_LEAD_FRACTION)
}

/// Is reported accuracy good enough to trust at this speed?
/// `nil` is admitted (rare unknown); negative sentinel (-1 on iOS) is rejected.
public func accuracyOk(acc: Double?, speedMps: Double) -> Bool {
    guard let acc = acc else { return true }
    if acc < 0.0 { return false }
    return acc <= accuracyCeilingM(speedMps: speedMps)
}

/// Forward-windowed nearest-vertex projection: searches [cursor, cursor+window) for vertex
/// closest to (lng, lat) and returns new cursor index. Monotonic; rejects fixes beyond maxOffRouteM.
public func projectForwardIndex(
    polyline: [LngLat],
    cursor: Int,
    lng: Double,
    lat: Double,
    window: Int,
    maxOffRouteM: Double = OFF_ROUTE_MAX_M
) -> Int {
    guard !polyline.isEmpty else { return 0 }
    let end = min(polyline.count, cursor + window)
    var bestIdx = cursor
    var bestDist = haversineMeters(polyline[cursor], LngLat(longitude: lng, latitude: lat))
    for i in (cursor + 1)..<end {
        let d = haversineMeters(polyline[i], LngLat(longitude: lng, latitude: lat))
        if d < bestDist {
            bestDist = d
            bestIdx = i
        }
    }
    return bestDist <= maxOffRouteM ? bestIdx : cursor
}

/// Whether a projected live position has reached route end.
public func reachedRouteEnd(
    alongM: Double,
    routeEndM: Double,
    cursor: Int,
    polylineLen: Int,
    rawToEndM: Double,
    epsilonM: Double,
    maxEndDistM: Double = OFF_ROUTE_MAX_M
) -> Bool {
    if routeEndM <= 0.0 { return false }
    return alongM >= routeEndM - epsilonM ||
        (cursor >= polylineLen - 2 && rawToEndM <= maxEndDistM) ||
        (rawToEndM <= epsilonM && alongM >= routeEndM * 0.5)
}

/// The subset of location data read by the fix pipeline.
public struct RawFixCoords: Equatable, Codable, Sendable {
    public var latitude: Double
    public var longitude: Double
    public var accuracy: Double?
    public var speed: Double?
    public var heading: Double?

    public init(latitude: Double, longitude: Double, accuracy: Double? = nil, speed: Double? = nil, heading: Double? = nil) {
        self.latitude = latitude
        self.longitude = longitude
        self.accuracy = accuracy
        self.speed = speed
        self.heading = heading
    }

    private enum CodingKeys: String, CodingKey {
        case latitude, longitude, accuracy, speed, heading
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        latitude = try container.decode(Double.self, forKey: .latitude)
        longitude = try container.decode(Double.self, forKey: .longitude)
        accuracy = try container.decodeIfPresent(Double.self, forKey: .accuracy)
        speed = try container.decodeIfPresent(Double.self, forKey: .speed)
        heading = try container.decodeIfPresent(Double.self, forKey: .heading)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(latitude, forKey: .latitude)
        try container.encode(longitude, forKey: .longitude)
        try container.encode(accuracy, forKey: .accuracy)
        try container.encode(speed, forKey: .speed)
        try container.encode(heading, forKey: .heading)
    }
}

/// A raw GPS fix before filtering or sanitization.
public struct RawFix: Equatable, Codable, Sendable {
    public var coords: RawFixCoords
    public var timestamp: Double

    public init(coords: RawFixCoords, timestamp: Double) {
        self.coords = coords
        self.timestamp = timestamp
    }
}

/// Callbacks and configuration for the live fix pipeline.
public struct FixMapperOptions {
    public var onFix: (GpsFix) -> Void
    public var onEnd: (() -> Void)?
    public var epsilonM: Double?
    public var windowVerts: Int?
    public var maxOffRouteM: Double?

    public init(
        onFix: @escaping (GpsFix) -> Void,
        onEnd: (() -> Void)? = nil,
        epsilonM: Double? = nil,
        windowVerts: Int? = nil,
        maxOffRouteM: Double? = nil
    ) {
        self.onFix = onFix
        self.onEnd = onEnd
        self.epsilonM = epsilonM
        self.windowVerts = windowVerts
        self.maxOffRouteM = maxOffRouteM
    }
}

/// Stateful fix mapping pipeline: accuracy filtering, monotonic route projection, and end detection.
public final class FixMapper {
    private let polyline: [LngLat]
    private let cumulative: [Double]
    private let routeEndM: Double
    private let epsilonM: Double
    private let windowVerts: Int
    private let maxOffRouteM: Double
    private let onFix: (GpsFix) -> Void
    private let onEnd: (() -> Void)?

    private var cursor: Int = 0
    private var startMs: Double? = nil
    private var ended: Bool = false

    public init(polyline: [LngLat], opts: FixMapperOptions) {
        self.polyline = polyline
        self.cumulative = cumulativeMeters(polyline)
        self.routeEndM = cumulative.last ?? 0.0
        self.epsilonM = opts.epsilonM ?? ROUTE_END_EPSILON_M
        self.windowVerts = opts.windowVerts ?? PROJECT_WINDOW_VERTS
        self.maxOffRouteM = opts.maxOffRouteM ?? OFF_ROUTE_MAX_M
        self.onFix = opts.onFix
        self.onEnd = opts.onEnd
    }

    /// Process one raw fix. Returns false if rejected by accuracy gate.
    public func accept(_ raw: RawFix) -> Bool {
        let lat = raw.coords.latitude
        let lng = raw.coords.longitude
        let speed = saneNonNeg(raw.coords.speed)

        if !accuracyOk(acc: raw.coords.accuracy, speedMps: speed) {
            return false
        }

        if startMs == nil {
            startMs = raw.timestamp
        }

        guard !polyline.isEmpty else { return false }

        cursor = projectForwardIndex(
            polyline: polyline,
            cursor: cursor,
            lng: lng,
            lat: lat,
            window: windowVerts,
            maxOffRouteM: maxOffRouteM
        )
        let alongM = cursor < cumulative.count ? cumulative[cursor] : 0.0
        let heading = raw.coords.heading ?? -1.0
        let tSec = (raw.timestamp - (startMs ?? raw.timestamp)) / 1000.0

        let fix = GpsFix(
            lat: lat,
            lng: lng,
            speedMps: speed,
            headingDeg: heading,
            tSec: tSec,
            alongM: alongM
        )
        onFix(fix)

        if !ended, let lastVertex = polyline.last {
            let rawToEndM = haversineMeters(LngLat(longitude: lng, latitude: lat), lastVertex)
            if reachedRouteEnd(
                alongM: alongM,
                routeEndM: routeEndM,
                cursor: cursor,
                polylineLen: polyline.count,
                rawToEndM: rawToEndM,
                epsilonM: epsilonM,
                maxEndDistM: maxOffRouteM
            ) {
                ended = true
                onEnd?()
            }
        }

        return true
    }
}

/// Convenience factory mirroring TS `createFixMapper(polyline, opts)`.
public func createFixMapper(polyline: [LngLat], opts: FixMapperOptions) -> (RawFix) -> Bool {
    let mapper = FixMapper(polyline: polyline, opts: opts)
    return { raw in mapper.accept(raw) }
}
