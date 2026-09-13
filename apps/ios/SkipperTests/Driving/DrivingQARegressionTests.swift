import Foundation
import XCTest
@testable import Skipper

private struct DrivingQASuite<C: Decodable>: Decodable {
    let fixtureVersion: Int
    let cases: [C]
}
private struct DrivingQACase: Decodable {
    struct Recipe: Decodable {
        struct Route: Decodable { let kind: String; let lastVertex: Int; let stepLat: Double }
        let route: Route
        let mph: Double?
        let removeFixRange: [Int]?
        let indices: [Int]?
        let accuracy: Double?
        let speed: Double?
        let heading: Double?
        let startMs: Double?
    }
    struct Expected: Decodable {
        let admitted: [Bool]?
        let events: [Event]?
        let harness: HarnessResult?
        enum CodingKeys: String, CodingKey { case admitted, events }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            if c.contains(.events) {
                admitted = try c.decode([Bool].self, forKey: .admitted)
                events = try c.decode([Event].self, forKey: .events)
                harness = nil
            } else {
                harness = try HarnessResult(from: decoder)
                admitted = nil; events = nil
            }
        }
    }
    struct Event: Decodable { let kind: String; let fix: GpsFix? }
    let id: String
    let input: Recipe
    let expected: Expected
}

private final class DrivingQACallbacks: @unchecked Sendable {
    private let lock = NSLock()
    private var storedKinds: [String] = []
    private var storedFixes: [GpsFix] = []
    var kinds: [String] { lock.withLock { storedKinds } }
    var fixes: [GpsFix] { lock.withLock { storedFixes } }
    func fix(_ value: GpsFix) { lock.withLock { storedKinds.append("fix"); storedFixes.append(value) } }
    func end() { lock.withLock { storedKinds.append("end") } }
}

final class DrivingQARegressionTests: XCTestCase {
    private let meters = 0.0001
    private let seconds = 0.000001

    private func cases() throws -> [DrivingQACase] {
        let suite = try JSONDecoder().decode(DrivingQASuite<DrivingQACase>.self,
            from: DrivingQAInputs.data("contracts/driving-qa.json"))
        XCTAssertEqual(suite.fixtureVersion, 1)
        XCTAssertEqual(Set(suite.cases.map(\.id)), Set([
            "gap-between-stops", "gap-spans-stop", "out-and-back-projection", "repeated-final-fix-callback-order",
        ]), "Required scenario removal/addition needs an explicit test adapter")
        return suite.cases
    }
    private func route(_ recipe: DrivingQACase.Recipe.Route) throws -> [LngLat] {
        let outbound = (0...recipe.lastVertex).map { LngLat(0, Double($0) * recipe.stepLat) }
        switch recipe.kind {
        case "straight": return outbound
        case "out-and-back": return outbound + outbound.dropLast().reversed()
        default: throw CocoaError(.coderInvalidValue)
        }
    }

    func testGPSGapScenariosAgainstLegacyResults() throws {
        for c in try cases() where c.id.hasPrefix("gap-") {
            let path = try route(c.input.route)
            let range = try XCTUnwrap(c.input.removeFixRange, c.id)
            XCTAssertEqual(range.count, 2)
            let clean = syntheticTrace(polyline: path, opts: SyntheticTraceOptions(mph: try XCTUnwrap(c.input.mph)))
            let trace = Array(clean[..<range[0]]) + Array(clean[range[1]...])
            let actual = driveTrace(polyline: path, stops: DrivingQAInputs.stops, trace: trace)
            let expected = try XCTUnwrap(c.expected.harness, c.id)
            XCTAssertEqual(actual.admitted, expected.admitted, c.id)
            XCTAssertEqual(actual.rejected, expected.rejected, c.id)
            XCTAssertEqual(actual.ended, expected.ended, c.id)
            XCTAssertEqual(actual.neverFired, expected.neverFired, c.id)
            XCTAssertEqual(actual.finalAlongM, expected.finalAlongM, accuracy: meters, c.id)
            XCTAssertEqual(actual.fired.map(\.seq), expected.fired.map(\.seq), c.id)
            for (a, e) in zip(actual.fired, expected.fired) {
                XCTAssertEqual(a.tSec, e.tSec, accuracy: seconds, c.id)
                XCTAssertEqual(a.leadSec, e.leadSec, accuracy: seconds, c.id)
                XCTAssertEqual(a.distanceM, e.distanceM, accuracy: meters, c.id)
            }
        }
    }

    func testOutAndBackProjectionAndRepeatedFinalFixCallbackOrder() throws {
        for c in try cases() where !c.id.hasPrefix("gap-") {
            let path = try route(c.input.route)
            let indices = try XCTUnwrap(c.input.indices, c.id)
            let callbacks = DrivingQACallbacks()
            let accept = createFixMapper(polyline: path, opts: FixMapperOptions(
                onFix: { callbacks.fix($0) }, onEnd: { callbacks.end() }))
            let startMs = try XCTUnwrap(c.input.startMs)
            let admitted = indices.enumerated().map { i, index in
                accept(RawFix(coords: RawFixCoords(latitude: path[index].latitude, longitude: path[index].longitude,
                    accuracy: c.input.accuracy, speed: c.input.speed, heading: c.input.heading),
                    timestamp: startMs + Double(i) * 1000))
            }
            XCTAssertEqual(admitted, try XCTUnwrap(c.expected.admitted), c.id)
            let expectedEvents = try XCTUnwrap(c.expected.events, c.id)
            XCTAssertEqual(callbacks.kinds, expectedEvents.map(\.kind), c.id)
            let wanted = try expectedEvents.filter { $0.kind == "fix" }.map { try XCTUnwrap($0.fix, c.id) }
            XCTAssertEqual(callbacks.fixes.count, wanted.count, c.id)
            for (a, e) in zip(callbacks.fixes, wanted) {
                XCTAssertEqual(a.lat, e.lat, accuracy: 1e-10, c.id)
                XCTAssertEqual(a.lng, e.lng, accuracy: 1e-10, c.id)
                XCTAssertEqual(a.alongM, e.alongM, accuracy: meters, c.id)
                XCTAssertEqual(a.tSec, e.tSec, accuracy: seconds, c.id)
                XCTAssertEqual(a.headingDeg, e.headingDeg, c.id)
                XCTAssertEqual(a.speedMps, e.speedMps, c.id)
            }
            // The actual trace must have crossed the return leg and ended once, after its final fix.
            XCTAssertEqual(callbacks.kinds.filter { $0 == "end" }.count, 1, c.id)
            XCTAssertEqual(Array(callbacks.kinds.suffix(3)), ["fix", "end", "fix"], c.id)
            for (a, b) in zip(callbacks.fixes, callbacks.fixes.dropFirst()) {
                XCTAssertGreaterThanOrEqual(b.alongM, a.alongM, c.id)
            }
        }
    }

    func testTraceSerializationPreservesExplicitNullSensorValues() throws {
        let recorder = TraceRecorder()
        recorder.record(raw: RawFix(coords: RawFixCoords(latitude: 0, longitude: 0,
            accuracy: nil, speed: nil, heading: nil), timestamp: 1_700_000_000_000))
        let env = recorder.envelope(meta: TraceMeta(driveId: "synthetic-trace", recordedAt: "2026-09-12T12:00:00.000Z",
                                                   polyline: [LngLat(0, 0), LngLat(0, 0.001)]))
        let data = try JSONEncoder().encode(env)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let fixes = try XCTUnwrap(json["fixes"] as? [[String: Any]])
        let coords = try XCTUnwrap(fixes.first?["coords"] as? [String: Any])
        for key in ["accuracy", "speed", "heading"] {
            XCTAssertTrue(coords.keys.contains(key), "Legacy trace writes explicit null for \(key); absence is not byte-shape parity")
            XCTAssertTrue(coords[key] is NSNull, "\(key) must serialize as JSON null")
        }
        let parsed = try XCTUnwrap(parseTraceEnvelope(json: XCTUnwrap(String(data: data, encoding: .utf8))))
        XCTAssertNil(parsed.fixes[0].coords.accuracy)
        XCTAssertNil(parsed.fixes[0].coords.speed)
        XCTAssertNil(parsed.fixes[0].coords.heading)
    }

    func testTraceActuallyReachesCapThenTruncatesAndStops() throws {
        let data = try DrivingQAInputs.data("driving/trace_fixtures.json")
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let constants = try XCTUnwrap(json["constants"] as? [String: Any])
        XCTAssertEqual(MAX_TRACE_FIXES, try XCTUnwrap(constants["maxTraceFixes"] as? Int))
        XCTAssertEqual(TRACE_FORMAT_VERSION, try XCTUnwrap(constants["formatVersion"] as? Int))
        let recorder = TraceRecorder()
        let coords = RawFixCoords(latitude: 0, longitude: 0, accuracy: -1, speed: -1, heading: -1)
        for index in 0..<MAX_TRACE_FIXES {
            recorder.record(raw: RawFix(coords: coords, timestamp: 1_700_000_000_000 + Double(index) * 250))
        }
        XCTAssertEqual(recorder.count, MAX_TRACE_FIXES)
        XCTAssertFalse(recorder.truncated, "Exactly at capacity is still a complete trace")
        let expectedSpan = Double(MAX_TRACE_FIXES - 1) * 0.25
        XCTAssertEqual(recorder.spanSec, expectedSpan, accuracy: seconds)
        recorder.record(raw: RawFix(coords: coords, timestamp: 1_800_000_000_000))
        XCTAssertTrue(recorder.truncated, "Overflow must be visibly reported")
        recorder.record(raw: RawFix(coords: coords, timestamp: 1_900_000_000_000))
        XCTAssertEqual(recorder.count, MAX_TRACE_FIXES)
        XCTAssertEqual(recorder.spanSec, expectedSpan, accuracy: seconds)
        let snapshot = recorder.envelope(meta: TraceMeta(driveId: "synthetic-cap", recordedAt: "2026-09-12T12:00:00.000Z",
            polyline: [LngLat(0, 0), LngLat(0, 0.001)]))
        XCTAssertTrue(snapshot.truncated)
        XCTAssertEqual(snapshot.fixes.count, MAX_TRACE_FIXES)
        XCTAssertEqual(snapshot.fixes.first?.timestamp, 1_700_000_000_000)
        XCTAssertEqual(snapshot.fixes.last?.timestamp, 1_700_000_000_000 + Double(MAX_TRACE_FIXES - 1) * 250)
        XCTAssertEqual(snapshot.fixes.last?.coords, coords, "Raw iOS -1 sentinels must survive recording")
    }
}
