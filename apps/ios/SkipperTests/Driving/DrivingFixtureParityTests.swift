import Foundation
import XCTest
@testable import Skipper

/// Golden outputs are captured from TypeScript. Inputs for the stateful scenarios come from
/// packages/engine/test/trigger.test.ts and packages/engine/src/harness.test.ts.
/// Distances tolerate 0.1 mm, timings 1 microsecond, coordinates 1e-10 degrees; event order/count
/// and decisions are exact. A missing section is a failure, never an unexecuted green check.
final class DrivingFixtureParityTests: XCTestCase {
    private let meters = 0.0001
    private let seconds = 0.000001
    private let degrees = 0.0000000001

    private func fixture(_ name: String) throws -> [String: Any] {
        #if SWIFT_PACKAGE
        let bundle = Bundle.module
        #else
        let bundle = Bundle(for: DrivingFixtureParityTests.self)
        #endif
        let root = try XCTUnwrap(bundle.url(forResource: "native-ios", withExtension: nil),
                                 "Missing bundled native-ios fixtures")
        let data = try Data(contentsOf: root.appendingPathComponent("driving/\(name)_fixtures.json"))
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(try required(json, "version", as: Int.self), 1, name)
        return json
    }

    private func required<T>(_ json: [String: Any], _ key: String, as type: T.Type = T.self) throws -> T {
        try XCTUnwrap(json[key] as? T, "Missing or malformed required fixture section: \(key)")
    }
    private func rows(_ json: [String: Any], _ key: String) throws -> [[String: Any]] {
        let result: [[String: Any]] = try required(json, key)
        XCTAssertFalse(result.isEmpty, "Fixture matrix \(key) must execute cases")
        return result
    }
    private func decode<T: Decodable>(_ type: T.Type, _ json: Any) throws -> T {
        try JSONDecoder().decode(type, from: JSONSerialization.data(withJSONObject: json, options: .fragmentsAllowed))
    }
    private func point(_ value: Any?) throws -> LngLat {
        let pair = try XCTUnwrap(value as? [Double])
        XCTAssertEqual(pair.count, 2)
        guard pair.count == 2 else { throw CocoaError(.coderInvalidValue) }
        return LngLat(pair[0], pair[1])
    }
    private func polyline(_ value: Any?) throws -> [LngLat] {
        try XCTUnwrap(value as? [[Double]]).map { try point($0) }
    }
    private func events(_ actual: [TriggerEvent], _ expected: Any?, _ name: String) throws {
        let wanted = try decode([TriggerEvent].self, XCTUnwrap(expected, name))
        XCTAssertEqual(actual.map(\.seq), wanted.map(\.seq), name)
        for (a, e) in zip(actual, wanted) {
            XCTAssertEqual(a.tSec, e.tSec, accuracy: seconds, name)
            XCTAssertEqual(a.alongM, e.alongM, accuracy: meters, name)
            XCTAssertEqual(a.distanceM, e.distanceM, accuracy: meters, name)
            XCTAssertEqual(a.speedMps, e.speedMps, accuracy: 0.000001, name)
            XCTAssertEqual(a.leadSec, e.leadSec, accuracy: seconds, name)
        }
    }
    private func northEngine() -> TriggerEngine {
        TriggerEngine(stops: [DriveStopRef(seq: 1, lat: 0.01, lng: 0, triggerRadiusM: 120,
                                          durationMs: 30_000, name: "North")])
    }
    private func fix(_ lat: Double, speed: Double = 26.82, heading: Double = 0, time: Double = 0) -> GpsFix {
        GpsFix(lat: lat, lng: 0, speedMps: speed, headingDeg: heading, tSec: time)
    }

    func testGeoFixturesParity() throws {
        let json = try fixture("geo")
        for c in try rows(json, "haversine") {
            XCTAssertEqual(haversineMeters(try point(c["a"]), try point(c["b"])),
                           try required(c, "expectedM"), accuracy: meters)
        }
        for c in try rows(json, "bearing") {
            XCTAssertEqual(bearingDeg(try point(c["a"]), try point(c["b"])),
                           try required(c, "expectedDeg"), accuracy: degrees)
        }
        for c in try rows(json, "angularDiff") {
            XCTAssertEqual(angularDiffDeg(try required(c, "a"), try required(c, "b")),
                           try required(c, "expectedDeg"), accuracy: degrees)
        }
        for c in try rows(json, "interpolate") {
            let actual = interpolate(try point(c["a"]), try point(c["b"]), try required(c, "frac"))
            let expected = try point(c["expected"])
            XCTAssertEqual(actual.longitude, expected.longitude, accuracy: degrees)
            XCTAssertEqual(actual.latitude, expected.latitude, accuracy: degrees)
        }
        for c in try rows(json, "cumulative") {
            let actual = cumulativeMeters(try polyline(c["polyline"]))
            let expected: [Double] = try required(c, "expectedM")
            XCTAssertEqual(actual.count, expected.count)
            for (a, e) in zip(actual, expected) { XCTAssertEqual(a, e, accuracy: meters) }
        }
        let nearest: [String: Any] = try required(json, "nearestOnRoute")
        let actual = nearestOnRoute(polyline: try polyline(nearest["polyline"]),
                                    cumulative: try required(nearest, "cumulative"), point: try point(nearest["point"]))
        let expected = try decode(RoutePosition.self, XCTUnwrap(nearest["expected"]))
        XCTAssertEqual(actual.index, expected.index)
        XCTAssertEqual(actual.lng, expected.lng, accuracy: degrees)
        XCTAssertEqual(actual.lat, expected.lat, accuracy: degrees)
        XCTAssertEqual(actual.offRouteM, expected.offRouteM, accuracy: meters)
        XCTAssertEqual(actual.alongM, expected.alongM, accuracy: meters)
        let bearingRoute = [LngLat(0, 0), LngLat(0, 0.001), LngLat(0.001, 0.001)]
        for c in try rows(json, "routeBearing") {
            XCTAssertEqual(routeBearingAt(polyline: bearingRoute, index: try required(c, "index")),
                           try required(c, "expectedDeg"), accuracy: degrees)
        }
        for c in try rows(json, "radiusForKind") {
            _ = try XCTUnwrap(c["kind"], "kind may be null but must exist")
            XCTAssertEqual(radiusForKind(c["kind"] as? String), try required(c, "expectedM"), accuracy: meters)
        }
        for c in try rows(json, "triggerRadiusForKind") {
            XCTAssertEqual(triggerRadiusForKind(try required(c, "kind", as: String.self), anchored: try required(c, "anchored")),
                           try required(c, "expectedM"), accuracy: meters)
        }
        // Server-only bbox, corpus anchor eligibility and loop selection records are not client
        // engine parity. They remain in the shared golden file but are outside this test's claim.
    }

    func testTriggerRadiusAndDefaultsParity() throws {
        let json = try fixture("trigger")
        XCTAssertEqual(DEFAULT_TRIGGER, try decode(TriggerOptions.self, XCTUnwrap(json["defaultOptions"])))
        for c in try rows(json, "effectiveRadiusCases") {
            XCTAssertEqual(effectiveRadiusM(triggerRadiusM: try required(c, "triggerRadiusM"),
                                             speedMps: try required(c, "speedMps"), leadSeconds: try required(c, "leadSeconds")),
                           try required(c, "expectedM"), accuracy: meters)
        }
    }

    func testApproachAndDebounceActuallyExecuteEngine() throws {
        let c: [String: Any] = try required(fixture("trigger"), "approachAndDebounce")
        let engine = northEngine()
        try events(engine.update(fix: fix(0)), c["fix1Result"], "approach first")
        try events(engine.update(fix: fix(0.008, time: 1)), c["fix2Result"], "approach fire")
        try events(engine.update(fix: fix(0.0085, time: 2)), c["fix3Result"], "approach debounce")
        XCTAssertEqual(engine.firedCount, try required(c, "firedCount"))
        XCTAssertEqual(engine.firedSeqSet, Set([1]))
    }

    func testHeadingGateFixturesExecuteFreshEngines() throws {
        let c: [String: Any] = try required(fixture("trigger"), "headingGate")
        try events(northEngine().update(fix: fix(0.0109)), c["behindAtSpeed"], "behind at speed")
        try events(northEngine().update(fix: fix(0.0109, speed: 1)), c["crawling"], "crawling")
        try events(northEngine().update(fix: fix(0.0109, heading: -1)), c["unknownHeading"], "unknown heading")
    }

    func testPassedPointRetirementAndRearmingExecuteOneEngine() throws {
        let c: [String: Any] = try required(fixture("trigger"), "passedPointRetire")
        let engine = northEngine()
        try events(engine.update(fix: fix(0.008, heading: 135)), c["step1"], "retire approach")
        try events(engine.update(fix: fix(0.0098, heading: 135, time: 1)), c["step2"], "closest approach")
        try events(engine.update(fix: fix(0.011, heading: -1, time: 2)), c["step3Retired"], "retired")
        XCTAssertEqual(engine.firedCount, 0)
        try events(engine.update(fix: fix(0.02, time: 3)), c["step4OutOfRange"], "out of range")
        try events(engine.update(fix: fix(0.008, time: 4)), c["step5ReArmedFired"], "rearmed")
        XCTAssertEqual(engine.firedCount, 1)
    }

    func testMalformedFixesDoNotConsumeStops() throws {
        let c: [String: Any] = try required(fixture("trigger"), "malformedFixes")
        let engine = TriggerEngine(stops: [
            DriveStopRef(seq: 1, lat: 0.008, lng: 0, triggerRadiusM: 120),
            DriveStopRef(seq: 2, lat: 0.0081, lng: 0, triggerRadiusM: 120),
        ])
        try events(engine.update(fix: fix(.nan)), c["nanCoord"], "NaN coordinate")
        try events(engine.update(fix: fix(0.008, speed: .nan)), c["nanSpeed"], "NaN speed")
        XCTAssertEqual(engine.firedCount, try required(c, "countAfterBad"))
        try events(engine.update(fix: fix(0.0079)), c["validFix"], "valid after malformed")
        XCTAssertEqual(engine.firedSeqSet, Set([1, 2]))
    }

    func testFixMapperFixturesParity() throws {
        let json = try fixture("fix_mapper")
        for c in try rows(json, "saneNonNeg") {
            // Both absent and JSON null are intentional inputs in this matrix.
            XCTAssertEqual(saneNonNeg(c["in"] as? Double), try required(c, "out"), accuracy: meters)
        }
        for c in try rows(json, "accuracyCeiling") {
            XCTAssertEqual(accuracyCeilingM(speedMps: try required(c, "speed")), try required(c, "out"), accuracy: meters)
        }
        for c in try rows(json, "accuracyOk") {
            _ = try XCTUnwrap(c["acc"])
            XCTAssertEqual(accuracyOk(acc: c["acc"] as? Double, speedMps: try required(c, "speed")), try required(c, "out"))
        }
        let projected: [String: Any] = try required(json, "projectForwardIndex")
        let line = (0..<50).map { LngLat(0, Double($0) * 0.001) }
        let c1 = projectForwardIndex(polyline: line, cursor: 0, lng: 0, lat: 0.005, window: 10)
        let c2 = projectForwardIndex(polyline: line, cursor: c1, lng: 0, lat: 0.004, window: 10)
        let c3 = projectForwardIndex(polyline: line, cursor: c2, lng: 0.05, lat: 0.005, window: 10)
        XCTAssertEqual(c1, try required(projected, "c1"))
        XCTAssertEqual(c2, try required(projected, "c2"))
        XCTAssertEqual(c3, try required(projected, "c3"))
        for c in try rows(json, "reachedRouteEnd") {
            let args: [String: Any] = try required(c, "args")
            let actual = reachedRouteEnd(alongM: try required(args, "alongM"), routeEndM: try required(args, "routeEndM"),
                cursor: try required(args, "cursor"), polylineLen: try required(args, "polylineLen"),
                rawToEndM: try required(args, "rawToEndM"), epsilonM: try required(args, "epsilonM"),
                maxEndDistM: (args["maxEndDistM"] as? Double) ?? OFF_ROUTE_MAX_M)
            let name: String = try required(c, "name")
            XCTAssertEqual(actual, try required(c, "expected"), name)
        }
    }

    func testPlayerDecisionFixturesParity() throws {
        let json = try fixture("player_decision")
        for c in try rows(json, "decidePump") {
            let state: [String: Any] = try required(c, "s")
            let actual = decidePump(clipBusy: try required(state, "clipBusy"), queue: try required(state, "queue"),
                                    reachedEnd: try required(state, "reachedEnd"))
            let expected: [String: Any] = try required(c, "expected")
            switch try required(expected, "kind", as: String.self) {
            case "wait": XCTAssertEqual(actual, .wait)
            case "play": XCTAssertEqual(actual, .play(seq: try required(expected, "seq")))
            case "finish": XCTAssertEqual(actual, .finish)
            case "idle": XCTAssertEqual(actual, .idle)
            default: XCTFail("Unrecognized pump fixture action")
            }
        }
        for c in try rows(json, "decideStall") {
            let state: [String: Any] = try required(c, "s")
            let actual = decideStall(now: try required(state, "now"), lastProgressAt: try required(state, "lastProgressAt"),
                lastProgressTime: try required(state, "lastProgressTime"), duration: try required(state, "duration"),
                resumeTried: try required(state, "resumeTried"))
            XCTAssertEqual(actual.rawValue, try required(c, "expected"))
        }
        for c in try rows(json, "clampSeekSec") {
            XCTAssertEqual(clampSeekSec(ms: try required(c, "ms"), durationSec: try required(c, "durationSec")),
                           try required(c, "expected"), accuracy: seconds)
        }
        for c in try rows(json, "seekTargetReached") {
            XCTAssertEqual(seekTargetReached(currentTime: try required(c, "current"), target: try required(c, "target")),
                           try required(c, "expected"))
        }
        for c in try rows(json, "format") {
            let actual: String
            if c.keys.contains("sec") {
                // JSON's null captures the legacy non-finite number case; exercise that branch.
                actual = formatMmss(c["sec"] is NSNull ? .nan : try required(c, "sec"))
            } else { actual = formatMmssMs(try required(c, "ms")) }
            XCTAssertEqual(actual, try required(c, "expected"))
        }
    }

    func testTraceRecorderFixtureIsProducedAndSerialized() throws {
        let json = try fixture("trace")
        for c in try rows(json, "fingerprints") {
            XCTAssertEqual(polylineFingerprint(try polyline(c["polyline"])), try required(c, "expectedHash"))
        }
        let c: [String: Any] = try required(json, "recorder")
        let expected = try decode(TraceEnvelope.self, XCTUnwrap(c["envelope"]))
        let route = [LngLat(-120, 39), LngLat(-120, 39.001)]
        let recorder = TraceRecorder()
        for i in 0..<2 {
            recorder.record(raw: RawFix(coords: RawFixCoords(latitude: 39 + Double(i) * 0.001, longitude: -120,
                accuracy: 5, speed: 20, heading: 90), timestamp: 1_700_000_000_000 + Double(i) * 1000))
        }
        let envelope = recorder.envelope(meta: TraceMeta(driveId: "drive-12345678-test", label: "Test Trace",
            recordedAt: "2026-09-12T12:00:00.000Z", appVersion: "1.2.0", polyline: route))
        XCTAssertEqual(recorder.count, try required(c, "count"))
        XCTAssertEqual(recorder.spanSec, try required(c, "spanSec"), accuracy: seconds)
        XCTAssertEqual(recorder.truncated, try required(c, "truncated"))
        XCTAssertEqual(envelope, expected)
        let text = try XCTUnwrap(String(data: JSONEncoder().encode(envelope), encoding: .utf8))
        let parsed = parseTraceEnvelope(json: text)
        XCTAssertEqual(parsed != nil, try required(c, "parsedOk"))
        XCTAssertEqual(parsed, expected)
        XCTAssertEqual(traceFileName(env: envelope), try required(c, "fileName"))
        let match: [String: Any] = try required(c, "match")
        XCTAssertEqual(traceMatchesRoute(env: envelope, polyline: route).ok, try required(match, "ok"))
        let mismatch: [String: Any] = try required(c, "mismatch")
        let result = traceMatchesRoute(env: envelope, polyline: [LngLat(-120, 39), LngLat(-120, 39.002)])
        XCTAssertEqual(result.ok, try required(mismatch, "ok"))
        XCTAssertEqual(result.reason, try required(mismatch, "reason", as: String.self))
    }

    func testEveryHarnessScenarioExecutesAndChecksTiming() throws {
        let json = try fixture("harness")
        let route = DrivingQAInputs.route
        let stops = DrivingQAInputs.stops
        XCTAssertEqual(route.count, try required(json, "routeVertices"))
        XCTAssertEqual(stops.count, try required(json, "stopsCount"))
        let clean = syntheticTrace(polyline: route, opts: SyntheticTraceOptions(mph: 45))
        let baseline: [String: Any] = try required(json, "baseline")
        XCTAssertEqual(clean.count, try required(baseline, "traceCount"))
        try compareRawFix(XCTUnwrap(clean.first), decode(RawFix.self, XCTUnwrap(baseline["sampleFirstFix"])))
        try compareRawFix(XCTUnwrap(clean.last), decode(RawFix.self, XCTUnwrap(baseline["sampleLastFix"])))
        // The saved noisyAtSpeed fixture changes reported speed/accuracy on the 45-mph geometry.
        // It intentionally does not regenerate a 67-mph trace (that is a separate TS test).
        for name in ["baseline", "noisyAtRest", "noisyAtSpeed", "headingUnknown"] {
            let section: [String: Any] = try required(json, name)
            let expected = try decode(HarnessResult.self, XCTUnwrap(section["result"], name))
            let trace = clean.map { raw -> RawFix in
                var value = raw
                switch name {
                case "noisyAtRest": value.coords.accuracy = 900; value.coords.speed = 0
                case "noisyAtSpeed": value.coords.accuracy = 120; value.coords.speed = 30
                case "headingUnknown": value.coords.heading = -1
                default: break
                }
                return value
            }
            let actual = driveTrace(polyline: route, stops: stops, trace: trace)
            XCTAssertEqual(actual.admitted, expected.admitted, name)
            XCTAssertEqual(actual.rejected, expected.rejected, name)
            XCTAssertEqual(actual.ended, expected.ended, name)
            XCTAssertEqual(actual.neverFired, expected.neverFired, name)
            XCTAssertEqual(actual.finalAlongM, expected.finalAlongM, accuracy: meters, name)
            XCTAssertEqual(actual.fired.map(\.seq), expected.fired.map(\.seq), name)
            for (a, e) in zip(actual.fired, expected.fired) {
                XCTAssertEqual(a.tSec, e.tSec, accuracy: seconds, name)
                XCTAssertEqual(a.leadSec, e.leadSec, accuracy: seconds, name)
                XCTAssertEqual(a.distanceM, e.distanceM, accuracy: meters, name)
            }
        }
    }

    private func compareRawFix(_ actual: RawFix, _ expected: RawFix) throws {
        XCTAssertEqual(actual.coords.latitude, expected.coords.latitude, accuracy: degrees)
        XCTAssertEqual(actual.coords.longitude, expected.coords.longitude, accuracy: degrees)
        XCTAssertEqual(actual.coords.speed, expected.coords.speed)
        XCTAssertEqual(actual.coords.accuracy, expected.coords.accuracy)
        XCTAssertEqual(actual.coords.heading, expected.coords.heading)
        XCTAssertEqual(actual.timestamp, expected.timestamp, accuracy: 0.001)
    }
}
