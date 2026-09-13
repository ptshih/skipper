import XCTest
import Foundation
@testable import Skipper

final class FixMapperTests: XCTestCase {
    func testSaneNonNeg() {
        XCTAssertEqual(saneNonNeg(-1), 0.0)
        XCTAssertEqual(saneNonNeg(nil), 0.0)
        XCTAssertEqual(saneNonNeg(0), 0.0)
        XCTAssertEqual(saneNonNeg(15.5), 15.5)
    }

    func testAccuracyCeilingM() {
        XCTAssertEqual(accuracyCeilingM(speedMps: 0), MAX_FIX_ACCURACY_M)
        XCTAssertEqual(accuracyCeilingM(speedMps: 10), 60.0) // 10 * 12 * 0.5 = 60
        XCTAssertEqual(accuracyCeilingM(speedMps: 30), 180.0) // 30 * 12 * 0.5 = 180
    }

    func testAccuracyOk() {
        XCTAssertTrue(accuracyOk(acc: 10, speedMps: 0))
        XCTAssertFalse(accuracyOk(acc: 55, speedMps: 0)) // 55 > 50

        // In a granite canyon at speed, 120m accuracy is admitted
        XCTAssertTrue(accuracyOk(acc: 120, speedMps: 30))
        XCTAssertFalse(accuracyOk(acc: 200, speedMps: 30))

        // iOS -1 sentinel is always rejected
        XCTAssertFalse(accuracyOk(acc: -1, speedMps: 30))

        // Nil accuracy is admitted
        XCTAssertTrue(accuracyOk(acc: nil, speedMps: 30))
    }

    func testProjectForwardIndexMonotonicAndOffRoute() {
        let polyline: [LngLat] = (0..<50).map { i in LngLat(0, Double(i) * 0.001) }

        // Forward advance
        let c1 = projectForwardIndex(polyline: polyline, cursor: 0, lng: 0, lat: 0.005, window: 10, maxOffRouteM: 700)
        XCTAssertEqual(c1, 5)

        // Monotonic guarantee: candidate behind cursor keeps current cursor
        let c2 = projectForwardIndex(polyline: polyline, cursor: 5, lng: 0, lat: 0.004, window: 10, maxOffRouteM: 700)
        XCTAssertEqual(c2, 5)

        // Off-route freeze (> 700m off route holds position)
        let c3 = projectForwardIndex(polyline: polyline, cursor: 5, lng: 0.05, lat: 0.005, window: 10, maxOffRouteM: 700)
        XCTAssertEqual(c3, 5)
    }

    func testReachedRouteEndThreeClauses() {
        // Clause 1: alongM near end
        XCTAssertTrue(reachedRouteEnd(
            alongM: 990,
            routeEndM: 1000,
            cursor: 50,
            polylineLen: 100,
            rawToEndM: 500,
            epsilonM: 25
        ))

        // Clause 2: cursor near end and rawToEnd small
        XCTAssertTrue(reachedRouteEnd(
            alongM: 500,
            routeEndM: 1000,
            cursor: 98,
            polylineLen: 100,
            rawToEndM: 50,
            epsilonM: 25,
            maxEndDistM: 700
        ))

        // Clause 2 rejected: cursor at end but rawToEnd is huge (e.g. Cupertino start)
        XCTAssertFalse(reachedRouteEnd(
            alongM: 500,
            routeEndM: 1000,
            cursor: 98,
            polylineLen: 100,
            rawToEndM: 1000,
            epsilonM: 25,
            maxEndDistM: 700
        ))

        // Clause 3: rawToEnd small and >50% route covered (GPS lag recovery)
        XCTAssertTrue(reachedRouteEnd(
            alongM: 600,
            routeEndM: 1000,
            cursor: 60,
            polylineLen: 100,
            rawToEndM: 20,
            epsilonM: 25
        ))

        // Clause 3 rejected at start of loop (alongM < 50% routeEndM)
        XCTAssertFalse(reachedRouteEnd(
            alongM: 100,
            routeEndM: 1000,
            cursor: 10,
            polylineLen: 100,
            rawToEndM: 20,
            epsilonM: 25
        ))
    }

    func testFixMapperPipelineStreaming() {
        final class StreamBox: @unchecked Sendable {
            var fixesReceived: [GpsFix] = []
            var endTriggered = false
        }
        let box = StreamBox()
        let route: [LngLat] = (0..<10).map { i in LngLat(0, Double(i) * 0.001) }

        let accept = createFixMapper(
            polyline: route,
            opts: FixMapperOptions(
                onFix: { f in box.fixesReceived.append(f) },
                onEnd: { box.endTriggered = true }
            )
        )

        // Raw fix 1: rejected by accuracy gate (>50m at rest)
        let rejected = accept(RawFix(
            coords: RawFixCoords(latitude: 0, longitude: 0, accuracy: 100, speed: 0, heading: 0),
            timestamp: 1000
        ))
        XCTAssertFalse(rejected)
        XCTAssertEqual(box.fixesReceived.count, 0)

        // Raw fix 2: admitted good fix
        let admitted1 = accept(RawFix(
            coords: RawFixCoords(latitude: 0, longitude: 0, accuracy: 5, speed: 10, heading: 0),
            timestamp: 2000
        ))
        XCTAssertTrue(admitted1)
        XCTAssertEqual(box.fixesReceived.count, 1)
        XCTAssertEqual(box.fixesReceived[0].tSec, 0.0) // first admitted fix starts clock

        // Raw fix 3: at the end of the route
        let admittedEnd = accept(RawFix(
            coords: RawFixCoords(latitude: 0.009, longitude: 0, accuracy: 5, speed: 10, heading: 0),
            timestamp: 3000
        ))
        XCTAssertTrue(admittedEnd)
        XCTAssertEqual(box.fixesReceived.count, 2)
        XCTAssertEqual(box.fixesReceived[1].tSec, 1.0)
        XCTAssertTrue(box.endTriggered)
    }
}
