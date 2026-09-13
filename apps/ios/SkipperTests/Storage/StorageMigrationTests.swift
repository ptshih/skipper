import XCTest
@testable import Skipper

final class StorageMigrationTests: XCTestCase {

    private func loadFixture() -> [String: Any]? {
        let possiblePaths = [
            "/Users/ptshih/code/skipper/fixtures/native-ios/migration/manifests.json",
            URL(fileURLWithPath: #file)
                .deletingLastPathComponent() // Storage
                .deletingLastPathComponent() // SkipperTests
                .deletingLastPathComponent() // ios
                .deletingLastPathComponent() // apps
                .appendingPathComponent("fixtures/native-ios/migration/manifests.json").path
        ]
        for p in possiblePaths {
            if let data = try? Data(contentsOf: URL(fileURLWithPath: p)),
               let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
                return json
            }
        }
        return nil
    }

    private func populateFiles(files: [String: Any], rootDir: URL) throws {
        let fm = FileManager.default
        for (relPath, fileInfo) in files {
            guard let dict = fileInfo as? [String: Any] else { continue }
            let fileURL = rootDir.appendingPathComponent(relPath)
            try fm.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)

            if let text = dict["text"] as? String {
                try text.write(to: fileURL, atomically: true, encoding: .utf8)
            } else if let bytes = dict["bytes"] as? [UInt8] {
                let data = Data(bytes)
                try data.write(to: fileURL)
            }
        }
    }

    func testManifestMigrationFixtureSuite() async throws {
        guard let fixture = loadFixture(), let cases = fixture["cases"] as? [[String: Any]] else {
            XCTFail("Could not load manifests.json fixture")
            return
        }

        let fm = FileManager.default

        for testCase in cases {
            guard let caseId = testCase["id"] as? String,
                  let input = testCase["input"] as? [String: Any],
                  let driveId = input["driveId"] as? String,
                  let files = input["files"] as? [String: Any],
                  let expected = testCase["expected"] as? [String: Any] else {
                XCTFail("Malformed case in manifests.json")
                continue
            }

            // 1. Pure migration golden test
            if let v4Manifest = input["manifest"] as? [String: Any],
               (v4Manifest["version"] as? Int) == 4,
               let expectedManifestDict = expected["manifest"] as? [String: Any] {
                let placed = Set((input["verifiedPlacedNames"] as? [String]) ?? [])
                let pureMigrated = StorageUtils.migrateV4ToV5(raw: v4Manifest, placed: placed)
                XCTAssertNotNil(pureMigrated, "Case \(caseId): Pure migrateV4ToV5 must succeed")
                if let pureMigrated {
                    XCTAssertEqual(pureMigrated["version"] as? Int, expectedManifestDict["version"] as? Int, "Case \(caseId): Version 5")
                    XCTAssertEqual(pureMigrated["driveId"] as? String, expectedManifestDict["driveId"] as? String, "Case \(caseId): driveId")
                    XCTAssertEqual(pureMigrated["savedAt"] as? String, expectedManifestDict["savedAt"] as? String, "Case \(caseId): savedAt")
                    if let expClips = expectedManifestDict["clips"] as? [String: [String: Any]],
                       let actClips = pureMigrated["clips"] as? [String: [String: Any]] {
                        for (seq, expClip) in expClips {
                            let actClip = actClips[seq]
                            XCTAssertEqual(actClip?["name"] as? String, expClip["name"] as? String, "Case \(caseId) seq \(seq) name")
                            XCTAssertEqual(actClip?["shared"] as? Bool, expClip["shared"] as? Bool, "Case \(caseId) seq \(seq) shared")
                        }
                    }
                }
            }

            // 2. Pure gate evaluation test
            if let offlineGateStr = expected["offlineGate"] as? String,
               let onlineGateStr = expected["onlineGate"] as? String,
               let availableSeqs = expected["availableSeqs"] as? [Int],
               let missingSeqs = expected["missingSeqs"] as? [Int] {
                let hasAnyLocal = !availableSeqs.isEmpty
                let missingCount = missingSeqs.count
                let offGate = StorageUtils.decideDriveGate(online: false, hasAnyLocal: hasAnyLocal, missingCount: missingCount)
                let onGate = StorageUtils.decideDriveGate(online: true, hasAnyLocal: hasAnyLocal, missingCount: missingCount)
                XCTAssertEqual(offGate.rawValue, offlineGateStr, "Case \(caseId) offline gate")
                XCTAssertEqual(onGate.rawValue, onlineGateStr, "Case \(caseId) online gate")
            }

            // 3. Filesystem-based loadManifest & idempotence & sweep tests
            let tempDir = fm.temporaryDirectory.appendingPathComponent("MigrationTest-\(caseId)-\(UUID().uuidString)")
            try fm.createDirectory(at: tempDir, withIntermediateDirectories: true)
            defer {
                try? fm.removeItem(at: tempDir)
            }

            try populateFiles(files: files, rootDir: tempDir)

            // If this case specifically simulates move failure, simulate the destination being blocked
            if caseId == "v4-move-fails-keeps-local" {
                let clipsDir = tempDir.appendingPathComponent("clips", isDirectory: true)
                try fm.createDirectory(at: clipsDir, withIntermediateDirectories: true)
                // Creating a directory at destination path causes file move to fail
                let blockedDest = clipsDir.appendingPathComponent("poi-00000004-0000-4000-8000-000000000001.1789214400000.m4a")
                try fm.createDirectory(at: blockedDest, withIntermediateDirectories: true)
            }

            let service = StorageService(rootURL: tempDir)
            let loaded = await service.loadManifest(driveId: driveId)

            if let expectedManifestDict = expected["manifest"] as? [String: Any] {
                // Expected readable manifest
                XCTAssertNotNil(loaded, "Case \(caseId): Expected manifest to be readable")
                if let manifest = loaded {
                    XCTAssertEqual(manifest.version, 5, "Case \(caseId): Version must be 5")
                    XCTAssertEqual(manifest.driveId, driveId, "Case \(caseId): driveId mismatch")

                    if let preserveSavedAt = expected["preserveSavedAt"] as? Bool, preserveSavedAt {
                        let expectedSavedAt = expectedManifestDict["savedAt"] as? String
                        XCTAssertEqual(manifest.savedAt, expectedSavedAt, "Case \(caseId): savedAt must be preserved verbatim")
                    }

                    if let expectedClips = expectedManifestDict["clips"] as? [String: [String: Any]] {
                        for (seqStr, expClip) in expectedClips {
                            let actualClip = manifest.clips[seqStr]
                            XCTAssertNotNil(actualClip, "Case \(caseId): Missing clip for seq \(seqStr)")
                            if let actualClip {
                                XCTAssertEqual(actualClip.name, expClip["name"] as? String, "Case \(caseId): Clip name mismatch for seq \(seqStr)")
                                XCTAssertEqual(actualClip.shared, expClip["shared"] as? Bool, "Case \(caseId): Clip shared mismatch for seq \(seqStr)")
                            }
                        }
                    }
                }

                // Idempotence check: loading manifest a second time produces identical output
                let secondLoad = await service.loadManifest(driveId: driveId)
                XCTAssertEqual(loaded, secondLoad, "Case \(caseId): Second loadManifest call must be idempotent")

            } else if let readable = expected["readable"] as? Bool, !readable {
                // Expected unreadable manifest (unsupported-v3, future-version, malformed, etc.)
                XCTAssertNil(loaded, "Case \(caseId): Expected manifest to be unreadable")

                if let gcAllowed = expected["gcAllowed"] as? Bool, !gcAllowed {
                    // Sweep must fail closed and delete nothing
                    let swept = await service.sweepOrphanClips()
                    XCTAssertEqual(swept, 0, "Case \(caseId): Fail-closed sweep must delete 0 files")
                }
            } else if caseId == "unsafe-relative-path" {
                // Unsafe relative path in clips
                XCTAssertNil(loaded, "Case \(caseId): Unsafe relative path must cause loadManifest to return nil")
                let swept = await service.sweepOrphanClips()
                XCTAssertEqual(swept, 0, "Case \(caseId): Sweep must fail closed on unsafe relative path")
            }
        }
    }
}
