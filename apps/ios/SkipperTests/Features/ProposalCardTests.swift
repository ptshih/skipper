import XCTest
@testable import Skipper

final class ProposalCardTests: XCTestCase {
    private let baseURL = URL(string: "https://features.example.invalid")!

    func testProposeKeyDeterminism() {
        let route1 = PlannedRoute(start: "Santa Monica", end: "Malibu", via: ["Topanga"])
        let route2 = PlannedRoute(start: "Santa Monica", end: "Malibu", via: ["Topanga"])
        let route3 = PlannedRoute(start: "Santa Monica", end: "Malibu", via: nil)

        XCTAssertEqual(proposeKey(for: route1), proposeKey(for: route2))
        XCTAssertNotEqual(proposeKey(for: route1), proposeKey(for: route3))
    }

    func testReflowDrawnCardMovesExistingCardToEnd() {
        let routeA = PlannedRoute(start: "A", end: "B", via: nil)
        let routeB = PlannedRoute(start: "C", end: "D", via: nil)

        let cardA = ProposalCardItem(afterTurn: 0, route: routeA)
        let cardB = ProposalCardItem(afterTurn: 1, route: routeB)

        let cards = [cardA, cardB]

        // Reflow routeA after turn 3
        let reflowed = reflowDrawnCard(cards: cards, route: routeA, afterTurn: 3)

        XCTAssertEqual(reflowed.count, 2)
        XCTAssertEqual(reflowed[0].id, cardB.id)
        XCTAssertEqual(reflowed[1].id, cardA.id)
        XCTAssertEqual(reflowed[1].afterTurn, 3)
        // Idempotency key must remain identical!
        XCTAssertEqual(reflowed[1].idempotencyKey, cardA.idempotencyKey)
    }

    func testIdempotencyKeyPreservedAcrossCardLifecycle() {
        let route = PlannedRoute(start: "Start", end: "End", via: nil)
        let fixedKey = UUID()
        var card = ProposalCardItem(afterTurn: 0, route: route, idempotencyKey: fixedKey)

        XCTAssertEqual(card.idempotencyKey, fixedKey)

        // Transition through states: needsAccount, retried, made
        card.state = .needsAccount
        XCTAssertEqual(card.idempotencyKey, fixedKey)

        card.state = .creating
        XCTAssertEqual(card.idempotencyKey, fixedKey)

        card.state = .made(driveId: "drive-123")
        XCTAssertEqual(card.idempotencyKey, fixedKey)
    }

    func testNeedsAccountReconcilesToIdlePreservingIdempotencyKey() {
        let route = PlannedRoute(start: "Start", end: "End", via: nil)
        let fixedKey = UUID()
        var card = ProposalCardItem(afterTurn: 0, route: route, idempotencyKey: fixedKey)

        card.state = .needsAccount
        XCTAssertEqual(card.state, .needsAccount)

        // On sign-in reconciliation, state resets to idle so user can explicitly tap CTA
        if card.state == .needsAccount {
            card.state = .idle
        }

        XCTAssertEqual(card.state, .idle)
        XCTAssertEqual(card.idempotencyKey, fixedKey)
        XCTAssertEqual(card.route, route)
    }

    // MARK: - Async ViewModel Tests

    @MainActor
    func testAsyncProposalSurvivesNewerConversationalTurnInSameConversation() async throws {
        let input = try FeaturesQAFixtures.input("contracts/ui-flows", id: "planner-account-retry")
        let responses = try XCTUnwrap(input["responses"] as? [String: Any])
        let stream = try XCTUnwrap(input["stream"] as? [String: Any])
        let terminal = try FeaturesQAFixtures.decode(DrivePlanResponse.self, XCTUnwrap(stream["terminal"]))
        let proposal = try FeaturesQAFixtures.decode(DriveProposal.self, XCTUnwrap(responses["proposal"]))

        let turn1Entered = expectation(description: "turn 1 entered")
        let turn2Entered = expectation(description: "turn 2 entered")
        let planner = FeaturesQAControlledPlanner(entered: [turn1Entered, turn2Entered])

        let proposeControllable = ControllableProposeAPI(proposal: proposal)
        let vault = CredentialVault(keychain: FeaturesQAKeychain(), clock: FeaturesQAClock())
        let auth = AuthClient(baseURL: baseURL, transport: FeaturesQAHTTP(responses: [:]), vault: vault)
        let session = SessionStore(auth: auth, vault: vault, clock: FeaturesQAClock(), purgeDownloads: {})

        let model = PlannerViewModel(planner: planner, api: proposeControllable, session: session)
        model.selectRegion(makeTestRegion())

        // Turn 1 sends and emits a route with an in-flight proposal
        let turn1Task = Task { await model.sendTurn(prompt: "Show me a drive") }
        await fulfillment(of: [turn1Entered], timeout: 2)
        try await planner.complete(0, with: .success(terminal))
        await turn1Task.value

        XCTAssertEqual(model.cards.count, 1)
        XCTAssertTrue(model.cards[0].isLoadingProposal, "Card must be loading proposal while API is pending")
        XCTAssertNil(model.cards[0].proposal)

        // Rider sends Turn 2 in the SAME conversation while proposal is still pending
        let turn2Response = try JSONDecoder().decode(
            DrivePlanResponse.self,
            from: Data(#"{"say": "Avoiding traffic on the route.", "done": false}"#.utf8)
        )
        let turn2Task = Task { await model.sendTurn(prompt: "Avoid traffic") }
        await fulfillment(of: [turn2Entered], timeout: 2)
        try await planner.complete(1, with: .success(turn2Response))
        await turn2Task.value

        XCTAssertEqual(model.turns.map(\.text), ["Show me a drive", terminal.say, "Avoid traffic", "Avoiding traffic on the route."])
        XCTAssertEqual(model.cards.count, 1)

        // Now the delayed propose API completes
        await proposeControllable.waitForProposeCall()
        await proposeControllable.resumePending()
        while model.cards.first?.isLoadingProposal == true {
            await Task.yield()
        }

        // Proposal must NOT be discarded; card must NOT remain stuck in loading
        XCTAssertFalse(model.cards[0].isLoadingProposal, "Card must not remain isLoadingProposal forever after turn 2")
        XCTAssertNotNil(model.cards[0].proposal, "Proposal must be populated across newer turns in same conversation")
        XCTAssertEqual(model.cards[0].proposal?.durationSeconds, proposal.durationSeconds)
        XCTAssertNil(model.cards[0].proposalError)
    }

    @MainActor
    func testAsyncProposalCanceledOnTrueReset() async throws {
        let input = try FeaturesQAFixtures.input("contracts/ui-flows", id: "planner-account-retry")
        let stream = try XCTUnwrap(input["stream"] as? [String: Any])
        let terminal = try FeaturesQAFixtures.decode(DrivePlanResponse.self, XCTUnwrap(stream["terminal"]))
        let proposal = try FeaturesQAFixtures.decode(DriveProposal.self, XCTUnwrap((input["responses"] as? [String: Any])?["proposal"]))

        let turnEntered = expectation(description: "turn entered")
        let planner = FeaturesQAControlledPlanner(entered: [turnEntered])
        let proposeControllable = ControllableProposeAPI(proposal: proposal)

        let vault = CredentialVault(keychain: FeaturesQAKeychain(), clock: FeaturesQAClock())
        let auth = AuthClient(baseURL: baseURL, transport: FeaturesQAHTTP(responses: [:]), vault: vault)
        let session = SessionStore(auth: auth, vault: vault, clock: FeaturesQAClock(), purgeDownloads: {})

        let model = PlannerViewModel(planner: planner, api: proposeControllable, session: session)
        model.selectRegion(makeTestRegion())

        let turnTask = Task { await model.sendTurn(prompt: "Show route") }
        await fulfillment(of: [turnEntered], timeout: 2)
        try await planner.complete(0, with: .success(terminal))
        await turnTask.value
        await proposeControllable.waitForProposeCall()

        XCTAssertEqual(model.cards.count, 1)
        XCTAssertTrue(model.cards[0].isLoadingProposal)

        // Rider starts fresh (true reset)
        model.startFresh()
        XCTAssertTrue(model.cards.isEmpty)

        // Late propose completion must not resurrect card
        await proposeControllable.resumePending()
        await Task.yield()

        XCTAssertTrue(model.cards.isEmpty, "Late propose completion after startFresh must not add or resurrect cards")
    }

    @MainActor
    func testReEmittedRouteRetriesFailedProposal() async throws {
        let input = try FeaturesQAFixtures.input("contracts/ui-flows", id: "planner-account-retry")
        let stream = try XCTUnwrap(input["stream"] as? [String: Any])
        let terminal = try FeaturesQAFixtures.decode(DrivePlanResponse.self, XCTUnwrap(stream["terminal"]))
        let proposal = try FeaturesQAFixtures.decode(DriveProposal.self, XCTUnwrap((input["responses"] as? [String: Any])?["proposal"]))

        let turn1Entered = expectation(description: "turn 1 entered")
        let turn2Entered = expectation(description: "turn 2 entered")
        let planner = FeaturesQAControlledPlanner(entered: [turn1Entered, turn2Entered])

        // First attempt fails, second succeeds
        let proposeControllable = ControllableProposeAPI(proposal: proposal, failFirst: true)
        let vault = CredentialVault(keychain: FeaturesQAKeychain(), clock: FeaturesQAClock())
        let auth = AuthClient(baseURL: baseURL, transport: FeaturesQAHTTP(responses: [:]), vault: vault)
        let session = SessionStore(auth: auth, vault: vault, clock: FeaturesQAClock(), purgeDownloads: {})

        let model = PlannerViewModel(planner: planner, api: proposeControllable, session: session)
        model.selectRegion(makeTestRegion())

        // Turn 1 emits route, proposal fails
        let turn1Task = Task { await model.sendTurn(prompt: "Show route") }
        await fulfillment(of: [turn1Entered], timeout: 2)
        try await planner.complete(0, with: .success(terminal))
        await turn1Task.value

        await proposeControllable.waitForProposeCall()
        await proposeControllable.resumePending()
        while model.cards.first?.isLoadingProposal == true {
            await Task.yield()
        }

        XCTAssertEqual(model.cards.count, 1)
        XCTAssertFalse(model.cards[0].isLoadingProposal)
        XCTAssertEqual(model.cards[0].proposalError, "Could not estimate route.")
        XCTAssertNil(model.cards[0].proposal)

        // Turn 2 re-emits the same route
        let turn2Task = Task { await model.sendTurn(prompt: "Try that route again") }
        await fulfillment(of: [turn2Entered], timeout: 2)
        try await planner.complete(1, with: .success(terminal))
        await turn2Task.value

        await proposeControllable.waitForProposeCall()
        await proposeControllable.resumePending()
        while model.cards.first?.isLoadingProposal == true {
            await Task.yield()
        }

        // Re-emission must clear error and populate proposal
        XCTAssertEqual(model.cards.count, 1)
        XCTAssertFalse(model.cards[0].isLoadingProposal)
        XCTAssertNil(model.cards[0].proposalError)
        XCTAssertNotNil(model.cards[0].proposal)
        XCTAssertEqual(model.cards[0].proposal?.durationSeconds, proposal.durationSeconds)
    }

    @MainActor
    func testDrawnCardsTruncatedToMaxPlanDrawn() async throws {
        let input = try FeaturesQAFixtures.input("contracts/ui-flows", id: "planner-account-retry")
        let responses = try XCTUnwrap(input["responses"] as? [String: Any])
        let proposal = try FeaturesQAFixtures.decode(DriveProposal.self, XCTUnwrap(responses["proposal"]))

        let recordingPlanner = RecordingPlanner()
        let proposeControllable = ControllableProposeAPI(proposal: proposal)
        let vault = CredentialVault(keychain: FeaturesQAKeychain(), clock: FeaturesQAClock())
        let auth = AuthClient(baseURL: baseURL, transport: FeaturesQAHTTP(responses: [:]), vault: vault)
        let session = SessionStore(auth: auth, vault: vault, clock: FeaturesQAClock(), purgeDownloads: {})

        let model = PlannerViewModel(planner: recordingPlanner, api: proposeControllable, session: session)
        model.selectRegion(makeTestRegion())

        // Pre-populate 10 cards
        for i in 1...10 {
            let route = PlannedRoute(start: "Start \(i)", end: "End \(i)", via: nil)
            model.cards.append(ProposalCardItem(id: "card-\(i)", afterTurn: i, route: route))
        }

        XCTAssertEqual(model.cards.count, 10)

        // Send a turn
        await model.sendTurn(prompt: "Update plan")

        // Verify request.drawn contains only the last 8 entries (MAX_PLAN_DRAWN)
        let lastRequest = try XCTUnwrap(recordingPlanner.lastRequest)
        XCTAssertEqual(lastRequest.drawn?.count, 8)
        let expectedDrawn = model.cards.suffix(8).map(\.route)
        XCTAssertEqual(lastRequest.drawn, expectedDrawn)
    }

    @MainActor
    func testMakeDriveRetryPreservesSameIdempotencyKey() async throws {
        let canonicalServerID = "00000000-0000-4000-8000-000000000001"
        let manifestData = Data("""
        {
            "driveId": "\(canonicalServerID)",
            "label": "Test Drive",
            "polyline": [[-122.0, 37.0]],
            "distanceMeters": 1000,
            "durationSeconds": 60,
            "clips": []
        }
        """.utf8)
        let manifest = try JSONDecoder().decode(DriveManifest.self, from: manifestData)

        let mockAPI = MockCreateDriveAPI(manifest: manifest, failFirst: true)
        let sessionValue = syntheticSession(anonymous: false)
        let keychain = try syntheticKeychain(session: sessionValue)
        let vault = CredentialVault(keychain: keychain, clock: FeaturesQAClock())
        let auth = AuthClient(baseURL: baseURL, transport: FeaturesQAHTTP(responses: [:]), vault: vault)
        let session = SessionStore(auth: auth, vault: vault, clock: FeaturesQAClock(), purgeDownloads: {})
        await session.refresh()

        let planner = RecordingPlanner()
        let model = PlannerViewModel(planner: planner, api: mockAPI, session: session)
        model.selectRegion(makeTestRegion())

        let route = PlannedRoute(start: "Start", end: "End", via: nil)
        let cardId = "test-card-1"
        let initialCard = ProposalCardItem(id: cardId, afterTurn: 0, route: route)
        let expectedKey = initialCard.idempotencyKey
        model.cards.append(initialCard)

        // First attempt fails
        var navigatedDriveId: String?
        await model.makeDrive(cardId: cardId) { driveId in
            navigatedDriveId = driveId
        }

        XCTAssertNil(navigatedDriveId)
        XCTAssertEqual(mockAPI.createRequests.count, 1)
        guard !mockAPI.createRequests.isEmpty else {
            XCTFail("createRequests should have at least 1 request")
            return
        }
        XCTAssertEqual(mockAPI.createRequests[0].idempotencyKey, expectedKey.uuidString.lowercased())
        guard case .failed = model.cards[0].state else {
            XCTFail("Card state should be failed")
            return
        }

        // Retry attempt succeeds
        await model.makeDrive(cardId: cardId) { driveId in
            navigatedDriveId = driveId
        }

        XCTAssertEqual(navigatedDriveId, canonicalServerID)
        XCTAssertEqual(mockAPI.createRequests.count, 2)
        guard mockAPI.createRequests.count >= 2 else {
            XCTFail("createRequests should have at least 2 requests")
            return
        }
        XCTAssertEqual(mockAPI.createRequests[1].idempotencyKey, expectedKey.uuidString.lowercased(), "Retry must preserve identical idempotencyKey")
        if case .made(let driveId) = model.cards[0].state {
            XCTAssertEqual(driveId, canonicalServerID)
        } else {
            XCTFail("Card state should be made")
        }
    }

    @MainActor
    func testMakeDriveNavigatesImmediatelyWhileDownloadProceedsInBackground() async throws {
        let canonicalServerID = "00000000-0000-4000-8000-000000000001"
        let clipURL = "https://audio.example.invalid/clip0.mp3"
        let manifestData = Data("""
        {
            "driveId": "\(canonicalServerID)",
            "label": "Test Drive",
            "polyline": [[-122.0, 37.0]],
            "distanceMeters": 1000,
            "durationSeconds": 60,
            "clips": [
                {
                    "seq": 0,
                    "form": "story",
                    "poiId": "00000000-0000-4000-8000-000000000002",
                    "subjectId": "00000000-0000-4000-8000-000000000003",
                    "subjectKind": "poi",
                    "name": "Stop 1",
                    "lat": 37.0,
                    "lng": -122.0,
                    "alongSec": 10.0,
                    "durationMs": 5000,
                    "url": "\(clipURL)",
                    "contentType": "audio/mpeg"
                }
            ]
        }
        """.utf8)
        let manifest = try JSONDecoder().decode(DriveManifest.self, from: manifestData)

        let mockAPI = MockCreateDriveAPI(manifest: manifest)
        let sessionValue = syntheticSession(anonymous: false)
        let keychain = try syntheticKeychain(session: sessionValue)
        let vault = CredentialVault(keychain: keychain, clock: FeaturesQAClock())
        let auth = AuthClient(baseURL: baseURL, transport: FeaturesQAHTTP(responses: [:]), vault: vault)
        let session = SessionStore(auth: auth, vault: vault, clock: FeaturesQAClock(), purgeDownloads: {})
        await session.refresh()

        let recordingDownloader = RecordingHangingDownloader()
        let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let storage = StorageService(rootURL: tempDir, downloader: recordingDownloader)

        let planner = RecordingPlanner()
        let model = PlannerViewModel(planner: planner, api: mockAPI, session: session, storage: storage)
        model.selectRegion(makeTestRegion())

        let route = PlannedRoute(start: "Start", end: "End", via: nil)
        let cardId = "test-card-bg"
        model.cards.append(ProposalCardItem(id: cardId, afterTurn: 0, route: route))

        var navigatedDriveId: String?
        await model.makeDrive(cardId: cardId) { driveId in
            navigatedDriveId = driveId
        }

        // Navigation occurs immediately under server canonical ID without waiting for hanging downloader
        XCTAssertEqual(navigatedDriveId, canonicalServerID)

        // Background download actually started under the server canonical ID with the nonempty clip
        await fulfillment(of: [recordingDownloader.downloadStarted], timeout: 2)
        XCTAssertEqual(recordingDownloader.requestedURLs, [URL(string: clipURL)!])
        let driveDir = tempDir.appendingPathComponent("drives").appendingPathComponent(canonicalServerID)
        XCTAssertTrue(FileManager.default.fileExists(atPath: driveDir.path))
    }

    @MainActor
    func testQuietRoadEstStopCountZeroRefusesMake() async throws {
        let quietProposal = try makeTestProposal(estStopCount: 0)

        let mockAPI = MockCreateDriveAPI(manifest: try makeTestManifest())
        let sessionValue = syntheticSession(anonymous: false)
        let keychain = try syntheticKeychain(session: sessionValue)
        let vault = CredentialVault(keychain: keychain, clock: FeaturesQAClock())
        let auth = AuthClient(baseURL: baseURL, transport: FeaturesQAHTTP(responses: [:]), vault: vault)
        let session = SessionStore(auth: auth, vault: vault, clock: FeaturesQAClock(), purgeDownloads: {})

        let planner = RecordingPlanner()
        let model = PlannerViewModel(planner: planner, api: mockAPI, session: session)
        model.selectRegion(makeTestRegion())

        let cardId = "quiet-card"
        var card = ProposalCardItem(id: cardId, afterTurn: 0, route: PlannedRoute(start: "A", end: "B", via: nil))
        card.proposal = quietProposal
        card.state = .noStops
        model.cards.append(card)

        var navigated = false
        await model.makeDrive(cardId: cardId) { _ in
            navigated = true
        }

        // Must refuse to make quiet drive
        XCTAssertFalse(navigated)
        XCTAssertTrue(mockAPI.createRequests.isEmpty)
        XCTAssertEqual(model.cards[0].state, ProposalCardState.noStops)
    }

    @MainActor
    func testMissingServerDriveIdFailsWithoutFallbackToCardId() async throws {
        var recordedEvents: [(String, [String: Any])] = []
        let analytics: AnalyticsTracker = { event, props in
            recordedEvents.append((event, props))
        }

        // Server returns manifest with nil driveId
        let manifestData = Data("""
        {
            "driveId": null,
            "label": "Test Drive",
            "polyline": [[-122.0, 37.0]],
            "distanceMeters": 1000,
            "durationSeconds": 60,
            "clips": []
        }
        """.utf8)
        let manifest = try JSONDecoder().decode(DriveManifest.self, from: manifestData)

        let mockAPI = MockCreateDriveAPI(manifest: manifest)
        let sessionValue = syntheticSession(anonymous: false)
        let keychain = try syntheticKeychain(session: sessionValue)
        let vault = CredentialVault(keychain: keychain, clock: FeaturesQAClock())
        let auth = AuthClient(baseURL: baseURL, transport: FeaturesQAHTTP(responses: [:]), vault: vault)
        let session = SessionStore(auth: auth, vault: vault, clock: FeaturesQAClock(), purgeDownloads: {})
        await session.refresh()

        let planner = RecordingPlanner()
        let model = PlannerViewModel(planner: planner, api: mockAPI, session: session, analytics: analytics)
        model.selectRegion(makeTestRegion())

        let cardId = "client-card-uuid"
        model.cards.append(ProposalCardItem(id: cardId, afterTurn: 0, route: PlannedRoute(start: "A", end: "B", via: nil)))

        var navigatedId: String?
        await model.makeDrive(cardId: cardId) { driveId in
            navigatedId = driveId
        }

        XCTAssertNil(navigatedId, "Must not navigate when server driveId is absent")
        XCTAssertNotEqual(navigatedId, cardId, "Must refuse to fallback to cardId")
        guard case .failed(let message) = model.cards[0].state else {
            XCTFail("Card state should be failed")
            return
        }
        XCTAssertEqual(message, "Server returned incomplete drive manifest.")
        XCTAssertFalse(recordedEvents.contains(where: { $0.0 == "drive_created" }), "Must not emit drive_created on absent server driveId")
    }

    @MainActor
    func testFailedTurnErrorLineAndRetryTranscriptMerge() async throws {
        var recordedEvents: [(String, [String: Any])] = []
        let analytics: AnalyticsTracker = { event, props in
            recordedEvents.append((event, props))
        }

        let failTurn = expectation(description: "first turn fail")
        let succeedTurn = expectation(description: "retry turn succeed")
        let planner = FeaturesQAControlledPlanner(entered: [failTurn, succeedTurn])

        let mockAPI = MockCreateDriveAPI(manifest: try makeTestManifest())
        let vault = CredentialVault(keychain: FeaturesQAKeychain(), clock: FeaturesQAClock())
        let auth = AuthClient(baseURL: baseURL, transport: FeaturesQAHTTP(responses: [:]), vault: vault)
        let session = SessionStore(auth: auth, vault: vault, clock: FeaturesQAClock(), purgeDownloads: {})

        let model = PlannerViewModel(planner: planner, api: mockAPI, session: session, analytics: analytics)
        let region = makeTestRegion()
        model.selectRegion(region)

        // Turn 1 sends and fails with 429
        let turn1Task = Task { await model.sendTurn(prompt: "Take me to the coast") }
        await fulfillment(of: [failTurn], timeout: 2)
        try await planner.complete(0, with: .failure(APIError(status: 429, code: "rate_limited", message: "Catch your breath!")))
        await turn1Task.value

        XCTAssertEqual(model.errorMessage, "Catch your breath!")
        XCTAssertTrue(model.canRetryTurn)
        XCTAssertEqual(model.turns.count, 1)
        XCTAssertEqual(model.turns[0].text, "Take me to the coast")

        // First plan_turn_sent event
        let sentEvents1 = recordedEvents.filter { $0.0 == "plan_turn_sent" }
        XCTAssertEqual(sentEvents1.count, 1)
        XCTAssertEqual(sentEvents1[0].1["retry"] as? NSNumber, NSNumber(value: false))
        XCTAssertEqual(sentEvents1[0].1["turn_index"] as? NSNumber, NSNumber(value: 1))

        // Tap Retry
        let retryTask = Task { await model.retryTurn() }
        await fulfillment(of: [succeedTurn], timeout: 2)
        let terminal = DrivePlanResponse(say: "Here is your drive to the coast.", route: nil, done: false)
        try await planner.complete(1, with: .success(terminal))
        await retryTask.value

        XCTAssertNil(model.errorMessage)
        XCTAssertFalse(model.canRetryTurn)
        XCTAssertEqual(model.turns.count, 2)
        XCTAssertEqual(model.turns[1].text, "Here is your drive to the coast.")

        // Retry plan_turn_sent event: retry == true, turn_index unchanged
        let sentEvents2 = recordedEvents.filter { $0.0 == "plan_turn_sent" }
        XCTAssertEqual(sentEvents2.count, 2)
        XCTAssertEqual(sentEvents2[1].1["retry"] as? NSNumber, NSNumber(value: true))
        XCTAssertEqual(sentEvents2[1].1["turn_index"] as? NSNumber, NSNumber(value: 1))
    }

    @MainActor
    func testCollapseConsecutiveTurnsMergesSameRole() {
        let turns = [
            PlannerTurn(role: .rider, text: "First ask"),
            PlannerTurn(role: .rider, text: "Additional detail"),
            PlannerTurn(role: .skipper, text: "Got it"),
            PlannerTurn(role: .rider, text: "Next ask")
        ]
        let collapsed = PlannerViewModel.collapseConsecutiveTurns(turns)
        XCTAssertEqual(collapsed.count, 3)
        XCTAssertEqual(collapsed[0].role, .rider)
        XCTAssertEqual(collapsed[0].text, "First ask\n\nAdditional detail")
        XCTAssertEqual(collapsed[1].role, .skipper)
        XCTAssertEqual(collapsed[1].text, "Got it")
        XCTAssertEqual(collapsed[2].role, .rider)
        XCTAssertEqual(collapsed[2].text, "Next ask")
    }

    @MainActor
    func testMissingRegionExplicitlyUnavailable() async throws {
        let planner = RecordingPlanner()
        let mockAPI = MockCreateDriveAPI(manifest: try makeTestManifest())
        let vault = CredentialVault(keychain: FeaturesQAKeychain(), clock: FeaturesQAClock())
        let auth = AuthClient(baseURL: baseURL, transport: FeaturesQAHTTP(responses: [:]), vault: vault)
        let session = SessionStore(auth: auth, vault: vault, clock: FeaturesQAClock(), purgeDownloads: {})

        // Initialized without any selected region
        let model = PlannerViewModel(planner: planner, api: mockAPI, session: session)
        XCTAssertNil(model.selectedRegion)

        await model.sendTurn(prompt: "Hello")

        XCTAssertTrue(model.turns.isEmpty, "Turn must not be added when no region is selected")
        XCTAssertNil(planner.lastRequest, "Planner must not be called when region is missing")
        XCTAssertEqual(model.errorMessage, "Planner is unavailable: no region selected.")
    }

    @MainActor
    func testPersistedRegionSelectedAcrossColdStart() throws {
        let suite = "fm.skipper.test.region.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        let tahoeID = "00000001-0000-4000-8000-000000000002"
        let norcalID = "00000001-0000-4000-8000-000000000003"
        let socalID = "00000001-0000-4000-8000-000000000001"
        defaults.set(tahoeID, forKey: PlannerViewModel.selectedRegionKey)

        let regions = [
            makeTestRegion(id: socalID, slug: "us-socal", displayName: "Southern California"),
            makeTestRegion(id: tahoeID, slug: "region-tahoe", displayName: "Lake Tahoe"),
            makeTestRegion(id: norcalID, slug: "region-norcal", displayName: "Northern California")
        ]

        // Matching cached region selects Tahoe, not the first region
        let picked = PlannerViewModel.pickRegion(regions: regions, cachedRegionId: tahoeID)
        XCTAssertEqual(picked?.id, tahoeID)

        // Unreleased cached region falls back to first available region
        let unreleasedPicked = PlannerViewModel.pickRegion(regions: regions, cachedRegionId: "00000001-0000-4000-8000-999999999999")
        XCTAssertEqual(unreleasedPicked?.id, socalID)

        // Nil cached region falls back to first available region
        let nilPicked = PlannerViewModel.pickRegion(regions: regions, cachedRegionId: nil)
        XCTAssertEqual(nilPicked?.id, socalID)
    }

    @MainActor
    func testContractErrorPreservesUpdateGuidance() async throws {
        let turnEntered = expectation(description: "turn entered")
        let planner = FeaturesQAControlledPlanner(entered: [turnEntered])
        let mockAPI = MockCreateDriveAPI(manifest: try makeTestManifest())
        let vault = CredentialVault(keychain: FeaturesQAKeychain(), clock: FeaturesQAClock())
        let auth = AuthClient(baseURL: baseURL, transport: FeaturesQAHTTP(responses: [:]), vault: vault)
        let session = SessionStore(auth: auth, vault: vault, clock: FeaturesQAClock(), purgeDownloads: {})

        let model = PlannerViewModel(planner: planner, api: mockAPI, session: session)
        model.selectRegion(makeTestRegion())

        let turnTask = Task { await model.sendTurn(prompt: "Test contract") }
        await fulfillment(of: [turnEntered], timeout: 2)
        try await planner.complete(0, with: .failure(ContractError()))
        await turnTask.value

        XCTAssertEqual(model.errorMessage, "Please update Skipper to the latest version.")
    }

    func testAnalyticsContractValidation() {
        final class EventCollector: @unchecked Sendable {
            var events: [(String, [String: Any])] = []
        }
        let collector = EventCollector()
        let tracker: AnalyticsTracker = { event, props in
            collector.events.append((event, props))
        }

        AnalyticsEvents.planTurnSent(turnIndex: 3, retry: false, track: tracker)
        AnalyticsEvents.planTurnSent(turnIndex: 3, retry: true, track: tracker)
        AnalyticsEvents.proposalShown(stopCount: 0, durationMin: 15.0, roundTrip: true, hasClip: false, track: tracker)
        AnalyticsEvents.proposalShown(stopCount: nil, durationMin: 20.0, roundTrip: false, hasClip: true, track: tracker)
        AnalyticsEvents.driveCreated(track: tracker)

        XCTAssertEqual(collector.events.count, 5)
        XCTAssertEqual(collector.events[0].0, "plan_turn_sent")
        XCTAssertEqual(collector.events[0].1["turn_index"] as? NSNumber, NSNumber(value: 3))
        XCTAssertEqual(collector.events[0].1["retry"] as? NSNumber, NSNumber(value: false))

        XCTAssertEqual(collector.events[1].0, "plan_turn_sent")
        XCTAssertEqual(collector.events[1].1["turn_index"] as? NSNumber, NSNumber(value: 3))
        XCTAssertEqual(collector.events[1].1["retry"] as? NSNumber, NSNumber(value: true))

        XCTAssertEqual(collector.events[2].0, "proposal_shown")
        XCTAssertEqual(collector.events[2].1["stop_count"] as? NSNumber, NSNumber(value: 0))

        XCTAssertEqual(collector.events[3].0, "proposal_shown")
        XCTAssertTrue(collector.events[3].1["stop_count"] is NSNull)

        XCTAssertEqual(collector.events[4].0, "drive_created")
    }

    @MainActor
    func testSessionDoneDisablesFurtherTurns() async throws {
        let input = try FeaturesQAFixtures.input("contracts/ui-flows", id: "planner-account-retry")
        let responses = try XCTUnwrap(input["responses"] as? [String: Any])
        let proposal = try FeaturesQAFixtures.decode(DriveProposal.self, XCTUnwrap(responses["proposal"]))

        let recordingPlanner = RecordingPlanner(response: DrivePlanResponse(say: "All done!", route: nil, done: true))
        let proposeControllable = ControllableProposeAPI(proposal: proposal)
        let vault = CredentialVault(keychain: FeaturesQAKeychain(), clock: FeaturesQAClock())
        let auth = AuthClient(baseURL: baseURL, transport: FeaturesQAHTTP(responses: [:]), vault: vault)
        let session = SessionStore(auth: auth, vault: vault, clock: FeaturesQAClock(), purgeDownloads: {})

        let model = PlannerViewModel(planner: recordingPlanner, api: proposeControllable, session: session)
        model.selectRegion(makeTestRegion())

        await model.sendTurn(prompt: "First turn")
        XCTAssertTrue(model.isSessionDone)
        XCTAssertEqual(model.turns.count, 2) // Rider + Skipper

        // Attempting another turn is ignored when session is done
        await model.sendTurn(prompt: "Second turn")
        XCTAssertEqual(model.turns.count, 2, "sendTurn must be ignored when isSessionDone is true")
    }

    @MainActor
    func testDeferredStateRefusesPaidMakeAndSuppressesSignInButton() async throws {
        struct OfflineNetwork: NetworkAvailability {
            func isOffline() async -> Bool { true }
        }

        let vault = CredentialVault(keychain: FeaturesQAKeychain(), clock: FeaturesQAClock())
        let auth = AuthClient(baseURL: baseURL, transport: FeaturesQAHTTP(responses: [:]), vault: vault)
        let session = SessionStore(auth: auth, vault: vault, network: OfflineNetwork(), clock: FeaturesQAClock(), purgeDownloads: {})
        await session.refresh()

        // Deferred state check
        XCTAssertEqual(session.state, .deferred)
        XCTAssertFalse(session.isSignedIn)

        let mockAPI = MockCreateDriveAPI(manifest: try makeTestManifest())
        let planner = RecordingPlanner()
        let model = PlannerViewModel(planner: planner, api: mockAPI, session: session)
        model.selectRegion(makeTestRegion())

        // Planner ViewModel exposes canOfferSignIn = false during deferred state
        XCTAssertFalse(model.canOfferSignIn, "Ordinary sign-in presentation must be suppressed in deferred state")
        XCTAssertFalse(AccountEntryPolicy.canOfferSignIn(in: session.state))

        // Minting a paid drive is refused in deferred state, transitioning to needsAccount
        let cardId = "card-deferred"
        model.cards.append(ProposalCardItem(id: cardId, afterTurn: 0, route: PlannedRoute(start: "A", end: "B", via: nil)))

        var navigatedId: String?
        await model.makeDrive(cardId: cardId) { driveId in
            navigatedId = driveId
        }

        XCTAssertNil(navigatedId, "Deferred state must refuse paid minting")
        guard case .needsAccount = model.cards[0].state else {
            XCTFail("Card state should be needsAccount")
            return
        }

        // View respects suppressed sign-in
        let cardView = ProposalCardView(
            card: model.cards[0],
            canOfferSignIn: model.canOfferSignIn,
            audio: nil,
            onMakeDrive: {},
            onSignIn: {},
            onOpenDrive: { _ in }
        )
        XCTAssertFalse(cardView.canOfferSignIn)
    }

    @MainActor
    func testGoogleRouteMapSafelyRendersFallbackWhenMapsNotReady() {
        // Without Maps SDK initialization (unit test environment), mapsReady is false.
        // GoogleRouteMap body must evaluate safely without constructing GMSMapView(options:)
        // which would otherwise crash on GMSServices checkServicePreconditions.
        XCTAssertFalse(NativeSDKs.mapsReady)
        let map = GoogleRouteMap(coordinates: [Coordinate(longitude: -122.0, latitude: 37.0)])
        _ = map.body
    }


}

// MARK: - Test Helpers

private func makeTestRegion(
    id: String = "00000001-0000-4000-8000-000000000001",
    slug: String = "socal",
    displayName: String = "Southern California"
) -> Region {
    let json = """
    {
        "id": "\(id)",
        "slug": "\(slug)",
        "displayName": "\(displayName)",
        "ready": true,
        "exampleAnchors": [],
        "examples": [],
        "exampleNames": []
    }
    """
    return try! JSONDecoder().decode(Region.self, from: Data(json.utf8))
}

private func makeTestManifest(
    driveId: String? = "00000000-0000-4000-8000-000000000001",
    label: String = "Test Drive"
) throws -> DriveManifest {
    var dict: [String: Any] = [
        "label": label,
        "polyline": [[-122.0, 37.0]],
        "distanceMeters": 1000,
        "durationSeconds": 60,
        "clips": []
    ]
    if let driveId {
        dict["driveId"] = driveId
    } else {
        dict["driveId"] = NSNull()
    }
    let data = try JSONSerialization.data(withJSONObject: dict)
    return try JSONDecoder().decode(DriveManifest.self, from: data)
}

private func makeTestProposal(
    estStopCount: Int? = 5,
    hasClip: Bool = false
) throws -> DriveProposal {
    let clipJSON = hasClip ? """
    ,
    "previewClip": {
        "audioUrl": "https://audio.example.invalid/preview.mp3",
        "durationMs": 5000
    }
    """ : ""
    let json = """
    {
        "start": {"name": "Start", "lat": 37.0, "lng": -122.0},
        "end": {"name": "End", "lat": 37.1, "lng": -122.1},
        "startId": "00000000-0000-4000-8000-000000000001",
        "endId": "00000000-0000-4000-8000-000000000002",
        "polyline": [[-122.0, 37.0], [-122.1, 37.1]],
        "distanceMeters": 5000,
        "durationSeconds": 300,
        "routeSig": "test-sig",
        "estStopCount": \(estStopCount == nil ? "null" : "\(estStopCount!)")
        \(clipJSON)
    }
    """
    return try JSONDecoder().decode(DriveProposal.self, from: Data(json.utf8))
}

private final class RecordingHangingDownloader: StorageFileDownloader, @unchecked Sendable {
    let downloadStarted = XCTestExpectation(description: "downloadStarted")
    private let queue = DispatchQueue(label: "recording.downloader")
    private var _requestedURLs: [URL] = []
    var requestedURLs: [URL] {
        queue.sync { _requestedURLs }
    }

    func downloadFile(
        from url: URL,
        to destURL: URL,
        name: String,
        onProgress: (@Sendable (Int64, Int64) -> Void)?
    ) async throws {
        queue.sync {
            _requestedURLs.append(url)
        }
        downloadStarted.fulfill()
        try await Task.sleep(nanoseconds: 10_000_000_000)
    }
}

private final class HangingDownloader: StorageFileDownloader, @unchecked Sendable {
    func downloadFile(
        from url: URL,
        to destURL: URL,
        name: String,
        onProgress: (@Sendable (Int64, Int64) -> Void)?
    ) async throws {
        try await Task.sleep(nanoseconds: 10_000_000_000)
    }
}

private final class RecordingPlanner: PlannerService, @unchecked Sendable {
    var lastRequest: DrivePlanRequest?
    var response: DrivePlanResponse

    init(response: DrivePlanResponse = DrivePlanResponse(say: "Here is your plan", route: nil, done: false)) {
        self.response = response
    }

    func turn(_ request: DrivePlanRequest, onDelta: @escaping @Sendable (String) -> Void) async throws -> DrivePlanResponse {
        lastRequest = request
        onDelta(response.say)
        return response
    }
}

private final class MockCreateDriveAPI: SkipperAPI, @unchecked Sendable {
    private let manifest: DriveManifest
    private var failFirst: Bool
    var createRequests: [CreateDriveRequest] = []

    init(manifest: DriveManifest, failFirst: Bool = false) {
        self.manifest = manifest
        self.failFirst = failFirst
    }

    func create(_ request: CreateDriveRequest) async throws -> DriveManifest {
        createRequests.append(request)
        if failFirst {
            failFirst = false
            throw URLError(.timedOut)
        }
        return manifest
    }

    func propose(_ request: DriveProposeRequest) async throws -> DriveProposal { throw URLError(.badURL) }
    func bootstrap(rotation: Int) async throws -> Bootstrap { throw URLError(.badURL) }
    func listDrives() async throws -> DriveList { throw URLError(.badURL) }
    func drive(id: String) async throws -> DriveManifest { throw URLError(.badURL) }
    func deleteDrive(id: String) async throws {}
    func setAccountPassword(_ password: String) async throws {}
    func version() async throws -> [VersionPolicy] { [] }
}

private actor ControllableProposeAPI: SkipperAPI {
    private let proposal: DriveProposal
    private var failFirst: Bool
    private var continuations: [CheckedContinuation<DriveProposal, Error>] = []
    private var enteredContinuations: [CheckedContinuation<Void, Never>] = []

    init(proposal: DriveProposal, failFirst: Bool = false) {
        self.proposal = proposal
        self.failFirst = failFirst
    }

    func waitForProposeCall() async {
        if !continuations.isEmpty { return }
        await withCheckedContinuation { continuation in
            enteredContinuations.append(continuation)
        }
    }

    func propose(_ request: DriveProposeRequest) async throws -> DriveProposal {
        try await withCheckedThrowingContinuation { continuation in
            continuations.append(continuation)
            while !enteredContinuations.isEmpty {
                let entered = enteredContinuations.removeFirst()
                entered.resume()
            }
        }
    }

    func resumePending() {
        while !continuations.isEmpty {
            let cont = continuations.removeFirst()
            if failFirst {
                failFirst = false
                cont.resume(throwing: URLError(.timedOut))
            } else {
                cont.resume(returning: proposal)
            }
        }
    }

    func bootstrap(rotation: Int) async throws -> Bootstrap {
        throw URLError(.badURL)
    }
    func listDrives() async throws -> DriveList {
        throw URLError(.badURL)
    }
    func drive(id: String) async throws -> DriveManifest {
        throw URLError(.badURL)
    }
    func create(_ request: CreateDriveRequest) async throws -> DriveManifest {
        throw URLError(.badURL)
    }
    func deleteDrive(id: String) async throws {}
    func setAccountPassword(_ password: String) async throws {}
    func version() async throws -> [VersionPolicy] { [] }
}
