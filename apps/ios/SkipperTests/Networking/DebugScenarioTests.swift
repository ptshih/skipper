#if DEBUG
import XCTest
@testable import Skipper

final class DebugScenarioTests: XCTestCase {
    func testResetBarrierRequiresRealPlannerCancellationAndNeverDeliversTerminal() async throws {
        let resources = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "native-ios", withExtension: nil))
        let suite = try JSONSerialization.jsonObject(with: Data(contentsOf: resources.appendingPathComponent("contracts/ui-flows.json"))) as! [String: Any]
        let fixture = try XCTUnwrap((suite["cases"] as! [[String: Any]]).first { $0["id"] as? String == "planner-reset-during-stream" })
        let input = fixture["input"] as! [String: Any]
        let expected = (fixture["expected"] as! [String: Any])["receipt"] as! [String: Any]
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let transport = try DebugScenarioTransport(input: input, root: root)
        let client = PlannerClient(baseURL: URL(string: "https://api.invalid")!, transport: transport)
        let delta = expectation(description: "Production parser delivers first visible chunk")
        let work = Task {
            try await client.turn(.init(turns: [.init(role: .rider, text: "Synthetic")],
                regionId: "00000001-0000-4000-8000-000000000001")) { text in
                XCTAssertEqual(text, "A quiet fixture drive. ")
                delta.fulfill()
            }
        }
        defer { work.cancel() }
        let reached = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            Self.receipt(root)["planStreamBarrierReached"] as? Bool == true
        }, object: nil)
        await fulfillment(of: [delta, reached], timeout: 3)
        XCTAssertEqual(Self.receipt(root)["planStreamCancellations"] as? Int, 0)
        XCTAssertEqual(Self.receipt(root)["planStreamTerminalDeliveries"] as? Int, 0)
        work.cancel()
        work.cancel() // Repeated consumer cancellation must not double-count the stream.
        do { _ = try await work.value; XCTFail("Held stream must end by cancellation") }
        catch { XCTAssertTrue(error is CancellationError) }
        let cancelled = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            Self.receipt(root)["planStreamCancellations"] as? Int == 1
        }, object: nil)
        await fulfillment(of: [cancelled], timeout: 3)
        let actual = Self.receipt(root)
        for (key, value) in expected {
            XCTAssertEqual(actual[key] as? NSNumber, value as? NSNumber, key)
        }
        // Persisted receipt survives same-run relaunch without reseeding server state.
        _ = try DebugScenarioTransport(input: input, root: root)
        XCTAssertEqual(Self.receipt(root)["planStreamCancellations"] as? Int, 1)
    }

    func testUnheldPlanCountsDeliveredTerminal() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let terminal = Data("event: turn\ndata: {\"say\":\"Done\",\"route\":null,\"done\":false}\n\n".utf8)
        let transport = try DebugScenarioTransport(input: ["stream": ["chunks": [Array(terminal)], "delayBeforeChunkMs": [0]]], root: root)
        var request = URLRequest(url: URL(string: "https://api.invalid/drives/plan")!)
        request.httpMethod = "POST"
        let stream = transport.open(request, timeouts: .planner)
        for try await _ in stream.events {}
        stream.cancel()
        XCTAssertEqual(Self.receipt(root)["planStreamTerminalDeliveries"] as? Int, 1)
        XCTAssertEqual(Self.receipt(root)["planStreamCancellations"] as? Int, 0)
        XCTAssertEqual(Self.receipt(root)["planStreamBarrierReached"] as? Bool, false)
    }

    @MainActor
    func testVersionReceiptCountsControllerOneShotAndSameRunRelaunch() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let suite = "skipper.version-receipt.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer {
            defaults.removePersistentDomain(forName: suite)
            try? FileManager.default.removeItem(at: root)
        }
        let input = try Self.versionInput()
        let transport = try DebugScenarioTransport(input: input, root: root)
        let api = APIClient(baseURL: URL(string: "https://api.invalid")!, transport: transport)
        let controller = VersionPolicyController(api: api, defaults: defaults, currentVersion: "1.2.0")
        XCTAssertEqual(Self.receipt(root)["versionRequests"] as? Int, 0)
        await controller.checkOnce()
        XCTAssertEqual(controller.gate, .nudge)
        XCTAssertEqual(Self.receipt(root)["versionRequests"] as? Int, 1)
        await controller.checkOnce()
        XCTAssertEqual(Self.receipt(root)["versionRequests"] as? Int, 1, "The counter must measure real requests, not checkOnce calls")
        controller.dismissNudge()

        let relaunched = try DebugScenarioTransport(input: input, root: root)
        XCTAssertEqual(Self.receipt(root)["versionRequests"] as? Int, 1)
        let relaunchedAPI = APIClient(baseURL: URL(string: "https://api.invalid")!, transport: relaunched)
        let relaunchedController = VersionPolicyController(api: relaunchedAPI, defaults: defaults, currentVersion: "1.2.0")
        await relaunchedController.checkOnce()
        XCTAssertNil(relaunchedController.gate, "The real policy response must respect persisted Later")
        XCTAssertEqual(Self.receipt(root)["versionRequests"] as? Int, 2)
        XCTAssertEqual(Self.receipt(root)["unexpectedRequests"] as? Int, 0)
        XCTAssertEqual(Self.receipt(root)["anonymousMintRequests"] as? Int, 0)
    }

    func testVersionReceiptDecodesOlderPersistedServerStateWithoutResettingCounters() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let input = try Self.versionInput()
        _ = try DebugScenarioTransport(input: input, root: root)
        let file = root.appendingPathComponent("mock-server.json")
        var older = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as! [String: Any]
        older.removeValue(forKey: "versionRequests")
        older["planRequests"] = 7
        try JSONSerialization.data(withJSONObject: older).write(to: file, options: .atomic)

        let transport = try DebugScenarioTransport(input: input, root: root)
        XCTAssertEqual(Self.receipt(root)["versionRequests"] as? Int, 0)
        XCTAssertEqual(Self.receipt(root)["planRequests"] as? Int, 7)
        let api = APIClient(baseURL: URL(string: "https://api.invalid")!, transport: transport)
        let policies = try await api.version()
        XCTAssertEqual(policies.first?.recommended, "99.0.0")
        XCTAssertEqual(Self.receipt(root)["versionRequests"] as? Int, 1)
        XCTAssertEqual(Self.receipt(root)["planRequests"] as? Int, 7)
    }

    func testVersionReceiptCountsReceivedRequestBeforeDelayedResponseIsCancelled() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        var input = try Self.versionInput()
        input["versionDelayMs"] = 30_000
        let transport = try DebugScenarioTransport(input: input, root: root)
        let api = APIClient(baseURL: URL(string: "https://api.invalid")!, transport: transport)
        let work = Task { try await api.version() }
        defer { work.cancel() }
        let received = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            Self.receipt(root)["versionRequests"] as? Int == 1
        }, object: nil)
        await fulfillment(of: [received], timeout: 3)
        work.cancel()
        do { _ = try await work.value; XCTFail("Cancelled delayed response cannot succeed") }
        catch { /* Request receipt survives response cancellation. */ }
        XCTAssertEqual(Self.receipt(root)["versionRequests"] as? Int, 1)
        XCTAssertEqual(Self.receipt(root)["unexpectedRequests"] as? Int, 0)
    }

    private static func versionInput() throws -> [String: Any] {
        let resources = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "native-ios", withExtension: nil))
        let data = try Data(contentsOf: resources.appendingPathComponent("contracts/version-policy-ui.json"))
        let suite = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        let fixture = try XCTUnwrap((suite["cases"] as! [[String: Any]]).first { $0["id"] as? String == "version-recommended" })
        return fixture["input"] as! [String: Any]
    }

    private static func receipt(_ root: URL) -> [String: Any] {
        guard let data = try? Data(contentsOf: root.appendingPathComponent("qa-receipt.json")),
              let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return value
    }

    func testScriptedLostAcknowledgementCountsActualRequestsAndOneCommit() async throws {
        let resources = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "native-ios", withExtension: nil))
        let data = try Data(contentsOf: resources.appendingPathComponent("contracts/ui-flows.json"))
        let suite = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        let input = (suite["cases"] as! [[String: Any]]).first { $0["id"] as? String == "planner-account-lost-ack" }!["input"] as! [String: Any]
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let transport = try DebugScenarioTransport(input: input, root: root)
        let clock = FixedAuthClock(date: authDate("2026-09-12T12:00:00Z")!)
        let vault = CredentialVault(keychain: AuthTestKeychain(), clock: clock)
        let url = URL(string: "https://api.invalid")!
        let auth = AuthClient(baseURL: url, transport: transport, vault: vault)
        let initial = try await auth.session(); XCTAssertTrue(initial?.user.isAnonymous == true)
        try await auth.sendCode(email: "rider@example.invalid")
        try await auth.signIn(email: "rider@example.invalid", code: "123456")
        _ = try await auth.session()
        let terminal = (input["stream"] as! [String: Any])["terminal"] as! [String: Any]
        let route = try JSONDecoder().decode(PlannedRoute.self, from: JSONSerialization.data(withJSONObject: terminal["route"]!))
        let request = CreateDriveRequest(route: route, idempotencyKey: UUID())
        let api = APIClient(baseURL: url, transport: transport, cookies: vault)
        do { _ = try await api.create(request); XCTFail("Expected lost acknowledgement") }
        catch { XCTAssertEqual((error as? URLError)?.code, .networkConnectionLost) }
        let result = try await api.create(request)
        XCTAssertEqual(result.driveId, "00000002-0000-4000-8000-000000000099")
        let receipt = try JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent("qa-receipt.json"))) as! [String: Any]
        XCTAssertEqual(receipt["createRequests"] as? Int, 2)
        XCTAssertEqual(receipt["committedDrives"] as? Int, 1)
        XCTAssertEqual(receipt["distinctCreateKeys"] as? Int, 1)
        XCTAssertEqual(receipt["unexpectedRequests"] as? Int, 0)
        XCTAssertEqual(receipt["anonymousMintRequests"] as? Int, 0)
        XCTAssertNil(receipt["cookies"]); XCTAssertNil(receipt["requestBodies"])
    }
}
#endif
