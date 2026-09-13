import Foundation
import Network

/// Unknown connectivity fails open; only the OS's affirmative unsatisfied path skips a request.
final class DeviceNetworkAvailability: NetworkAvailability, @unchecked Sendable {
    private let monitor = NWPathMonitor()
    private let lock = NSLock()
    private var offline = false
    init() {
        monitor.pathUpdateHandler = { [weak self] path in self?.update(path.status == .unsatisfied) }
        monitor.start(queue: DispatchQueue(label: "fm.skipper.connectivity"))
    }
    private func update(_ value: Bool) { lock.lock(); offline = value; lock.unlock() }
    private func current() -> Bool { lock.lock(); defer { lock.unlock() }; return offline }
    func isOffline() async -> Bool { current() }
    deinit { monitor.cancel() }
}
