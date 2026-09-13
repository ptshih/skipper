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

    func testSignedOutLoadDrivesTwiceMakesZeroRequestsLeavesDrivesEmptyAndNilError() async throws {
        let clock = FixedAuthClock(date: authDate("2026-09-12T12:00:00Z")!)
        for isAnonymous in [true, false] {
            let value = syntheticSession(anonymous: isAnonymous)
            let vault = CredentialVault(keychain: try syntheticKeychain(session: value), clock: clock)
            let auth = AuthTestService(session: value)
            let session = SessionStore(auth: auth, vault: vault, clock: clock, purgeDownloads: {})
            await session.start()
            if !isAnonymous {
                try await session.signOut()
            }
            XCTAssertFalse(session.isSignedIn)

            let api = MockLibraryAPI(driveList: try fixtureList())
            let model = LibraryViewModel(api: api, session: session)

            await model.loadDrives()
            let firstCount = await api.listDrivesCalls
            XCTAssertEqual(firstCount, 0, "Signed-out loadDrives must make 0 requests")
            XCTAssertTrue(model.drives.isEmpty)
            XCTAssertNil(model.errorMessage)
            XCTAssertFalse(model.isLoading)

            await model.loadDrives()
            let secondCount = await api.listDrivesCalls
            XCTAssertEqual(secondCount, 0, "Repeated signed-out loadDrives must make 0 requests")
            XCTAssertTrue(model.drives.isEmpty)
            XCTAssertNil(model.errorMessage)
            XCTAssertFalse(model.isLoading)
        }
    }

    private func makeDeferredSession() async throws -> SessionStore {
        let clock = FixedAuthClock(date: authDate("2026-09-12T12:00:00Z")!)
        let vault = CredentialVault(keychain: AuthTestKeychain(), clock: clock)
        let session = SessionStore(auth: AuthTestService(failure: AuthFailure.sessionUnavailable),
                                   vault: vault,
                                   network: AuthTestNetwork(offline: true),
                                   clock: clock, purgeDownloads: {})
        await session.start()
        XCTAssertEqual(session.state, .deferred)
        XCTAssertFalse(session.isSignedIn)
        return session
    }

    private func makeAnonymousSession() async throws -> SessionStore {
        let clock = FixedAuthClock(date: authDate("2026-09-12T12:00:00Z")!)
        let anonValue = syntheticSession(anonymous: true)
        let vault = CredentialVault(keychain: try syntheticKeychain(session: anonValue), clock: clock)
        let session = SessionStore(auth: AuthTestService(session: anonValue),
                                   vault: vault,
                                   network: AuthTestNetwork(offline: false),
                                   clock: clock, purgeDownloads: {})
        await session.start()
        XCTAssertFalse(session.isSignedIn)
        return session
    }

    private func makeSignedOutSession() async throws -> SessionStore {
        let session = try await makeSession()
        try await session.signOut()
        XCTAssertFalse(session.isSignedIn)
        return session
    }

    func testConnectivityEdgeTriggersExactOneReloadAndClearsFallback() async throws {
        let network = MutableTestNetwork(offline: true)
        let api = MockLibraryAPI(driveList: try fixtureList())
        await api.setFailure(OfflineError())
        let session = try await makeSession()
        let model = LibraryViewModel(api: api, session: session, network: network)

        await model.loadDrives()
        XCTAssertTrue(model.isOfflineFallback)
        let initialCalls = await api.listDrivesCalls
        XCTAssertEqual(initialCalls, 1)

        await model.seedConnectivityState()
        await network.setOffline(false)
        await api.setList(try fixtureList())

        await model.tickConnectivity()
        let edgeCalls = await api.listDrivesCalls
        XCTAssertEqual(edgeCalls, 2, "Exact one edge reload must be triggered")
        XCTAssertFalse(model.isOfflineFallback, "isOfflineFallback must be cleared after reconnect reload")
        XCTAssertEqual(model.drives.count, 4)
    }

    func testConnectivityStableStatesMakeZeroRequests() async throws {
        let network = MutableTestNetwork(offline: false)
        let api = MockLibraryAPI(driveList: try fixtureList())
        let session = try await makeSession()
        let model = LibraryViewModel(api: api, session: session, network: network)

        // Seed while online
        await model.seedConnectivityState()
        let seedCalls = await api.listDrivesCalls
        XCTAssertEqual(seedCalls, 0)

        // Steady online ticks make 0 requests
        await model.tickConnectivity(isOffline: false)
        await model.tickConnectivity(isOffline: false)
        await model.tickConnectivity(isOffline: false)
        let onlineCalls = await api.listDrivesCalls
        XCTAssertEqual(onlineCalls, 0, "Steady online ticks must make 0 requests")

        // Transition to offline (online -> offline edge does not reload)
        await model.tickConnectivity(isOffline: true)
        let offlineEdgeCalls = await api.listDrivesCalls
        XCTAssertEqual(offlineEdgeCalls, 0, "Online to offline transition must not trigger reload")

        // Steady offline ticks make 0 requests
        await model.tickConnectivity(isOffline: true)
        await model.tickConnectivity(isOffline: true)
        let steadyOfflineCalls = await api.listDrivesCalls
        XCTAssertEqual(steadyOfflineCalls, 0, "Steady offline ticks must make 0 requests")
    }

    func testConnectivityEdgeInSignedOutAnonymousDeferredMakesZeroRequests() async throws {
        let network = MutableTestNetwork(offline: true)

        // Signed out
        let signedOutSession = try await makeSignedOutSession()
        let apiSignedOut = MockLibraryAPI(driveList: try fixtureList())
        let modelSignedOut = LibraryViewModel(api: apiSignedOut, session: signedOutSession, network: network)
        await modelSignedOut.seedConnectivityState()
        await modelSignedOut.tickConnectivity(isOffline: false)
        let signedOutCalls = await apiSignedOut.listDrivesCalls
        XCTAssertEqual(signedOutCalls, 0, "Signed-out edge must make 0 requests")

        // Anonymous
        let anonSession = try await makeAnonymousSession()
        let apiAnon = MockLibraryAPI(driveList: try fixtureList())
        let modelAnon = LibraryViewModel(api: apiAnon, session: anonSession, network: network)
        await modelAnon.seedConnectivityState()
        await modelAnon.tickConnectivity(isOffline: false)
        let anonCalls = await apiAnon.listDrivesCalls
        XCTAssertEqual(anonCalls, 0, "Anonymous edge must make 0 requests")

        // Deferred
        let deferredSession = try await makeDeferredSession()
        let apiDeferred = MockLibraryAPI(driveList: try fixtureList())
        let modelDeferred = LibraryViewModel(api: apiDeferred, session: deferredSession, network: network)
        await modelDeferred.seedConnectivityState()
        await modelDeferred.tickConnectivity(isOffline: false)
        let deferredCalls = await apiDeferred.listDrivesCalls
        XCTAssertEqual(deferredCalls, 0, "Deferred edge must make 0 requests")
    }

    func testConnectivityHeldInFlightNoExtraAndResultCommits() async throws {
        let network = MutableTestNetwork(offline: true)
        let api = MockLibraryAPI(driveList: try fixtureList())
        let session = try await makeSession()
        let model = LibraryViewModel(api: api, session: session, network: network)

        let entered = expectation(description: "entered loadDrives")
        await api.hold(entered)

        let loadTask = Task { await model.loadDrives() }
        await fulfillment(of: [entered], timeout: 2.0)
        XCTAssertTrue(model.isLoading)
        let initialCalls = await api.listDrivesCalls
        XCTAssertEqual(initialCalls, 1)

        // Edge tick while load is held in flight
        await model.tickConnectivity(isOffline: false)
        let inFlightCalls = await api.listDrivesCalls
        XCTAssertEqual(inFlightCalls, 1, "In-flight load must block duplicate launch on edge")

        // Release the held request
        await api.release(try fixtureList())
        await loadTask.value

        XCTAssertFalse(model.isLoading)
        XCTAssertEqual(model.drives.count, 4, "Result of in-flight load must commit cleanly")
    }

    func testConnectivityReconnectFailureNonOfflinePreservesRowsFacetsSelectionAndSurfacesActualError() async throws {
        let network = MutableTestNetwork(offline: false)
        let api = MockLibraryAPI(driveList: try fixtureList())
        let session = try await makeSession()
        let model = LibraryViewModel(api: api, session: session, network: network)

        // Initial online load succeeds
        await model.loadDrives()
        XCTAssertEqual(model.drives.count, 4)
        XCTAssertEqual(model.facets.count, 2)

        // Select a region filter
        model.selectRegion(yosemite)
        XCTAssertEqual(model.selectedRegion, yosemite)
        XCTAssertEqual(model.filteredDrives.count, 1)

        // Simulate offline transition
        await model.tickConnectivity(isOffline: true)

        // Reconnect fails with non-offline server error (500)
        await api.setFailure(APIError(status: 500, code: "INTERNAL_ERROR", message: "Internal Server Error (500)"))

        await model.tickConnectivity(isOffline: false)

        XCTAssertFalse(model.isOfflineFallback, "Non-offline failure must not set isOfflineFallback")
        XCTAssertEqual(model.errorMessage, "Internal Server Error (500)", "Actual error must be surfaced")
        XCTAssertEqual(model.drives.count, 4, "Rows must be preserved on non-offline failure")
        XCTAssertEqual(model.facets.count, 2, "Facets must be preserved on non-offline failure")
        XCTAssertEqual(model.selectedRegion, yosemite, "Selected region must be preserved on non-offline failure")
        XCTAssertEqual(model.filteredDrives.count, 1, "Filtered drives must reflect preserved selection")
    }

    func testConnectivityOwnerSwitchDiscardsStaleResult() async throws {
        let api = MockLibraryAPI(driveList: try fixtureList())
        let clock = FixedAuthClock(date: authDate("2026-09-12T12:00:00Z")!)
        let userA = syntheticSession(anonymous: false)
        let vault = CredentialVault(keychain: try syntheticKeychain(session: userA), clock: clock)
        let auth = AuthTestService(session: userA)
        let session = SessionStore(auth: auth, vault: vault, clock: clock, purgeDownloads: {})
        await session.start()
        let model = LibraryViewModel(api: api, session: session)

        let entered = expectation(description: "entered loadDrives")
        await api.hold(entered)

        let loadTask = Task { await model.loadDrives() }
        await fulfillment(of: [entered], timeout: 2.0)
        XCTAssertTrue(model.isLoading)

        // User signs out or switches owner while load is held
        try await session.signOut()
        model.reconcileSession()

        // Release the held request
        await api.release(try fixtureList())
        await loadTask.value

        XCTAssertTrue(model.drives.isEmpty, "Stale result from departed owner must be discarded")
        XCTAssertNil(model.errorMessage)
    }

    func testColdLoadFailureWithSavedDownloadsShowsLocalRowFallbackTrueAndErrorVisible() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let storage = StorageService(rootURL: root, downloader: LibraryFixtureDownloader())
        let detail = StorageSavedDriveDetail(
            driveId: secondDrive,
            label: "Cold Saved Yosemite",
            polyline: [[-119.6, 37.7], [-119.5, 37.8]],
            clips: [
                StorageSavedDriveClip(
                    seq: 0,
                    alongSec: 1,
                    subjectId: "00000004-0000-4000-8000-000000000001",
                    subjectKind: .poi,
                    contentType: "audio/mp4",
                    url: "https://audio.invalid/clip.m4a"
                )
            ]
        )
        _ = try await storage.downloadDrive(driveId: secondDrive, detail: detail)

        let api = MockLibraryAPI(driveList: try fixtureList())
        await api.setFailure(APIError(status: 500, code: "INTERNAL_ERROR", message: "Internal Server Error (500)"))

        let session = try await makeSession()
        let model = LibraryViewModel(api: api, session: session, storage: storage)

        // Verify cold state: no previous online rows
        XCTAssertTrue(model.drives.isEmpty)
        XCTAssertFalse(model.isOfflineFallback)
        XCTAssertNil(model.errorMessage)

        // Perform cold load with API 500 failure
        await model.loadDrives()

        // Assert local row shown, fallback true, error visible
        XCTAssertEqual(model.drives.count, 1, "Local downloaded row must be shown")
        XCTAssertEqual(model.drives.first?.driveId, secondDrive)
        XCTAssertEqual(model.drives.first?.title, "Cold Saved Yosemite")
        XCTAssertTrue(model.isOfflineFallback, "isOfflineFallback must be true because saved downloads satisfied path")
        XCTAssertEqual(model.errorMessage, "Internal Server Error (500)", "Server error message must be visible")
    }
}

private actor MockLibraryAPI: SkipperAPI {
    var result: Result<DriveList, Error>
    var entered: XCTestExpectation?
    var pending: CheckedContinuation<DriveList, Never>?
    var listDrivesCalls: Int = 0
    init(driveList: DriveList) { result = .success(driveList) }
    func setFailure(_ error: Error) { result = .failure(error) }
    func setList(_ list: DriveList) { result = .success(list) }
    func hold(_ entered: XCTestExpectation) { self.entered = entered }
    func release(_ list: DriveList) { pending?.resume(returning: list); pending = nil }
    func listDrives() async throws -> DriveList {
        listDrivesCalls += 1
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

private actor MutableTestNetwork: NetworkAvailability {
    var offline: Bool
    init(offline: Bool) { self.offline = offline }
    func setOffline(_ value: Bool) { offline = value }
    func isOffline() async -> Bool { offline }
}

