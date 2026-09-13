import XCTest
@testable import Skipper

final class StorageGCTests: XCTestCase {

    private func loadGCFixture() -> [String: Any]? {
        let possiblePaths = [
            "/Users/ptshih/code/skipper/fixtures/native-ios/migration/gc.json",
            URL(fileURLWithPath: #file)
                .deletingLastPathComponent() // Storage
                .deletingLastPathComponent() // SkipperTests
                .deletingLastPathComponent() // ios
                .deletingLastPathComponent() // apps
                .appendingPathComponent("fixtures/native-ios/migration/gc.json").path
        ]
        for p in possiblePaths {
            if let data = try? Data(contentsOf: URL(fileURLWithPath: p)),
               let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
                return json
            }
        }
        return nil
    }

    func testGCFixtureSuite() throws {
        guard let fixture = loadGCFixture(), let cases = fixture["cases"] as? [[String: Any]] else {
            XCTFail("Could not load gc.json fixture")
            return
        }

        let fm = FileManager.default

        for testCase in cases {
            guard let caseId = testCase["id"] as? String,
                  let input = testCase["input"] as? [String: Any],
                  let inspection = input["inspection"] as? String,
                  let busyArray = input["busy"] as? [String],
                  let keepArray = input["keep"] as? [String],
                  let onDisk = input["onDisk"] as? [String],
                  let expected = testCase["expected"] as? [String: Any],
                  let expectedDeletes = expected["deleteFiles"] as? [String] else {
                XCTFail("Malformed case in gc.json")
                continue
            }

            let tempDir = fm.temporaryDirectory.appendingPathComponent("GCTest-\(caseId)-\(UUID().uuidString)")
            let clipsDir = tempDir.appendingPathComponent("clips", isDirectory: true)
            let drivesDir = tempDir.appendingPathComponent("drives", isDirectory: true)
            try fm.createDirectory(at: clipsDir, withIntermediateDirectories: true)
            try fm.createDirectory(at: drivesDir, withIntermediateDirectories: true)
            defer {
                try? fm.removeItem(at: tempDir)
            }

            // Create files in clips/
            for name in onDisk {
                let fileURL = clipsDir.appendingPathComponent(name)
                try Data([1, 2, 3, 4]).write(to: fileURL)
            }

            let store = StorageClipStore(rootURL: tempDir)
            let driveId = "00000002-0000-4000-8000-000000000001"
            let driveDir = drivesDir.appendingPathComponent(driveId)
            try fm.createDirectory(at: driveDir, withIntermediateDirectories: true)

            // Setup manifest inspection state
            let readManifest: (@Sendable (String) -> [String: Any]?)?
            let hasManifest: (@Sendable (String) -> Bool)?

            switch inspection {
            case "complete":
                var clipsMap = [String: [String: Any]]()
                for (i, name) in keepArray.enumerated() {
                    clipsMap[String(i)] = ["name": name, "shared": true, "contentType": "audio/mp4"]
                }
                let capturedClips = clipsMap
                readManifest = { _ in ["version": 5, "clips": capturedClips] }
                hasManifest = { _ in true }
            case "listing-failed":
                readManifest = { _ in nil }
                hasManifest = { _ in false }
            default:
                // unreadable, migration-incomplete, migration-failed, existence-read-error
                readManifest = { _ in nil }
                hasManifest = { _ in true }
            }

            let downloadsInFlight = caseId == "download-in-flight" || caseId == "topup-in-flight" || busyArray.contains("topup")
            let busySet = Set(busyArray)

            let sweepInput = StorageClipStore.StoreSweepInput(
                driveIds: [driveId],
                readManifest: readManifest,
                downloadsInFlight: downloadsInFlight,
                busy: busySet,
                hasManifest: hasManifest
            )

            let reclaimed = store.sweepOrphanClips(input: sweepInput)
            let expectedReclaimedCount = expectedDeletes.count
            XCTAssertEqual(reclaimed, expectedReclaimedCount, "Case \(caseId): Reclaimed count mismatch")

            // Verify deleted files are gone
            for del in expectedDeletes {
                let filename = (del as NSString).lastPathComponent
                let fileURL = clipsDir.appendingPathComponent(filename)
                XCTAssertFalse(fm.fileExists(atPath: fileURL.path), "Case \(caseId): File \(del) should have been deleted")
            }

            // Verify unknown / future format files are preserved
            if let preserveUnknown = expected["preserveUnknownFiles"] as? Bool, preserveUnknown {
                let futureFile = clipsDir.appendingPathComponent("future-format.bin")
                XCTAssertTrue(fm.fileExists(atPath: futureFile.path), "Case \(caseId): Unknown files must be preserved by GC")
            }
        }
    }
}
