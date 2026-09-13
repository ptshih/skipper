import Foundation
import XCTest
@testable import Skipper

@MainActor
final class FeaturesQAFlowTests: XCTestCase {
    private let baseURL = URL(string: "https://features.example.invalid")!

    func testLateCanceledTurnCleanupCannotEndNewerStream() async throws {
        let input = try FeaturesQAFixtures.input("contracts/ui-flows", id: "planner-account-retry")
        let responses = try XCTUnwrap(input["responses"] as? [String: Any])
        let stream = try XCTUnwrap(input["stream"] as? [String: Any])
        let terminal = try FeaturesQAFixtures.decode(DrivePlanResponse.self, XCTUnwrap(stream["terminal"]))
        let enteredOld = expectation(description: "old stream entered")
        let enteredNew = expectation(description: "new stream entered")
        let proposedNew = expectation(description: "current terminal proposes once")
        let transport = FeaturesQAHTTP(responses: [
            "GET /bootstrap": try FeaturesQAFixtures.data(XCTUnwrap(responses["bootstrap"])),
            "POST /drives/propose": try FeaturesQAFixtures.data(XCTUnwrap(responses["proposal"])),
        ], observe: { if $0 == "POST /drives/propose" { proposedNew.fulfill() } })
        let vault = CredentialVault(keychain: FeaturesQAKeychain(), clock: FeaturesQAClock())
        let auth = AuthClient(baseURL: baseURL, transport: transport, vault: vault)
        let session = SessionStore(auth: auth, vault: vault, clock: FeaturesQAClock(), purgeDownloads: {})
        let planner = FeaturesQAControlledPlanner(entered: [enteredOld, enteredNew])
        let model = PlannerViewModel(planner: planner,
            api: APIClient(baseURL: baseURL, transport: transport, cookies: vault), session: session)
        await model.loadInitialData()
        let old = Task { await model.sendTurn(prompt: "Old request") }
        await fulfillment(of: [enteredOld], timeout: 2)
        model.startFresh()
        let current = Task { await model.sendTurn(prompt: "Current request") }
        await fulfillment(of: [enteredNew], timeout: 2)
        XCTAssertTrue(model.isStreaming)
        XCTAssertEqual(model.turns.map(\.text), ["Current request"])

        // A late error executes the old catch/cleanup while the new request is still pending.
        try await planner.complete(0, with: .failure(URLError(.networkConnectionLost)))
        await old.value
        XCTAssertTrue(model.isStreaming, "Old cleanup must not disable the current stream/composer state")
        XCTAssertNil(model.errorMessage)
        XCTAssertEqual(model.turns.map(\.text), ["Current request"])
        XCTAssertTrue(model.cards.isEmpty)
        XCTAssertEqual(transport.calls.filter { $0 == "POST /drives/propose" }.count, 0)
        XCTAssertEqual(transport.calls.filter { $0 == "POST /drives" }.count, 0)

        try await planner.complete(1, with: .success(terminal))
        await current.value
        await fulfillment(of: [proposedNew], timeout: 2)
        XCTAssertFalse(model.isStreaming)
        XCTAssertNil(model.errorMessage)
        XCTAssertEqual(model.turns.map(\.text), ["Current request", terminal.say])
        XCTAssertEqual(model.cards.count, 1)
        XCTAssertEqual(model.cards.first?.route, terminal.route)
        XCTAssertEqual(transport.calls.filter { $0 == "POST /drives/propose" }.count, 1)
        XCTAssertEqual(transport.calls.filter { $0 == "POST /drives" }.count, 0)
    }

    func testRecoveredAccountOfflineLibraryShowsOnlyIndividuallyVerifiedDriveAcrossRelaunch() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("FeaturesQA-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let details = try FeaturesQAFixtures.seedTwoRetainedDrives(at: root)
        let ids = details.keys.sorted()
        let verifiedID = try XCTUnwrap(ids.first)
        let unknownID = try XCTUnwrap(ids.last)
        XCTAssertNotEqual(verifiedID, unknownID)
        let storage = StorageService(rootURL: root, downloader: FeaturesQARejectDownloader())
        let before = await storage.listDownloadedDrives().map(\.driveId).sorted()
        XCTAssertEqual(before, ids, "Both original drives must actually exist before testing authorization")
        let input = try FeaturesQAFixtures.input("contracts/ui-flows", id: "corrupt-credentials-recovery")
        let transport = FeaturesQAHTTP(responses: [
            "POST /api/auth/sign-in/email-otp": Data("{}".utf8),
            "GET /api/auth/get-session": try FeaturesQAFixtures.data(XCTUnwrap(input["signedInSession"])),
            "GET /drives/\(verifiedID)": try XCTUnwrap(details[verifiedID]),
        ])
        let keychain = FeaturesQAKeychain()
        let corruptOriginal = Data("{broken-native-envelope".utf8)
        try keychain.write(corruptOriginal, at: CredentialVault.address)
        let network = FeaturesQANetwork()
        let vault = CredentialVault(keychain: keychain, clock: FeaturesQAClock())
        let auth = AuthClient(baseURL: baseURL, transport: transport, vault: vault, network: network)
        let session = SessionStore(auth: auth, vault: vault, network: network, clock: FeaturesQAClock(),
                                   purgeDownloads: { XCTFail("Credential recovery must not purge downloads") })
        await session.start()
        XCTAssertTrue(session.canRecoverCredentials)
        XCTAssertTrue(transport.calls.isEmpty, "Corruption must not cause anonymous mint or remote fallback")
        try await session.signIn(email: "rider@example.invalid", code: "123456")
        XCTAssertTrue(session.isSignedIn)
        XCTAssertTrue(session.hasUnverifiedLocalOwnership)
        let allowedBefore = await session.canAccessLocalDrive(verifiedID)
        let unknownBefore = await session.canAccessLocalDrive(unknownID)
        XCTAssertFalse(allowedBefore); XCTAssertFalse(unknownBefore)

        let api = APIClient(baseURL: baseURL, transport: transport, cookies: vault, network: network)
        _ = try await api.drive(id: verifiedID) // Only a real owner-scoped successful API response grants this ID.
        let allowed = await session.canAccessLocalDrive(verifiedID)
        let unknown = await session.canAccessLocalDrive(unknownID)
        XCTAssertTrue(allowed); XCTAssertFalse(unknown)
        await network.setOffline(true)
        let requestsBeforeOffline = transport.calls
        let library = LibraryViewModel(api: api, session: session, storage: storage)
        await library.loadDrives()
        XCTAssertEqual(library.drives.map(\.driveId), [verifiedID])
        XCTAssertTrue(library.drives.allSatisfy(\.isDownloaded))
        XCTAssertTrue(library.isOfflineFallback)

        // Fresh vault/session/model from the same mock Keychain, not the same in-memory authority.
        let reopenedVault = CredentialVault(keychain: keychain, clock: FeaturesQAClock())
        let reopenedAuth = AuthClient(baseURL: baseURL, transport: transport, vault: reopenedVault, network: network)
        let reopenedSession = SessionStore(auth: reopenedAuth, vault: reopenedVault, network: network,
            clock: FeaturesQAClock(), purgeDownloads: { XCTFail("Relaunch must not purge downloads") })
        await reopenedSession.start()
        let reopenedAPI = APIClient(baseURL: baseURL, transport: transport, cookies: reopenedVault, network: network)
        let reopenedLibrary = LibraryViewModel(api: reopenedAPI, session: reopenedSession, storage: storage)
        await reopenedLibrary.loadDrives()
        XCTAssertEqual(reopenedLibrary.drives.map(\.driveId), [verifiedID])
        XCTAssertTrue(reopenedLibrary.isOfflineFallback)
        XCTAssertEqual(transport.calls, requestsBeforeOffline, "Offline checks must not open any HTTP stream")
        XCTAssertEqual(try keychain.read(CredentialVault.address), corruptOriginal)
        let after = await storage.listDownloadedDrives().map(\.driveId).sorted()
        XCTAssertEqual(after, ids, "The unauthorized drive must be hidden, not destroyed")
    }
}
