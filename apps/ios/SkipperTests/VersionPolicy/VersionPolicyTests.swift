import XCTest
@testable import Skipper

@MainActor final class VersionPolicyTests: XCTestCase {
    enum Failure: Error { case offline, preferences, store }

    func testShippedVersionPrecedence() {
        let cases: [(String, String, Int)] = [
            ("1.0.0", "1.0.1", -1), ("1.2.0", "1.1.9", 1), ("2.0.0", "1.9.9", 1),
            ("1.0.0", "1.0.0", 0), ("1.2", "1.2.0", 0), ("1", "1.0.1", -1),
            ("1.10.0", "1.9.0", 1), ("1.x.0", "1.0.0", 0), ("1.2.", "1.2.0", 0),
            ("1.-1.0", "1.0.0", -1), ("1.2.3+abc", "1.2.3+def", 0),
            ("1.2.3+build", "1.2.4", -1), ("1.0.0-beta", "1.0.0", -1),
            ("1.0.0-rc.1", "1.0.0-rc.1", 0), ("1.0.0-alpha", "1.0.0-alpha.1", -1),
            ("1.0.0-alpha.1", "1.0.0-alpha.beta", -1), ("1.0.0-alpha.beta", "1.0.0-beta", -1),
            ("1.0.0-2", "1.0.0-11", -1), ("1.2.3.1", "1.2.3", 1)
        ]
        for (lhs, rhs, expected) in cases {
            XCTAssertEqual(VersionComparison.compare(lhs, rhs), expected, "\(lhs) vs \(rhs)")
            XCTAssertEqual(VersionComparison.compare(rhs, lhs), -expected, "\(rhs) vs \(lhs)")
        }
    }

    func testMinimumAndRecommendedBoundaries() async throws {
        let policy = try policy()
        let cases: [(String, VersionPolicyController.Gate?)] = [
            ("0.9.0", .force), ("1.0.0-beta", .force), ("1.0.0", .nudge),
            ("1.1.9", .nudge), ("1.2.0", nil), ("2.0.0", nil)
        ]
        for (current, expected) in cases {
            let subject = controller(current: current, policies: [policy])
            await subject.checkOnce()
            XCTAssertEqual(subject.gate, expected, current)
        }
    }

    func testOnlyFirstIOSPolicyAppliesAndMissingPolicyFailsOpen() async throws {
        let android = try policy(platform: "android", minimum: "9.0.0")
        let ios = try policy(minimum: "1.0.0", recommended: "1.0.0")
        let laterIOS = try policy(minimum: "9.0.0")
        let subject = controller(policies: [android, ios, laterIOS])
        await subject.checkOnce()
        XCTAssertNil(subject.gate)
        for policies in [[], [android]] {
            let absent = controller(policies: policies)
            await absent.checkOnce()
            XCTAssertNil(absent.gate)
            XCTAssertNil(absent.storeURL)
        }
    }

    func testMissingCurrentVersionDoesNotFetch() async {
        var requests = 0
        for current in [nil, ""] as [String?] {
            let subject = VersionPolicyController(currentVersion: current, loadPolicies: {
                requests += 1; throw Failure.offline
            }, readDismissal: { nil }, saveDismissal: { _ in })
            await subject.checkOnce()
            XCTAssertNil(subject.gate)
        }
        XCTAssertEqual(requests, 0)
    }

    func testNetworkAndDecodeFailuresFailOpenWithoutAutomaticRetry() async {
        for malformed in [false, true] {
            var requests = 0
            let subject = VersionPolicyController(currentVersion: "1.0.0", loadPolicies: {
                requests += 1
                if malformed {
                    return try JSONDecoder().decode(VersionResponse.self,
                        from: Data(#"{"policies":[{"platform":"ios","minimum":4}]}"#.utf8)).policies
                }
                throw Failure.offline
            }, readDismissal: { nil }, saveDismissal: { _ in })
            await subject.checkOnce()
            await subject.checkOnce()
            XCTAssertNil(subject.gate)
            XCTAssertNil(subject.storeURL)
            XCTAssertEqual(requests, 1)
        }
    }

    func testMigratedDismissalIsKeyedToCurrentVersion() async throws {
        let suite = "VersionPolicyTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        // PreferenceMigration imports this exact value/key; the gate reads it from app defaults.
        defaults.set("1.0.0", forKey: "skipper.updateNudgeDismissed")
        let policies = [try policy(recommended: "3.0.0")]
        let api = APIClient(baseURL: URL(string: "https://version.invalid")!,
            transport: VersionPolicyTransport(data: try JSONEncoder().encode(VersionResponse(policies: policies))),
            cookies: DeferredSessionCookies())
        func make(_ current: String) -> VersionPolicyController {
            VersionPolicyController(api: api, defaults: defaults, currentVersion: current)
        }
        let previous = make("1.0.0")
        await previous.checkOnce()
        XCTAssertNil(previous.gate)
        let updated = make("1.1.0")
        await updated.checkOnce()
        XCTAssertEqual(updated.gate, .nudge)
        updated.dismissNudge()
        XCTAssertNil(updated.gate)
        XCTAssertEqual(defaults.string(forKey: "skipper.updateNudgeDismissed"), "1.1.0")
        let relaunched = make("1.1.0")
        await relaunched.checkOnce()
        XCTAssertNil(relaunched.gate)
    }

    func testForceIgnoresDismissalAndCannotBeDismissed() async throws {
        var reads = 0, writes = 0
        let policies = [try policy(minimum: "2.0.0")]
        let subject = VersionPolicyController(currentVersion: "1.0.0", loadPolicies: { policies },
            readDismissal: { reads += 1; return "1.0.0" }, saveDismissal: { _ in writes += 1 })
        await subject.checkOnce()
        subject.dismissNudge()
        XCTAssertEqual(subject.gate, .force)
        XCTAssertEqual(reads, 0)
        XCTAssertEqual(writes, 0)
    }

    func testPreferenceReadFailureShowsNudgeAndWriteFailureStillDismisses() async throws {
        let policies = [try policy()]
        let subject = VersionPolicyController(currentVersion: "1.0.0", loadPolicies: { policies },
            readDismissal: { throw Failure.preferences }, saveDismissal: { _ in throw Failure.preferences })
        await subject.checkOnce()
        XCTAssertEqual(subject.gate, .nudge)
        subject.dismissNudge()
        XCTAssertNil(subject.gate)
        await subject.checkOnce()
        XCTAssertNil(subject.gate)
    }

    func testStoreOpenUsesPolicyURLAndFailurePreservesGate() async throws {
        for minimum in ["0.0.0", "2.0.0"] {
            let subject = controller(policies: [try policy(minimum: minimum)])
            await subject.checkOnce()
            let original = subject.gate
            var opened: [URL] = []
            subject.openStore { opened.append($0); throw Failure.store }
            subject.openStore { opened.append($0) }
            XCTAssertEqual(opened.map(\.absoluteString), Array(repeating: "https://apps.apple.com/app/id123456", count: 2))
            XCTAssertEqual(subject.gate, original)
        }
    }

    func testCancellationRejectsLatePolicyAndConcurrentChecksFetchOnce() async throws {
        let policies = [try policy(minimum: "2.0.0")]
        var continuation: CheckedContinuation<[VersionPolicy], Never>?
        var requests = 0
        let subject = VersionPolicyController(currentVersion: "1.0.0", loadPolicies: {
            requests += 1
            return await withCheckedContinuation { continuation = $0 }
        }, readDismissal: { nil }, saveDismissal: { _ in })
        let checking = Task { await subject.checkOnce() }
        while continuation == nil { await Task.yield() }
        await subject.checkOnce()
        checking.cancel()
        continuation?.resume(returning: policies)
        await checking.value
        XCTAssertEqual(requests, 1)
        XCTAssertNil(subject.gate)
        XCTAssertNil(subject.storeURL)
    }

    private func controller(current: String = "1.0.0", policies: [VersionPolicy]) -> VersionPolicyController {
        VersionPolicyController(currentVersion: current, loadPolicies: { policies },
            readDismissal: { nil }, saveDismissal: { _ in })
    }

    private func policy(platform: String = "ios", minimum: String = "1.0.0", recommended: String = "1.2.0") throws -> VersionPolicy {
        let data = try JSONSerialization.data(withJSONObject: ["platform": platform, "minimum": minimum,
            "recommended": recommended, "storeUrl": "https://apps.apple.com/app/id123456"])
        return try JSONDecoder().decode(VersionPolicy.self, from: data)
    }
}

private struct VersionPolicyTransport: HTTPTransport {
    let data: Data
    func open(_ request: URLRequest, timeouts: RequestTimeouts) -> HTTPStream {
        HTTPStream(events: AsyncThrowingStream { continuation in
            guard request.url?.path == "/version", request.httpMethod == "GET",
                  request.value(forHTTPHeaderField: "Cookie") == nil,
                  let url = request.url,
                  let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil) else {
                continuation.finish(throwing: ContractError())
                return
            }
            continuation.yield(.response(response))
            continuation.yield(.bytes(data))
            continuation.finish()
        }, cancel: {})
    }
}
