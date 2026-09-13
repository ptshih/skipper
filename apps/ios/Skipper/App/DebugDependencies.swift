#if DEBUG
import Foundation

/// Only service state is synthetic. UI scenarios run through the production SessionStore,
/// storage actor, feature models, navigation, and views.
@MainActor
enum DebugDependencies {
    static let scenarios: Set<String> = ["offline-library", "offline-empty", "signed-out", "migration-deferred", "planner-account-retry", "planner-account-lost-ack", "planner-reset-during-stream", "planner-map-landmark", "offline-no-playable-clips", "corrupt-credentials-recovery", "version-force", "version-recommended", "version-force-delayed-sheet", "version-recommended-delayed-planner"]

    /// Shared fixture/diagnostic destination; unavailable for production or invalid launches.
    static func runDirectory(for launch: AppLaunchConfiguration) -> URL? {
        guard case .uiTest(let scenario, let runID, _) = launch.mode,
              scenarios.contains(scenario), let identifier = UUID(uuidString: runID) else { return nil }
        return URL.applicationSupportDirectory.appendingPathComponent("UITestRuns", isDirectory: true)
            .appendingPathComponent(identifier.uuidString, isDirectory: true)
    }

    static func make(launch: AppLaunchConfiguration, bundle: Bundle = .main) throws -> AppDependencies {
        guard case .uiTest(let scenario, let runID, _) = launch.mode,
              scenarios.contains(scenario), let identifier = UUID(uuidString: runID),
              let resources = bundle.url(forResource: "native-ios-debug", withExtension: nil),
              let defaults = UserDefaults(suiteName: "fm.skipper.app.ui.\(identifier.uuidString)"),
              let documents = runDirectory(for: launch) else { throw ContractError() }
        let flow = scenario.hasPrefix("version-")
            ? try fixture(scenario, file: "version-policy-ui", resources: resources)
            : try? fixture(scenario, file: "ui-flows", resources: resources)
        try FileManager.default.createDirectory(at: documents, withIntermediateDirectories: true)
        // A relaunch with the same run ID preserves its already-seeded files.
        let marker = documents.appendingPathComponent("fixture-seeded")
        if !FileManager.default.fileExists(atPath: marker.path) {
            if !scenario.hasPrefix("planner-"), scenario != "offline-empty" {
                let input = try fixture("v5-partial-shared", file: "manifests", resources: resources)
                guard let files = input["files"] as? [String: [String: Any]] else { throw ContractError() }
                for (path, contents) in files {
                    let components = path.split(separator: "/")
                    guard !path.hasPrefix("/"), !components.contains(".."), !components.contains(".") else { throw ContractError() }
                    let destination = documents.appendingPathComponent(path)
                    try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
                    let data: Data
                    if let text = contents["text"] as? String { data = Data(text.utf8) }
                    else if let bytes = contents["bytes"] as? [UInt8] {
                        if scenario == "offline-no-playable-clips" { continue }
                        data = Data(bytes)
                    }
                    else { throw ContractError() }
                    try data.write(to: destination, options: .atomic)
                }
            }
            try Data(scenario.utf8).write(to: marker, options: .atomic)
        } else if try String(contentsOf: marker, encoding: .utf8) != scenario { throw ContractError() }

        let input = try fixture("unchunked-fresh-offline", file: "credentials", resources: resources)
        guard let rows = input["rows"] as? [[String: Any]], let now = input["now"] as? String,
              let date = authDate(now) else { throw ContractError() }
        var values: [KeychainAddress: Data] = [:]
        for row in (flow?["credentialRows"] as? [[String: Any]] ?? rows) {
            guard let service = row["service"] as? String, let key = row["key"] as? String,
                  let value = row["value"] as? String else { throw ContractError() }
            values[.init(service: service, key: key)] = Data(value.utf8)
        }
        if let initial = flow?["initialSession"] {
            values[.init(service: "app:no-auth", key: "skipper_session_data")] = try JSONSerialization.data(withJSONObject: initial)
        }
        if scenario == "signed-out" { values[.init(service: "app:no-auth", key: "skipper_cookie")] = Data("{}".utf8) }
        let keychain = try DebugKeychain(rows: values, unavailable: scenario == "migration-deferred", file: documents.appendingPathComponent("mock-keychain.json"))
        let clock = DebugClock(date: date)
        let vault = CredentialVault(keychain: keychain, clock: clock)
        let network = DebugNetwork(offline: flow?["offline"] as? Bool ?? true)
        let transport = try DebugScenarioTransport(input: flow ?? [:], root: documents)
        let api = APIClient(baseURL: URL(string: "https://api.invalid")!, transport: transport, cookies: vault, network: network)
        let storage = StorageService(rootURL: documents, downloader: try downloader(for: launch, resources: resources))
        let auth = AuthClient(baseURL: URL(string: "https://api.invalid")!, transport: transport, vault: vault, network: network)
        let session = SessionStore(auth: auth, vault: vault, network: network, clock: clock,
            purgeDownloads: {
                transport.recordPurge()
                _ = await storage.deleteAllDriveDownloads()
            })
        let initialTab: MainTab?
        if let rawTab = flow?["initialTab"] as? String {
            guard let tab = MainTab(rawValue: rawTab) else { throw ContractError() }
            initialTab = tab
        } else { initialTab = nil }
        return AppDependencies(api: api, planner: PlannerClient(baseURL: URL(string: "https://api.invalid")!, transport: transport, network: network),
            documentsURL: documents, launch: launch, session: session, storage: storage, network: network, defaults: defaults, preview: nil, analytics: nil,
            makePlayback: { DebugPlaybackServices.make(session: session, date: date, root: documents) }, initialTab: initialTab)
    }
    static func downloader(for launch: AppLaunchConfiguration, resources: URL) throws -> any StorageFileDownloader {
        guard case .uiTest(let scenario, _, _) = launch.mode,
              ["planner-account-retry", "planner-account-lost-ack"].contains(scenario),
              let root = runDirectory(for: launch) else { return DebugRejectedDownloader() }
        let bytes = try Data(contentsOf: resources.appendingPathComponent("audio/create-continuity.m4a"))
        guard !bytes.isEmpty else { throw ContractError() }
        return DebugCreateDownloader(bytes: bytes, staging: root.appendingPathComponent(".staging", isDirectory: true))
    }

    private static func fixture(_ id: String, file: String, resources: URL) throws -> [String: Any] {
        let data = try Data(contentsOf: resources.appendingPathComponent("\(file).json"))
        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let cases = root["cases"] as? [[String: Any]],
              let input = cases.first(where: { $0["id"] as? String == id })?["input"] as? [String: Any] else { throw ContractError() }
        return input
    }
}

private struct DebugClock: AppClock { let date: Date; func now() -> Date { date } }
private struct DebugNetwork: NetworkAvailability { let offline: Bool; func isOffline() async -> Bool { offline } }
private struct DebugRejectedTransport: HTTPTransport {
    func open(_ request: URLRequest, timeouts: RequestTimeouts) -> HTTPStream {
        HTTPStream(events: AsyncThrowingStream { $0.finish(throwing: OfflineError()) }, cancel: {})
    }
}
private struct DebugRejectedDownloader: StorageFileDownloader {
    func downloadFile(from url: URL, to destURL: URL, name: String, onProgress: (@Sendable (Int64, Int64) -> Void)?) async throws {
        throw OfflineError()
    }
}
/// The real storage actor promotes these bytes and commits its own manifest. This fixture
/// cannot fetch remote audio or write directly into a drive directory.
private struct DebugCreateDownloader: StorageFileDownloader {
    let bytes: Data
    let staging: URL

    func downloadFile(from url: URL, to destURL: URL, name: String, onProgress: (@Sendable (Int64, Int64) -> Void)?) async throws {
        guard url.absoluteString == "https://fixture.invalid/native-ios/create-continuity.m4a",
              destURL.isFileURL,
              destURL.deletingLastPathComponent().standardizedFileURL == staging.standardizedFileURL,
              destURL.resolvingSymlinksInPath().deletingLastPathComponent() == staging.standardizedFileURL else { throw OfflineError() }
        try Task.checkCancellation()
        try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: true)
        try bytes.write(to: destURL, options: .atomic)
        onProgress?(Int64(bytes.count), Int64(bytes.count))
    }
}
private final class DebugKeychain: KeychainStore, @unchecked Sendable {
    private let lock = NSLock()
    private var rows: [KeychainAddress: Data]
    private let unavailable: Bool
    private let file: URL
    init(rows: [KeychainAddress: Data], unavailable: Bool, file: URL) throws {
        self.file = file; self.unavailable = unavailable
        if FileManager.default.fileExists(atPath: file.path) {
            self.rows = try JSONDecoder().decode([KeychainAddress: Data].self, from: Data(contentsOf: file))
        } else {
            self.rows = rows
            try JSONEncoder().encode(rows).write(to: file, options: .atomic)
        }
    }
    func read(_ address: KeychainAddress) throws -> Data? {
        lock.lock(); defer { lock.unlock() }
        if unavailable { throw AuthFailure.keychainUnavailable(-25308) }
        return rows[address]
    }
    func write(_ data: Data, at address: KeychainAddress) throws {
        lock.lock(); defer { lock.unlock() }
        if unavailable { throw AuthFailure.keychainUnavailable(-25308) }
        var updated = rows; updated[address] = data
        try JSONEncoder().encode(updated).write(to: file, options: .atomic); rows = updated
    }
    func delete(_ address: KeychainAddress) throws {
        lock.lock(); defer { lock.unlock() }
        if unavailable { throw AuthFailure.keychainUnavailable(-25308) }
        var updated = rows; updated[address] = nil
        try JSONEncoder().encode(updated).write(to: file, options: .atomic); rows = updated
    }
}
#endif
