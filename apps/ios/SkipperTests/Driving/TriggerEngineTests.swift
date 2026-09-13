import XCTest
import Foundation
@testable import Skipper

final class TriggerEngineTests: XCTestCase {
    private let MPH60 = 26.82 // m/s
    private let MPH20 = 8.94  // m/s
    private let northStop = DriveStopRef(seq: 1, lat: 0.01, lng: 0, triggerRadiusM: 120, durationMs: 30_000, name: "North")

    private func fix(lat: Double, lng: Double, speedMps: Double, headingDeg: Double, tSec: Double = 0.0) -> GpsFix {
        GpsFix(lat: lat, lng: lng, speedMps: speedMps, headingDeg: headingDeg, tSec: tSec, alongM: 0.0)
    }

    func testEffectiveRadiusSpeedAdaptiveLead() {
        XCTAssertEqual(effectiveRadiusM(triggerRadiusM: 120, speedMps: MPH60, leadSeconds: 12), 321.84, accuracy: 0.1)
        XCTAssertEqual(effectiveRadiusM(triggerRadiusM: 120, speedMps: MPH20, leadSeconds: 12), 120.0, accuracy: 0.0001)
    }

    func testFiresOnceOnApproachThenDebounces() {
        let e = TriggerEngine(stops: [northStop])
        // ~1113 m out, beyond 322 m effective radius
        XCTAssertEqual(e.update(fix: fix(lat: 0, lng: 0, speedMps: MPH60, headingDeg: 0)).count, 0)

        // ~222 m out, heading north -> fire
        let fired = e.update(fix: fix(lat: 0.008, lng: 0, speedMps: MPH60, headingDeg: 0))
        XCTAssertEqual(fired.count, 1)
        XCTAssertEqual(fired[0].seq, 1)
        XCTAssertGreaterThan(fired[0].leadSec, 5.0)
        XCTAssertLessThan(fired[0].leadSec, 12.0)

        // Debounced on next fix
        XCTAssertEqual(e.update(fix: fix(lat: 0.0085, lng: 0, speedMps: MPH60, headingDeg: 0)).count, 0)
        XCTAssertEqual(e.firedCount, 1)
    }

    func testHeadingGateStopBehindAtSpeedDoesNotFire() {
        let e = TriggerEngine(stops: [northStop])
        // Vehicle north of stop (stop behind), heading north (away), within 120m
        XCTAssertEqual(e.update(fix: fix(lat: 0.0109, lng: 0, speedMps: MPH60, headingDeg: 0)).count, 0)
    }

    func testHeadingGateSkippedWhenCrawling() {
        let e = TriggerEngine(stops: [northStop])
        // 1.0 m/s < 2.2 m/s gate speed -> heading gate skipped
        let fired = e.update(fix: fix(lat: 0.0109, lng: 0, speedMps: 1.0, headingDeg: 0))
        XCTAssertEqual(fired.count, 1)
    }

    func testUnknownHeadingSkippedProximityFires() {
        let e = TriggerEngine(stops: [northStop])
        // iOS course -1 sentinel indicates unknown heading -> gate skipped
        let fired = e.update(fix: fix(lat: 0.0109, lng: 0, speedMps: MPH60, headingDeg: -1))
        XCTAssertEqual(fired.count, 1)
    }

    func testPassedPointRetireSuppressesLateFire() {
        let e = TriggerEngine(stops: [northStop]) // stop at lat 0.01
        // Approach from south heading SE (135°): gated on the way in
        XCTAssertEqual(e.update(fix: fix(lat: 0.008, lng: 0, speedMps: MPH60, headingDeg: 135, tSec: 0)).count, 0)
        XCTAssertEqual(e.update(fix: fix(lat: 0.0098, lng: 0, speedMps: MPH60, headingDeg: 135, tSec: 1)).count, 0)

        // Past stop with unknown heading: receded past closest approach -> retired!
        XCTAssertEqual(e.update(fix: fix(lat: 0.011, lng: 0, speedMps: MPH60, headingDeg: -1, tSec: 2)).count, 0)
        XCTAssertEqual(e.firedCount, 0)
    }

    func testPassedPointRetireRearmsOnOutOfRange() {
        let e = TriggerEngine(stops: [northStop])
        _ = e.update(fix: fix(lat: 0.0098, lng: 0, speedMps: MPH60, headingDeg: 135, tSec: 0))
        _ = e.update(fix: fix(lat: 0.011, lng: 0, speedMps: MPH60, headingDeg: -1, tSec: 1)) // retired
        _ = e.update(fix: fix(lat: 0.02, lng: 0, speedMps: MPH60, headingDeg: 0, tSec: 2)) // out of range -> re-arm

        // Fresh approach from south heading north fires
        let fired = e.update(fix: fix(lat: 0.008, lng: 0, speedMps: MPH60, headingDeg: 0, tSec: 3))
        XCTAssertEqual(fired.count, 1)
    }

    func testSpeedAdaptiveRangeDifference() {
        let ahead60 = fix(lat: 0.0073, lng: 0, speedMps: MPH60, headingDeg: 0) // ~300 m south
        XCTAssertEqual(TriggerEngine(stops: [northStop]).update(fix: ahead60).count, 1)

        let slow20 = fix(lat: 0.0073, lng: 0, speedMps: MPH20, headingDeg: 0)
        XCTAssertEqual(TriggerEngine(stops: [northStop]).update(fix: slow20).count, 0)
    }

    func testMalformedFixIgnoredAndDoesNotCorruptEngine() {
        let stops = [
            DriveStopRef(seq: 1, lat: 0.008, lng: 0, triggerRadiusM: 120, durationMs: 30_000, name: "A"),
            DriveStopRef(seq: 2, lat: 0.0081, lng: 0, triggerRadiusM: 120, durationMs: 30_000, name: "B"),
        ]
        let e = TriggerEngine(stops: stops)
        XCTAssertEqual(e.update(fix: fix(lat: Double.nan, lng: 0, speedMps: MPH60, headingDeg: 0)).count, 0)
        XCTAssertEqual(e.update(fix: fix(lat: 0.008, lng: 0, speedMps: Double.nan, headingDeg: 0)).count, 0)
        XCTAssertEqual(e.firedCount, 0)

        // Subsequent valid fix fires both
        let fired = e.update(fix: fix(lat: 0.0079, lng: 0, speedMps: MPH60, headingDeg: 0))
        XCTAssertEqual(fired.map { $0.seq }.sorted(), [1, 2])
    }

    func testBearingFloorOriginFiresAllHeadingsAtSpeedAndParked() {
        let mLat = 110_574.0
        let mLng = 111_320.0

        func firesLeaving(headingDeg: Double, speedMps: Double) -> Bool {
            let r = (headingDeg * .pi) / 180.0
            let route: [LngLat] = (0...100).map { i in
                LngLat(
                    (sin(r) * (Double(i) * 20.0)) / mLng,
                    (cos(r) * (Double(i) * 20.0)) / mLat
                )
            }
            let stop = DriveStopRef(seq: 0, lat: 0, lng: 0, triggerRadiusM: 150)
            let snapped = snapStopsToRoute(polyline: route, stops: [stop])
            let e = TriggerEngine(stops: snapped.map { s in
                DriveStopRef(seq: s.seq, lat: s.lat, lng: s.lng, triggerRadiusM: s.triggerRadiusM)
            })

            for i in 0..<40 {
                let m = speedMps * 0.25 * Double(i)
                let f = fix(
                    lat: (cos(r) * m) / mLat,
                    lng: (sin(r) * m) / mLng,
                    speedMps: speedMps,
                    headingDeg: headingDeg,
                    tSec: Double(i) * 0.25
                )
                if !e.update(fix: f).isEmpty { return true }
            }
            return false
        }

        // Test 8 cardinal and intercardinal departures at 60 mph
        for h in [0.0, 45.0, 90.0, 135.0, 180.0, 221.0, 270.0, 315.0] {
            XCTAssertTrue(firesLeaving(headingDeg: h, speedMps: MPH60), "Failed leaving on heading \(h)° at 60 mph")
        }

        // Test parked start
        for h in [0.0, 135.0, 221.0, 270.0] {
            XCTAssertTrue(firesLeaving(headingDeg: h, speedMps: 0.0), "Failed parked start on heading \(h)°")
        }
    }

    func testSnapStopsToRoute() {
        let route: [LngLat] = (0...10).map { i in LngLat(0, Double(i) * 0.001) }
        let stops = [DriveStopRef(seq: 0, lat: 0.005, lng: 0.001, triggerRadiusM: 120)]
        let snapped = snapStopsToRoute(polyline: route, stops: stops)[0]

        XCTAssertEqual(snapped.poiLat, 0.005)
        XCTAssertEqual(snapped.poiLng, 0.001)
        XCTAssertEqual(snapped.lng, 0.0, accuracy: 0.000001)
        XCTAssertEqual(snapped.lat, 0.005, accuracy: 0.001)
        XCTAssertGreaterThan(snapped.offRouteM, 90.0)
        XCTAssertLessThan(snapped.offRouteM, 130.0)
    }
}
