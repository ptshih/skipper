import XCTest
import Foundation
@testable import Skipper

final class SimulateTests: XCTestCase {
    // ~11.1 km straight north (0.001 deg lat ≈ 111.19 m). At 45 mph ≈ 20.117 m/s the whole drive is ≈ 552 s.
    private let route: [LngLat] = (0...100).map { i in LngLat(0, 38.0 + Double(i) * 0.001) }
    private let mph = 45.0

    private func makeStop(seq: Int, lat: Double, durationMs: Double) -> DriveStopRef {
        DriveStopRef(
            seq: seq,
            lat: lat,
            lng: 0.0003,
            triggerRadiusM: 120,
            durationMs: durationMs,
            name: "stop \(seq)"
        )
    }

    func testGenerateDriveEmptyOrShortPolyline() {
        XCTAssertEqual(generateDrive(polyline: []).count, 0)
        XCTAssertEqual(generateDrive(polyline: [LngLat(0, 0)]).count, 0)
    }

    func testGenerateDriveLinearSpeedAndTimings() {
        let fixes = generateDrive(polyline: route, opts: DriveOptions(mph: mph, tickHz: 4))
        XCTAssertGreaterThan(fixes.count, 2000)
        XCTAssertEqual(fixes[0].tSec, 0.0)
        XCTAssertEqual(fixes[0].alongM, 0.0)
        XCTAssertGreaterThan(fixes.last!.tSec, 500.0)
        XCTAssertGreaterThan(fixes.last!.alongM, 11_000.0)
    }

    func testQuietWindowsTileTheDrive() {
        let r = runDrive(
            polyline: route,
            stops: [makeStop(seq: 0, lat: 38.02, durationMs: 20_000), makeStop(seq: 1, lat: 38.07, durationMs: 20_000)],
            opts: DriveOptions(mph: mph, tickHz: 4)
        )
        let q = r.quietWindows

        // Before first clip, between the two, and after the last.
        XCTAssertEqual(q.count, 3)
        XCTAssertNil(q[0].afterSeq) // drive opens in silence
        XCTAssertEqual(q[0].beforeSeq, 0)
        XCTAssertNil(q[2].beforeSeq) // ends in silence
        XCTAssertEqual(q[2].afterSeq, 1)

        // Ordered and non-overlapping
        for i in 1..<q.count {
            XCTAssertGreaterThanOrEqual(q[i].startSec, q[i - 1].endSec)
        }

        // Tiling identity: quiet + played audio (20s + 20s = 40s) = drive length
        let quietSec = q.reduce(0.0) { $0 + $1.sec }
        XCTAssertEqual(quietSec + 40.0, r.driveSec, accuracy: 0.5)
    }

    func testQueuedClipShortensWindowAfterIt() {
        let r = runDrive(
            polyline: route,
            stops: [
                makeStop(seq: 0, lat: 38.02, durationMs: 120_000),  // fires ≈ 98s, plays 98 → 218
                makeStop(seq: 1, lat: 38.03, durationMs: 120_000),  // fires ≈ 154s — mid-playback, queues: plays 218 → 338
                makeStop(seq: 2, lat: 38.075, durationMs: 20_000),  // fires ≈ 402s
            ],
            opts: DriveOptions(mph: mph, tickHz: 4)
        )
        XCTAssertTrue(r.stops.allSatisfy { $0.fired })

        // Window between queued clip (1) and last stop (2)
        let mid = r.quietWindows.first { $0.afterSeq == 1 && $0.beforeSeq == 2 }
        XCTAssertNotNil(mid)
        XCTAssertGreaterThan(mid!.sec, 50.0)
        XCTAssertLessThan(mid!.sec, 80.0)
        XCTAssertLessThan(mid!.sec, 100.0) // rejects trigger-differenced answer of ~129s

        // Stop 1 queues behind stop 0: NO window between them
        XCTAssertFalse(r.quietWindows.contains { $0.afterSeq == 0 && $0.beforeSeq == 1 })
    }

    func testExcludedOffRouteStops() {
        let offRouteStop = DriveStopRef(
            seq: 99,
            lat: 38.05,
            lng: 0.05, // ~4 km off route (> 700m threshold)
            triggerRadiusM: 120,
            durationMs: 30_000
        )
        let r = runDrive(polyline: route, stops: [offRouteStop], opts: DriveOptions(mph: mph, tickHz: 4))
        XCTAssertEqual(r.excludedOffRoute, [99])
        XCTAssertFalse(r.stops[0].fired)
        XCTAssertTrue(r.stops[0].excluded)
        XCTAssertEqual(r.neverFired.count, 0) // excluded stops are not in neverFired
    }
}
