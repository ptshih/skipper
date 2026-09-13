import Foundation

/// A validated GPS position record ready for triggering decisions.
public struct GpsFix: Equatable, Codable, Sendable {
    public var lat: Double
    public var lng: Double
    public var speedMps: Double
    public var headingDeg: Double
    public var tSec: Double
    public var alongM: Double

    public init(lat: Double, lng: Double, speedMps: Double, headingDeg: Double, tSec: Double = 0.0, alongM: Double = 0.0) {
        self.lat = lat
        self.lng = lng
        self.speedMps = speedMps
        self.headingDeg = headingDeg
        self.tSec = tSec
        self.alongM = alongM
    }
}

/// A stop on a drive with its trigger radius and optional metadata.
public struct DriveStopRef: Equatable, Codable, Sendable {
    public var seq: Int
    public var lat: Double
    public var lng: Double
    public var triggerRadiusM: Double
    public var durationMs: Double?
    public var name: String?
    public var stopType: String?

    public init(
        seq: Int,
        lat: Double,
        lng: Double,
        triggerRadiusM: Double,
        durationMs: Double? = nil,
        name: String? = nil,
        stopType: String? = nil
    ) {
        self.seq = seq
        self.lat = lat
        self.lng = lng
        self.triggerRadiusM = triggerRadiusM
        self.durationMs = durationMs
        self.name = name
        self.stopType = stopType
    }
}

/// A narration stop fired by the trigger engine.
public struct TriggerEvent: Equatable, Codable, Sendable {
    public var seq: Int
    public var tSec: Double
    public var alongM: Double
    public var distanceM: Double
    public var speedMps: Double
    public var leadSec: Double

    public init(seq: Int, tSec: Double, alongM: Double, distanceM: Double, speedMps: Double, leadSec: Double) {
        self.seq = seq
        self.tSec = tSec
        self.alongM = alongM
        self.distanceM = distanceM
        self.speedMps = speedMps
        self.leadSec = leadSec
    }
}

/// Trigger engine tuning parameters.
public struct TriggerOptions: Equatable, Codable, Sendable {
    public var leadSeconds: Double
    public var headingGateMps: Double
    public var headingConeDeg: Double
    public var bearingFloorM: Double
    public var recedeMarginM: Double

    public init(
        leadSeconds: Double = 12.0,
        headingGateMps: Double = 2.2,
        headingConeDeg: Double = 90.0,
        bearingFloorM: Double = 15.0,
        recedeMarginM: Double = 40.0
    ) {
        self.leadSeconds = leadSeconds
        self.headingGateMps = headingGateMps
        self.headingConeDeg = headingConeDeg
        self.bearingFloorM = bearingFloorM
        self.recedeMarginM = recedeMarginM
    }
}

public let DEFAULT_TRIGGER = TriggerOptions()

/// Calculate speed-adaptive trigger radius.
public func effectiveRadiusM(triggerRadiusM: Double, speedMps: Double, leadSeconds: Double) -> Double {
    return max(triggerRadiusM, speedMps * leadSeconds)
}

/// The core drive trigger engine evaluating raw GPS fixes against stops.
public final class TriggerEngine {
    private let stops: [DriveStopRef]
    private let opts: TriggerOptions
    private var fired = Set<Int>()
    private var minDistM = [Int: Double]()

    public init(stops: [DriveStopRef], opts: TriggerOptions = DEFAULT_TRIGGER) {
        self.stops = stops
        self.opts = opts
    }

    /// Feed one fix; returns stops that fired on it (usually 0 or 1).
    public func update(fix: GpsFix) -> [TriggerEvent] {
        // Defense-in-depth: a malformed fix (non-finite coords/speed) must NEVER fire.
        guard fix.lat.isFinite && fix.lng.isFinite && fix.speedMps.isFinite else {
            return []
        }

        let here = LngLat(longitude: fix.lng, latitude: fix.lat)
        var events: [TriggerEvent] = []

        for stop in stops {
            if fired.contains(stop.seq) { continue }

            let stopLoc = LngLat(longitude: stop.lng, latitude: stop.lat)
            let d = haversineMeters(here, stopLoc)
            if d > effectiveRadiusM(triggerRadiusM: stop.triggerRadiusM, speedMps: fix.speedMps, leadSeconds: opts.leadSeconds) {
                minDistM.removeValue(forKey: stop.seq) // out of range -> forget approach (re-arm)
                continue
            }

            // Passed-point retire: track closest approach; if we receded past it, stop is behind.
            let minSeen = min(minDistM[stop.seq] ?? Double.infinity, d)
            minDistM[stop.seq] = minSeen
            if d > minSeen + opts.recedeMarginM { continue }

            // Heading gate: only at meaningful speed, with known heading, and far enough out.
            if d > opts.bearingFloorM && fix.speedMps >= opts.headingGateMps && fix.headingDeg >= 0 {
                let ahead = angularDiffDeg(fix.headingDeg, bearingDeg(here, stopLoc))
                if ahead > opts.headingConeDeg { continue }
            }

            fired.insert(stop.seq)
            events.append(TriggerEvent(
                seq: stop.seq,
                tSec: fix.tSec,
                alongM: fix.alongM,
                distanceM: d,
                speedMps: fix.speedMps,
                leadSec: fix.speedMps > 0 ? d / fix.speedMps : 0.0
            ))
        }

        return events
    }

    public var firedCount: Int {
        return fired.count
    }

    public var firedSeqSet: Set<Int> {
        return fired
    }
}

/// A stop with its lat/lng moved to its trigger point on the road.
public struct SnappedStop: Equatable, Codable, Sendable {
    public var seq: Int
    public var lat: Double
    public var lng: Double
    public var triggerRadiusM: Double
    public var durationMs: Double?
    public var name: String?
    public var stopType: String?
    public var offRouteM: Double
    public var poiLat: Double
    public var poiLng: Double

    public init(
        seq: Int,
        lat: Double,
        lng: Double,
        triggerRadiusM: Double,
        durationMs: Double? = nil,
        name: String? = nil,
        stopType: String? = nil,
        offRouteM: Double,
        poiLat: Double,
        poiLng: Double
    ) {
        self.seq = seq
        self.lat = lat
        self.lng = lng
        self.triggerRadiusM = triggerRadiusM
        self.durationMs = durationMs
        self.name = name
        self.stopType = stopType
        self.offRouteM = offRouteM
        self.poiLat = poiLat
        self.poiLng = poiLng
    }
}

/// Move each stop's trigger location from its POI to the nearest point on the route.
public func snapStopsToRoute(polyline: [LngLat], stops: [DriveStopRef]) -> [SnappedStop] {
    let cum = cumulativeMeters(polyline)
    return stops.map { s in
        let pos = nearestOnRoute(polyline: polyline, cumulative: cum, point: LngLat(longitude: s.lng, latitude: s.lat))
        return SnappedStop(
            seq: s.seq,
            lat: pos.lat,
            lng: pos.lng,
            triggerRadiusM: s.triggerRadiusM,
            durationMs: s.durationMs,
            name: s.name,
            stopType: s.stopType,
            offRouteM: pos.offRouteM,
            poiLat: s.lat,
            poiLng: s.lng
        )
    }
}
