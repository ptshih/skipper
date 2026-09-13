import XCTest
@testable import Skipper

@MainActor final class DriveTraceTests: XCTestCase {
    func testTraceWriterFlushPreventsAQueuedWriteFromResurrectingPurgedFiles() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let writer = TraceFileWriter()
        let trace = TraceEnvelope(driveId: "fixture", recordedAt: "2026-01-01T00:00:00Z", routeVertices: 2, routeHash: "fixture", truncated: false,
                                  fixes: [RawFix(coords: RawFixCoords(latitude: 0, longitude: 0), timestamp: 1000)])
        let url = try XCTUnwrap(writer.save(trace, directory: directory))
        writer.flush()
        XCTAssertTrue(FileManager.default.fileExists(atPath: url.path))
        try FileManager.default.removeItem(at: directory)
        writer.flush()
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.path))
    }

    func testTraceReplayUsesFixQualityGateAndRejectsDifferentRoute() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let rig = PlaybackRig(traceDirectory: directory); defer { rig.controller.stop() }
        let playback = rig.playback()
        try rig.controller.load(playback, online: false)
        let route = playback.detail.polyline.map { LngLat(longitude: $0[0], latitude: $0[1]) }
        var trace = TraceEnvelope(driveId: playback.detail.driveId!, recordedAt: "2026-01-01T00:00:00Z", routeVertices: route.count,
                                  routeHash: polylineFingerprint(route), truncated: false,
                                  fixes: [RawFix(coords: RawFixCoords(latitude: 0, longitude: 0, accuracy: -1), timestamp: 1000),
                                          RawFix(coords: RawFixCoords(latitude: 0, longitude: 0, accuracy: 5), timestamp: 2000)])
        try JSONEncoder().encode(trace).write(to: directory.appendingPathComponent("trace-fixture.json"))
        try rig.controller.replayTrace(named: "trace-fixture.json")
        rig.controller.tick()
        XCTAssertNil(rig.controller.activeSeq)
        rig.clock.advance(1); rig.controller.tick()
        XCTAssertEqual(rig.controller.activeSeq, 0)
        XCTAssertEqual(rig.location.starts, 0)
        rig.controller.stop()
        trace.routeHash = "different"
        try JSONEncoder().encode(trace).write(to: directory.appendingPathComponent("trace-fixture.json"))
        XCTAssertThrowsError(try rig.controller.replayTrace(named: "trace-fixture.json"))
    }

    func testAdminGateRechecksEveryReadExportAndDelete() throws {
        let rig = PlaybackRig(); let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let library = DriveTraceLibrary(directory: directory, session: { rig.account }, now: { rig.clock.date })
        let trace = TraceEnvelope(driveId: "fixture", recordedAt: "2026-01-01T00:00:00Z", routeVertices: 2, routeHash: "fixture", truncated: false,
                                  fixes: [RawFix(coords: RawFixCoords(latitude: 0, longitude: 0, accuracy: -1), timestamp: 1000)])
        let name = traceFileName(env: trace)
        try JSONEncoder().encode(trace).write(to: directory.appendingPathComponent(name))
        XCTAssertEqual(try library.list().count, 1)
        XCTAssertEqual(try library.read(name).fixes.first?.coords.accuracy, -1)
        XCTAssertEqual(try library.export(name).lastPathComponent, name)
        rig.account = nil
        XCTAssertThrowsError(try library.list())
        XCTAssertThrowsError(try library.read(name))
        XCTAssertThrowsError(try library.export(name))
        XCTAssertThrowsError(try library.delete(name))
        XCTAssertTrue(FileManager.default.fileExists(atPath: directory.appendingPathComponent(name).path))
    }

    func testTraceReaderRejectsTraversalSymlinkAndOutOfOrderFixes() throws {
        let rig = PlaybackRig(); let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let library = DriveTraceLibrary(directory: directory, session: { rig.account }, now: { rig.clock.date })
        XCTAssertThrowsError(try library.read("trace-../../secret.json"))
        try FileManager.default.createSymbolicLink(at: directory.appendingPathComponent("trace-link.json"), withDestinationURL: directory.deletingLastPathComponent().appendingPathComponent("outside.json"))
        XCTAssertThrowsError(try library.export("trace-link.json"))
        let trace = TraceEnvelope(driveId: "fixture", recordedAt: "2026-01-01T00:00:00Z", routeVertices: 2, routeHash: "fixture", truncated: false,
                                  fixes: [RawFix(coords: RawFixCoords(latitude: 0, longitude: 0), timestamp: 2000), RawFix(coords: RawFixCoords(latitude: 0, longitude: 0), timestamp: 1000)])
        try JSONEncoder().encode(trace).write(to: directory.appendingPathComponent("trace-order.json"))
        XCTAssertThrowsError(try library.read("trace-order.json"))
    }
}
