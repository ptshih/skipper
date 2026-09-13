import Foundation
import XCTest
@testable import Skipper

final class PlannerContractTests: XCTestCase {
    private let baseURL = URL(string: "https://api.example.invalid")!
    private var request: DrivePlanRequest {
        DrivePlanRequest(turns: [PlannerTurn(role: .rider, text: "Synthetic ask")],
                         regionId: "00000001-0000-4000-8000-000000000001")
    }

    func testByteParserAgainstAllFragmentationFixtures() throws {
        for fixture in try contractFixtures("sse", as: StreamFixture.self) {
            var parser = SSEParser()
            var frames = fixture.input.chunks.flatMap { parser.push(Data($0)) }
            if fixture.input.finish == "eof" { frames.append(contentsOf: parser.end()) }
            XCTAssertEqual(frames, fixture.expected.frames.map { SSEFrame(event: $0.event, data: $0.data) }, fixture.id)
        }
    }

    func testPlannerTerminalFailureAndCancelFixturesWithoutRetries() async throws {
        for fixture in try contractFixtures("sse", as: StreamFixture.self) {
            let transport = FixtureTransport(chunks: fixture.input.chunks.map { Data($0) }, ending: fixture.input.finish)
            let client = PlannerClient(baseURL: baseURL, transport: transport)
            do {
                let result = try await client.turn(request) { transport.recordDelta($0) }
                XCTAssertEqual(fixture.expected.outcome, "success", fixture.id)
                XCTAssertEqual(result, fixture.expected.terminal, fixture.id)
            } catch {
                XCTAssertEqual(outcome(error), fixture.expected.outcome, fixture.id)
            }
            XCTAssertEqual(transport.deltas, fixture.expected.deltas, fixture.id)
            XCTAssertEqual(transport.requests.count, 1 + fixture.expected.automaticRetryCount, fixture.id)
            XCTAssertEqual(transport.cancellations, 1, fixture.id)
            let sent = try XCTUnwrap(transport.requests.first)
            XCTAssertNil(sent.value(forHTTPHeaderField: "Cookie"), fixture.id)
            XCTAssertFalse(sent.httpShouldHandleCookies, fixture.id)
            XCTAssertEqual(sent.httpMethod, "POST", fixture.id)
        }
    }

    func testBufferedJSONFallbackAndServerErrors() async throws {
        let transport = FixtureTransport(contentType: "application/json", chunks: [Data(#"{"say":"Buffered response"}"#.utf8)])
        let result = try await PlannerClient(baseURL: baseURL, transport: transport).turn(request)
        XCTAssertEqual(result.say, "Buffered response")
        XCTAssertFalse(result.done)
        XCTAssertEqual(transport.requests.count, 1)

        let rejected = FixtureTransport(status: 429, contentType: "application/json",
                                        chunks: [Data(#"{"error":"RATE_LIMITED","message":"Synthetic rate limit"}"#.utf8)])
        do {
            _ = try await PlannerClient(baseURL: baseURL, transport: rejected).turn(request)
            XCTFail("Expected server rejection")
        } catch let error as APIError {
            XCTAssertEqual(error.status, 429)
            XCTAssertEqual(error.code, "RATE_LIMITED")
            XCTAssertEqual(error.message, "Synthetic rate limit")
        }
        XCTAssertEqual(rejected.requests.count, 1)
    }

    func testOfflinePreflightMakesNoRequest() async {
        let transport = FixtureTransport(chunks: [])
        let client = PlannerClient(baseURL: baseURL, transport: transport, network: FixtureNetwork(offline: true))
        do { _ = try await client.turn(request); XCTFail("Expected offline error") }
        catch { XCTAssertTrue(error is OfflineError) }
        XCTAssertTrue(transport.requests.isEmpty)
    }

    func testActualTaskCancellationClosesSuspendedTransfer() async throws {
        let transport = FixtureTransport(chunks: [], ending: "suspended")
        let client = PlannerClient(baseURL: baseURL, transport: transport)
        let value = request
        let task = Task { try await client.turn(value) }
        // Bound startup without depending on wall-clock sleeps or a network operation.
        for _ in 0..<10_000 {
            if !transport.requests.isEmpty { break }
            await Task.yield()
        }
        XCTAssertEqual(transport.requests.count, 1)
        task.cancel()
        do { _ = try await task.value; XCTFail("Expected caller cancellation") }
        catch { XCTAssertTrue(error is CancellationError) }
        XCTAssertEqual(transport.cancellations, 1)
        XCTAssertEqual(transport.requests.count, 1)
    }

    func testTimeoutReasonsRemainDistinct() async {
        for (ending, expected) in [("first_byte_timeout", "first_byte"), ("idle_timeout", "idle"), ("total_timeout", "total")] {
            let transport = FixtureTransport(chunks: [], ending: ending)
            do { _ = try await PlannerClient(baseURL: baseURL, transport: transport).turn(request); XCTFail("Expected timeout") }
            catch { XCTAssertEqual(outcome(error), expected) }
            XCTAssertEqual(transport.requests.count, 1)
        }
    }

    func testDegeneratePaidActionsAndDeferredCookiesNeverReachTransport() async throws {
        let transport = FixtureTransport(chunks: [])
        let api = APIClient(baseURL: baseURL, transport: transport, cookies: EmptyFixtureCookies())
        let route = PlannedRoute(start: "00000006-0000-4000-8000-000000000001",
                                 end: "00000006-0000-4000-8000-000000000001")
        do { _ = try await api.propose(DriveProposeRequest(route: route)); XCTFail("Expected degenerate rejection") }
        catch { XCTAssertTrue(error is ContractError) }
        do { _ = try await api.create(CreateDriveRequest(route: route, idempotencyKey: UUID())); XCTFail("Expected degenerate rejection") }
        catch { XCTAssertTrue(error is ContractError) }
        let deferred = APIClient(baseURL: baseURL, transport: transport, cookies: DeferredSessionCookies())
        do { _ = try await deferred.listDrives(); XCTFail("Expected migration pending") }
        catch { XCTAssertTrue(error is CredentialMigrationPending) }
        XCTAssertTrue(transport.requests.isEmpty)
    }

    private func outcome(_ error: Error) -> String {
        if error is CancellationError { return "aborted" }
        if error is ContractError { return "contract" }
        guard let failure = error as? PlanStreamFailure else { return "unexpected:\(type(of: error))" }
        switch failure {
        case .firstByte: return "first_byte"
        case .idle: return "idle"
        case .total: return "total"
        case .noTerminal: return "no_terminal"
        case .transport: return "transport"
        }
    }
}
