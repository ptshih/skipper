import Foundation

/// Spherical Earth radius in meters (IUGG recommended mean radius for R1).
public let EARTH_RADIUS_M: Double = 6_371_008.8

/// Conversion factor from miles per hour to meters per second.
public let MPH_TO_MPS: Double = 0.44704

/// Meters in one international mile.
public let METERS_PER_MILE: Double = 1609.344

/// POIs farther off-route than this (meters) never trigger on that drive.
public let OFF_ROUTE_MAX_M: Double = 700.0

/// Proximity trigger radius (meters) for an anchored stop pin (whose center is on the road).
public let ANCHORED_TRIGGER_RADIUS_M: Double = 250.0

/// Speakable anchor tolerance multiplier: pin may be up to 1.5x kind radius from road anchor.
public let SPEAKABLE_ANCHOR_RADIUS_MULT: Double = 1.5

/// Maximum allowed distance (meters) between pin and access point.
public let ACCESS_POINT_MAX_M: Double = 2_000.0

/// Distance threshold (meters) for considering a route sample retraced.
public let RETRACE_NEAR_M: Double = 35.0

/// Minimum along-route distance (meters) between samples before retrace detection applies.
public let RETRACE_MIN_ALONG_M: Double = 1_500.0

/// Resampling step distance (meters) along route for retrace analysis.
public let RETRACE_SAMPLE_M: Double = 25.0

/// Retrace fraction ceiling above which a drive is classified as an out-and-back rather than loop.
public let LOOP_MAX_RETRACE: Double = 0.2

/// Separator for serialized region bounding box lists.
public let REGION_BBOX_SEPARATOR: String = ";"

/// A longitude/latitude coordinate pair, serialized as `[lng, lat]`.
public struct LngLat: Hashable, Sendable {
    public var longitude: Double
    public var latitude: Double

    public init(longitude: Double, latitude: Double) {
        self.longitude = longitude
        self.latitude = latitude
    }

    public init(lng: Double, lat: Double) {
        self.longitude = lng
        self.latitude = lat
    }

    public init(_ lng: Double, _ lat: Double) {
        self.longitude = lng
        self.latitude = lat
    }

    public subscript(index: Int) -> Double {
        get {
            switch index {
            case 0: return longitude
            case 1: return latitude
            default: fatalError("Index out of range for LngLat (0=lng, 1=lat)")
            }
        }
        set {
            switch index {
            case 0: longitude = newValue
            case 1: latitude = newValue
            default: fatalError("Index out of range for LngLat (0=lng, 1=lat)")
            }
        }
    }
}

extension LngLat: Codable {
    public init(from decoder: Decoder) throws {
        var container = try decoder.unkeyedContainer()
        let lng = try container.decode(Double.self)
        let lat = try container.decode(Double.self)
        self.init(longitude: lng, latitude: lat)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.unkeyedContainer()
        try container.encode(longitude)
        try container.encode(latitude)
    }
}

private func toRad(_ deg: Double) -> Double { (deg * .pi) / 180.0 }
private func toDeg(_ rad: Double) -> Double { (rad * 180.0) / .pi }

/// Radius floor (meters) for a stop kind when not anchored on the road.
public func radiusForKind(_ kind: String?) -> Double {
    guard let kind = kind?.lowercased() else { return 600.0 }

    if kind.range(of: "mountain|peak|summit|ridge|hill|pass", options: .regularExpression) != nil {
        return 1500.0
    }
    if kind.range(of: #"lake|reservoir|bay|valley|canyon|island|peninsula|\bpoint\b|cape"#, options: .regularExpression) != nil {
        return 1200.0
    }
    if kind.range(of: "park|recreation area|beach|cove|meadow|historic district|waterfall|vista|viewpoint|overlook", options: .regularExpression) != nil {
        return 1000.0
    }
    return 600.0
}

/// Trigger radius (meters) for a stop kind, taking anchored status into account.
public func triggerRadiusForKind(_ kind: String?, anchored: Bool) -> Double {
    return anchored ? ANCHORED_TRIGGER_RADIUS_M : radiusForKind(kind)
}

/// Great-circle distance between two points in meters using the haversine formula.
public func haversineMeters(_ a: LngLat, _ b: LngLat) -> Double {
    let dLat = toRad(b.latitude - a.latitude)
    let dLng = toRad(b.longitude - a.longitude)
    let sinLat = sin(dLat / 2.0)
    let sinLng = sin(dLng / 2.0)
    let h = sinLat * sinLat + cos(toRad(a.latitude)) * cos(toRad(b.latitude)) * sinLng * sinLng
    return 2.0 * EARTH_RADIUS_M * asin(min(1.0, sqrt(h)))
}

/// Initial bearing from `a` to `b` in degrees [0, 360). Coincident points return 0 (due north).
public func bearingDeg(_ a: LngLat, _ b: LngLat) -> Double {
    let lng1 = a.longitude
    let lat1 = a.latitude
    let lng2 = b.longitude
    let lat2 = b.latitude
    let phi1 = toRad(lat1)
    let phi2 = toRad(lat2)
    let deltaLambda = toRad(lng2 - lng1)
    let y = sin(deltaLambda) * cos(phi2)
    let x = cos(phi1) * sin(phi2) - sin(phi1) * cos(phi2) * cos(deltaLambda)
    let deg = toDeg(atan2(y, x))
    return (deg.truncatingRemainder(dividingBy: 360.0) + 360.0).truncatingRemainder(dividingBy: 360.0)
}

/// Shortest angular difference between two bearings in degrees [0, 180].
public func angularDiffDeg(_ a: Double, _ b: Double) -> Double {
    let diff = ((a - b + 540.0).truncatingRemainder(dividingBy: 360.0)) - 180.0
    return abs(diff)
}

/// Linearly interpolate between two coordinates; `frac` is clamped to [0, 1].
public func interpolate(_ a: LngLat, _ b: LngLat, _ frac: Double) -> LngLat {
    let t = max(0.0, min(1.0, frac))
    return LngLat(
        longitude: a.longitude + (b.longitude - a.longitude) * t,
        latitude: a.latitude + (b.latitude - a.latitude) * t
    )
}

/// Monotonically increasing distance along polyline vertices in meters, starting at 0.
public func cumulativeMeters(_ polyline: [LngLat]) -> [Double] {
    guard !polyline.isEmpty else { return [] }
    var out = [Double](repeating: 0.0, count: polyline.count)
    out[0] = 0.0
    for i in 1..<polyline.count {
        out[i] = out[i - 1] + haversineMeters(polyline[i - 1], polyline[i])
    }
    return out
}

/// Position of a point projected onto a polyline.
public struct RoutePosition: Equatable, Codable, Sendable {
    public var index: Int
    public var lng: Double
    public var lat: Double
    public var offRouteM: Double
    public var alongM: Double

    public init(index: Int, lng: Double, lat: Double, offRouteM: Double, alongM: Double) {
        self.index = index
        self.lng = lng
        self.lat = lat
        self.offRouteM = offRouteM
        self.alongM = alongM
    }
}

/// Find nearest vertex on polyline as projection proxy.
public func nearestOnRoute(polyline: [LngLat], cumulative: [Double], point: LngLat) -> RoutePosition {
    guard !polyline.isEmpty else {
        return RoutePosition(index: 0, lng: point.longitude, lat: point.latitude, offRouteM: .infinity, alongM: 0.0)
    }
    var bestIndex = 0
    var bestDist = Double.infinity
    for i in 0..<polyline.count {
        let d = haversineMeters(polyline[i], point)
        if d < bestDist {
            bestDist = d
            bestIndex = i
        }
    }
    let v = polyline[bestIndex]
    let alongM = bestIndex < cumulative.count ? cumulative[bestIndex] : 0.0
    return RoutePosition(index: bestIndex, lng: v.longitude, lat: v.latitude, offRouteM: bestDist, alongM: alongM)
}

/// Total route length in meters from precomputed cumulative distances.
public func totalMeters(_ cumulative: [Double]) -> Double {
    return cumulative.last ?? 0.0
}

/// Heading along route at vertex `index` in degrees [0, 360).
public func routeBearingAt(polyline: [LngLat], index: Int) -> Double {
    guard polyline.count >= 2 else { return 0.0 }
    let i = min(max(index, 0), polyline.count - 1)
    let from: LngLat
    let to: LngLat
    if i < polyline.count - 1 {
        from = polyline[i]
        to = polyline[i + 1]
    } else {
        from = polyline[i - 1]
        to = polyline[i]
    }
    return bearingDeg(from, to)
}

/// Proportional driving time in seconds at distance alongM.
public func timeAtAlong(alongM: Double, totalRouteM: Double, totalRouteSec: Double) -> Double {
    guard totalRouteM > 0 else { return 0.0 }
    return (alongM / totalRouteM) * totalRouteSec
}

/// Maximum permitted distance (meters) between pin and speakable anchor for kind.
public func speakableAnchorMaxM(kind: String?) -> Double {
    return (SPEAKABLE_ANCHOR_RADIUS_MULT * radiusForKind(kind)).rounded()
}

public struct SpeakableAnchorCheck: Equatable, Codable, Sendable {
    public var distanceM: Double
    public var maxM: Double
    public var ok: Bool

    public init(distanceM: Double, maxM: Double, ok: Bool) {
        self.distanceM = distanceM
        self.maxM = maxM
        self.ok = ok
    }
}

public func checkSpeakableAnchor(pin: LngLat, anchor: LngLat, kind: String?) -> SpeakableAnchorCheck {
    let distanceM = haversineMeters(pin, anchor)
    let maxM = speakableAnchorMaxM(kind: kind)
    return SpeakableAnchorCheck(distanceM: distanceM, maxM: maxM, ok: distanceM <= maxM)
}

public struct AccessPointCheck: Equatable, Codable, Sendable {
    public var distanceM: Double
    public var maxM: Double
    public var ok: Bool

    public init(distanceM: Double, maxM: Double, ok: Bool) {
        self.distanceM = distanceM
        self.maxM = maxM
        self.ok = ok
    }
}

public func checkAccessPoint(pin: LngLat, access: LngLat) -> AccessPointCheck {
    let distanceM = haversineMeters(pin, access)
    return AccessPointCheck(distanceM: distanceM, maxM: ACCESS_POINT_MAX_M, ok: distanceM <= ACCESS_POINT_MAX_M)
}

private struct RouteSample {
    let pt: LngLat
    let alongM: Double
}

private func resampleAlong(polyline: [LngLat], stepM: Double) -> [RouteSample] {
    var out: [RouteSample] = []
    if polyline.isEmpty || stepM <= 0 { return out }
    out.append(RouteSample(pt: polyline[0], alongM: 0))
    var travelled = 0.0
    var carry = 0.0
    for i in 1..<polyline.count {
        let a = polyline[i - 1]
        let b = polyline[i]
        let segM = haversineMeters(a, b)
        if segM == 0 { continue }
        var t = stepM - carry
        while t <= segM {
            out.append(RouteSample(pt: interpolate(a, b, t / segM), alongM: travelled + t))
            t += stepM
        }
        carry = (carry + segM).truncatingRemainder(dividingBy: stepM)
        travelled += segM
    }
    return out
}

private struct GridCell: Hashable {
    let x: Int
    let y: Int
}

/// Fraction of route [0, 1] that retraces over itself.
public func retraceFraction(
    polyline: [LngLat],
    nearM: Double = RETRACE_NEAR_M,
    minAlongM: Double = RETRACE_MIN_ALONG_M,
    stepM: Double = RETRACE_SAMPLE_M
) -> Double {
    let samples = resampleAlong(polyline: polyline, stepM: stepM)
    if samples.count < 3 { return 0.0 }

    let cellDeg = nearM / 111_000.0
    var grid = [GridCell: [Int]]()

    func cellOf(_ p: LngLat) -> GridCell {
        GridCell(x: Int(floor(p.longitude / cellDeg)), y: Int(floor(p.latitude / cellDeg)))
    }

    for (i, s) in samples.enumerated() {
        let cell = cellOf(s.pt)
        grid[cell, default: []].append(i)
    }

    var retraced = 0
    for i in 0..<samples.count {
        let here = samples[i]
        let c = cellOf(here.pt)
        var found = false
        for dx in -1...1 where !found {
            for dy in -1...1 where !found {
                let cell = GridCell(x: c.x + dx, y: c.y + dy)
                guard let bucket = grid[cell] else { continue }
                for j in bucket {
                    if j == i { continue }
                    let other = samples[j]
                    if abs(other.alongM - here.alongM) < minAlongM { continue }
                    if haversineMeters(here.pt, other.pt) <= nearM {
                        found = true
                        break
                    }
                }
            }
        }
        if found { retraced += 1 }
    }
    return Double(retraced) / Double(samples.count)
}

public struct RegionBbox: Equatable, Codable, Sendable {
    public var swLng: Double
    public var swLat: Double
    public var neLng: Double
    public var neLat: Double

    public init(swLng: Double, swLat: Double, neLng: Double, neLat: Double) {
        self.swLng = swLng
        self.swLat = swLat
        self.neLng = neLng
        self.neLat = neLat
    }
}

public func parseRegionBbox(_ raw: String?) -> RegionBbox? {
    guard let raw = raw, !raw.isEmpty else { return nil }
    if raw.contains(REGION_BBOX_SEPARATOR) { return nil }
    let parts = raw.split(separator: ",").map { Double($0.trimmingCharacters(in: .whitespaces)) }
    if parts.count != 4 || parts.contains(where: { $0 == nil || !($0!.isFinite) }) {
        return nil
    }
    return RegionBbox(swLng: parts[0]!, swLat: parts[1]!, neLng: parts[2]!, neLat: parts[3]!)
}

public func parseRegionBboxes(_ raw: String?) -> [RegionBbox] {
    guard let raw = raw, !raw.isEmpty else { return [] }
    let parts = raw
        .split(separator: Character(REGION_BBOX_SEPARATOR))
        .map { $0.trimmingCharacters(in: .whitespaces) }
        .filter { !$0.isEmpty }
    if parts.isEmpty { return [] }
    var out: [RegionBbox] = []
    for part in parts {
        guard let box = parseRegionBbox(part) else { return [] }
        out.append(box)
    }
    return out
}

public func formatRegionBboxes(_ boxes: [RegionBbox]) -> String {
    return boxes
        .map { "\($0.swLng),\($0.swLat),\($0.neLng),\($0.neLat)" }
        .join(separator: REGION_BBOX_SEPARATOR)
}

public func pointInRegionBbox(box: RegionBbox, lat: Double, lng: Double) -> Bool {
    return lat >= box.swLat && lat <= box.neLat && lng >= box.swLng && lng <= box.neLng
}

public func pointInAnyRegionBbox(boxes: [RegionBbox], lat: Double, lng: Double) -> Bool {
    for b in boxes {
        if pointInRegionBbox(box: b, lat: lat, lng: lng) { return true }
    }
    return false
}

public func containingRegionBboxArea(boxes: [RegionBbox], lat: Double, lng: Double) -> Double? {
    var best: Double? = nil
    for b in boxes {
        if !pointInRegionBbox(box: b, lat: lat, lng: lng) { continue }
        let area = (b.neLat - b.swLat) * (b.neLng - b.swLng)
        if best == nil || area < best! {
            best = area
        }
    }
    return best
}

private extension Array where Element == String {
    func join(separator: String) -> String {
        return self.joined(separator: separator)
    }
}
