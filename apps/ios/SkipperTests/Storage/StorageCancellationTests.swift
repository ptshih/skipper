import Foundation
import XCTest
@testable import Skipper

private final class StorageURLProtocol: URLProtocol {
    struct Handlers {
        let started: () -> Void
        let stopped: () -> Void
        var fails = false
    }
    private final class Registry: @unchecked Sendable {
        let lock = NSLock()
        var handlers: [String: Handlers] = [:]
        func set(_ value: Handlers?, host: String) {
            lock.lock(); defer { lock.unlock() }
            handlers[host] = value
        }
        func get(host: String) -> Handlers? {
            lock.lock(); defer { lock.unlock() }
            return handlers[host]
        }
    }
    private static let registry = Registry()
    static func install(_ value: Handlers?, host: String) { registry.set(value, host: host) }
    private var callbacks: Handlers? { Self.registry.get(host: request.url?.host ?? "") }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let callbacks = callbacks
        callbacks?.started()
        if callbacks?.fails == true { client?.urlProtocol(self, didFailWithError: URLError(.cannotConnectToHost)) }
    }
    override func stopLoading() { callbacks?.stopped() }
}

final class StorageCancellationTests: XCTestCase {
    private func detail(_ id: String, url: URL, shared: Bool = true) -> StorageSavedDriveDetail {
        .init(driveId: id, label: "Cancellation fixture", polyline: [[0, 0]], clips: [
            .init(seq: 0, alongSec: 10,
                subjectId: shared ? "00000004-0000-4000-8000-000000000001" : nil,
                subjectKind: shared ? .poi : nil, contentType: "audio/mp4",
                revisedAt: "2026-09-12T12:00:00.000Z", url: url.absoluteString)
        ])
    }

    private func cancellationReachesURLSession(shared: Bool, purge: Bool, topUp: Bool = false) async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let host = UUID().uuidString.lowercased() + ".invalid"
        let started = expectation(description: "Real URLSession download entered URLProtocol")
        let stopped = expectation(description: "Real URLSession download canceled")
        StorageURLProtocol.install(.init(started: { started.fulfill() }, stopped: { stopped.fulfill() }), host: host)
        defer { StorageURLProtocol.install(nil, host: host) }
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StorageURLProtocol.self]
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }
        let service = StorageService(rootURL: root, downloader: StorageDefaultDownloader(session: session))
        let id = UUID().uuidString.lowercased()
        let fixture = detail(id, url: URL(string: "https://\(host)/audio.m4a")!, shared: shared)
        let saved = StorageOfflineManifest(driveId: id, savedAt: "2026-09-12T12:00:00.000Z",
            detail: fixture.strippingURLs(), audioSeqs: [0], clips: [:])
        if topUp {
            let store = StorageClipStore(rootURL: root)
            store.ensureDriveDir(driveId: id)
            try JSONEncoder().encode(saved).write(to: store.manifestURL(driveId: id))
        }
        let task = Task {
            if topUp { _ = try await service.topUpDrive(driveId: id, fresh: fixture) }
            else { _ = try await service.downloadDrive(driveId: id, detail: fixture) }
        }
        await fulfillment(of: [started], timeout: 5)
        if purge { _ = await service.deleteAllDriveDownloads() } else { await service.cancelDownload(driveId: id) }
        await fulfillment(of: [stopped], timeout: 5)
        do { _ = try await task.value; XCTFail("Canceled run must fail") } catch {}
        let manifest = await service.loadManifest(driveId: id)
        if topUp && !purge { XCTAssertEqual(manifest, saved, "Cancellation preserves the previous manifest") }
        else { XCTAssertNil(manifest) }
        XCTAssertTrue((try? FileManager.default.contentsOfDirectory(atPath: root.appendingPathComponent("clips").path))?.isEmpty ?? true)
        XCTAssertTrue((try? FileManager.default.contentsOfDirectory(atPath: root.appendingPathComponent(".staging").path))?.isEmpty ?? true)
    }

    func testExplicitCancelStopsDefaultSharedDownloader() async throws {
        try await cancellationReachesURLSession(shared: true, purge: false)
    }
    func testExplicitCancelStopsDefaultDriveLocalDownloader() async throws {
        try await cancellationReachesURLSession(shared: false, purge: false)
    }
    func testPurgeStopsDefaultSharedDownloader() async throws {
        try await cancellationReachesURLSession(shared: true, purge: true)
    }
    func testPurgeStopsDefaultDriveLocalDownloader() async throws {
        try await cancellationReachesURLSession(shared: false, purge: true)
    }

    func testExplicitCancelStopsDefaultTopUpDownloaderAndPreservesManifest() async throws {
        try await cancellationReachesURLSession(shared: true, purge: false, topUp: true)
    }
    func testPurgeStopsDefaultTopUpDownloader() async throws {
        try await cancellationReachesURLSession(shared: true, purge: true, topUp: true)
    }

    func testDefaultDownloaderExhaustedFailureNeverDeletesLandedBytes() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let landed = root.appendingPathComponent("landed.m4a")
        let bytes = Data([1, 2, 3])
        try bytes.write(to: landed)
        let destination = root.appendingPathComponent("staging.m4a")
        let host = UUID().uuidString.lowercased() + ".invalid"
        let attempts = expectation(description: "All configured retry attempts actually fail")
        attempts.expectedFulfillmentCount = StorageDefaultDownloader.maxAttempts
        StorageURLProtocol.install(.init(started: { attempts.fulfill() }, stopped: {}, fails: true), host: host)
        defer { StorageURLProtocol.install(nil, host: host) }
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StorageURLProtocol.self]
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }
        do {
            try await StorageDefaultDownloader(session: session).downloadFile(
                from: URL(string: "https://\(host)/audio.m4a")!, to: destination, name: "audio.m4a")
            XCTFail("All failed attempts must throw")
        } catch {}
        await fulfillment(of: [attempts], timeout: 5)
        XCTAssertEqual(try Data(contentsOf: landed), bytes)
        XCTAssertFalse(FileManager.default.fileExists(atPath: destination.path))
    }

    private actor LateWriter: StorageFileDownloader {
        let entered: XCTestExpectation
        private var release: CheckedContinuation<Void, Never>?
        private var count = 0
        init(entered: XCTestExpectation) { self.entered = entered }
        func resume() { release?.resume(); release = nil }
        func downloadFile(from url: URL, to destURL: URL, name: String,
                          onProgress: (@Sendable (Int64, Int64) -> Void)?) async throws {
            count += 1
            let attempt = count
            if attempt == 1 {
                await withCheckedContinuation { continuation in
                    release = continuation
                    entered.fulfill()
                }
            }
            // Deliberately ignores cancellation to emulate a queued delegate callback after purge.
            try FileManager.default.createDirectory(at: destURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try Data([UInt8(attempt)]).write(to: destURL)
        }
    }

    func testPurgeEpochRejectsLateOldBytesWithoutDeletingNewAccountDownload() async throws {
        for shared in [true, false] {
            let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            defer { try? FileManager.default.removeItem(at: root) }
            let entered = expectation(description: "Old writer held before late callback")
            let writer = LateWriter(entered: entered)
            let service = StorageService(rootURL: root, downloader: writer)
            let id = UUID().uuidString.lowercased()
            let fixture = detail(id, url: URL(string: "https://storage.invalid/audio.m4a")!, shared: shared)
            let old = Task { try await service.downloadDrive(driveId: id, detail: fixture) }
            await fulfillment(of: [entered], timeout: 5)
            _ = await service.deleteAllDriveDownloads()
            let replacement = try await service.downloadDrive(driveId: id, detail: fixture)
            XCTAssertEqual(replacement.downloaded, 1)
            await writer.resume()
            do { _ = try await old.value; XCTFail("Old epoch must not commit") } catch {}
            let playback = try await service.loadPlayback(driveId: id)
            XCTAssertEqual(try Data(contentsOf: XCTUnwrap(playback.urls[0])), Data([2]))
            XCTAssertTrue((try? FileManager.default.contentsOfDirectory(atPath: root.appendingPathComponent(".staging").path))?.isEmpty ?? true)
        }
    }
}
