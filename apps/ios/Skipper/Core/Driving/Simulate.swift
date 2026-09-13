import Foundation

/// Simulation options for driving a polyline.
public struct DriveOptions: Equatable, Codable, Sendable {
    public var mph: Double?
    public var tickHz: Double?
    public var maxOffRouteM: Double?
    public var leadSeconds: Double?
    public var headingGateMps: Double?
    public var headingConeDeg: Double?
    public var bearingFloorM: Double?
    public var recedeMarginM: Double?

    public init(
        mph: Double? = 60.0,
        tickHz: Double? = 4.0,
        maxOffRouteM: Double? = OFF_ROUTE_MAX_M,
        leadSeconds: Double? = nil,
        headingGateMps: Double? = nil,
        headingConeDeg: Double? = nil,
        bearingFloorM: Double? = nil,
        recedeMarginM: Double? = nil
    ) {
        self.mph = mph
        self.tickHz = tickHz
        self.maxOffRouteM = maxOffRouteM
        self.leadSeconds = leadSeconds
        self.headingGateMps = headingGateMps
        self.headingConeDeg = headingConeDeg
        self.bearingFloorM = bearingFloorM
        self.recedeMarginM = recedeMarginM
    }
}

/// Simulation outcome for a single stop.
public struct StopOutcome: Equatable, Codable, Sendable {
    public var seq: Int
    public var name: String?
    public var stopType: String?
    public var fired: Bool
    public var fireSec: Double?
    public var leadSec: Double?
    public var offRouteM: Double
    public var excluded: Bool
    public var durationMs: Double?

    public init(
        seq: Int,
        name: String? = nil,
        stopType: String? = nil,
        fired: Bool,
        fireSec: Double? = nil,
        leadSec: Double? = nil,
        offRouteM: Double,
        excluded: Bool,
        durationMs: Double? = nil
    ) {
        self.seq = seq
        self.name = name
        self.stopType = stopType
        self.fired = fired
        self.fireSec = fireSec
        self.leadSec = leadSec
        self.offRouteM = offRouteM
        self.excluded = excluded
        self.durationMs = durationMs
    }
}

/// Narration audio overlap between two stops.
public struct Overlap: Equatable, Codable, Sendable {
    public var prevSeq: Int
    public var seq: Int
    public var overlapSec: Double

    public init(prevSeq: Int, seq: Int, overlapSec: Double) {
        self.prevSeq = prevSeq
        self.seq = seq
        self.overlapSec = overlapSec
    }
}

/// Stretch of route with no narration playing (quiet period).
public struct QuietWindow: Equatable, Codable, Sendable {
    public var startSec: Double
    public var endSec: Double
    public var sec: Double
    public var afterSeq: Int?
    public var beforeSeq: Int?

    public init(startSec: Double, endSec: Double, sec: Double, afterSeq: Int? = nil, beforeSeq: Int? = nil) {
        self.startSec = startSec
        self.endSec = endSec
        self.sec = sec
        self.afterSeq = afterSeq
        self.beforeSeq = beforeSeq
    }
}

/// Complete report produced by simulating a drive.
public struct SimReport: Equatable, Codable, Sendable {
    public var speedMph: Double
    public var tickHz: Double
    public var driveSec: Double
    public var totalRouteM: Double
    public var fixCount: Int
    public var trigger: TriggerOptions
    public var events: [TriggerEvent]
    public var stops: [StopOutcome]
    public var overlaps: [Overlap]
    public var quietWindows: [QuietWindow]
    public var neverFired: [Int]
    public var excludedOffRoute: [Int]
    public var coverageRatio: Double

    public init(
        speedMph: Double,
        tickHz: Double,
        driveSec: Double,
        totalRouteM: Double,
        fixCount: Int,
        trigger: TriggerOptions,
        events: [TriggerEvent],
        stops: [StopOutcome],
        overlaps: [Overlap],
        quietWindows: [QuietWindow],
        neverFired: [Int],
        excludedOffRoute: [Int],
        coverageRatio: Double
    ) {
        self.speedMph = speedMph
        self.tickHz = tickHz
        self.driveSec = driveSec
        self.totalRouteM = totalRouteM
        self.fixCount = fixCount
        self.trigger = trigger
        self.events = events
        self.stops = stops
        self.overlaps = overlaps
        self.quietWindows = quietWindows
        self.neverFired = neverFired
        self.excludedOffRoute = excludedOffRoute
        self.coverageRatio = coverageRatio
    }
}

/// Generate an evenly-timed GPS fix stream driving the polyline at a constant speed.
public func generateDrive(polyline: [LngLat], opts: DriveOptions = DriveOptions()) -> [GpsFix] {
    guard polyline.count >= 2 else { return [] }
    let speedMps = (opts.mph ?? 60.0) * MPH_TO_MPS
    let dt = 1.0 / (opts.tickHz ?? 4.0)
    guard speedMps > 0.0 else { return [] }

    let cum = cumulativeMeters(polyline)
    guard let total = cum.last else { return [] }
    var fixes: [GpsFix] = []
    var along = 0.0
    var t = 0.0
    var seg = 0

    while along <= total {
        while seg < polyline.count - 2 && cum[seg + 1] < along {
            seg += 1
        }
        let a = polyline[seg]
        let b = polyline[seg + 1]
        let segLen = cum[seg + 1] - cum[seg]
        let frac = segLen > 0.0 ? (along - cum[seg]) / segLen : 0.0
        let pt = interpolate(a, b, frac)
        fixes.append(GpsFix(
            lat: pt.latitude,
            lng: pt.longitude,
            speedMps: speedMps,
            headingDeg: bearingDeg(a, b),
            tSec: t,
            alongM: along
        ))
        along += speedMps * dt
        t += dt
    }

    return fixes
}

/// Simulate a drive and report triggering, overlap, and quiet windows.
public func runDrive(polyline: [LngLat], stops: [DriveStopRef], opts: DriveOptions = DriveOptions()) -> SimReport {
    let fixes = generateDrive(polyline: polyline, opts: opts)
    let trigger = TriggerOptions(
        leadSeconds: opts.leadSeconds ?? DEFAULT_TRIGGER.leadSeconds,
        headingGateMps: opts.headingGateMps ?? DEFAULT_TRIGGER.headingGateMps,
        headingConeDeg: opts.headingConeDeg ?? DEFAULT_TRIGGER.headingConeDeg,
        bearingFloorM: opts.bearingFloorM ?? DEFAULT_TRIGGER.bearingFloorM,
        recedeMarginM: opts.recedeMarginM ?? DEFAULT_TRIGGER.recedeMarginM
    )
    let maxOffRouteM = opts.maxOffRouteM ?? OFF_ROUTE_MAX_M

    let snapped = snapStopsToRoute(polyline: polyline, stops: stops)
    var offRouteBySeq = [Int: Double]()
    for s in snapped {
        offRouteBySeq[s.seq] = s.offRouteM
    }

    let triggerable: [DriveStopRef] = snapped.filter { $0.offRouteM <= maxOffRouteM }.map { s in
        DriveStopRef(
            seq: s.seq,
            lat: s.lat,
            lng: s.lng,
            triggerRadiusM: s.triggerRadiusM,
            durationMs: s.durationMs,
            name: s.name,
            stopType: s.stopType
        )
    }
    let excludedOffRoute = snapped.filter { $0.offRouteM > maxOffRouteM }.map { $0.seq }

    let engine = TriggerEngine(stops: triggerable, opts: trigger)
    var events: [TriggerEvent] = []
    for fix in fixes {
        events.append(contentsOf: engine.update(fix: fix))
    }

    var eventBySeq = [Int: TriggerEvent]()
    for e in events {
        eventBySeq[e.seq] = e
    }

    let stopOutcomes: [StopOutcome] = stops.map { s in
        let e = eventBySeq[s.seq]
        return StopOutcome(
            seq: s.seq,
            name: s.name,
            stopType: s.stopType,
            fired: e != nil,
            fireSec: e?.tSec,
            leadSec: e?.leadSec,
            offRouteM: offRouteBySeq[s.seq] ?? Double.infinity,
            excluded: excludedOffRoute.contains(s.seq),
            durationMs: s.durationMs
        )
    }

    // Overlap: among audio clips in fire order, does one start before the previous ends?
    var audioFires = events.filter { e in
        if let dur = stops.first(where: { $0.seq == e.seq })?.durationMs {
            return dur > 0.0
        }
        return false
    }
    audioFires.sort { $0.tSec < $1.tSec }

    var overlaps: [Overlap] = []
    if audioFires.count > 1 {
        for i in 1..<audioFires.count {
            let prev = audioFires[i - 1]
            let cur = audioFires[i]
            let prevDurSec = ((stops.first(where: { $0.seq == prev.seq })?.durationMs) ?? 0.0) / 1000.0
            let gap = cur.tSec - (prev.tSec + prevDurSec)
            if gap < 0.0 {
                overlaps.append(Overlap(prevSeq: prev.seq, seq: cur.seq, overlapSec: -gap))
            }
        }
    }

    let driveSec = fixes.last?.tSec ?? 0.0
    let audioSec = stops.reduce(0.0) { sum, s in sum + (s.durationMs ?? 0.0) / 1000.0 }
    let cum = cumulativeMeters(polyline)

    var durBySeq = [Int: Double]()
    for s in stops {
        durBySeq[s.seq] = (s.durationMs ?? 0.0) / 1000.0
    }

    var quietWindows: [QuietWindow] = []
    var cursor = 0.0
    var prevSeq: Int? = nil
    for e in audioFires {
        let startSec = max(e.tSec, cursor)
        if startSec > cursor {
            quietWindows.append(QuietWindow(
                startSec: cursor,
                endSec: startSec,
                sec: startSec - cursor,
                afterSeq: prevSeq,
                beforeSeq: e.seq
            ))
        }
        cursor = startSec + (durBySeq[e.seq] ?? 0.0)
        prevSeq = e.seq
    }
    if driveSec > cursor {
        quietWindows.append(QuietWindow(
            startSec: cursor,
            endSec: driveSec,
            sec: driveSec - cursor,
            afterSeq: prevSeq,
            beforeSeq: nil
        ))
    }

    return SimReport(
        speedMph: opts.mph ?? 60.0,
        tickHz: opts.tickHz ?? 4.0,
        driveSec: driveSec,
        totalRouteM: cum.last ?? 0.0,
        fixCount: fixes.count,
        trigger: trigger,
        events: events,
        stops: stopOutcomes,
        overlaps: overlaps,
        quietWindows: quietWindows,
        neverFired: stopOutcomes.filter { !$0.fired && !$0.excluded }.map { $0.seq },
        excludedOffRoute: excludedOffRoute,
        coverageRatio: driveSec > 0.0 ? audioSec / driveSec : 0.0
    )
}
