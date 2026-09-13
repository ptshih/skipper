import Foundation

/// A stop fired during a headless desk drive.
public struct HarnessFiredStop: Equatable, Codable, Sendable {
    public var seq: Int
    public var tSec: Double
    public var leadSec: Double
    public var distanceM: Double

    public init(seq: Int, tSec: Double, leadSec: Double, distanceM: Double) {
        self.seq = seq
        self.tSec = tSec
        self.leadSec = leadSec
        self.distanceM = distanceM
    }
}

/// The outcome of running a raw fix trace through the real live mapping pipeline and trigger engine.
public struct HarnessResult: Equatable, Codable, Sendable {
    public var admitted: Int
    public var rejected: Int
    public var ended: Bool
    public var fired: [HarnessFiredStop]
    public var neverFired: [Int]
    public var finalAlongM: Double

    public init(
        admitted: Int,
        rejected: Int,
        ended: Bool,
        fired: [HarnessFiredStop],
        neverFired: [Int],
        finalAlongM: Double
    ) {
        self.admitted = admitted
        self.rejected = rejected
        self.ended = ended
        self.fired = fired
        self.neverFired = neverFired
        self.finalAlongM = finalAlongM
    }
}

public struct SyntheticTraceOptions: Equatable, Codable, Sendable {
    public var mph: Double?
    public var tickHz: Double?
    public var accuracyM: Double?
    public var startMs: Double?

    public init(
        mph: Double? = 45.0,
        tickHz: Double? = 1.0,
        accuracyM: Double? = 5.0,
        startMs: Double? = 1_700_000_000_000.0
    ) {
        self.mph = mph
        self.tickHz = tickHz
        self.accuracyM = accuracyM
        self.startMs = startMs
    }
}

private let R_EARTH_M_HARNESS: Double = 6_371_000.0
private func radH(_ d: Double) -> Double { (d * .pi) / 180.0 }

private func metersBetweenHarness(_ a: LngLat, _ b: LngLat) -> Double {
    let dLat = radH(b.latitude - a.latitude)
    let dLng = radH(b.longitude - a.longitude)
    let lat = radH((a.latitude + b.latitude) / 2.0)
    let x = dLng * cos(lat)
    return sqrt(x * x + dLat * dLat) * R_EARTH_M_HARNESS
}

private func bearingHarness(_ a: LngLat, _ b: LngLat) -> Double {
    let y = sin(radH(b.longitude - a.longitude)) * cos(radH(b.latitude))
    let x = cos(radH(a.latitude)) * sin(radH(b.latitude)) -
        sin(radH(a.latitude)) * cos(radH(b.latitude)) * cos(radH(b.longitude - a.longitude))
    let deg = (atan2(y, x) * 180.0) / .pi
    return (deg.truncatingRemainder(dividingBy: 360.0) + 360.0).truncatingRemainder(dividingBy: 360.0)
}

/// Build a clean synthetic RawFix trace walking the polyline at a constant speed.
public func syntheticTrace(polyline: [LngLat], opts: SyntheticTraceOptions = SyntheticTraceOptions()) -> [RawFix] {
    let mph = opts.mph ?? 45.0
    let tickHz = opts.tickHz ?? 1.0
    let accuracyM = opts.accuracyM ?? 5.0
    let startMs = opts.startMs ?? 1_700_000_000_000.0

    guard polyline.count >= 2 else { return [] }
    let speedMps = mph * 0.44704
    let dtSec = 1.0 / tickHz
    var out: [RawFix] = []

    var segLen: [Double] = []
    var total = 0.0
    for i in 0..<(polyline.count - 1) {
        let d = metersBetweenHarness(polyline[i], polyline[i + 1])
        segLen.append(d)
        total += d
    }

    var along = 0.0
    var t = 0.0
    var seg = 0
    var acc = 0.0

    while along <= total {
        while seg < segLen.count - 1 && acc + segLen[seg] < along {
            acc += segLen[seg]
            seg += 1
        }
        let a = polyline[seg]
        let b = seg + 1 < polyline.count ? polyline[seg + 1] : a
        let frac = segLen[seg] > 0.0 ? (along - acc) / segLen[seg] : 0.0
        out.append(RawFix(
            coords: RawFixCoords(
                latitude: a.latitude + (b.latitude - a.latitude) * frac,
                longitude: a.longitude + (b.longitude - a.longitude) * frac,
                accuracy: accuracyM,
                speed: speedMps,
                heading: bearingHarness(a, b)
            ),
            timestamp: startMs + (t * 1000.0).rounded()
        ))
        along += speedMps * dtSec
        t += dtSec
    }

    return out
}

private final class HarnessState: @unchecked Sendable {
    var admitted = 0
    var rejected = 0
    var ended = false
    var finalAlongM = 0.0
    var fired: [HarnessFiredStop] = []
}

/// Drive a raw fix trace through the full live path (FixMapper -> TriggerEngine) and report outcomes.
public func driveTrace(
    polyline: [LngLat],
    stops: [DriveStopRef],
    trace: [RawFix],
    opts: TriggerOptions = DEFAULT_TRIGGER
) -> HarnessResult {
    let engine = TriggerEngine(stops: stops, opts: opts)
    let state = HarnessState()

    let accept = createFixMapper(
        polyline: polyline,
        opts: FixMapperOptions(
            onFix: { f in
                state.admitted += 1
                state.finalAlongM = f.alongM
                for e in engine.update(fix: f) {
                    state.fired.append(HarnessFiredStop(
                        seq: e.seq,
                        tSec: e.tSec,
                        leadSec: e.leadSec,
                        distanceM: e.distanceM
                    ))
                }
            },
            onEnd: {
                state.ended = true
            }
        )
    )

    for raw in trace {
        if !accept(raw) {
            state.rejected += 1
        }
    }

    let firedSeqs = Set(state.fired.map { $0.seq })
    let neverFired = stops.map { $0.seq }.filter { !firedSeqs.contains($0) }

    return HarnessResult(
        admitted: state.admitted,
        rejected: state.rejected,
        ended: state.ended,
        fired: state.fired,
        neverFired: neverFired,
        finalAlongM: state.finalAlongM
    )
}
