import XCTest
@testable import Skipper

private final class RecordingTransport: HTTPTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var requests: [URLRequest] = []
    private var cancellations = 0
    let events: [HTTPStreamEvent]
    let error: Error?
    init(events: [HTTPStreamEvent], error: Error? = nil) { self.events = events; self.error = error }
    func open(_ request: URLRequest, timeouts: RequestTimeouts) -> HTTPStream {
        lock.lock(); requests.append(request); lock.unlock()
        return HTTPStream(events: AsyncThrowingStream { continuation in
            for event in events { continuation.yield(event) }
            if let error { continuation.finish(throwing: error) } else { continuation.finish() }
        }, cancel: { [self] in lock.lock(); cancellations += 1; lock.unlock() })
    }
    var recorded: [URLRequest] { lock.lock(); defer { lock.unlock() }; return requests }
    var cancelCount: Int { lock.lock(); defer { lock.unlock() }; return cancellations }
}
private struct TestCookies: SessionCookieProvider {
    func cookieHeader() async throws -> String? { "session=synthetic" }
    func receive(_ response: HTTPURLResponse) async throws {}
}
private final class Deltas: @unchecked Sendable {
    private let lock = NSLock()
    private var content: [String] = []
    func append(_ value: String) { lock.lock(); content.append(value); lock.unlock() }
    var values: [String] { lock.lock(); defer { lock.unlock() }; return content }
}
final class NetworkingTests: XCTestCase {
    private let url = URL(string: "https://api.invalid")!
    private func response(_ contentType: String = "text/event-stream", status: Int = 200) -> HTTPStreamEvent {
        .response(HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: ["Content-Type":contentType])!)
    }
    private var request: DrivePlanRequest { .init(turns: [.init(role: .rider, text: "Synthetic")], regionId: "00000001-0000-4000-8000-000000000001") }
    func testServerGuidanceSurvivesRealAPIAndPlannerLocalizedErrorRendering() async throws {
        let guidance: [(Int, String, String)] = [
            (403, "drive_limit_reached", "That's all 5 of your free drives, and you've been busy. Email support@example.invalid and we'll top you up, free."),
            (422, "no_stories", "The skipper couldn't find any stories along that route. Try different start and end points, or a longer drive."),
            (409, "conflict", "That drive id is already in use. Use a fresh idempotency key."),
            (429, "rate_limited", "Too many requests. Give it a moment and try again.")
        ]
        for (status, code, message) in guidance {
            let body = try JSONSerialization.data(withJSONObject: ["error": code, "message": message])
            let transport = RecordingTransport(events: [response("application/json", status: status), .bytes(body)])
            let api = APIClient(baseURL: url, transport: transport)
            do { _ = try await api.listDrives(); XCTFail("Expected server rejection") }
            catch {
                XCTAssertEqual((error as? APIError)?.status, status)
                XCTAssertEqual((error as? APIError)?.code, code)
                XCTAssertEqual(error.localizedDescription, message)
                XCTAssertEqual(userMessage(for: error, fallback: "Fallback"), message)
            }
            do { _ = try await PlannerClient(baseURL: url, transport: transport).turn(request); XCTFail("Expected server rejection") }
            catch { XCTAssertEqual(error.localizedDescription, message) }
        }
    }

    func testContractAndOfflineGuidanceRemainUserReadableAndUnknownErrorsUseFallback() async throws {
        let transport = RecordingTransport(events: [response("application/json"), .bytes(Data("{}".utf8))])
        do { _ = try await APIClient(baseURL: url, transport: transport).listDrives(); XCTFail("Expected contract failure") }
        catch { XCTAssertEqual(error.localizedDescription, "Please update Skipper to the latest version.") }
        let offline = APIClient(baseURL: url, transport: transport, network: AuthTestNetwork(offline: true))
        do { _ = try await offline.version(); XCTFail("Expected offline failure") }
        catch { XCTAssertEqual(error.localizedDescription, "No signal out here, and this one needs a bar or two. Try again when they’re back.") }
        XCTAssertEqual(transport.recorded.count, 1, "Offline preflight must not open a request")
        XCTAssertEqual(userMessage(for: URLError(.badServerResponse), fallback: "Try again."), "Try again.")
    }

    func testByteFragmentationCRLFCommentsMultilineAndUTF8() {
        var parser = SSEParser()
        let input = ": heartbeat\r\nevent: say\r\ndata: {\"delta\":\"é🚙\"}\r\n\r\nevent: turn\rdata: one\rdata: two"
        var frames: [SSEFrame] = []
        for byte in input.utf8 { frames += parser.push(Data([byte])) }
        frames += parser.end()
        XCTAssertEqual(frames, [SSEFrame(event: "say", data: #"{"delta":"é🚙"}"#), SSEFrame(event: "turn", data: "one\ntwo")])
    }
    func testPlannerFirstTerminalWinsAndHasNoIdentityHeaders() async throws {
        let data = Data("event: say\ndata: {\"delta\":\"partial\"}\n\nevent: turn\ndata: {\"say\":\"Replacement\"}\n\nevent: turn\ndata: {\"say\":\"Wrong\"}\n\n".utf8)
        let transport = RecordingTransport(events: [response(), .bytes(data)])
        let deltas = Deltas()
        let result = try await PlannerClient(baseURL: url, transport: transport).turn(request) { deltas.append($0) }
        XCTAssertEqual(result.say, "Replacement"); XCTAssertEqual(deltas.values, ["partial"])
        XCTAssertEqual(transport.recorded.count, 1); XCTAssertEqual(transport.cancelCount, 1)
        XCTAssertNil(transport.recorded[0].value(forHTTPHeaderField: "Cookie"))
        XCTAssertFalse(transport.recorded[0].httpShouldHandleCookies)
    }
    func testPlannerJSONFallbackAndFailureNeverRetry() async throws {
        let json = RecordingTransport(events: [response("application/json"), .bytes(Data(#"{"say":"Buffered","done":true}"#.utf8))])
        let result = try await PlannerClient(baseURL: url, transport: json).turn(request)
        XCTAssertTrue(result.done)
        let broken = RecordingTransport(events: [response(), .bytes(Data("event: say\ndata: {\"delta\":\"partial\"}\n\n".utf8))])
        do { _ = try await PlannerClient(baseURL: url, transport: broken).turn(request); XCTFail("EOF without terminal must fail") }
        catch { XCTAssertEqual(error as? PlanStreamFailure, .noTerminal) }
        XCTAssertEqual(broken.recorded.count, 1)
    }
    func testDeferredMigrationMakesNoRequest() async {
        let transport = RecordingTransport(events: [])
        let api = APIClient(baseURL: url, transport: transport, cookies: DeferredSessionCookies())
        do { _ = try await api.listDrives(); XCTFail("Deferred credentials must not become anonymous") }
        catch { XCTAssertTrue(error is CredentialMigrationPending) }
        XCTAssertTrue(transport.recorded.isEmpty)
    }
    func testBootstrapCarriesCookieForAdminReleaseBypass() async throws {
        let transport = RecordingTransport(events: [response("application/json"), .bytes(Data(#"{"regions":[]}"#.utf8))])
        _ = try await APIClient(baseURL: url, transport: transport, cookies: TestCookies()).bootstrap(rotation: 3)
        XCTAssertEqual(transport.recorded.first?.value(forHTTPHeaderField: "Cookie"), "session=synthetic")
        XCTAssertEqual(transport.recorded.first?.url?.query, "rotation=3")
    }
    func testDeferredCredentialsDoNotBlockPublicBootstrapOrVersion() async throws {
        let bootstrapTransport = RecordingTransport(events: [response("application/json"), .bytes(Data(#"{"regions":[]}"#.utf8))])
        let api = APIClient(baseURL: url, transport: bootstrapTransport, cookies: DeferredSessionCookies())
        _ = try await api.bootstrap(rotation: 0)
        XCTAssertEqual(bootstrapTransport.recorded.count, 1)
        XCTAssertNil(bootstrapTransport.recorded[0].value(forHTTPHeaderField: "Cookie"))
        let versionTransport = RecordingTransport(events: [response("application/json"), .bytes(Data(#"{"policies":[]}"#.utf8))])
        _ = try await APIClient(baseURL: url, transport: versionTransport, cookies: DeferredSessionCookies()).version()
        XCTAssertEqual(versionTransport.recorded.count, 1)
    }
    func testDeferredCredentialsDoNotBlockExplicitProposalAndNeverRetry() async throws {
        let transport = RecordingTransport(events: [response("application/json", status: 503), .bytes(Data(#"{"error":"busy"}"#.utf8))])
        let route = try JSONDecoder().decode(PlannedRoute.self, from: Data(#"{"start":"00000001-0000-4000-8000-000000000001","end":"00000001-0000-4000-8000-000000000002"}"#.utf8))
        do {
            _ = try await APIClient(baseURL: url, transport: transport, cookies: DeferredSessionCookies()).propose(.init(route: route))
            XCTFail("Expected server rejection")
        } catch { XCTAssertEqual((error as? APIError)?.status, 503) }
        XCTAssertEqual(transport.recorded.count, 1)
        XCTAssertEqual(transport.recorded.first?.url?.path, "/drives/propose")
        XCTAssertNil(transport.recorded.first?.value(forHTTPHeaderField: "Cookie"))
    }
    func testOldDequeuedDeadlineCannotExpireAProgressingStream() {
        var gate = DeadlineGeneration()
        let firstByte = gate.arm(.firstByte)
        gate.invalidate(.firstByte)
        XCTAssertFalse(gate.isCurrent(firstByte), "A timer waiting for the lock must recheck after headers arrive")
        let staleIdle = gate.arm(.idle)
        let freshIdle = gate.arm(.idle)
        XCTAssertFalse(gate.isCurrent(staleIdle), "Bytes supersede an already-dequeued idle callback")
        XCTAssertTrue(gate.isCurrent(freshIdle))
        let total = gate.arm(.total)
        _ = gate.arm(.idle)
        XCTAssertTrue(gate.isCurrent(total), "Byte progress must not extend the total turn wall")
    }
    func testPrecancelledTurnMakesNoPaidRequest() async {
        let transport = RecordingTransport(events: [])
        let client = PlannerClient(baseURL: url, transport: transport)
        let value = request
        let task = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            return try await client.turn(value)
        }
        do { _ = try await task.value; XCTFail("Must reject before opening transport") }
        catch { XCTAssertTrue(error is CancellationError) }
        XCTAssertTrue(transport.recorded.isEmpty)
    }
    func testCancelledTaskDoesNotReturnPartialTurn() async {
        let transport = RecordingTransport(events: [], error: CancellationError())
        do { _ = try await PlannerClient(baseURL: url, transport: transport).turn(request); XCTFail("Must cancel") }
        catch { XCTAssertTrue(error is CancellationError) }
        XCTAssertEqual(transport.recorded.count, 1)
    }
}
