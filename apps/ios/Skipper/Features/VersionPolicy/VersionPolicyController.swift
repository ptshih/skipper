import Foundation
import Observation

@MainActor @Observable
final class VersionPolicyController {
    enum Gate: Equatable { case force, nudge }

    static let dismissalKey = "skipper.updateNudgeDismissed"
    private(set) var gate: Gate?
    private(set) var storeURL: URL?
    @ObservationIgnored private var didCheck = false
    @ObservationIgnored private let currentVersion: String?
    @ObservationIgnored private let loadPolicies: @MainActor () async throws -> [VersionPolicy]
    @ObservationIgnored private let readDismissal: @MainActor () throws -> String?
    @ObservationIgnored private let saveDismissal: @MainActor (String) throws -> Void

    convenience init(api: any SkipperAPI, defaults: UserDefaults,
                     currentVersion: String? = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) {
        self.init(currentVersion: currentVersion, loadPolicies: { try await api.version() },
                  readDismissal: { defaults.string(forKey: Self.dismissalKey) },
                  saveDismissal: { defaults.set($0, forKey: Self.dismissalKey) })
    }

    init(currentVersion: String?, loadPolicies: @escaping @MainActor () async throws -> [VersionPolicy],
         readDismissal: @escaping @MainActor () throws -> String?,
         saveDismissal: @escaping @MainActor (String) throws -> Void) {
        self.currentVersion = currentVersion
        self.loadPolicies = loadPolicies
        self.readDismissal = readDismissal
        self.saveDismissal = saveDismissal
    }

    /// A launch request, never a foreground retry loop. No reachable policy means no wall.
    func checkOnce() async {
        guard !didCheck else { return }
        didCheck = true
        guard let currentVersion, !currentVersion.isEmpty, !Task.isCancelled else { return }
        do {
            let policies = try await loadPolicies()
            guard !Task.isCancelled, let policy = policies.first(where: { $0.platform == .ios }),
                  let url = URL(string: policy.storeUrl) else { return }
            storeURL = url
            if VersionComparison.compare(currentVersion, policy.minimum) < 0 {
                gate = .force
            } else if VersionComparison.compare(currentVersion, policy.recommended) < 0,
                      (try? readDismissal()) != currentVersion {
                gate = .nudge
            }
        } catch {
            // Offline and malformed responses must not strand a rider with downloaded drives.
        }
    }

    func dismissNudge() {
        guard gate == .nudge, let currentVersion else { return }
        try? saveDismissal(currentVersion)
        gate = nil
    }

    /// Store-open failure leaves the gate intact so the rider can retry or choose Later.
    func openStore(using open: (URL) throws -> Void) {
        guard gate != nil, let storeURL else { return }
        try? open(storeURL)
    }
}
