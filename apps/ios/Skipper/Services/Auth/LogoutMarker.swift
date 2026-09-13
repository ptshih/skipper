import Foundation

protocol LogoutMarkerStore: Sendable {
    func isMarked() -> Bool
    func setMarked(_ value: Bool)
}
/// This contains no credential or identity: only the rider's explicit local sign-out intent.
/// It prevents an old Keychain item resurrecting if the device locks during the sign-out write.
final class DefaultsLogoutMarker: LogoutMarkerStore, @unchecked Sendable {
    private let defaults: UserDefaults
    private let key = "skipper.native.auth.signedOut"
    init(defaults: UserDefaults) { self.defaults = defaults }
    func isMarked() -> Bool { defaults.bool(forKey: key) }
    func setMarked(_ value: Bool) { defaults.set(value, forKey: key) }
}
final class MemoryLogoutMarker: LogoutMarkerStore, @unchecked Sendable {
    private let lock = NSLock()
    private var marked = false
    func isMarked() -> Bool { lock.lock(); defer { lock.unlock() }; return marked }
    func setMarked(_ value: Bool) { lock.lock(); marked = value; lock.unlock() }
}
