import Foundation
import Observation
import XCTest
@testable import Skipper

@MainActor final class AppStartupTests: XCTestCase {
    private final class HeldVersionTransport: HTTPTransport, @unchecked Sendable {
        let entered: XCTestExpectation
        private let lock = NSLock()
        private var continuation: AsyncThrowingStream<HTTPStreamEvent, Error>.Continuation?
        init(entered: XCTestExpectation) { self.entered = entered }
        func open(_ request: URLRequest, timeouts: RequestTimeouts) -> HTTPStream {
            let events = AsyncThrowingStream<HTTPStreamEvent, Error> { continuation in
                self.lock.lock(); self.continuation = continuation; self.lock.unlock()
                self.entered.fulfill()
            }
            return HTTPStream(events: events, cancel: { self.finish() })
        }
        private func take() -> AsyncThrowingStream<HTTPStreamEvent, Error>.Continuation? {
            lock.lock(); defer { lock.unlock() }
            let value = continuation; continuation = nil; return value
        }
        func finish() { take()?.finish(throwing: CancellationError()) }
        func releaseForcePolicy() {
            let continuation = take()
            continuation?.yield(.response(HTTPURLResponse(url: URL(string: "https://api.invalid/version")!, statusCode: 200, httpVersion: nil, headerFields: nil)!))
            continuation?.yield(.bytes(Data(#"{"policies":[{"platform":"ios","minimum":"999.0.0","recommended":"999.0.0","storeUrl":"https://apps.apple.com/app/id6778946770"}]}"#.utf8)))
            continuation?.finish()
        }
    }

    func testHeldVersionResponseDoesNotDelaySessionOrAppReadinessAndStillAppliesLateGate() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let suite = "AppStartupTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite); try? FileManager.default.removeItem(at: root) }
        let entered = expectation(description: "Version request is held without response")
        let transport = HeldVersionTransport(entered: entered)
        defer { transport.finish() }
        let clock = FixedAuthClock(date: authDate("2026-09-12T12:00:00Z")!)
        let vault = CredentialVault(keychain: try syntheticKeychain(), clock: clock)
        let auth = AuthTestService(session: syntheticSession())
        let session = SessionStore(auth: auth, vault: vault, network: AuthTestNetwork(offline: false), clock: clock, purgeDownloads: {})
        let dependencies = AppDependencies(
            api: APIClient(baseURL: URL(string: "https://api.invalid")!, transport: transport, cookies: vault),
            planner: UnavailableTestServices(), documentsURL: root, launch: .init(mode: .unitTest),
            session: session, storage: StorageService(rootURL: root), network: AuthTestNetwork(offline: false),
            defaults: defaults, preview: nil, analytics: nil,
            makePlayback: { fatalError("Startup must not create playback") })
        let model = AppModel(dependencies: dependencies)
        let ready = expectation(description: "Startup finishes while policy remains blocked")
        let startup = Task { await model.start(); ready.fulfill() }
        await fulfillment(of: [entered, ready], timeout: 2)
        if case .ready = model.readiness {} else { XCTFail("Policy must not block first ready UI") }
        XCTAssertTrue(session.isSignedIn)
        XCTAssertNil(model.versionPolicy?.gate)
        let gate = expectation(description: "Late policy still reaches the root model")
        withObservationTracking { _ = model.versionPolicy?.gate } onChange: { gate.fulfill() }
        transport.releaseForcePolicy()
        await fulfillment(of: [gate], timeout: 2)
        XCTAssertEqual(model.versionPolicy?.gate, .force)
        await startup.value
    }
}
