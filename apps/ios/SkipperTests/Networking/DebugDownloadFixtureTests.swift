#if DEBUG
import XCTest
@testable import Skipper

@MainActor
final class DebugDownloadFixtureTests: XCTestCase {
    private let audioURL = URL(string: "https://fixture.invalid/native-ios/create-continuity.m4a")!

    private func resources() throws -> URL {
        try XCTUnwrap(Bundle(for: Self.self).url(forResource: "native-ios", withExtension: nil))
            .appendingPathComponent("contracts", isDirectory: true)
    }

    private func launch(_ scenario: String, runID: String = UUID().uuidString) -> AppLaunchConfiguration {
        .init(mode: .uiTest(scenario: scenario, runID: runID, theme: .system))
    }

    func testBothCreateFixturesCommitCanonicalManifestAndBytesThroughStorageAndRelaunch() async throws {
        let resources = try resources()
        let suite = try JSONSerialization.jsonObject(with: Data(contentsOf: resources.appendingPathComponent("ui-flows.json"))) as! [String: Any]
        let cases = suite["cases"] as! [[String: Any]]
        let audio = try Data(contentsOf: resources.appendingPathComponent("audio/create-continuity.m4a"))
        XCTAssertFalse(audio.isEmpty)
        for scenario in ["planner-account-retry", "planner-account-lost-ack"] {
            let launch = launch(scenario)
            let root = try XCTUnwrap(DebugDependencies.runDirectory(for: launch))
            defer { try? FileManager.default.removeItem(at: root) }
            let fixture = try XCTUnwrap(cases.first { $0["id"] as? String == scenario })
            let input = fixture["input"] as! [String: Any]
            let responses = input["responses"] as! [String: Any]
            let data = try JSONSerialization.data(withJSONObject: XCTUnwrap(responses["createdManifest"]))
            // Use the public wire decoder and the same adapter as the production planner.
            let manifest = try JSONDecoder().decode(DriveManifest.self, from: data)
            let id = try XCTUnwrap(manifest.driveId)
            XCTAssertEqual(id, "00000002-0000-4000-8000-000000000099")
            let downloader = try DebugDependencies.downloader(for: launch, resources: resources)
            XCTAssertFalse(FileManager.default.fileExists(atPath: root.path), "Fixture construction must not seed storage")
            let storage = StorageService(rootURL: root, downloader: downloader)
            let result = try await storage.downloadDrive(driveId: id, detail: StorageSavedDriveDetail(manifest: manifest))
            XCTAssertEqual(result.downloaded, 1)
            XCTAssertEqual(result.total, 1)
            XCTAssertTrue(result.failedSeqs.isEmpty)
            let manifestURL = root.appendingPathComponent("drives/\(id)/manifest.json")
            let committedBytes = try Data(contentsOf: manifestURL)
            let committed = try JSONDecoder().decode(StorageOfflineManifest.self, from: committedBytes)
            XCTAssertEqual(committed.driveId, id)
            XCTAssertEqual(committed.clips.count, 1)
            let playback = try await storage.loadPlayback(driveId: id)
            XCTAssertEqual(playback.urls.count, 1)
            XCTAssertEqual(try Data(contentsOf: XCTUnwrap(playback.urls[0])), audio)
            XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: root.appendingPathComponent("drives").path), [id])
            let relaunched = StorageService(rootURL: root, downloader: try DebugDependencies.downloader(for: launch, resources: resources))
            let reopened = try await relaunched.loadPlayback(driveId: id)
            XCTAssertEqual(try Data(contentsOf: XCTUnwrap(reopened.urls[0])), audio)
            XCTAssertEqual(try Data(contentsOf: manifestURL), committedBytes)
        }
    }

    func testUnknownURLsAndNonStagingDestinationsAreRejectedWithoutWrites() async throws {
        let launch = launch("planner-account-retry")
        let root = try XCTUnwrap(DebugDependencies.runDirectory(for: launch))
        defer { try? FileManager.default.removeItem(at: root) }
        let downloader = try DebugDependencies.downloader(for: launch, resources: resources())
        let staging = root.appendingPathComponent(".staging/fixture.m4a")
        for raw in ["https://example.com/audio.m4a", audioURL.absoluteString + "?other=1", "file:///tmp/create-continuity.m4a"] {
            await assertRejected(downloader, url: URL(string: raw)!, destination: staging)
        }
        await assertRejected(downloader, url: audioURL, destination: root.appendingPathComponent("drives/fixture/audio.m4a"))
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.path))
    }

    func testAllOtherScenariosAndInvalidLaunchesKeepDefaultRejection() async throws {
        let unused = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let others = DebugDependencies.scenarios.subtracting(["planner-account-retry", "planner-account-lost-ack"])
        let launches = others.map { launch($0) } + [launch("unknown"), launch("planner-account-retry", runID: "invalid"),
            .init(mode: .production), .init(mode: .unitTest), .init(mode: .rejectedTestConfiguration)]
        for configuration in launches {
            let downloader = try DebugDependencies.downloader(for: configuration, resources: unused)
            await assertRejected(downloader, url: audioURL, destination: unused.appendingPathComponent(".staging/audio.m4a"))
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: unused.path))
    }

    private func assertRejected(_ downloader: any StorageFileDownloader, url: URL, destination: URL) async {
        do {
            try await downloader.downloadFile(from: url, to: destination, name: "audio.m4a", onProgress: nil)
            XCTFail("Unexpected fixture download: \(url)")
        } catch { XCTAssertTrue(error is OfflineError) }
        XCTAssertFalse(FileManager.default.fileExists(atPath: destination.path))
    }
}
#endif
