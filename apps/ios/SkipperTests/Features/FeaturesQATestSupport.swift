import Foundation
import XCTest
@testable import Skipper

enum FeaturesQAFixtures {
    static func input(_ suite: String, id: String) throws -> [String: Any] {
        #if SWIFT_PACKAGE
        let bundle = Bundle.module
        #else
        let bundle = Bundle(for: FeaturesQAFlowTests.self)
        #endif
        let root = try XCTUnwrap(bundle.url(forResource: "native-ios", withExtension: nil))
        let data = try Data(contentsOf: root.appendingPathComponent(suite + ".json"))
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(json["fixtureVersion"] as? Int, 1)
        let cases = try XCTUnwrap(json["cases"] as? [[String: Any]])
        return try XCTUnwrap(cases.first { $0["id"] as? String == id }?["input"] as? [String: Any])
    }
    static func data(_ value: Any) throws -> Data {
        try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed, .sortedKeys])
    }
    static func decode<T: Decodable>(_ type: T.Type, _ value: Any) throws -> T {
        try JSONDecoder().decode(type, from: data(value))
    }
    /// Seed the exact migration fixture tree, not a reconstructed StorageService implementation.
    static func seedTwoRetainedDrives(at root: URL) throws -> [String: Data] {
        let input = try input("migration/manifests", id: "v5-two-drives-share-one-clip")
        let files = try XCTUnwrap(input["files"] as? [String: [String: Any]])
        var details: [String: Data] = [:]
        for (path, entry) in files {
            guard !path.hasPrefix("/"), !path.split(separator: "/").contains("..") else { throw CocoaError(.fileReadInvalidFileName) }
            let destination = root.appendingPathComponent(path)
            try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
            let contents: Data
            if let text = entry["text"] as? String {
                contents = Data(text.utf8)
                let manifest = try XCTUnwrap(JSONSerialization.jsonObject(with: contents) as? [String: Any])
                let id = try XCTUnwrap(manifest["driveId"] as? String)
                details[id] = try data(XCTUnwrap(manifest["detail"]))
            } else { contents = Data(try XCTUnwrap(entry["bytes"] as? [UInt8])) }
            try contents.write(to: destination)
        }
        XCTAssertEqual(details.count, 2)
        return details
    }
}

struct FeaturesQAClock: AppClock {
    func now() -> Date { Date(timeIntervalSince1970: 1_789_214_400) }
}
actor FeaturesQANetwork: NetworkAvailability {
    private var offline = false
    func isOffline() async -> Bool { offline }
    func setOffline(_ value: Bool) { offline = value }
}
final class FeaturesQAKeychain: KeychainStore, @unchecked Sendable {
    private let lock = NSLock()
    private var rows: [KeychainAddress: Data] = [:]
    func read(_ address: KeychainAddress) throws -> Data? { lock.withLock { rows[address] } }
    func write(_ data: Data, at address: KeychainAddress) throws { lock.withLock { rows[address] = data } }
    func delete(_ address: KeychainAddress) throws { _ = lock.withLock { rows.removeValue(forKey: address) } }
}

/// Only deterministic response bytes cross this HTTP seam; actual API/Auth clients perform decoding,
/// ownership validation, cookie handling and vault updates. Unexpected requests cannot reach a server.
final class FeaturesQAHTTP: HTTPTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var recorded: [String] = []
    private let responses: [String: Data]
    private let observe: @Sendable (String) -> Void
    init(responses: [String: Data], observe: @escaping @Sendable (String) -> Void = { _ in }) {
        self.responses = responses; self.observe = observe
    }
    var calls: [String] { lock.withLock { recorded } }
    func open(_ request: URLRequest, timeouts: RequestTimeouts) -> HTTPStream {
        let route = "\(request.httpMethod ?? "GET") \(request.url?.path ?? "missing")"
        lock.withLock { recorded.append(route) }
        let (events, continuation) = AsyncThrowingStream<HTTPStreamEvent, Error>.makeStream()
        if let bytes = responses[route], let url = request.url,
           let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                                          headerFields: ["Content-Type": "application/json"]) {
            continuation.yield(.response(response)); continuation.yield(.bytes(bytes)); continuation.finish()
        } else { continuation.finish(throwing: URLError(.unsupportedURL)) }
        observe(route)
        return HTTPStream(events: events, cancel: { continuation.finish(throwing: CancellationError()) })
    }
}

/// Cancellation deliberately does not finish these continuations. Tests control late completion
/// after cancellation to prove the ViewModel's generation guard, rather than assuming cooperation.
actor FeaturesQAControlledPlanner: PlannerService {
    private struct Pending {
        let continuation: CheckedContinuation<DrivePlanResponse, Error>
        let delta: @Sendable (String) -> Void
    }
    private let entered: [XCTestExpectation]
    private var pending: [Int: Pending] = [:]
    private var nextIndex = 0
    init(entered: [XCTestExpectation]) { self.entered = entered }
    func turn(_ request: DrivePlanRequest, onDelta: @escaping @Sendable (String) -> Void) async throws -> DrivePlanResponse {
        let index = nextIndex; nextIndex += 1
        return try await withCheckedThrowingContinuation { continuation in
            pending[index] = Pending(continuation: continuation, delta: onDelta)
            if entered.indices.contains(index) { entered[index].fulfill() }
            else { XCTFail("Unexpected planner request \(index)"); pending.removeValue(forKey: index)?.continuation.resume(throwing: URLError(.badURL)) }
        }
    }
    func delta(_ text: String, to index: Int) { pending[index]?.delta(text) }
    func complete(_ index: Int, with result: Result<DrivePlanResponse, Error>) throws {
        let value = try XCTUnwrap(pending.removeValue(forKey: index), "No controlled request \(index)")
        value.continuation.resume(with: result)
    }
}

struct FeaturesQARejectDownloader: StorageFileDownloader {
    func downloadFile(from url: URL, to destURL: URL, name: String,
                      onProgress: (@Sendable (Int64, Int64) -> Void)?) async throws { throw URLError(.notConnectedToInternet) }
}
