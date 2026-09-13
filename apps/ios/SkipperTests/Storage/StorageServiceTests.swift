import XCTest
@testable import Skipper

final class StorageServiceTests: XCTestCase {

    private final class MockDownloader: StorageFileDownloader, @unchecked Sendable {
        private let lock = NSLock()
        private var _downloadedURLs = [URL]()
        private var _failForNames = Set<String>()
        private var _delaySeconds: TimeInterval = 0
        private var _delaysForName = [String: TimeInterval]()
        private var _onDownloadStart: (@Sendable (String) async -> Void)?

        var downloadedURLs: [URL] {
            lock.lock()
            defer { lock.unlock() }
            return _downloadedURLs
        }

        var failForName: String? {
            get {
                lock.lock()
                defer { lock.unlock() }
                return _failForNames.first
            }
            set {
                lock.lock()
                defer { lock.unlock() }
                _failForNames.removeAll()
                if let newValue {
                    _failForNames.insert(newValue)
                }
            }
        }

        var failForNames: Set<String> {
            get {
                lock.lock()
                defer { lock.unlock() }
                return _failForNames
            }
            set {
                lock.lock()
                defer { lock.unlock() }
                _failForNames = newValue
            }
        }

        var delaySeconds: TimeInterval {
            get {
                lock.lock()
                defer { lock.unlock() }
                return _delaySeconds
            }
            set {
                lock.lock()
                defer { lock.unlock() }
                _delaySeconds = newValue
            }
        }

        var delaysForName: [String: TimeInterval] {
            get {
                lock.lock()
                defer { lock.unlock() }
                return _delaysForName
            }
            set {
                lock.lock()
                defer { lock.unlock() }
                _delaysForName = newValue
            }
        }

        var onDownloadStart: (@Sendable (String) async -> Void)? {
            get {
                lock.lock()
                defer { lock.unlock() }
                return _onDownloadStart
            }
            set {
                lock.lock()
                defer { lock.unlock() }
                _onDownloadStart = newValue
            }
        }

        private func recordDownload(_ url: URL) {
            lock.lock(); defer { lock.unlock() }
            _downloadedURLs.append(url)
        }

        func downloadFile(
            from url: URL,
            to destURL: URL,
            name: String,
            onProgress: (@Sendable (Int64, Int64) -> Void)?
        ) async throws {
            if let onStart = onDownloadStart {
                await onStart(name)
            }

            try Task.checkCancellation()

            let shouldFail: Bool = {
                lock.lock()
                defer { lock.unlock() }
                return _failForNames.contains { name.contains($0) }
            }()

            if shouldFail {
                throw StorageError.downloadFailed(name: name, underlying: "Simulated mock network error")
            }

            let delay: TimeInterval = {
                lock.lock()
                defer { lock.unlock() }
                return _delaysForName[name] ?? _delaySeconds
            }()

            if delay > 0 {
                try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            }
            try Task.checkCancellation()

            recordDownload(url)

            let parent = destURL.deletingLastPathComponent()
            try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)
            let fakeAudio = Data([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70]) // non-zero bytes
            try fakeAudio.write(to: destURL)
            onProgress?(Int64(fakeAudio.count), Int64(fakeAudio.count))
        }
    }

    private final class ProgressCollector: @unchecked Sendable {
        private let lock = NSLock()
        private var _updates = [StorageDownloadProgress]()
        var updates: [StorageDownloadProgress] {
            lock.lock()
            defer { lock.unlock() }
            return _updates
        }
        func add(_ p: StorageDownloadProgress) {
            lock.lock()
            defer { lock.unlock() }
            _updates.append(p)
        }
    }

    private final class BarrierBox: @unchecked Sendable {
        private let lock = NSLock()
        private var waiters: [CheckedContinuation<Void, Never>] = []
        private var startedWaiters: [CheckedContinuation<Void, Never>] = []
        private var isStarted = false
        private var released = false

        func blockUntilResumed() async {
            await withCheckedContinuation { continuation in
                lock.lock()
                isStarted = true
                let started = startedWaiters
                startedWaiters.removeAll()
                let resumeNow = released
                if !resumeNow { waiters.append(continuation) }
                lock.unlock()
                started.forEach { $0.resume() }
                if resumeNow { continuation.resume() }
            }
        }

        func waitUntilStarted() async {
            await withCheckedContinuation { continuation in
                lock.lock()
                let resumeNow = isStarted
                if !resumeNow { startedWaiters.append(continuation) }
                lock.unlock()
                if resumeNow { continuation.resume() }
            }
        }

        func resume() {
            lock.lock()
            released = true
            let pending = waiters
            waiters.removeAll()
            lock.unlock()
            pending.forEach { $0.resume() }
        }
    }

    func testDownloadDriveAndPlayback() async throws {
        let fm = FileManager.default
        let tempDir = fm.temporaryDirectory.appendingPathComponent("ServiceTest-\(UUID().uuidString)")
        try fm.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: tempDir) }

        let mockDownloader = MockDownloader()
        let service = StorageService(rootURL: tempDir, downloader: mockDownloader)

        let driveId = "00000002-0000-4000-8000-000000000001"
        let clip1 = StorageSavedDriveClip(
            seq: 0,
            alongSec: 10,
            subjectId: "00000004-0000-4000-8000-000000000001",
            subjectKind: .poi,
            contentType: "audio/mp4",
            revisedAt: "2026-09-12T12:00:00.000Z",
            url: "https://example.com/audio/0.m4a"
        )
        let clip2 = StorageSavedDriveClip(
            seq: 1,
            alongSec: 60,
            subjectId: "00000004-0000-4000-8000-000000000002",
            subjectKind: .poi,
            contentType: "audio/mp4",
            revisedAt: "2026-09-12T12:00:00.000Z",
            url: "https://example.com/audio/1.m4a"
        )
        let detail = StorageSavedDriveDetail(
            driveId: driveId,
            label: "Test Loop",
            polyline: [[0, 0], [0.01, 0.01]],
            clips: [clip1, clip2]
        )

        let collector = ProgressCollector()
        _ = await service.subscribeDownload(driveId: driveId) { progress in
            collector.add(progress)
        }

        let result = try await service.downloadDrive(driveId: driveId, detail: detail)
        XCTAssertEqual(result.downloaded, 2)
        XCTAssertEqual(result.total, 2)
        XCTAssertEqual(result.failedSeqs, [])

        // Manifest check
        let manifest = await service.loadManifest(driveId: driveId)
        XCTAssertNotNil(manifest)
        XCTAssertEqual(manifest?.version, 5)
        XCTAssertEqual(manifest?.clips.count, 2)
        XCTAssertEqual(manifest?.clips["0"]?.shared, true)
        XCTAssertEqual(manifest?.clips["1"]?.shared, true)

        // Offline status
        let status = await service.offlineStatus(driveId: driveId)
        XCTAssertNotNil(status)
        XCTAssertTrue(status?.downloaded ?? false)
        XCTAssertEqual(status?.missingSeqs, [])

        // Playback resolution
        let playback = try await service.loadPlayback(driveId: driveId)
        XCTAssertEqual(playback.urls.count, 2)
        XCTAssertNotNil(playback.urls[0])
        XCTAssertNotNil(playback.urls[1])
        XCTAssertTrue(fm.fileExists(atPath: playback.urls[0]!.path))
        XCTAssertTrue(fm.fileExists(atPath: playback.urls[1]!.path))
    }

    func testCancellation() async throws {
        let fm = FileManager.default
        let tempDir = fm.temporaryDirectory.appendingPathComponent("CancelTest-\(UUID().uuidString)")
        try fm.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: tempDir) }

        let mockDownloader = MockDownloader()
        mockDownloader.delaySeconds = 0.5 // slow enough to cancel
        let service = StorageService(rootURL: tempDir, downloader: mockDownloader)

        let driveId = "00000002-0000-4000-8000-000000000001"
        let clip = StorageSavedDriveClip(
            seq: 0,
            alongSec: 10,
            subjectId: "00000004-0000-4000-8000-000000000001",
            subjectKind: .poi,
            contentType: "audio/mp4",
            revisedAt: "2026-09-12T12:00:00.000Z",
            url: "https://example.com/audio/0.m4a"
        )
        let detail = StorageSavedDriveDetail(
            driveId: driveId,
            label: "Test Loop",
            polyline: [[0, 0]],
            clips: [clip]
        )

        let task = Task {
            try await service.downloadDrive(driveId: driveId, detail: detail)
        }

        try await Task.sleep(nanoseconds: 50_000_000) // 50ms
        await service.cancelDownload(driveId: driveId)

        do {
            _ = try await task.value
            XCTFail("Expected download to fail on cancellation")
        } catch {
            XCTAssertTrue(error is CancellationError || (error as? StorageError) != nil)
        }
    }

    func testTopUpAndRepair() async throws {
        let fm = FileManager.default
        let tempDir = fm.temporaryDirectory.appendingPathComponent("TopUpTest-\(UUID().uuidString)")
        try fm.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: tempDir) }

        let mockDownloader = MockDownloader()
        let service = StorageService(rootURL: tempDir, downloader: mockDownloader)

        let driveId = "00000002-0000-4000-8000-000000000001"
        let clip0 = StorageSavedDriveClip(
            seq: 0,
            alongSec: 10,
            subjectId: "00000004-0000-4000-8000-000000000001",
            subjectKind: .poi,
            contentType: "audio/mp4",
            revisedAt: "2026-09-12T12:00:00.000Z",
            url: "https://example.com/audio/0.m4a"
        )
        let initialDetail = StorageSavedDriveDetail(
            driveId: driveId,
            label: "Test Loop",
            polyline: [[0, 0]],
            clips: [clip0]
        )

        // Download initial drive
        _ = try await service.downloadDrive(driveId: driveId, detail: initialDetail)
        let initialManifest = await service.loadManifest(driveId: driveId)
        XCTAssertNotNil(initialManifest)
        _ = initialManifest!.savedAt

        // Add a second clip
        let clip1 = StorageSavedDriveClip(
            seq: 1,
            alongSec: 50,
            subjectId: "00000004-0000-4000-8000-000000000002",
            subjectKind: .poi,
            contentType: "audio/mp4",
            revisedAt: "2026-09-12T12:00:00.000Z",
            url: "https://example.com/audio/1.m4a"
        )
        let updatedDetail = StorageSavedDriveDetail(
            driveId: driveId,
            label: "Test Loop Updated",
            polyline: [[0, 0]],
            clips: [clip0, clip1]
        )

        // Top-up
        let topUpStatus = try await service.topUpDrive(driveId: driveId, fresh: updatedDetail)
        XCTAssertNotNil(topUpStatus)
        XCTAssertTrue(topUpStatus?.downloaded ?? false)
        XCTAssertEqual(topUpStatus?.missingSeqs, [])

        let toppedUpManifest = await service.loadManifest(driveId: driveId)
        XCTAssertEqual(toppedUpManifest?.clips.count, 2)
        XCTAssertNotNil(toppedUpManifest?.savedAt)

        // Corrupt manifest file to test repair
        let manifestFile = tempDir.appendingPathComponent("drives/\(driveId)/manifest.json")
        try Data("bad json".utf8).write(to: manifestFile)

        let brokenState = await service.downloadDirState(driveId: driveId)
        XCTAssertEqual(brokenState, .unreadable)

        // Repair against disk bytes
        let repairStatus = try await service.repairDownload(driveId: driveId, fresh: updatedDetail)
        XCTAssertNotNil(repairStatus)
        XCTAssertTrue(repairStatus?.downloaded ?? false)

        let repairedState = await service.downloadDirState(driveId: driveId)
        XCTAssertEqual(repairedState, .ok)
    }

    func testDeleteDriveVsAllPurge() async throws {
        let fm = FileManager.default
        let tempDir = fm.temporaryDirectory.appendingPathComponent("PurgeTest-\(UUID().uuidString)")
        try fm.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: tempDir) }

        let mockDownloader = MockDownloader()
        let service = StorageService(rootURL: tempDir, downloader: mockDownloader)

        let driveId = "00000002-0000-4000-8000-000000000001"
        let clip = StorageSavedDriveClip(
            seq: 0,
            alongSec: 10,
            subjectId: "00000004-0000-4000-8000-000000000001",
            subjectKind: .poi,
            contentType: "audio/mp4",
            revisedAt: "2026-09-12T12:00:00.000Z",
            url: "https://example.com/audio/0.m4a"
        )
        let detail = StorageSavedDriveDetail(
            driveId: driveId,
            label: "Test Loop",
            polyline: [[0, 0]],
            clips: [clip]
        )

        _ = try await service.downloadDrive(driveId: driveId, detail: detail)

        let clipsDir = tempDir.appendingPathComponent("clips")
        let driveDir = tempDir.appendingPathComponent("drives/\(driveId)")
        XCTAssertTrue(fm.fileExists(atPath: clipsDir.path))
        XCTAssertTrue(fm.fileExists(atPath: driveDir.path))

        // Normal delete: removes drive directory, leaves shared clip in clips/
        await service.deleteDriveDownload(driveId: driveId)
        XCTAssertFalse(fm.fileExists(atPath: driveDir.path))
        XCTAssertTrue(fm.fileExists(atPath: clipsDir.path))

        // Account wipe: deleteAllDriveDownloads clears clips/ directory entirely
        let purgedClips = await service.deleteAllDriveDownloads()
        XCTAssertEqual(purgedClips, 1)
        XCTAssertFalse(fm.fileExists(atPath: clipsDir.path))
    }

    func testGCSweepInvariants() async throws {
        let fm = FileManager.default
        let tempDir = fm.temporaryDirectory.appendingPathComponent("GCInvariantTest-\(UUID().uuidString)")
        try fm.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: tempDir) }

        let mockDownloader = MockDownloader()
        let service = StorageService(rootURL: tempDir, downloader: mockDownloader)

        let clipsDir = tempDir.appendingPathComponent("clips", isDirectory: true)
        let drivesDir = tempDir.appendingPathComponent("drives", isDirectory: true)
        try fm.createDirectory(at: clipsDir, withIntermediateDirectories: true)
        try fm.createDirectory(at: drivesDir, withIntermediateDirectories: true)

        let sharedClipName = "poi-00000004-0000-4000-8000-000000000001.1789214400000.m4a"
        let orphanClipName = "poi-00000004-0000-4000-8000-000000000002.1789214400000.m4a"
        let futureClipName = "future-format.bin"

        try Data([1, 2, 3]).write(to: clipsDir.appendingPathComponent(sharedClipName))
        try Data([4, 5, 6]).write(to: clipsDir.appendingPathComponent(orphanClipName))
        try Data([7, 8, 9]).write(to: clipsDir.appendingPathComponent(futureClipName))

        // 1. Directory with NO manifest is skipped safely (does not abort sweep)
        let emptyDriveDir = drivesDir.appendingPathComponent("00000002-0000-4000-8000-000000000099")
        try fm.createDirectory(at: emptyDriveDir, withIntermediateDirectories: true)

        // Valid drive referencing sharedClipName
        let validDriveId = "00000002-0000-4000-8000-000000000001"
        let validDriveDir = drivesDir.appendingPathComponent(validDriveId)
        try fm.createDirectory(at: validDriveDir, withIntermediateDirectories: true)
        let validManifestData = """
        {
            "version": 5,
            "driveId": "\(validDriveId)",
            "savedAt": "2026-09-12T12:00:00.000Z",
            "detail": {
                "driveId": "\(validDriveId)",
                "label": "Test",
                "polyline": [[0,0]],
                "clips": []
            },
            "audioSeqs": [0],
            "clips": {
                "0": {
                    "name": "\(sharedClipName)",
                    "contentType": "audio/mp4",
                    "durationMs": 1000,
                    "shared": true
                }
            }
        }
        """.data(using: .utf8)!
        try validManifestData.write(to: validDriveDir.appendingPathComponent("manifest.json"))

        // Sweep should reclaim orphanClipName, keep sharedClipName and futureClipName
        let sweptCount = await service.sweepOrphanClips()
        XCTAssertEqual(sweptCount, 1)
        XCTAssertTrue(fm.fileExists(atPath: clipsDir.appendingPathComponent(sharedClipName).path))
        XCTAssertFalse(fm.fileExists(atPath: clipsDir.appendingPathComponent(orphanClipName).path))
        XCTAssertTrue(fm.fileExists(atPath: clipsDir.appendingPathComponent(futureClipName).path), "Future/unknown files must never be deleted")

        // 2. Corrupt manifest aborts whole sweep
        let corruptDriveDir = drivesDir.appendingPathComponent("00000002-0000-4000-8000-000000000002")
        try fm.createDirectory(at: corruptDriveDir, withIntermediateDirectories: true)
        try Data("corrupt json".utf8).write(to: corruptDriveDir.appendingPathComponent("manifest.json"))

        // Re-create orphan to see if sweep attempts to delete it
        try Data([4, 5, 6]).write(to: clipsDir.appendingPathComponent(orphanClipName))
        let abortSweptCount = await service.sweepOrphanClips()
        XCTAssertEqual(abortSweptCount, 0, "Sweep must abort when any drive has corrupt manifest")
        XCTAssertTrue(fm.fileExists(atPath: clipsDir.appendingPathComponent(orphanClipName).path))
    }

    // MARK: - Fable Regression Tests

    // HIGH 1 Regression: Drive B failed/canceled fetch must never delete Drive A's committed shared bytes
    func testTwoDriveSharedFilesFailureDoesNotDeleteCommitted() async throws {
        let fm = FileManager.default
        let tempDir = fm.temporaryDirectory.appendingPathComponent("TwoDrive-\(UUID().uuidString)")
        try fm.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: tempDir) }

        let mockDownloader = MockDownloader()
        let service = StorageService(rootURL: tempDir, downloader: mockDownloader)

        let sharedClip = StorageSavedDriveClip(
            seq: 0,
            alongSec: 10,
            subjectId: "00000004-0000-4000-8000-000000000001",
            subjectKind: .poi,
            contentType: "audio/mp4",
            revisedAt: "2026-09-12T12:00:00.000Z",
            url: "https://example.com/audio/shared.m4a"
        )

        let driveAId = "00000002-0000-4000-8000-000000000001"
        let detailA = StorageSavedDriveDetail(
            driveId: driveAId,
            label: "Drive A",
            polyline: [[0, 0]],
            clips: [sharedClip]
        )

        // 1. Drive A successfully downloads shared clip
        let resultA = try await service.downloadDrive(driveId: driveAId, detail: detailA)
        XCTAssertEqual(resultA.downloaded, 1)

        let manifestA = await service.loadManifest(driveId: driveAId)
        let clipName = manifestA!.clips["0"]!.name
        let sharedClipURL = tempDir.appendingPathComponent("clips/\(clipName)")
        XCTAssertTrue(fm.fileExists(atPath: sharedClipURL.path))
        let initialAttrs = try fm.attributesOfItem(atPath: sharedClipURL.path)
        let initialSize = initialAttrs[.size] as? Int64 ?? 0
        XCTAssertGreaterThan(initialSize, 0)

        // 2. Drive B also references the same shared clip + a failing clip
        let driveBId = "00000002-0000-4000-8000-000000000002"
        let failingClip = StorageSavedDriveClip(
            seq: 1,
            alongSec: 30,
            subjectId: "00000004-0000-4000-8000-000000000099",
            subjectKind: .poi,
            contentType: "audio/mp4",
            revisedAt: "2026-09-12T12:00:00.000Z",
            url: "https://example.com/audio/failing.m4a"
        )
        let detailB = StorageSavedDriveDetail(
            driveId: driveBId,
            label: "Drive B",
            polyline: [[0, 0]],
            clips: [sharedClip, failingClip]
        )

        // Make mockDownloader fail for the second clip
        mockDownloader.failForName = "00000004-0000-4000-8000-000000000099"

        let resultB = try await service.downloadDrive(driveId: driveBId, detail: detailB)
        XCTAssertEqual(resultB.downloaded, 1) // salvaged shared clip
        XCTAssertEqual(resultB.failedSeqs, [1])

        // Verify Drive A's committed bytes are completely intact!
        XCTAssertTrue(fm.fileExists(atPath: sharedClipURL.path))
        let postAttrs = try fm.attributesOfItem(atPath: sharedClipURL.path)
        XCTAssertEqual(postAttrs[.size] as? Int64, initialSize)

        // Drive A playback is completely unaffected
        let playbackA = try await service.loadPlayback(driveId: driveAId)
        XCTAssertEqual(playbackA.urls.count, 1)
        XCTAssertEqual(playbackA.urls[0]?.path, sharedClipURL.path)
    }

    // HIGH 1 Regression: Intra-drive duplicate subject seqs and concurrent requests deduplicate safely
    func testIntraDriveDuplicateSubjectAndConcurrentDedupe() async throws {
        let fm = FileManager.default
        let tempDir = fm.temporaryDirectory.appendingPathComponent("DupTest-\(UUID().uuidString)")
        try fm.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: tempDir) }

        let mockDownloader = MockDownloader()
        mockDownloader.delaySeconds = 0.05
        let service = StorageService(rootURL: tempDir, downloader: mockDownloader)

        let driveId = "00000002-0000-4000-8000-000000000001"
        // Two clips with identical subjectId, subjectKind, and revisedAt -> identical storeKey & fileName
        let clip0 = StorageSavedDriveClip(
            seq: 0,
            alongSec: 10,
            subjectId: "00000004-0000-4000-8000-000000000001",
            subjectKind: .poi,
            contentType: "audio/mp4",
            revisedAt: "2026-09-12T12:00:00.000Z",
            url: "https://example.com/audio/same.m4a"
        )
        let clip1 = StorageSavedDriveClip(
            seq: 1,
            alongSec: 40,
            subjectId: "00000004-0000-4000-8000-000000000001",
            subjectKind: .poi,
            contentType: "audio/mp4",
            revisedAt: "2026-09-12T12:00:00.000Z",
            url: "https://example.com/audio/same.m4a"
        )
        let detail = StorageSavedDriveDetail(
            driveId: driveId,
            label: "Duplicate Subject Drive",
            polyline: [[0, 0]],
            clips: [clip0, clip1]
        )

        let result = try await service.downloadDrive(driveId: driveId, detail: detail)
        XCTAssertEqual(result.downloaded, 2)
        XCTAssertEqual(result.failedSeqs, [])

        let manifest = await service.loadManifest(driveId: driveId)
        XCTAssertNotNil(manifest)
        XCTAssertEqual(manifest?.clips["0"]?.name, manifest?.clips["1"]?.name)

        let playback = try await service.loadPlayback(driveId: driveId)
        XCTAssertEqual(playback.urls.count, 2)
        XCTAssertEqual(playback.urls[0], playback.urls[1])
    }

    func testTwoDistinctDrivesSharedTransferDedupeWithBarriers() async throws {
        let fm = FileManager.default
        let tempDir = fm.temporaryDirectory.appendingPathComponent("SharedDedupe-\(UUID().uuidString)")
        try fm.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: tempDir) }

        let mockDownloader = MockDownloader()
        let barrier = BarrierBox()

        let driveAId = "00000002-0000-4000-8000-000000000001"
        let driveBId = "00000002-0000-4000-8000-000000000002"

        // Both drives request the same POI clip with identical subjectId and rev
        let clipA = StorageSavedDriveClip(
            seq: 0,
            alongSec: 10,
            subjectId: "00000004-0000-4000-8000-000000000001",
            subjectKind: .poi,
            contentType: "audio/mp4",
            revisedAt: "2026-09-12T12:00:00.000Z",
            url: "https://example.com/audio/shared.m4a"
        )
        let clipB = StorageSavedDriveClip(
            seq: 0,
            alongSec: 15,
            subjectId: "00000004-0000-4000-8000-000000000001",
            subjectKind: .poi,
            contentType: "audio/mp4",
            revisedAt: "2026-09-12T12:00:00.000Z",
            url: "https://example.com/audio/shared.m4a"
        )
        let detailA = StorageSavedDriveDetail(
            driveId: driveAId,
            label: "Drive A",
            polyline: [[0, 0]],
            clips: [clipA]
        )
        let detailB = StorageSavedDriveDetail(
            driveId: driveBId,
            label: "Drive B",
            polyline: [[0, 0]],
            clips: [clipB]
        )

        mockDownloader.onDownloadStart = { _ in
            await barrier.blockUntilResumed()
        }

        let service = StorageService(rootURL: tempDir, downloader: mockDownloader)

        let joined = expectation(description: "Second shared consumer registered")
        await service.observeConcurrency { event in
            if case .transferConsumerRegistered(let id) = event, id == driveBId { joined.fulfill() }
        }

        // Launch Drive A: starts download and suspends at barrier
        let taskA = Task {
            try await service.downloadDrive(driveId: driveAId, detail: detailA)
        }

        // Wait until Drive A's transfer has actually entered downloader
        await barrier.waitUntilStarted()

        // Launch Drive B concurrently: should find in-flight transfer and join
        let taskB = Task {
            try await service.downloadDrive(driveId: driveBId, detail: detailB)
        }

        await fulfillment(of: [joined], timeout: 5)

        // Resume downloader
        barrier.resume()

        let resultA = try await taskA.value
        let resultB = try await taskB.value
        XCTAssertEqual(resultA.downloaded, 1)
        XCTAssertEqual(resultB.downloaded, 1)

        // Verify the transfer count across distinct drives is EXACTLY 1!
        XCTAssertEqual(mockDownloader.downloadedURLs.count, 1, "Shared transfer must only hit network/downloader ONCE for 2 distinct drives")

        // Both drives have valid manifests and point to the same shared clip
        let manifestA = await service.loadManifest(driveId: driveAId)
        let manifestB = await service.loadManifest(driveId: driveBId)
        XCTAssertNotNil(manifestA)
        XCTAssertNotNil(manifestB)
        XCTAssertEqual(manifestA?.clips["0"]?.name, manifestB?.clips["0"]?.name)
        XCTAssertEqual(manifestA?.clips["0"]?.shared, true)
        XCTAssertEqual(manifestB?.clips["0"]?.shared, true)
    }

    // HIGH 2 Regression: Failed new revision retry preserves old usable bytes and keeps drive playable
    func testFailedNewRevisionPreservesExistingPlayable() async throws {
        let fm = FileManager.default
        let tempDir = fm.temporaryDirectory.appendingPathComponent("RevFallback-\(UUID().uuidString)")
        try fm.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: tempDir) }

        let mockDownloader = MockDownloader()
        let service = StorageService(rootURL: tempDir, downloader: mockDownloader)

        let driveId = "00000002-0000-4000-8000-000000000001"
        let clipRev1 = StorageSavedDriveClip(
            seq: 0,
            alongSec: 10,
            subjectId: "00000004-0000-4000-8000-000000000001",
            subjectKind: .poi,
            contentType: "audio/mp4",
            revisedAt: "2026-09-12T12:00:00.000Z",
            url: "https://example.com/audio/rev1.m4a"
        )
        let detailRev1 = StorageSavedDriveDetail(
            driveId: driveId,
            label: "Rev1 Drive",
            polyline: [[0, 0]],
            clips: [clipRev1]
        )

        // 1. Download initial revision
        _ = try await service.downloadDrive(driveId: driveId, detail: detailRev1)
        let manifest1 = await service.loadManifest(driveId: driveId)
        let rev1FileName = manifest1!.clips["0"]!.name
        XCTAssertTrue(fm.fileExists(atPath: tempDir.appendingPathComponent("clips/\(rev1FileName)").path))

        // 2. Drive updated on server with revision 2, but network fails for rev 2
        let clipRev2 = StorageSavedDriveClip(
            seq: 0,
            alongSec: 10,
            subjectId: "00000004-0000-4000-8000-000000000001",
            subjectKind: .poi,
            contentType: "audio/mp4",
            revisedAt: "2026-09-12T13:00:00.000Z",
            url: "https://example.com/audio/rev2.m4a"
        )
        let detailRev2 = StorageSavedDriveDetail(
            driveId: driveId,
            label: "Rev2 Drive",
            polyline: [[0, 0]],
            clips: [clipRev2]
        )

        mockDownloader.failForName = "1789218000000" // timestamp for 13:00:00.000Z

        // The re-pull runs; rev2 fails to download, but resolveClipRef keeps rev1!
        let result2 = try await service.downloadDrive(driveId: driveId, detail: detailRev2)
        XCTAssertEqual(result2.downloaded, 1) // Kept rev 1!
        XCTAssertEqual(result2.failedSeqs, [0]) // Marked missing in fresh, but playable via fallback

        // Old bytes on disk are preserved
        XCTAssertTrue(fm.fileExists(atPath: tempDir.appendingPathComponent("clips/\(rev1FileName)").path))

        // Manifest still resolves to rev1
        let manifest2 = await service.loadManifest(driveId: driveId)
        XCTAssertEqual(manifest2?.clips["0"]?.name, rev1FileName)

        // Playback still works!
        let playback = try await service.loadPlayback(driveId: driveId)
        XCTAssertNotNil(playback.urls[0])
    }

    // HIGH 2 Regression: All-failure throws error and NEVER commits empty manifest
    func testAllFailurePreservesManifest() async throws {
        let fm = FileManager.default
        let tempDir = fm.temporaryDirectory.appendingPathComponent("AllFailTest-\(UUID().uuidString)")
        try fm.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: tempDir) }

        let mockDownloader = MockDownloader()
        let service = StorageService(rootURL: tempDir, downloader: mockDownloader)

        let driveId = "00000002-0000-4000-8000-000000000001"
        let clip = StorageSavedDriveClip(
            seq: 0,
            alongSec: 10,
            subjectId: "00000004-0000-4000-8000-000000000001",
            subjectKind: .poi,
            contentType: "audio/mp4",
            revisedAt: "2026-09-12T12:00:00.000Z",
            url: "https://example.com/audio/0.m4a"
        )
        let detail = StorageSavedDriveDetail(
            driveId: driveId,
            label: "Test Loop",
            polyline: [[0, 0]],
            clips: [clip]
        )

        // 1. Initial download succeeds
        _ = try await service.downloadDrive(driveId: driveId, detail: detail)
        let manifestBefore = await service.loadManifest(driveId: driveId)
        XCTAssertNotNil(manifestBefore)
        XCTAssertEqual(manifestBefore?.clips.count, 1)

        // 2. Subsequent attempt where every clip fails
        mockDownloader.failForName = "poi"
        let freshClip = StorageSavedDriveClip(
            seq: 1, // different seq, no fallback
            alongSec: 30,
            subjectId: "00000004-0000-4000-8000-000000000099",
            subjectKind: .poi,
            contentType: "audio/mp4",
            revisedAt: "2026-09-12T14:00:00.000Z",
            url: "https://example.com/audio/fresh.m4a"
        )
        let freshDetail = StorageSavedDriveDetail(
            driveId: driveId,
            label: "Fresh Detail",
            polyline: [[0, 0]],
            clips: [freshClip]
        )

        do {
            _ = try await service.downloadDrive(driveId: driveId, detail: freshDetail)
            XCTFail("Expected all-failure to throw")
        } catch {
            XCTAssertTrue((error as? StorageError) != nil)
        }

        // Original manifest is NOT wiped or overwritten with empty dict!
        let manifestAfter = await service.loadManifest(driveId: driveId)
        XCTAssertNotNil(manifestAfter)
        XCTAssertEqual(manifestAfter?.clips.count, 1)
        XCTAssertEqual(manifestAfter?.clips["0"]?.name, manifestBefore?.clips["0"]?.name)
    }

    // HIGH 3 Regression: Top-up holds busy protection through commit so GC cannot delete downloaded clip
    func testTopUpSweepWhileSecondFileBlocked() async throws {
        let fm = FileManager.default
        let tempDir = fm.temporaryDirectory.appendingPathComponent("TopUpGC-\(UUID().uuidString)")
        try fm.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: tempDir) }

        let mockDownloader = MockDownloader()
        let barrier = BarrierBox()
        let service = StorageService(rootURL: tempDir, downloader: mockDownloader)

        let driveId = "00000002-0000-4000-8000-000000000001"
        // Initial empty drive with manifest containing 0 clips
        let initialDetail = StorageSavedDriveDetail(
            driveId: driveId,
            label: "Initial Empty",
            polyline: [[0, 0]],
            clips: []
        )
        let initialStore = StorageClipStore(rootURL: tempDir)
        initialStore.ensureDriveDir(driveId: driveId)
        let initialManifest = StorageOfflineManifest(driveId: driveId, version: 5,
            savedAt: "2026-09-12T12:00:00.000Z", detail: initialDetail, audioSeqs: [], clips: [:])
        try JSONEncoder().encode(initialManifest).write(to: initialStore.manifestURL(driveId: driveId))

        let clip0 = StorageSavedDriveClip(
            seq: 0,
            alongSec: 10,
            subjectId: "00000004-0000-4000-8000-000000000001",
            subjectKind: .poi,
            contentType: "audio/mp4",
            revisedAt: "2026-09-12T12:00:00.000Z",
            url: "https://example.com/audio/0.m4a"
        )
        let clip1 = StorageSavedDriveClip(
            seq: 1,
            alongSec: 40,
            subjectId: "00000004-0000-4000-8000-000000000002",
            subjectKind: .poi,
            contentType: "audio/mp4",
            revisedAt: "2026-09-12T12:00:00.000Z",
            url: "https://example.com/audio/1.m4a"
        )
        let freshDetail = StorageSavedDriveDetail(
            driveId: driveId,
            label: "Fresh 2 Clips",
            polyline: [[0, 0]],
            clips: [clip0, clip1]
        )

        // Block downloading of clip 1, letting clip 0 land first
        mockDownloader.onDownloadStart = { name in
            if name.contains("00000004-0000-4000-8000-000000000002") {
                await barrier.blockUntilResumed()
            }
        }

        let topUpTask = Task {
            try await service.topUpDrive(driveId: driveId, fresh: freshDetail)
        }

        // Wait until clip 1 has started and is blocked at barrier
        await barrier.waitUntilStarted()

        // Clip 0 has already landed on disk, but top-up manifest is NOT yet committed!
        let clip0FileName = try StorageUtils.storeFileName(
            key: StorageStoreKey(subjectId: clip0.subjectId!, subjectKind: clip0.subjectKind!, rev: StorageUtils.revisionToken(clip0.revisedAt)),
            contentType: clip0.contentType!
        )
        let clip0DiskURL = tempDir.appendingPathComponent("clips").appendingPathComponent(clip0FileName)
        XCTAssertTrue(fm.fileExists(atPath: clip0DiskURL.path), "Clip 0 must have landed on disk")

        // Run sweep while clip 1 is blocked: sweep must NOT delete clip 0 (protected by busyStoreNames)
        let swept = await service.sweepOrphanClips()
        XCTAssertEqual(swept, 0, "GC must not delete uncommitted landed new clip or in-flight transfer during top-up")
        XCTAssertTrue(fm.fileExists(atPath: clip0DiskURL.path), "Clip 0 must remain on disk after GC sweep")

        // Unblock clip 1 and finish top-up
        barrier.resume()

        let status = try await topUpTask.value
        XCTAssertNotNil(status)
        XCTAssertTrue(status?.downloaded ?? false)
        XCTAssertTrue(status?.isComplete ?? false)
    }

    private func waiterCancellationPreservesSharedRun(topUp: Bool, cancelCreator: Bool) async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let downloader = MockDownloader()
        let barrier = BarrierBox()
        downloader.onDownloadStart = { _ in await barrier.blockUntilResumed() }
        let service = StorageService(rootURL: root, downloader: downloader)
        let id = UUID().uuidString.lowercased()
        let clip = StorageSavedDriveClip(seq: 0, alongSec: 10,
            subjectId: "00000004-0000-4000-8000-000000000001", subjectKind: .poi,
            contentType: "audio/mp4", revisedAt: "2026-09-12T12:00:00.000Z",
            url: "https://storage.invalid/shared.m4a")
        let detail = StorageSavedDriveDetail(driveId: id, label: "Waiter cancellation", polyline: [[0, 0]], clips: [clip])
        if topUp {
            let store = StorageClipStore(rootURL: root)
            store.ensureDriveDir(driveId: id)
            let saved = StorageOfflineManifest(driveId: id, savedAt: "2026-09-12T12:00:00.000Z",
                detail: detail.strippingURLs(), audioSeqs: [0], clips: [:])
            try JSONEncoder().encode(saved).write(to: store.manifestURL(driveId: id))
        }
        let joined = expectation(description: "Both additional waiters joined the existing run")
        joined.expectedFulfillmentCount = 2
        await service.observeConcurrency { event in
            if case .joinedRun = event { joined.fulfill() }
        }
        let operation: @Sendable () async throws -> Int = {
            if topUp {
                let result = try await service.topUpDrive(driveId: id, fresh: detail)
                return result?.isComplete == true ? 1 : 0
            }
            return try await service.downloadDrive(driveId: id, detail: detail).downloaded
        }
        let creator = Task { try await operation() }
        await barrier.waitUntilStarted()
        let joinerA = Task { try await operation() }
        let joinerB = Task { try await operation() }
        await fulfillment(of: [joined], timeout: 5)
        let canceled = cancelCreator ? creator : joinerA
        canceled.cancel()
        if !topUp {
            let active = await service.activeDownload(driveId: id)
            XCTAssertEqual(active?.isCanceled, false, "Screen cancellation must not mark the drive canceled")
        }
        barrier.resume()
        let survivor = cancelCreator ? joinerA : creator
        let firstResult = try await survivor.value
        let secondResult = try await joinerB.value
        XCTAssertEqual(firstResult, 1)
        XCTAssertEqual(secondResult, 1)
        do { _ = try await canceled.value; XCTFail("Only the canceled waiter must throw") }
        catch { XCTAssertTrue(error is CancellationError) }
        XCTAssertEqual(downloader.downloadedURLs.count, 1, "All callers share one successful transfer")
        let manifest = await service.loadManifest(driveId: id)
        XCTAssertEqual(manifest?.clips.count, 1)
        let active = await service.activeDownload(driveId: id)
        XCTAssertNil(active, "Completed run leaves no auto-start tombstone")
    }

    func testDownloadCanceledJoinerDoesNotCancelCreatorOrSecondJoiner() async throws {
        try await waiterCancellationPreservesSharedRun(topUp: false, cancelCreator: false)
    }
    func testDownloadOutlivesCanceledCreatingScreen() async throws {
        try await waiterCancellationPreservesSharedRun(topUp: false, cancelCreator: true)
    }
    func testTopUpCanceledJoinerDoesNotCancelCreatorOrSecondJoiner() async throws {
        try await waiterCancellationPreservesSharedRun(topUp: true, cancelCreator: false)
    }
    func testTopUpOutlivesCanceledCreatingScreen() async throws {
        try await waiterCancellationPreservesSharedRun(topUp: true, cancelCreator: true)
    }

    // HIGH 3 Regression: Quick cancel + retry identity check preserves newer work
    func testCancelImmediateRetryTeardownIdentity() async throws {
        let fm = FileManager.default
        let tempDir = fm.temporaryDirectory.appendingPathComponent("CancelRetry-\(UUID().uuidString)")
        try fm.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: tempDir) }

        let mockDownloader = MockDownloader()
        let barrier = BarrierBox()
        let service = StorageService(rootURL: tempDir, downloader: mockDownloader)

        let driveId = "00000002-0000-4000-8000-000000000001"
        let clip = StorageSavedDriveClip(
            seq: 0,
            alongSec: 10,
            subjectId: "00000004-0000-4000-8000-000000000001",
            subjectKind: .poi,
            contentType: "audio/mp4",
            revisedAt: "2026-09-12T12:00:00.000Z",
            url: "https://example.com/audio/0.m4a"
        )
        let detail = StorageSavedDriveDetail(
            driveId: driveId,
            label: "Cancel Retry",
            polyline: [[0, 0]],
            clips: [clip]
        )

        mockDownloader.onDownloadStart = { _ in
            await barrier.blockUntilResumed()
        }

        // Start first download
        let task1 = Task {
            try await service.downloadDrive(driveId: driveId, detail: detail)
        }

        // Wait until first download enters downloader and blocks
        await barrier.waitUntilStarted()

        // Verify first run is registered
        let active1 = await service.activeDownload(driveId: driveId)
        XCTAssertNotNil(active1)
        let firstRunId = active1!.id
        XCTAssertFalse(active1!.isCanceled)

        // Cancel first download: registry must record tombstone
        await service.cancelDownload(driveId: driveId)
        let activeCanceled = await service.activeDownload(driveId: driveId)
        XCTAssertTrue(activeCanceled?.isCanceled == true, "Tombstone must record isCanceled == true")
        XCTAssertEqual(activeCanceled?.id, firstRunId)

        let replacement = BarrierBox()
        mockDownloader.onDownloadStart = { _ in await replacement.blockUntilResumed() }
        let waiting = expectation(description: "Both retries wait for old run")
        waiting.expectedFulfillmentCount = 2
        let joined = expectation(description: "Second retry joins replacement")
        await service.observeConcurrency { event in
            switch event {
            case .waitingForCancelledRun: waiting.fulfill()
            case .joinedRun: joined.fulfill()
            default: break
            }
        }
        let progress = ProgressCollector()
        _ = await service.subscribeDownload(driveId: driveId) { progress.add($0) }

        // Launch TWO concurrent retry callers while first run is still unwinding
        let retry1 = Task {
            try await service.downloadDrive(driveId: driveId, detail: detail)
        }
        let retry2 = Task {
            try await service.downloadDrive(driveId: driveId, detail: detail)
        }

        await fulfillment(of: [waiting], timeout: 5)
        barrier.resume()
        await replacement.waitUntilStarted()
        await fulfillment(of: [joined], timeout: 5)
        let replacementActive = await service.activeDownload(driveId: driveId)
        XCTAssertNotEqual(replacementActive?.id, firstRunId)
        XCTAssertEqual(replacementActive?.progress.done, 0)
        XCTAssertEqual(replacementActive?.progress.total, 1)
        replacement.resume()

        do {
            _ = try await task1.value
            XCTFail("First task should have thrown cancellation")
        } catch {
            // Expected cancellation
        }

        // Both retry callers must succeed with downloaded == 1
        let result1 = try await retry1.value
        let result2 = try await retry2.value
        XCTAssertEqual(result1.downloaded, 1)
        XCTAssertEqual(result2.downloaded, 1)
        XCTAssertEqual(mockDownloader.downloadedURLs.count, 1, "Exactly one replacement transfer")
        XCTAssertEqual(progress.updates.last?.done, 1)
        XCTAssertEqual(progress.updates.last?.total, 1)

        // Active download must not be erased or overwritten with invalid state
        let manifest = await service.loadManifest(driveId: driveId)
        XCTAssertNotNil(manifest)
        XCTAssertEqual(manifest?.clips.count, 1)
    }

    func testOfflineStatusPartialVsCompleteSemantics() async throws {
        let fm = FileManager.default
        let tempDir = fm.temporaryDirectory.appendingPathComponent("OfflineStatusSemantics-\(UUID().uuidString)")
        try fm.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: tempDir) }

        let service = StorageService(rootURL: tempDir)
        let driveId = "00000002-0000-4000-8000-000000000001"

        // Build a manifest with 2 clips: 0 and 1
        let clip0Name = "poi-00000004-0000-4000-8000-000000000001.1789214400000.m4a"
        let clip1Name = "poi-00000004-0000-4000-8000-000000000002.1789214400000.m4a"
        let manifest = StorageOfflineManifest(
            driveId: driveId,
            version: 5,
            savedAt: "2026-09-12T12:00:00.000Z",
            detail: StorageSavedDriveDetail(
                driveId: driveId,
                label: "Offline Status Drive",
                polyline: [[0, 0]],
                clips: []
            ),
            audioSeqs: [0, 1],
            clips: [
                "0": StorageStoredClipRef(name: clip0Name, contentType: "audio/mp4", durationMs: 1000, shared: true),
                "1": StorageStoredClipRef(name: clip1Name, contentType: "audio/mp4", durationMs: 1000, shared: true)
            ]
        )

        // Save manifest to disk
        let driveDir = tempDir.appendingPathComponent("drives").appendingPathComponent(driveId)
        try fm.createDirectory(at: driveDir, withIntermediateDirectories: true)
        let manifestData = try JSONEncoder().encode(manifest)
        try manifestData.write(to: driveDir.appendingPathComponent("manifest.json"))

        // Case 1: 0 clips present on disk -> offlineStatus is nil, hasPlayable=false, hasComplete=false
        let status0 = await service.offlineStatus(driveId: driveId)
        XCTAssertNil(status0)
        let playable0 = await service.hasPlayableDrive(driveId: driveId)
        XCTAssertFalse(playable0)
        let complete0 = await service.hasCompleteDrive(driveId: driveId)
        XCTAssertFalse(complete0)

        // Case 2: Only clip 0 present on disk -> partial download!
        // Shipped TS offline.ts:1088-1090: downloaded == true (playable copy exists), isComplete == false, missingSeqs == [1]
        let clipsDir = tempDir.appendingPathComponent("clips")
        try fm.createDirectory(at: clipsDir, withIntermediateDirectories: true)
        try Data([0x01, 0x02]).write(to: clipsDir.appendingPathComponent(clip0Name))

        let statusPartial = await service.offlineStatus(driveId: driveId)
        XCTAssertNotNil(statusPartial)
        XCTAssertTrue(statusPartial!.downloaded, "Shipped TS offlineStatus: downloaded is true for partial playable copy")
        XCTAssertFalse(statusPartial!.isComplete, "Partial download is not complete")
        XCTAssertEqual(statusPartial!.missingSeqs, [1])
        XCTAssertEqual(statusPartial!.expectedCount, 2)
        let playablePartial = await service.hasPlayableDrive(driveId: driveId)
        XCTAssertTrue(playablePartial)
        let completePartial = await service.hasCompleteDrive(driveId: driveId)
        XCTAssertFalse(completePartial)

        // Case 3: Both clips present on disk -> complete download!
        try Data([0x03, 0x04]).write(to: clipsDir.appendingPathComponent(clip1Name))

        let statusComplete = await service.offlineStatus(driveId: driveId)
        XCTAssertNotNil(statusComplete)
        XCTAssertTrue(statusComplete!.downloaded)
        XCTAssertTrue(statusComplete!.isComplete)
        XCTAssertEqual(statusComplete!.missingSeqs, [])
        let playableComplete = await service.hasPlayableDrive(driveId: driveId)
        XCTAssertTrue(playableComplete)
        let completeComplete = await service.hasCompleteDrive(driveId: driveId)
        XCTAssertTrue(completeComplete)
    }

    func testDefaultDownloaderFailAndCancelPlacement() async throws {
        let fm = FileManager.default
        let tempDir = fm.temporaryDirectory.appendingPathComponent("DefaultDownloaderTest-\(UUID().uuidString)")
        try fm.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: tempDir) }

        let downloader = StorageDefaultDownloader()
        let destURL = tempDir.appendingPathComponent("clips").appendingPathComponent("poi-test.m4a")
        try fm.createDirectory(at: destURL.deletingLastPathComponent(), withIntermediateDirectories: true)

        let initialBytes = Data([0x01, 0x02, 0x03, 0x04])
        try initialBytes.write(to: destURL)

        // An existing landed file short-circuits network access and must remain untouched.
        let invalidURL = URL(string: "https://storage.invalid/nonexistent.m4a")!
        try await downloader.downloadFile(from: invalidURL, to: destURL, name: "poi-test.m4a", onProgress: nil)
        XCTAssertEqual(try Data(contentsOf: destURL), initialBytes)

        // 2. Cancellation: must NOT delete existing destination file
        let cancelBarrier = BarrierBox()
        let cancelTask = Task {
            await cancelBarrier.blockUntilResumed()
            try await downloader.downloadFile(from: invalidURL, to: destURL, name: "poi-test.m4a", onProgress: nil)
        }
        await cancelBarrier.waitUntilStarted()
        cancelTask.cancel()
        cancelBarrier.resume()
        do {
            _ = try await cancelTask.value
            XCTFail("Should have thrown cancellation")
        } catch {
            // Expected
        }
        XCTAssertTrue(fm.fileExists(atPath: destURL.path), "Existing destination must survive cancellation")
        let bytesAfterCancel = try Data(contentsOf: destURL)
        XCTAssertEqual(bytesAfterCancel, initialBytes, "Bytes must be untouched after cancellation")

        // 3. Collision / No-Overwrite: if destination already exists with bytes, collision is treated as landed
        let localSourceURL = tempDir.appendingPathComponent("source.m4a")
        let newBytes = Data([0xAA, 0xBB, 0xCC, 0xDD, 0xEE])
        try newBytes.write(to: localSourceURL)

        try await downloader.downloadFile(from: localSourceURL, to: destURL, name: "poi-test.m4a", onProgress: nil)
        // Collision handled cleanly: destination was already present with bytes, was not destroyed
        XCTAssertTrue(fm.fileExists(atPath: destURL.path))
        let finalBytes = try Data(contentsOf: destURL)
        XCTAssertEqual(finalBytes, initialBytes, "Pre-existing destination retained without overwrite")
    }

    // Compatibility Gap: Undecodable v4 manifest remains 100% byte-identical on disk
    func testMalformedMigrationLeavesDiskUnchanged() async throws {
        let fm = FileManager.default
        let tempDir = fm.temporaryDirectory.appendingPathComponent("MalformedMigration-\(UUID().uuidString)")
        try fm.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: tempDir) }

        let service = StorageService(rootURL: tempDir)
        let driveId = "00000002-0000-4000-8000-000000000001"
        let driveDir = tempDir.appendingPathComponent("drives/\(driveId)")
        try fm.createDirectory(at: driveDir, withIntermediateDirectories: true)

        let malformedV4 = """
        {
            "version": 4,
            "driveId": "\(driveId)",
            "detail": {
                "label": "Corrupt",
                "clips": "this_should_be_an_array_not_a_string"
            }
        }
        """
        let manifestFile = driveDir.appendingPathComponent("manifest.json")
        let originalBytes = malformedV4.data(using: .utf8)!
        try originalBytes.write(to: manifestFile)

        // loadManifest should fail validation and return nil
        let loaded = await service.loadManifest(driveId: driveId)
        XCTAssertNil(loaded)

        // Verify on-disk file is byte-identical to original bytes!
        let postBytes = try Data(contentsOf: manifestFile)
        XCTAssertEqual(postBytes, originalBytes, "Malformed migration must never overwrite or corrupt existing file")
    }

    // MEDIUM 4 Regression: Serialized manifests contain NO presigned URLs across all operations
    func testManifestContainsNoPresignedURLs() async throws {
        let fm = FileManager.default
        let tempDir = fm.temporaryDirectory.appendingPathComponent("NoURLs-\(UUID().uuidString)")
        try fm.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: tempDir) }

        let mockDownloader = MockDownloader()
        let service = StorageService(rootURL: tempDir, downloader: mockDownloader)

        let driveId = "00000002-0000-4000-8000-000000000001"
        let presignedSecret = "X-Amz-Signature=deadbeefsecret123"
        let clip = StorageSavedDriveClip(
            seq: 0,
            alongSec: 10,
            subjectId: "00000004-0000-4000-8000-000000000001",
            subjectKind: .poi,
            contentType: "audio/mp4",
            revisedAt: "2026-09-12T12:00:00.000Z",
            url: "https://r2.skipper.app/audio/0.m4a?\(presignedSecret)"
        )
        let detail = StorageSavedDriveDetail(
            driveId: driveId,
            label: "Presigned Test",
            polyline: [[0, 0]],
            clips: [clip]
        )

        // 1. downloadDrive
        _ = try await service.downloadDrive(driveId: driveId, detail: detail)
        let manifestFile = tempDir.appendingPathComponent("drives/\(driveId)/manifest.json")
        var rawString = try String(contentsOf: manifestFile, encoding: .utf8)
        XCTAssertFalse(rawString.contains(presignedSecret))
        XCTAssertFalse(rawString.contains("\"url\""))

        // 2. topUpDrive
        let topUpSecret = "X-Amz-Signature=topupsecret456"
        let clip1 = StorageSavedDriveClip(
            seq: 1,
            alongSec: 30,
            subjectId: "00000004-0000-4000-8000-000000000002",
            subjectKind: .poi,
            contentType: "audio/mp4",
            revisedAt: "2026-09-12T12:00:00.000Z",
            url: "https://r2.skipper.app/audio/1.m4a?\(topUpSecret)"
        )
        let topUpDetail = StorageSavedDriveDetail(
            driveId: driveId,
            label: "TopUp Detail",
            polyline: [[0, 0]],
            clips: [clip, clip1]
        )
        _ = try await service.topUpDrive(driveId: driveId, fresh: topUpDetail)
        rawString = try String(contentsOf: manifestFile, encoding: .utf8)
        XCTAssertFalse(rawString.contains(topUpSecret))
        XCTAssertFalse(rawString.contains("\"url\""))

        // 3. repairDownload
        let repairSecret = "X-Amz-Signature=repairsecret789"
        let repairClip = StorageSavedDriveClip(
            seq: 0,
            alongSec: 10,
            subjectId: "00000004-0000-4000-8000-000000000001",
            subjectKind: .poi,
            contentType: "audio/mp4",
            revisedAt: "2026-09-12T12:00:00.000Z",
            url: "https://r2.skipper.app/audio/0.m4a?\(repairSecret)"
        )
        let repairDetail = StorageSavedDriveDetail(
            driveId: driveId,
            label: "Repair Detail",
            polyline: [[0, 0]],
            clips: [repairClip]
        )
        _ = try await service.repairDownload(driveId: driveId, fresh: repairDetail)
        rawString = try String(contentsOf: manifestFile, encoding: .utf8)
        XCTAssertFalse(rawString.contains(repairSecret))
        XCTAssertFalse(rawString.contains("\"url\""))
    }

    // List filtering compatibility: listDownloadedDrives requires offlineStatus != nil (at least 1 present clip)
    func testListDownloadedDrivesExcludesZeroPresentClips() async throws {
        let fm = FileManager.default
        let tempDir = fm.temporaryDirectory.appendingPathComponent("ListFilter-\(UUID().uuidString)")
        try fm.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: tempDir) }

        let service = StorageService(rootURL: tempDir)
        let driveId = "00000002-0000-4000-8000-000000000001"
        let driveDir = tempDir.appendingPathComponent("drives/\(driveId)")
        try fm.createDirectory(at: driveDir, withIntermediateDirectories: true)

        // Manifest exists but its clip is NOT on disk in clips/
        let manifest = """
        {
            "version": 5,
            "driveId": "\(driveId)",
            "savedAt": "2026-09-12T12:00:00.000Z",
            "detail": {
                "driveId": "\(driveId)",
                "label": "Ghost Drive",
                "polyline": [[0, 0]],
                "clips": []
            },
            "audioSeqs": [0],
            "clips": {
                "0": {
                    "name": "poi-00000004-0000-4000-8000-000000000001.1789214400000.m4a",
                    "contentType": "audio/mp4",
                    "durationMs": 1000,
                    "shared": true
                }
            }
        }
        """
        try manifest.data(using: .utf8)!.write(to: driveDir.appendingPathComponent("manifest.json"))

        // offlineStatus must be nil (0 present clips)
        let status = await service.offlineStatus(driveId: driveId)
        XCTAssertNil(status)

        // listDownloadedDrives must exclude this drive
        let list = await service.listDownloadedDrives()
        XCTAssertTrue(list.isEmpty, "Drives with 0 present clips must be excluded from listDownloadedDrives")
    }

    private final class ResumeBox: @unchecked Sendable {
        private let lock = NSLock()
        private var cont: CheckedContinuation<Void, Never>?
        private var released = false

        func set(_ continuation: CheckedContinuation<Void, Never>) {
            lock.lock()
            let resumeNow = released
            if !resumeNow { cont = continuation }
            lock.unlock()
            if resumeNow { continuation.resume() }
        }

        func resume() {
            lock.lock()
            released = true
            let toResume = cont
            cont = nil
            lock.unlock()
            toResume?.resume()
        }
    }

    func testBlockedInnerTransferPurgeDoesNotRepopulateStore() async throws {
        let fm = FileManager.default
        let tempDir = fm.temporaryDirectory.appendingPathComponent("PurgeTest-\(UUID().uuidString)")
        try fm.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: tempDir) }

        let downloader = MockDownloader()
        let service = StorageService(rootURL: tempDir, downloader: downloader)

        let subjectId = "00000004-0000-4000-8000-000000000099"
        let rev = "2026-09-12T10:00:00.000Z"
        let storeKey = StorageStoreKey(
            subjectId: subjectId,
            subjectKind: .poi,
            rev: StorageUtils.revisionToken(rev)
        )
        let storeName = try StorageUtils.storeFileName(key: storeKey, contentType: "audio/mp4")
        let driveId = "00000002-0000-4000-8000-000000000099"

        let clip = StorageSavedDriveClip(
            seq: 0,
            alongSec: 10,
            subjectId: subjectId,
            subjectKind: .poi,
            contentType: "audio/mp4",
            revisedAt: rev,
            url: "https://example.com/audio/purge.m4a"
        )
        let detail = StorageSavedDriveDetail(
            driveId: driveId,
            label: "Purge Drive",
            polyline: [[0, 0]],
            clips: [clip]
        )

        let transferStarted = expectation(description: "Transfer started")
        let resumeBox = ResumeBox()

        downloader.onDownloadStart = { name in
            if name == storeName {
                transferStarted.fulfill()
                await withCheckedContinuation { cont in
                    resumeBox.set(cont)
                }
            }
        }

        // 1. Start download task
        let downloadTask = Task {
            try await service.downloadDrive(driveId: driveId, detail: detail)
        }

        // 2. Wait until downloader is paused inside actual inner transfer
        await fulfillment(of: [transferStarted], timeout: 5.0)

        // 3. Purge entire account while transfer is blocked
        _ = await service.deleteAllDriveDownloads()

        // 4. Resume the blocked downloader callback
        resumeBox.resume()

        // 5. Await download task (should fail or cancel)
        _ = try? await downloadTask.value

        // 6. Assert NO old bytes or manifest appear!
        let clipsDir = tempDir.appendingPathComponent("clips")
        let drivesDir = tempDir.appendingPathComponent("drives")
        if fm.fileExists(atPath: clipsDir.path) {
            let clips = (try? fm.contentsOfDirectory(atPath: clipsDir.path)) ?? []
            XCTAssertEqual(clips, [], "No old clips should repopulate clips directory post-purge")
        }
        XCTAssertFalse(fm.fileExists(atPath: drivesDir.appendingPathComponent(driveId).path), "No old manifest should appear post-purge")

        // 7. Verify new-generation valid work in the new epoch succeeds cleanly
        downloader.onDownloadStart = nil
        let newDriveId = "00000002-0000-4000-8000-000000000088"
        let newClip = StorageSavedDriveClip(
            seq: 0,
            alongSec: 10,
            subjectId: "00000004-0000-4000-8000-000000000088",
            subjectKind: .poi,
            contentType: "audio/mp4",
            revisedAt: "2026-09-12T12:00:00.000Z",
            url: "https://example.com/audio/newgen.m4a"
        )
        let newDetail = StorageSavedDriveDetail(
            driveId: newDriveId,
            label: "New Gen Drive",
            polyline: [[0, 0]],
            clips: [newClip]
        )

        let result = try await service.downloadDrive(driveId: newDriveId, detail: newDetail)
        XCTAssertEqual(result.downloaded, 1)
        let isNewComplete = await service.hasCompleteDrive(driveId: newDriveId)
        XCTAssertTrue(isNewComplete)
        let playback = try await service.loadPlayback(driveId: newDriveId)
        XCTAssertNotNil(playback.urls[0])
        XCTAssertTrue(fm.fileExists(atPath: playback.urls[0]!.path))
    }

    func testSharedTransferConsumerCancellationDoesNotDeleteLandedClipForOtherConsumer() async throws {
        let fm = FileManager.default
        let tempDir = fm.temporaryDirectory.appendingPathComponent("SharedCancelTest-\(UUID().uuidString)")
        try fm.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: tempDir) }

        let downloader = MockDownloader()
        let service = StorageService(rootURL: tempDir, downloader: downloader)

        let subjectId = "00000004-0000-4000-8000-000000000077"
        let rev = "2026-09-12T10:00:00.000Z"
        let storeKey = StorageStoreKey(
            subjectId: subjectId,
            subjectKind: .poi,
            rev: StorageUtils.revisionToken(rev)
        )
        let storeName = try StorageUtils.storeFileName(key: storeKey, contentType: "audio/mp4")

        let sharedClip = StorageSavedDriveClip(
            seq: 0,
            alongSec: 10,
            subjectId: subjectId,
            subjectKind: .poi,
            contentType: "audio/mp4",
            revisedAt: rev,
            url: "https://example.com/audio/shared.m4a"
        )

        let driveA = "00000002-0000-4000-8000-000000000071"
        let driveB = "00000002-0000-4000-8000-000000000072"
        let detailA = StorageSavedDriveDetail(driveId: driveA, label: "Drive A", polyline: [[0, 0]], clips: [sharedClip])
        let detailB = StorageSavedDriveDetail(driveId: driveB, label: "Drive B", polyline: [[0, 0]], clips: [sharedClip])

        let transferStarted = expectation(description: "Shared transfer started")
        let resumeBox = ResumeBox()

        downloader.onDownloadStart = { name in
            if name == storeName {
                transferStarted.fulfill()
                await withCheckedContinuation { cont in
                    resumeBox.set(cont)
                }
            }
        }

        let joined = expectation(description: "Second shared consumer registered")
        await service.observeConcurrency { event in
            if case .transferConsumerRegistered(let id) = event, id == driveB { joined.fulfill() }
        }

        // Drive A starts download (becomes consumer 1)
        let taskA = Task {
            try await service.downloadDrive(driveId: driveA, detail: detailA)
        }

        await fulfillment(of: [transferStarted], timeout: 5.0)

        // Drive B starts download while transfer is paused (becomes consumer 2)
        let taskB = Task {
            try await service.downloadDrive(driveId: driveB, detail: detailB)
        }

        await fulfillment(of: [joined], timeout: 5)

        // Cancel Drive A
        await service.cancelDownload(driveId: driveA)

        // Resume transfer callback
        resumeBox.resume()

        // Drive A should be cancelled
        _ = try? await taskA.value

        // Drive B must succeed!
        let resultB = try await taskB.value
        XCTAssertEqual(resultB.downloaded, 1)
        let isBComplete = await service.hasCompleteDrive(driveId: driveB)
        XCTAssertTrue(isBComplete)
        let playbackB = try await service.loadPlayback(driveId: driveB)
        XCTAssertNotNil(playbackB.urls[0])
        XCTAssertTrue(fm.fileExists(atPath: playbackB.urls[0]!.path))
    }

    func testSharedTransferSoleConsumerCancellationCancelsInnerTask() async throws {
        let fm = FileManager.default
        let tempDir = fm.temporaryDirectory.appendingPathComponent("SoleCancelTest-\(UUID().uuidString)")
        try fm.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: tempDir) }

        let downloader = MockDownloader()
        let service = StorageService(rootURL: tempDir, downloader: downloader)

        let subjectId = "00000004-0000-4000-8000-000000000066"
        let rev = "2026-09-12T10:00:00.000Z"
        let storeKey = StorageStoreKey(
            subjectId: subjectId,
            subjectKind: .poi,
            rev: StorageUtils.revisionToken(rev)
        )
        let storeName = try StorageUtils.storeFileName(key: storeKey, contentType: "audio/mp4")

        let soleClip = StorageSavedDriveClip(
            seq: 0,
            alongSec: 10,
            subjectId: subjectId,
            subjectKind: .poi,
            contentType: "audio/mp4",
            revisedAt: rev,
            url: "https://example.com/audio/sole.m4a"
        )
        let driveSole = "00000002-0000-4000-8000-000000000066"
        let detail = StorageSavedDriveDetail(driveId: driveSole, label: "Drive Sole", polyline: [[0, 0]], clips: [soleClip])

        let transferStarted = expectation(description: "Sole transfer started")
        let resumeBox = ResumeBox()

        downloader.onDownloadStart = { name in
            if name == storeName {
                transferStarted.fulfill()
                await withCheckedContinuation { cont in
                    resumeBox.set(cont)
                }
            }
        }

        let downloadTask = Task {
            try await service.downloadDrive(driveId: driveSole, detail: detail)
        }

        await fulfillment(of: [transferStarted], timeout: 5.0)

        // Cancel the sole consumer
        await service.cancelDownload(driveId: driveSole)

        // Resume callback
        resumeBox.resume()

        _ = try? await downloadTask.value

        // Assert that no clip was placed into clips/
        let clipFile = tempDir.appendingPathComponent("clips").appendingPathComponent(storeName)
        XCTAssertFalse(fm.fileExists(atPath: clipFile.path))
    }
}
