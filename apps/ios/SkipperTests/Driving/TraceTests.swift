import XCTest
import Foundation
@testable import Skipper

final class TraceTests: XCTestCase {
    private let route: [LngLat] = (0..<20).map { i in LngLat(0, Double(i) * 0.0001) }
    private lazy var meta = TraceMeta(
        driveId: "b6388400-0df4-4edc-a2e0-f4ca65072279",
        recordedAt: "2026-08-03T12:00:00.000Z",
        polyline: route
    )

    private func makeFix(i: Int, speed: Double? = 20, heading: Double? = 90, accuracy: Double? = 5) -> RawFix {
        RawFix(
            coords: RawFixCoords(
                latitude: Double(i) * 0.0001,
                longitude: 0,
                accuracy: accuracy,
                speed: speed,
                heading: heading
            ),
            timestamp: 1_700_000_000_000.0 + Double(i) * 1000.0
        )
    }

    func testTraceRecorderOrderCountAndSpan() {
        let r = TraceRecorder()
        for i in 0..<10 { r.record(raw: makeFix(i: i)) }
        XCTAssertEqual(r.count, 10)
        XCTAssertEqual(r.spanSec, 9.0)
        XCTAssertFalse(r.truncated)
    }

    func testPreservesIosSentinelsVerbatim() {
        let r = TraceRecorder()
        r.record(raw: makeFix(i: 0, speed: -1, heading: -1, accuracy: -1))
        let env = r.envelope(meta: meta)
        XCTAssertEqual(env.fixes[0].coords.speed, -1.0)
        XCTAssertEqual(env.fixes[0].coords.heading, -1.0)
        XCTAssertEqual(env.fixes[0].coords.accuracy, -1.0)
    }

    func testPreservesNilsDistinctlyFromSentinels() {
        let r = TraceRecorder()
        r.record(raw: makeFix(i: 0, speed: nil, heading: nil, accuracy: nil))
        let env = r.envelope(meta: meta)
        XCTAssertNil(env.fixes[0].coords.speed)
        XCTAssertNil(env.fixes[0].coords.heading)
        XCTAssertNil(env.fixes[0].coords.accuracy)
    }

    func testStopEndsCapture() {
        let r = TraceRecorder()
        r.record(raw: makeFix(i: 0))
        r.stop()
        r.record(raw: makeFix(i: 1))
        XCTAssertEqual(r.count, 1)
    }

    func testSpanSecZeroForFewerThanTwoFixes() {
        let r = TraceRecorder()
        XCTAssertEqual(r.spanSec, 0.0)
        r.record(raw: makeFix(i: 0))
        XCTAssertEqual(r.spanSec, 0.0)
    }

    func testEnvelopeSnapshotDoesNotAliasLiveBuffer() {
        let r = TraceRecorder()
        r.record(raw: makeFix(i: 0))
        let env = r.envelope(meta: meta)
        r.record(raw: makeFix(i: 1))
        XCTAssertEqual(env.fixes.count, 1)
        XCTAssertEqual(r.count, 2)
    }

    func testPolylineFingerprintIdenticalAndJitterTolerance() {
        let hash1 = polylineFingerprint(route)
        let hash2 = polylineFingerprint(route.map { LngLat($0.longitude, $0.latitude) })
        XCTAssertEqual(hash1, hash2)

        // Sub-meter float noise rounded to 5 decimal places does NOT change fingerprint
        let jittered = route.map { LngLat($0.longitude + 1e-9, $0.latitude + 1e-9) }
        XCTAssertEqual(polylineFingerprint(jittered), hash1)

        // Distinct route produces distinct fingerprint
        let other = route.map { LngLat($0.longitude + 0.01, $0.latitude) }
        XCTAssertNotEqual(polylineFingerprint(other), hash1)
    }

    func testTraceMatchesRoute() {
        let r = TraceRecorder()
        r.record(raw: makeFix(i: 0))
        let env = r.envelope(meta: meta)

        // Exact match
        let match = traceMatchesRoute(env: env, polyline: route)
        XCTAssertTrue(match.ok)
        XCTAssertNil(match.reason)

        // Vertex count mismatch
        var wrongCount = route
        wrongCount.removeLast()
        let countMismatch = traceMatchesRoute(env: env, polyline: wrongCount)
        XCTAssertFalse(countMismatch.ok)
        XCTAssertTrue(countMismatch.reason?.contains("vertices") ?? false)

        // Hash mismatch
        let wrongHash = route.map { LngLat($0.longitude + 0.01, $0.latitude) }
        let hashMismatch = traceMatchesRoute(env: env, polyline: wrongHash)
        XCTAssertFalse(hashMismatch.ok)
        XCTAssertTrue(hashMismatch.reason?.contains("fingerprint") ?? false)
    }

    func testTraceFileName() {
        let env = TraceEnvelope(
            driveId: "b6388400-0df4-4edc-a2e0-f4ca65072279",
            recordedAt: "2026-08-03T12:00:00.000Z",
            routeVertices: 20,
            routeHash: "deadbeef",
            truncated: false,
            fixes: []
        )
        let name = traceFileName(env: env)
        XCTAssertEqual(name, "trace-b6388400-2026-08-03T12-00-00-000Z.json")
    }

    func testParseTraceEnvelope() throws {
        let r = TraceRecorder()
        r.record(raw: makeFix(i: 0))
        let env = r.envelope(meta: meta)

        let encoder = JSONEncoder()
        let data = try encoder.encode(env)
        let jsonStr = String(data: data, encoding: .utf8)!

        let parsed = parseTraceEnvelope(json: jsonStr)
        XCTAssertNotNil(parsed)
        XCTAssertEqual(parsed?.driveId, meta.driveId)
        XCTAssertEqual(parsed?.fixes.count, 1)

        // Invalid JSON strings return nil
        XCTAssertNil(parseTraceEnvelope(json: "invalid-json"))
        XCTAssertNil(parseTraceEnvelope(json: "{}"))
        XCTAssertNil(parseTraceEnvelope(json: "{\"driveId\":\"test\"}"))
    }
}
