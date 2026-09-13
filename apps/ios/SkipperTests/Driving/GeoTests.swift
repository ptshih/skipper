import XCTest
import Foundation
@testable import Skipper

final class GeoTests: XCTestCase {
    func testHaversineMetersCardinal() {
        let d = haversineMeters(LngLat(0, 0), LngLat(0, 1))
        XCTAssertGreaterThan(d, 110_000)
        XCTAssertLessThan(d, 112_000)
    }

    func testBearingDegCardinalDirections() {
        XCTAssertEqual(bearingDeg(LngLat(0, 0), LngLat(0, 1)), 0.0, accuracy: 0.1) // North
        XCTAssertEqual(bearingDeg(LngLat(0, 0), LngLat(1, 0)), 90.0, accuracy: 0.1) // East
        XCTAssertEqual(bearingDeg(LngLat(0, 0), LngLat(0, -1)), 180.0, accuracy: 0.1) // South
        XCTAssertEqual(bearingDeg(LngLat(0, 0), LngLat(-1, 0)), 270.0, accuracy: 0.1) // West
        XCTAssertEqual(bearingDeg(LngLat(0, 0), LngLat(0, 0)), 0.0, accuracy: 0.0001) // Coincident -> 0
    }

    func testAngularDiffDegWraparound() {
        XCTAssertEqual(angularDiffDeg(10, 350), 20.0, accuracy: 0.0001)
        XCTAssertEqual(angularDiffDeg(350, 10), 20.0, accuracy: 0.0001)
        XCTAssertEqual(angularDiffDeg(0, 180), 180.0, accuracy: 0.0001)
        XCTAssertEqual(angularDiffDeg(90, 90), 0.0, accuracy: 0.0001)
        XCTAssertEqual(angularDiffDeg(45, 225), 180.0, accuracy: 0.0001)
    }

    func testInterpolateClampedAndLinear() {
        let mid = interpolate(LngLat(0, 0), LngLat(2, 4), 0.5)
        XCTAssertEqual(mid.longitude, 1.0, accuracy: 0.0001)
        XCTAssertEqual(mid.latitude, 2.0, accuracy: 0.0001)

        let under = interpolate(LngLat(0, 0), LngLat(2, 4), -1.0)
        XCTAssertEqual(under.longitude, 0.0, accuracy: 0.0001)
        XCTAssertEqual(under.latitude, 0.0, accuracy: 0.0001)

        let over = interpolate(LngLat(0, 0), LngLat(2, 4), 5.0)
        XCTAssertEqual(over.longitude, 2.0, accuracy: 0.0001)
        XCTAssertEqual(over.latitude, 4.0, accuracy: 0.0001)
    }

    func testCumulativeMetersMonotonicAndZeroStart() {
        let line: [LngLat] = [
            LngLat(0, 0),
            LngLat(0, 0.001),
            LngLat(0, 0.002),
        ]
        let cum = cumulativeMeters(line)
        XCTAssertEqual(cum.count, 3)
        XCTAssertEqual(cum[0], 0.0)
        XCTAssertGreaterThan(cum[1], 0.0)
        XCTAssertGreaterThan(cum[2], cum[1])
    }

    func testNearestOnRoute() {
        let poly: [LngLat] = [
            LngLat(0, 0),
            LngLat(0, 0.001),
            LngLat(0, 0.002),
            LngLat(0, 0.003),
        ]
        let cum = cumulativeMeters(poly)
        let pos = nearestOnRoute(polyline: poly, cumulative: cum, point: LngLat(0.0005, 0.0015))
        XCTAssertTrue(pos.index == 1 || pos.index == 2)
        XCTAssertGreaterThan(pos.offRouteM, 0.0)
        XCTAssertLessThan(pos.offRouteM, 100.0)
    }

    func testRadiusForKindVocabulary() {
        XCTAssertEqual(radiusForKind("point"), 1200.0)
        XCTAssertEqual(radiusForKind("cape"), 1200.0)
        XCTAssertEqual(radiusForKind("pass"), 1500.0)
        XCTAssertEqual(radiusForKind("waterfall"), 1000.0)
        XCTAssertEqual(radiusForKind("overlook"), 1000.0)
        XCTAssertEqual(radiusForKind("viewpoint"), 1000.0) // park tier, not areal point
        XCTAssertEqual(radiusForKind("spring"), 600.0)
        XCTAssertEqual(radiusForKind("State Park"), 1000.0) // case insensitive
        XCTAssertEqual(radiusForKind("CAPE"), 1200.0)
        XCTAssertEqual(radiusForKind("Mountain"), 1500.0)
        XCTAssertEqual(radiusForKind(nil), 600.0)
    }

    func testTriggerRadiusForKindAnchoredVsUnanchored() {
        XCTAssertEqual(triggerRadiusForKind("mountain", anchored: true), ANCHORED_TRIGGER_RADIUS_M)
        XCTAssertEqual(triggerRadiusForKind("bay", anchored: true), ANCHORED_TRIGGER_RADIUS_M)
        XCTAssertEqual(triggerRadiusForKind(nil, anchored: true), ANCHORED_TRIGGER_RADIUS_M)

        XCTAssertEqual(triggerRadiusForKind("mountain", anchored: false), 1500.0)
        XCTAssertEqual(triggerRadiusForKind("bay", anchored: false), 1200.0)
        XCTAssertEqual(triggerRadiusForKind(nil, anchored: false), 600.0)
    }

    func testSpeakableAnchorCheck() {
        let checkPass = checkSpeakableAnchor(pin: LngLat(0, 0), anchor: LngLat(0, 0.005), kind: "mountain")
        XCTAssertTrue(checkPass.ok)
        XCTAssertEqual(checkPass.maxM, 2250.0) // 1.5 * 1500

        let checkFail = checkSpeakableAnchor(pin: LngLat(0, 0), anchor: LngLat(0, 0.05), kind: "spring")
        XCTAssertFalse(checkFail.ok)
        XCTAssertEqual(checkFail.maxM, 900.0) // 1.5 * 600
    }

    func testAccessPointCheck() {
        let checkPass = checkAccessPoint(pin: LngLat(0, 0), access: LngLat(0, 0.005))
        XCTAssertTrue(checkPass.ok)
        XCTAssertEqual(checkPass.maxM, ACCESS_POINT_MAX_M)

        let checkFail = checkAccessPoint(pin: LngLat(0, 0), access: LngLat(0, 0.03))
        XCTAssertFalse(checkFail.ok)
    }

    func testRetraceFractionLoopVsOutAndBack() {
        let loop: [LngLat] = (0..<100).map { i in
            let angle = (Double(i) * 2.0 * .pi) / 100.0
            return LngLat(cos(angle) * 0.05, sin(angle) * 0.05)
        }
        let frac = retraceFraction(polyline: loop)
        XCTAssertLessThan(frac, LOOP_MAX_RETRACE)
    }

    func testRegionBboxParsing() {
        let single = parseRegionBbox("-120.2,38.9,-119.8,39.3")
        XCTAssertNotNil(single)
        XCTAssertEqual(single?.swLng, -120.2)
        XCTAssertEqual(single?.swLat, 38.9)
        XCTAssertEqual(single?.neLng, -119.8)
        XCTAssertEqual(single?.neLat, 39.3)

        XCTAssertNil(parseRegionBbox("not,a,box"))
        XCTAssertNil(parseRegionBbox("-120,38,-119,39;-119,39,-118,40")) // multi refused in single

        let multi = parseRegionBboxes("-120,38,-119,39 ; -119,39,-118,40 ; ")
        XCTAssertEqual(multi.count, 2)
        XCTAssertEqual(multi[0].swLng, -120.0)
        XCTAssertEqual(multi[1].neLat, 40.0)

        let formatted = formatRegionBboxes(multi)
        XCTAssertEqual(formatted, "-120.0,38.0,-119.0,39.0;-119.0,39.0,-118.0,40.0")

        XCTAssertTrue(pointInRegionBbox(box: multi[0], lat: 38.5, lng: -119.5))
        XCTAssertFalse(pointInRegionBbox(box: multi[0], lat: 37.5, lng: -119.5))
        XCTAssertTrue(pointInAnyRegionBbox(boxes: multi, lat: 39.5, lng: -118.5))
        XCTAssertFalse(pointInAnyRegionBbox(boxes: multi, lat: 41.0, lng: -118.5))

        let area = containingRegionBboxArea(boxes: multi, lat: 38.5, lng: -119.5)
        XCTAssertNotNil(area)
        XCTAssertEqual(area!, 1.0, accuracy: 0.0001)
    }
}
