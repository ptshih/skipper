import XCTest
@testable import Skipper

@MainActor final class LibraryFilterTests: XCTestCase {
    private let tahoe = "11111111-1111-4111-8111-111111111111"
    private let yosemite = "22222222-2222-4222-8222-222222222222"
    private let secondDrive = "00000000-0000-4000-8000-000000000002"

    private func fixtureList() throws -> DriveList {
        let json = """
        {
          "drives": [
            {
              "driveId": "00000000-0000-4000-8000-000000000001",
              "label": "Tahoe Ridge",
              "clipCount": 4,
              "createdAt": "2026-09-12T12:00:00.000Z",
              "startName": "Tahoe",
              "endName": "Incline",
              "durationSeconds": 1800,
              "region": {
                "id": "11111111-1111-4111-8111-111111111111",
                "slug": "us-tahoe",
                "displayName": "Lake Tahoe"
              }
            },
            {
              "driveId": "00000000-0000-4000-8000-000000000002",
              "label": "Yosemite Valley",
              "clipCount": 6,
              "createdAt": "2026-09-12T12:00:00.000Z",
              "startName": "Valley",
              "endName": "Glacier",
              "durationSeconds": 2400,
              "region": {
                "id": "22222222-2222-4222-8222-222222222222",
                "slug": "us-yosemite",
                "displayName": "Yosemite"
              }
            },
            {
              "driveId": "00000000-0000-4000-8000-000000000003",
              "label": "Tahoe West",
              "clipCount": 3,
              "createdAt": "2026-09-12T12:00:00.000Z",
              "startName": "Tahoe City",
              "endName": "Emerald Bay",
              "durationSeconds": 1200,
              "region": {
                "id": "11111111-1111-4111-8111-111111111111",
                "slug": "us-tahoe",
                "displayName": "Lake Tahoe"
              }
            },
            {
              "driveId": "00000000-0000-4000-8000-000000000004",
              "label": "Unlabeled Drive",
              "clipCount": 2,
              "createdAt": "2026-09-12T12:00:00.000Z",
              "region": null
            }
          ],
          "credits": {
            "remaining": 3,
            "cap": 5
          }
        }
        """
        return try JSONDecoder().decode(DriveList.self, from: Data(json.utf8))
    }

    private func makeSession() async throws -> SessionStore {
        let clock = FixedAuthClock(date: authDate("2026-09-12T12:00:00Z")!)
        let vault = CredentialVault(keychain: try syntheticKeychain(), clock: clock)
        let session = SessionStore(auth: AuthTestService(session: syntheticSession()), vault: vault,
                                   network: AuthTestNetwork(offline: true), clock: clock, purgeDownloads: {})
        await session.start()
        XCTAssertTrue(session.isSignedIn)
        return session
    }

    func testRegionFacetsAndReconciliationIncludesUnassignedDrives() async throws {
        let api = MockLibraryAPI(driveList: try fixtureList())
        let model = LibraryViewModel(api: api, session: try await makeSession())
        await model.loadDrives()
        XCTAssertEqual(model.facets.map(\.displayName), ["Lake Tahoe", "Yosemite"])
        XCTAssertEqual(model.facets.map(\.count), [2, 1])
        model.selectRegion(yosemite)
        XCTAssertEqual(model.filteredDrives.map(\.driveId), [secondDrive])
        model.removeDriveLocally(driveId: secondDrive)
        XCTAssertNil(model.selectedRegion)
        XCTAssertFalse(model.shouldOfferRegionFilter)
        XCTAssertEqual(model.filteredDrives.count, 3, "Unassigned drives remain visible after filter disappears")
        model.selectRegion(tahoe)
        XCTAssertNil(model.selectedRegion, "A hidden filter must not strand unassigned drives")
    }

    func testFailedRefreshWithoutDownloadsPreservesRowsFacetsAndSelectionThenRetryReconciles() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let list = try fixtureList()
        let api = MockLibraryAPI(driveList: list)
        let model = LibraryViewModel(api: api, session: try await makeSession(), storage: StorageService(rootURL: root))
        await model.loadDrives()
        model.selectRegion(yosemite)
        let rows = model.drives
        let facets = model.facets
        await api.setFailure(URLError(.notConnectedToInternet))
        await model.loadDrives()
        XCTAssertEqual(model.drives, rows)
        XCTAssertEqual(model.facets, facets)
        XCTAssertEqual(model.credits, list.credits)
        XCTAssertEqual(model.selectedRegion, yosemite)
        XCTAssertEqual(model.filteredDrives.map(\.driveId), [secondDrive])
        XCTAssertNotNil(model.errorMessage)
        XCTAssertFalse(model.isOfflineFallback)
        XCTAssertFalse(model.isLoading)
        await api.setList(DriveList(drives: list.drives.filter { $0.driveId != secondDrive }, credits: list.credits))
        await model.loadDrives()
        XCTAssertNil(model.errorMessage)
        XCTAssertNil(model.selectedRegion)
        XCTAssertEqual(model.filteredDrives.count, 3)
    }

    func testInitialFailureIsNotSuccessfulEmptyAndSuccessfulRetryClearsError() async throws {
        let api = MockLibraryAPI(driveList: DriveList(drives: [], credits: nil))
        await api.setFailure(ContractError())
        let model = LibraryViewModel(api: api, session: try await makeSession())
        await model.loadDrives()
        XCTAssertTrue(model.drives.isEmpty)
        XCTAssertEqual(model.errorMessage, ContractError().localizedDescription)
        XCTAssertFalse(model.isLoading)
        await api.setList(DriveList(drives: [], credits: nil))
        await model.loadDrives()
        XCTAssertTrue(model.drives.isEmpty)
        XCTAssertNil(model.errorMessage)
    }

    func testVerifiedOfflineReplacementClearsOnlineFacetsCreditsAndHiddenSelection() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let storage = StorageService(rootURL: root, downloader: LibraryFixtureDownloader())
        let detail = StorageSavedDriveDetail(driveId: secondDrive, label: "Saved Yosemite",
            polyline: [[-119.6, 37.7], [-119.5, 37.8]], clips: [
                StorageSavedDriveClip(seq: 0, alongSec: 1, subjectId: "00000004-0000-4000-8000-000000000001",
                                     subjectKind: .poi, contentType: "audio/mp4", url: "https://audio.invalid/clip.m4a"),
                StorageSavedDriveClip(seq: 1, alongSec: 2, subjectId: "00000004-0000-4000-8000-000000000002",
                                     subjectKind: .poi, contentType: "audio/mp4", url: "https://audio.invalid/other.m4a")
            ])
        _ = try await storage.downloadDrive(driveId: secondDrive, detail: detail)
        let api = MockLibraryAPI(driveList: try fixtureList())
        let model = LibraryViewModel(api: api, session: try await makeSession(), storage: storage)
        await model.loadDrives()
        model.selectRegion(yosemite)
        let playback = try await storage.loadPlayback(driveId: secondDrive)
        try FileManager.default.removeItem(at: XCTUnwrap(playback.urls[1]))
        await api.setFailure(OfflineError())
        await model.loadDrives()
        XCTAssertTrue(model.isOfflineFallback)
        XCTAssertEqual(model.drives.map(\.driveId), [secondDrive])
        XCTAssertEqual(model.drives.first?.downloadState, .partial(downloaded: 1, total: 2))
        XCTAssertEqual(model.filteredDrives, model.drives)
        XCTAssertTrue(model.facets.isEmpty)
        XCTAssertNil(model.selectedRegion)
        XCTAssertNil(model.credits)
        XCTAssertNil(model.errorMessage, "The offline banner and playable partial row explain this valid fallback")
        let failures: [any Error] = [
            APIError(status: 401, code: "account_required", message: "Please sign in again."),
            APIError(status: 403, code: "cap", message: "Contact support."),
            APIError(status: 500, code: "server", message: "Please retry."),
            ContractError(), URLError(.networkConnectionLost)
        ]
        for failure in failures {
            await api.setFailure(failure)
            await model.loadDrives()
            XCTAssertEqual(model.drives.map(\.driveId), [secondDrive])
            XCTAssertEqual(model.drives.first?.downloadState, .partial(downloaded: 1, total: 2))
            XCTAssertEqual(model.errorMessage, userMessage(for: failure, fallback: "Could not load drives. Please check your connection."))
        }
        await api.setFailure(OfflineError())
        await model.loadDrives()
        XCTAssertNil(model.errorMessage, "Confirmed offline fallback also clears an earlier non-offline failure")
    }

    func testVerifiedOfflineEmptyDoesNotClaimCloudLibraryEmptyOrOfferUnavailableRows() async throws {
        for missingClip in [false, true] {
            let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            defer { try? FileManager.default.removeItem(at: root) }
            let storage = StorageService(rootURL: root, downloader: LibraryFixtureDownloader())
            if missingClip {
                let detail = StorageSavedDriveDetail(driveId: secondDrive, label: "Saved Yosemite",
                    polyline: [[-119.6, 37.7], [-119.5, 37.8]], clips: [
                        StorageSavedDriveClip(seq: 0, alongSec: 1, subjectId: "00000004-0000-4000-8000-000000000001",
                                             subjectKind: .poi, contentType: "audio/mp4", url: "https://audio.invalid/clip.m4a")
                    ])
                _ = try await storage.downloadDrive(driveId: secondDrive, detail: detail)
                let playback = try await storage.loadPlayback(driveId: secondDrive)
                XCTAssertEqual(playback.urls.count, 1)
                for file in playback.urls.values { try FileManager.default.removeItem(at: file) }
                let manifest = await storage.loadManifest(driveId: secondDrive)
                XCTAssertNotNil(manifest, "A retained manifest alone must not offer an unplayable row")
            }
            let api = MockLibraryAPI(driveList: try fixtureList())
            let model = LibraryViewModel(api: api, session: try await makeSession(), storage: storage)
            await model.loadDrives()
            XCTAssertEqual(model.drives.count, 4)
            model.selectRegion(yosemite)
            await api.setFailure(OfflineError())
            await model.loadDrives()
            XCTAssertTrue(model.isOfflineFallback)
            XCTAssertTrue(model.drives.isEmpty)
            XCTAssertTrue(model.facets.isEmpty)
            XCTAssertNil(model.selectedRegion)
            XCTAssertNil(model.credits)
            XCTAssertNil(model.errorMessage)
            await api.setList(try fixtureList())
            await model.loadDrives()
            XCTAssertFalse(model.isOfflineFallback)
            XCTAssertEqual(model.drives.count, 4, "Cloud contents were unknown while offline, never inferred empty")
        }
    }

    func testCancelledRefreshCannotCommitLateSuccessOrChangeExistingSnapshot() async throws {
        let api = MockLibraryAPI(driveList: try fixtureList())
        let model = LibraryViewModel(api: api, session: try await makeSession())
        await model.loadDrives()
        model.selectRegion(yosemite)
        let rows = model.drives
        let facets = model.facets
        let credits = model.credits
        let entered = expectation(description: "Refresh suspended inside API")
        await api.hold(entered)
        let refresh = Task { await model.loadDrives() }
        await fulfillment(of: [entered], timeout: 2)
        XCTAssertTrue(model.isLoading)
        refresh.cancel()
        await api.release(DriveList(drives: [], credits: nil))
        await refresh.value
        XCTAssertEqual(model.drives, rows)
        XCTAssertEqual(model.facets, facets)
        XCTAssertEqual(model.credits, credits)
        XCTAssertEqual(model.selectedRegion, yosemite)
        XCTAssertNil(model.errorMessage)
        XCTAssertFalse(model.isOfflineFallback)
        XCTAssertFalse(model.isLoading)
    }

    func testSuccessfulDeletionDuringRefreshCannotBeResurrectedByOldResponse() async throws {
        let list = try fixtureList()
        let api = MockLibraryAPI(driveList: list)
        let model = LibraryViewModel(api: api, session: try await makeSession())
        await model.loadDrives()
        model.selectRegion(yosemite)
        let entered = expectation(description: "Pre-delete list response is held")
        await api.hold(entered)
        let refresh = Task { await model.loadDrives() }
        await fulfillment(of: [entered], timeout: 2)
        model.removeDriveLocally(driveId: secondDrive)
        XCTAssertNil(model.selectedRegion)
        XCTAssertEqual(model.credits, list.credits, "Deletion does not refund credits")
        await api.release(list)
        await refresh.value
        XCTAssertEqual(model.drives.count, 3)
        XCTAssertFalse(model.drives.contains { $0.driveId == secondDrive })
        XCTAssertEqual(model.facets.map(\.id), [tahoe])
        XCTAssertNil(model.selectedRegion)
        XCTAssertEqual(model.credits, list.credits)
        // A later authoritative request can show a drive explicitly recreated with that id.
        await model.loadDrives()
        XCTAssertEqual(model.drives.count, 4)
    }

    func testSignoutClearsRetainedSnapshotAndRejectsOldAccountResponse() async throws {
        let list = try fixtureList()
        let api = MockLibraryAPI(driveList: list)
        let session = try await makeSession()
        let model = LibraryViewModel(api: api, session: session)
        await model.loadDrives()
        let entered = expectation(description: "Old account list response held")
        await api.hold(entered)
        let refresh = Task { await model.loadDrives() }
        await fulfillment(of: [entered], timeout: 2)
        try await session.signOut()
        model.reconcileSession()
        XCTAssertTrue(model.drives.isEmpty)
        XCTAssertTrue(model.facets.isEmpty)
        XCTAssertNil(model.credits)
        await api.release(list)
        await refresh.value
        XCTAssertTrue(model.drives.isEmpty)
        XCTAssertNil(model.errorMessage)
        XCTAssertFalse(model.isLoading)
    }

    func testCancellationErrorsPreservePriorErrorAndAllowNextRefresh() async throws {
        let api = MockLibraryAPI(driveList: DriveList(drives: [], credits: nil))
        let model = LibraryViewModel(api: api, session: try await makeSession())
        await api.setFailure(ContractError())
        await model.loadDrives()
        for cancellation: Error in [CancellationError(), URLError(.cancelled)] {
            await api.setFailure(cancellation)
            await model.loadDrives()
            XCTAssertEqual(model.errorMessage, ContractError().localizedDescription)
            XCTAssertFalse(model.isOfflineFallback)
            XCTAssertFalse(model.isLoading)
        }
        await api.setList(try fixtureList())
        await model.loadDrives()
        XCTAssertNil(model.errorMessage)
        XCTAssertEqual(model.drives.count, 4)
    }
}

private actor MockLibraryAPI: SkipperAPI {
    var result: Result<DriveList, Error>
    var entered: XCTestExpectation?
    var pending: CheckedContinuation<DriveList, Never>?
    init(driveList: DriveList) { result = .success(driveList) }
    func setFailure(_ error: Error) { result = .failure(error) }
    func setList(_ list: DriveList) { result = .success(list) }
    func hold(_ entered: XCTestExpectation) { self.entered = entered }
    func release(_ list: DriveList) { pending?.resume(returning: list); pending = nil }
    func listDrives() async throws -> DriveList {
        if let entered {
            self.entered = nil
            return await withCheckedContinuation { pending = $0; entered.fulfill() }
        }
        return try result.get()
    }
    func bootstrap(rotation: Int) async throws -> Bootstrap { throw URLError(.badURL) }
    func drive(id: String) async throws -> DriveManifest { throw URLError(.badURL) }
    func create(_ request: CreateDriveRequest) async throws -> DriveManifest { throw URLError(.badURL) }
    func propose(_ request: DriveProposeRequest) async throws -> DriveProposal { throw URLError(.badURL) }
    func deleteDrive(id: String) async throws {}
    func setAccountPassword(_ password: String) async throws {}
    func version() async throws -> [VersionPolicy] { [] }
}

private struct LibraryFixtureDownloader: StorageFileDownloader {
    func downloadFile(from url: URL, to destURL: URL, name: String,
                      onProgress: (@Sendable (Int64, Int64) -> Void)?) async throws {
        try FileManager.default.createDirectory(at: destURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("synthetic saved audio bytes".utf8).write(to: destURL)
    }
}
