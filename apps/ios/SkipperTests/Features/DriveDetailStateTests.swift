import XCTest
@testable import Skipper

@MainActor final class DriveDetailStateTests: XCTestCase {
    private let driveID = "11111111-1111-4111-8111-111111111111"

    func testRealStorageByteAndConnectivityMatrix() async throws {
        for offline in [false, true] {
            for present in [Set<Int>(), [0], [0, 1]] {
                let rig = try DetailRig(driveID: driveID)
                defer { rig.removeFiles() }
                try await rig.seed(present)
                await rig.downloader.allow([]) // Opening must not silently complete this test's partial copy.
                await rig.network.setOffline(offline)
                if offline { await rig.api.fail(status: nil) }
                let model = rig.model()
                await model.load()
                await model.topUpTask?.value
                XCTAssertEqual(model.manifest?.label, "Test Drive")
                XCTAssertEqual(Set(model.localAudioURLs.keys), present)
                XCTAssertEqual(model.isOffline, offline)
                XCTAssertEqual(model.missingCount, 2 - present.count)
                let expected: StorageDriveGate = present.count == 2 ? .play : offline ? (present.isEmpty ? .nothingSaved : .play) : .needsDownload
                XCTAssertEqual(model.gate, expected, "offline=\(offline), present=\(present)")
                let prepared = await model.prepareToStart()
                XCTAssertEqual(prepared != nil, expected == .play)
                if present.isEmpty {
                    let rows = await rig.storage.listDownloadedDrives()
                    XCTAssertTrue(rows.isEmpty, "Zero-byte metadata must not become an offline Library row")
                }
                model.endPresentation()
            }
        }
    }

    func testMissingStorageNeverEnablesStart() async throws {
        let api = DetailAPI(manifest: try detailManifest(id: driveID))
        let model = DriveDetailViewModel(driveId: driveID, api: api)
        await model.load()
        XCTAssertEqual(model.gate, .needsDownload)
        let start = await model.prepareToStart()
        XCTAssertNil(start)
    }

    func testHTTP500FallbackIsStillOnlineAndCannotStartPartial() async throws {
        let rig = try DetailRig(driveID: driveID)
        defer { rig.removeFiles() }
        try await rig.seed([0])
        await rig.api.fail(status: 500)
        let model = rig.model()
        await model.load()
        XCTAssertEqual(model.manifest?.label, "Test Drive")
        XCTAssertFalse(model.isOffline)
        XCTAssertEqual(model.gate, .needsDownload)
        XCTAssertEqual(model.missingCount, 1)
        let start = await model.prepareToStart()
        XCTAssertNil(start)
        XCTAssertNil(model.errorMessage)
    }

    func testStartRechecksCurrentConnectivityAndBytes() async throws {
        let rig = try DetailRig(driveID: driveID)
        defer { rig.removeFiles() }
        try await rig.seed([0])
        await rig.network.setOffline(true)
        await rig.api.fail(status: nil)
        let model = rig.model()
        await model.load()
        XCTAssertEqual(model.gate, .play)
        await rig.network.setOffline(false)
        let onlineStart = await model.prepareToStart()
        XCTAssertNil(onlineStart)
        XCTAssertEqual(model.gate, .needsDownload)
        await rig.network.setOffline(true)
        let partialStart = await model.prepareToStart()
        XCTAssertNotNil(partialStart)
        try FileManager.default.removeItem(at: XCTUnwrap(model.localAudioURLs[0]))
        let missingStart = await model.prepareToStart()
        XCTAssertNil(missingStart)
        XCTAssertEqual(model.gate, .nothingSaved)
    }

    func testSavedDetailAuditionsOnlyLocalBytesEvenOnlineWithRemoteURLs() async throws {
        let rig = try DetailRig(driveID: driveID)
        defer { rig.removeFiles() }
        try await rig.seed([0])
        await rig.downloader.allow([])
        let audio = MockAudioPreviewController()
        let model = rig.model(audio: audio)
        await model.load()
        await model.topUpTask?.value
        XCTAssertEqual(model.gate, .needsDownload)
        XCTAssertNotNil(model.manifest?.clips[1].url)
        XCTAssertTrue(model.isStopAuditionable(seq: 0))
        XCTAssertFalse(model.isStopAuditionable(seq: 1))
        await model.auditionStop(seq: 1)
        XCTAssertNil(audio.lastPlayedURL)
        await model.auditionStop(seq: 0)
        XCTAssertEqual(audio.lastPlayedURL, model.localAudioURLs[0])
        XCTAssertTrue(try XCTUnwrap(audio.lastPlayedURL).isFileURL)
        XCTAssertTrue(model.previewPlaying)
        await model.auditionStop(seq: 0)
        XCTAssertFalse(model.previewPlaying)
        XCTAssertEqual(model.auditionStopSeq, 0, "Pause retains the scrubber and resume target")
        await model.auditionStop(seq: 0)
        XCTAssertTrue(model.previewPlaying)
        model.seekPreview(by: 15)
        XCTAssertEqual(audio.currentTimeSec, 15)
        model.seekPreview(to: 100)
        XCTAssertEqual(audio.currentTimeSec, 30)
        model.seekPreview(by: -15)
        XCTAssertEqual(audio.currentTimeSec, 15)
        model.seekPreview(to: -5)
        XCTAssertEqual(audio.currentTimeSec, 0)
        model.endPresentation()
        XCTAssertFalse(audio.isPlaying)
        XCTAssertNil(audio.currentItemKey)
    }

    func testOnlineReopenTopsUpSavedPartialAndNeverDownloadsUnsavedDrive() async throws {
        let rig = try DetailRig(driveID: driveID)
        defer { rig.removeFiles() }
        try await rig.seed([0])
        await rig.downloader.allow([0, 1])
        let before = await rig.downloader.calls
        let model = rig.model()
        await model.load()
        await model.topUpTask?.value
        XCTAssertEqual(model.gate, .play)
        XCTAssertEqual(model.missingCount, 0)
        XCTAssertEqual(model.localAudioURLs.count, 2)
        let after = await rig.downloader.calls
        XCTAssertEqual(after.count - before.count, 1, "Top-up only fetches the one missing subject")
        let other = try DetailRig(driveID: "22222222-2222-4222-8222-222222222222")
        defer { other.removeFiles() }
        let unsaved = other.model()
        await unsaved.load()
        await unsaved.topUpTask?.value
        let unsavedCalls = await other.downloader.calls
        XCTAssertTrue(unsavedCalls.isEmpty)
        XCTAssertEqual(unsaved.gate, .needsDownload)
    }

    func testFailedRevisionTopUpKeepsFallbackBytesAndOffersUpdate() async throws {
        let rig = try DetailRig(driveID: driveID)
        defer { rig.removeFiles() }
        try await rig.seed([0, 1])
        let previous = try await rig.storage.loadPlayback(driveId: driveID).urls
        await rig.api.replace(try detailManifest(id: driveID, revision: "2026-09-12T00:00:00Z"))
        await rig.downloader.allow([])
        let model = rig.model()
        await model.load()
        await model.topUpTask?.value
        XCTAssertEqual(model.localAudioURLs, previous)
        XCTAssertEqual(model.gate, .play)
        XCTAssertTrue(model.isUpdatable)
        for url in previous.values { XCTAssertTrue(FileManager.default.fileExists(atPath: url.path)) }
    }

    func testRepairAdoptsExistingSharedBytesWithoutDownloadingAndPreservesAge() async throws {
        let rig = try DetailRig(driveID: driveID)
        defer { rig.removeFiles() }
        try await rig.seed([0, 1])
        let playback = try await rig.storage.loadPlayback(driveId: driveID)
        for url in playback.urls.values {
            try FileManager.default.setAttributes([.modificationDate: Date(timeIntervalSince1970: 946_684_800)], ofItemAtPath: url.path)
        }
        let manifestURL = rig.root.appendingPathComponent("drives/\(driveID)/manifest.json")
        try Data("{unreadable".utf8).write(to: manifestURL)
        let countBefore = await rig.downloader.calls.count
        let model = rig.model()
        await model.load()
        await model.topUpTask?.value
        XCTAssertEqual(model.directoryState, .unreadable)
        XCTAssertFalse(model.hasLocalAudio)
        await model.repairDownload()
        XCTAssertEqual(model.directoryState, .ok)
        XCTAssertEqual(model.gate, .play)
        XCTAssertEqual(model.localAudioURLs.count, 2)
        XCTAssertTrue(model.isExpired, "Repair dates the copy from its existing bytes")
        XCTAssertNil(model.downloadError)
        let countAfter = await rig.downloader.calls.count
        XCTAssertEqual(countAfter, countBefore)
    }

    func testExplicitDownloadRefreshesURLsAndReDerivesPartialThenComplete() async throws {
        let rig = try DetailRig(driveID: driveID)
        defer { rig.removeFiles() }
        await rig.downloader.allow([0])
        let model = rig.model()
        await model.load()
        await model.topUpTask?.value
        await model.startDownload()
        XCTAssertEqual(model.gate, .needsDownload)
        XCTAssertEqual(model.missingCount, 1)
        XCTAssertNotNil(model.downloadError)
        await rig.downloader.allow([0, 1])
        await model.startDownload()
        XCTAssertEqual(model.gate, .play)
        XCTAssertEqual(model.localAudioURLs.count, 2)
        XCTAssertNil(model.downloadError)
        let calls = await rig.api.calls
        XCTAssertEqual(calls, 3, "Load plus each explicit download fetches an owner-scoped fresh detail")
        await model.purgeDownload()
        XCTAssertFalse(model.hasLocalAudio)
        XCTAssertEqual(model.directoryState, .none)
        XCTAssertEqual(model.gate, .needsDownload)
    }

    func testCancelDuringFreshManifestFetchCannotStartALateDownload() async throws {
        let rig = try DetailRig(driveID: driveID)
        defer { rig.removeFiles() }
        let model = rig.model()
        await model.load()
        await model.topUpTask?.value
        let entered = expectation(description: "explicit download fetching fresh signed URLs")
        await rig.api.suspendNext(entered)
        let download = Task { await model.startDownload() }
        await fulfillment(of: [entered], timeout: 2)
        await model.cancelDownload()
        await rig.api.release()
        await download.value
        XCTAssertFalse(model.isDownloading)
        let calls = await rig.downloader.calls
        XCTAssertTrue(calls.isEmpty)
        XCTAssertFalse(model.hasLocalAudio)
    }

    func testRealOwnerGateIsRecheckedAfterFetchAndBeforePreviewAndStart() async throws {
        let rig = try DetailRig(driveID: driveID)
        defer { rig.removeFiles() }
        try await rig.seed([0, 1])
        let input = try FeaturesQAFixtures.input("contracts/ui-flows", id: "corrupt-credentials-recovery")
        let transport = FeaturesQAHTTP(responses: [
            "POST /api/auth/sign-in/email-otp": Data("{}".utf8),
            "GET /api/auth/get-session": try FeaturesQAFixtures.data(XCTUnwrap(input["signedInSession"])),
            "GET /drives/\(driveID)": try JSONEncoder().encode(detailManifest(id: driveID))
        ])
        let keychain = FeaturesQAKeychain()
        try keychain.write(Data("broken".utf8), at: CredentialVault.address)
        let vault = CredentialVault(keychain: keychain, clock: FeaturesQAClock())
        let base = URL(string: "https://detail.example.invalid")!
        let auth = AuthClient(baseURL: base, transport: transport, vault: vault)
        let session = SessionStore(auth: auth, vault: vault, clock: FeaturesQAClock(), purgeDownloads: {})
        await session.start()
        try await session.signIn(email: "rider@example.invalid", code: "123456")
        let before = await session.canAccessLocalDrive(driveID)
        XCTAssertFalse(before)
        let audio = MockAudioPreviewController()
        let events = DetailEvents()
        let model = DriveDetailViewModel(driveId: driveID,
            api: APIClient(baseURL: base, transport: transport, cookies: vault), storage: rig.storage,
            session: session, audio: audio, analytics: { events.record($0, $1) }, network: rig.network)
        await model.load()
        await model.topUpTask?.value
        XCTAssertEqual(model.gate, .play, "Successful API ownership evidence must be read after the fetch")
        await model.auditionStop(seq: 0)
        XCTAssertTrue(audio.isPlaying)
        try await session.signOut()
        await model.auditionStop(seq: 1)
        XCTAssertFalse(audio.isPlaying)
        XCTAssertTrue(model.localAudioURLs.isEmpty)
        let first = await model.prepareToStart(), second = await model.prepareToStart()
        XCTAssertNil(first); XCTAssertNil(second)
        XCTAssertEqual(events.sources, ["drive_play"])
    }

    func testExplicitDownloadDedupesAndSurvivesLeavingDetail() async throws {
        let rig = try DetailRig(driveID: driveID)
        defer { rig.removeFiles() }
        let model = rig.model()
        await model.load()
        await model.topUpTask?.value
        let entered = expectation(description: "download request entered")
        await rig.api.suspendNext(entered)
        let download = Task { await model.startDownload() }
        let repeatedTap = Task { await model.startDownload() }
        await fulfillment(of: [entered], timeout: 2)
        await repeatedTap.value
        model.endPresentation()
        await rig.api.release()
        await download.value
        let apiCalls = await rig.api.calls
        let byteCalls = await rig.downloader.calls
        XCTAssertEqual(apiCalls, 2, "Repeated tap joins the screen's existing request")
        XCTAssertEqual(byteCalls.count, 2)
        let saved = try await rig.storage.loadPlayback(driveId: driveID)
        XCTAssertEqual(saved.urls.count, 2, "Leaving detail must not cancel a deliberate download")
    }

    func testLateLoadCannotRepopulateDismissedDetail() async throws {
        let rig = try DetailRig(driveID: driveID)
        defer { rig.removeFiles() }
        let model = rig.model()
        let entered = expectation(description: "detail request entered")
        await rig.api.suspendNext(entered)
        let loading = Task { await model.load() }
        await fulfillment(of: [entered], timeout: 2)
        model.endPresentation()
        await rig.api.release()
        await loading.value
        XCTAssertNil(model.manifest)
        XCTAssertNil(model.topUpTask)
    }

    func test401ShowsDetailWallOnceWithoutServingLocalFallback() async throws {
        let rig = try DetailRig(driveID: driveID)
        defer { rig.removeFiles() }
        try await rig.seed([0, 1])
        await rig.api.fail(status: 401)
        let events = DetailEvents()
        let model = rig.model(analytics: { events.record($0, $1) })
        await model.load(); await model.load()
        XCTAssertTrue(model.needsAccount)
        XCTAssertNil(model.manifest)
        XCTAssertTrue(model.localAudioURLs.isEmpty)
        XCTAssertEqual(events.sources, ["drive_detail"])
    }

    func testConfirmedDeletePropagatesExactIDAfterLocalCleanup() async throws {
        for status in [nil, 404] as [Int?] {
            let rig = try DetailRig(driveID: driveID)
            defer { rig.removeFiles() }
            try await rig.seed([0, 1])
            await rig.api.setDeleteFailure(status)
            let audio = MockAudioPreviewController()
            let model = rig.model(audio: audio)
            await model.load()
            await model.topUpTask?.value
            await model.auditionStop(seq: 0)
            var deleted: [String] = []
            await model.deleteDrive { id in
                XCTAssertFalse(audio.isPlaying)
                XCTAssertFalse(FileManager.default.fileExists(atPath: rig.root.appendingPathComponent("drives/\(id)").path))
                deleted.append(id)
            }
            XCTAssertEqual(deleted, [driveID], "Only the confirmed drive is propagated to Navigation/Library")
            let retained = await rig.storage.loadManifest(driveId: driveID)
            XCTAssertNil(retained)
            XCTAssertNil(model.errorMessage)
        }
    }

    func testFailedDeleteDoesNotPropagateOrRemoveLocalCopy() async throws {
        for status in [401, 500] {
            let rig = try DetailRig(driveID: driveID)
            defer { rig.removeFiles() }
            try await rig.seed([0, 1])
            await rig.api.setDeleteFailure(status)
            let model = rig.model()
            await model.load()
            await model.topUpTask?.value
            var deleted: [String] = []
            await model.deleteDrive { deleted.append($0) }
            XCTAssertTrue(deleted.isEmpty, "Failed deletion must leave the Library row in place")
            let playback = try await rig.storage.loadPlayback(driveId: driveID)
            XCTAssertEqual(playback.urls.count, 2)
            if status == 401 { XCTAssertTrue(model.needsAccount) }
            else { XCTAssertNotNil(model.errorMessage) }
        }
    }
}

@MainActor private final class DetailRig {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("DriveDetail-\(UUID().uuidString)")
    let id: String
    let manifest: DriveManifest
    let downloader = DetailDownloader()
    let network = FeaturesQANetwork()
    let storage: StorageService
    let api: DetailAPI
    init(driveID: String) throws {
        id = driveID; manifest = try detailManifest(id: driveID)
        storage = StorageService(rootURL: root, downloader: downloader)
        api = DetailAPI(manifest: manifest)
    }
    func seed(_ present: Set<Int>) async throws {
        await downloader.allow([0, 1])
        _ = try await storage.downloadDrive(driveId: id,
            detail: StorageSavedDriveDetail.from(jsonData: JSONEncoder().encode(manifest)))
        let playback = try await storage.loadPlayback(driveId: id)
        for (seq, url) in playback.urls where !present.contains(seq) {
            try FileManager.default.removeItem(at: url)
        }
    }
    func model(audio: (any AudioPreviewControlling)? = nil, analytics: AnalyticsTracker? = nil) -> DriveDetailViewModel {
        DriveDetailViewModel(driveId: id, api: api, storage: storage, audio: audio, analytics: analytics, network: network)
    }
    func removeFiles() { try? FileManager.default.removeItem(at: root) }
}

private actor DetailDownloader: StorageFileDownloader {
    private var permitted: Set<Int> = [0, 1]
    private(set) var calls: [URL] = []
    func allow(_ values: Set<Int>) { permitted = values }
    func downloadFile(from url: URL, to destURL: URL, name: String,
                      onProgress: (@Sendable (Int64, Int64) -> Void)?) async throws {
        calls.append(url)
        guard let seq = Int(url.deletingPathExtension().lastPathComponent), permitted.contains(seq) else {
            throw URLError(.notConnectedToInternet)
        }
        try FileManager.default.createDirectory(at: destURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data([0, 0, 0, 24, 102, 116, 121, 112, UInt8(seq)]).write(to: destURL)
    }
}

private actor DetailAPI: SkipperAPI {
    var manifest: DriveManifest
    var failure: Error?
    private var deleteStatus: Int?
    private(set) var calls = 0
    private var entered: XCTestExpectation?
    private var waiting: CheckedContinuation<Void, Never>?
    init(manifest: DriveManifest) { self.manifest = manifest }
    func replace(_ manifest: DriveManifest) { self.manifest = manifest; failure = nil }
    func fail(status: Int?) {
        if let status { failure = APIError(status: status, code: nil, message: "Fixture failure") }
        else { failure = URLError(.notConnectedToInternet) }
    }
    func suspendNext(_ entered: XCTestExpectation) { self.entered = entered }
    func release() { waiting?.resume(); waiting = nil }
    func drive(id: String) async throws -> DriveManifest {
        calls += 1
        if let entered {
            self.entered = nil
            await withCheckedContinuation { waiting = $0; entered.fulfill() }
        }
        if let failure { throw failure }
        return manifest
    }
    func bootstrap(rotation: Int) async throws -> Bootstrap { throw URLError(.unsupportedURL) }
    func listDrives() async throws -> DriveList { throw URLError(.unsupportedURL) }
    func propose(_ request: DriveProposeRequest) async throws -> DriveProposal { throw URLError(.unsupportedURL) }
    func create(_ request: CreateDriveRequest) async throws -> DriveManifest { throw URLError(.unsupportedURL) }
    func setDeleteFailure(_ status: Int?) { deleteStatus = status }
    func deleteDrive(id: String) async throws {
        if let deleteStatus { throw APIError(status: deleteStatus, code: nil, message: "Fixture delete failure") }
    }
    func setAccountPassword(_ password: String) async throws {}
    func version() async throws -> [VersionPolicy] { [] }
}

private final class DetailEvents: @unchecked Sendable {
    private let lock = NSLock()
    private var recorded: [String] = []
    var sources: [String] { lock.withLock { recorded } }
    func record(_ name: String, _ properties: [String: Any]) {
        XCTAssertNotNil(AnalyticsContract.validate(name, properties: properties))
        XCTAssertEqual(name, "wall_shown")
        lock.withLock { recorded.append(properties["source"] as? String ?? "invalid") }
    }
}

private func detailManifest(id: String, revision: String = "2026-01-01T00:00:00Z") throws -> DriveManifest {
    let clips: [[String: Any]] = (0..<2).map { seq in [
        "seq": seq, "form": "story", "alongSec": seq * 100, "name": "Stop \(seq)",
        "lat": 34.01, "lng": -118.49 + Double(seq) * 0.01,
        "poiId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa\(seq)",
        "durationMs": 30_000, "contentType": "audio/mp4", "url": "https://detail.example.invalid/\(seq).m4a",
        "revisedAt": revision
    ] }
    let data = try JSONSerialization.data(withJSONObject: ["driveId": id, "label": "Test Drive",
        "polyline": [[-118.49, 34.01], [-118.47, 34.01]], "distanceMeters": 2000,
        "durationSeconds": 600, "clips": clips])
    return try JSONDecoder().decode(DriveManifest.self, from: data)
}
