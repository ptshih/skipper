import XCTest
import Foundation
@testable import Skipper

final class HarnessTests: XCTestCase {
    // ~5.5 km due north from (0,0): 501 vertices at 0.0001° (~11.1 m) each.
    private let route: [LngLat] = (0...500).map { i in LngLat(0, Double(i) * 0.0001) }

    // Four stops spaced along it, on the line, with 250m trigger radius.
    private lazy var stops: [DriveStopRef] = [100, 200, 300, 400].enumerated().map { i, v in
        DriveStopRef(
            seq: i,
            lat: route[v].latitude,
            lng: route[v].longitude,
            triggerRadiusM: 250,
            durationMs: 60_000,
            name: "stop \(i)",
            stopType: "story"
        )
    }

    func testSyntheticTraceGeneration() {
        let trace = syntheticTrace(polyline: route, opts: SyntheticTraceOptions(mph: 45))
        XCTAssertGreaterThan(trace.count, 200)
        XCTAssertEqual(trace[0].timestamp, 1_700_000_000_000.0)
        XCTAssertEqual(trace[0].coords.speed ?? 0.0, 45.0 * 0.44704, accuracy: 0.001)
    }

    func testBaselineDriveTraceFiresAllStopsInOrderAndCompletes() {
        let trace = syntheticTrace(polyline: route, opts: SyntheticTraceOptions(mph: 45))
        let r = driveTrace(polyline: route, stops: stops, trace: trace)

        XCTAssertEqual(r.rejected, 0)
        XCTAssertEqual(r.neverFired, [])
        XCTAssertEqual(r.fired.map { $0.seq }, [0, 1, 2, 3])
        XCTAssertTrue(r.ended)

        // Monotonic fire times
        for i in 1..<r.fired.count {
            XCTAssertGreaterThan(r.fired[i].tSec, r.fired[i - 1].tSec)
        }

        // Real advance warning
        for f in r.fired {
            XCTAssertGreaterThan(f.leadSec, 0.0)
        }

        // Projection cursor reaches end
        XCTAssertGreaterThan(r.finalAlongM, 5000.0)
    }

    func testZeroFireAllNoisyAtRestRejected() {
        let base = syntheticTrace(polyline: route, opts: SyntheticTraceOptions(mph: 45))
        let noisy = base.map { f in
            RawFix(
                coords: RawFixCoords(
                    latitude: f.coords.latitude,
                    longitude: f.coords.longitude,
                    accuracy: 900,
                    speed: 0,
                    heading: f.coords.heading
                ),
                timestamp: f.timestamp
            )
        }
        let r = driveTrace(polyline: route, stops: stops, trace: noisy)

        XCTAssertEqual(r.admitted, 0)
        XCTAssertEqual(r.rejected, noisy.count)
        XCTAssertEqual(r.neverFired, [0, 1, 2, 3])
        XCTAssertFalse(r.ended)
    }

    func testNoisyAtSpeedAdmittedInCanyon() {
        let base = syntheticTrace(polyline: route, opts: SyntheticTraceOptions(mph: 67))
        // 120m accuracy at 30 m/s: ceiling = 30 * 12 * 0.5 = 180m -> admitted
        let canyon = base.map { f in
            RawFix(
                coords: RawFixCoords(
                    latitude: f.coords.latitude,
                    longitude: f.coords.longitude,
                    accuracy: 120,
                    speed: 30,
                    heading: f.coords.heading
                ),
                timestamp: f.timestamp
            )
        }
        let r = driveTrace(polyline: route, stops: stops, trace: canyon)

        XCTAssertEqual(r.rejected, 0)
        XCTAssertEqual(r.neverFired, [])
        XCTAssertTrue(r.ended)
    }

    func testUnknownHeadingMinusOneDoesNotGateSouthboundDrive() {
        // Drive south: a mistakenly-zeroed heading (0 = north) would point away from every stop and gate them out!
        let southRoute = route.map { LngLat($0.longitude, -$0.latitude) }
        let southStops = stops.map { DriveStopRef(seq: $0.seq, lat: -$0.lat, lng: $0.lng, triggerRadiusM: $0.triggerRadiusM) }
        let base = syntheticTrace(polyline: southRoute, opts: SyntheticTraceOptions(mph: 45))
        let unknownHeading = base.map { f in
            RawFix(
                coords: RawFixCoords(
                    latitude: f.coords.latitude,
                    longitude: f.coords.longitude,
                    accuracy: f.coords.accuracy,
                    speed: f.coords.speed,
                    heading: -1 // raw iOS unknown heading
                ),
                timestamp: f.timestamp
            )
        }
        let r = driveTrace(polyline: southRoute, stops: southStops, trace: unknownHeading)

        XCTAssertEqual(r.neverFired, [])
        XCTAssertEqual(r.fired.map { $0.seq }, [0, 1, 2, 3])
    }

    func testColdStartPrefixRejectedThenCompletes() {
        let clean = syntheticTrace(polyline: route, opts: SyntheticTraceOptions(mph: 45))
        let cold = clean.prefix(8).map { f in
            RawFix(
                coords: RawFixCoords(
                    latitude: f.coords.latitude,
                    longitude: f.coords.longitude,
                    accuracy: 1000,
                    speed: 0,
                    heading: f.coords.heading
                ),
                timestamp: f.timestamp
            )
        }
        let trace = Array(cold) + clean
        let r = driveTrace(polyline: route, stops: stops, trace: trace)

        XCTAssertEqual(r.rejected, 8)
        XCTAssertEqual(r.neverFired, [])
        XCTAssertTrue(r.ended)
    }
}
