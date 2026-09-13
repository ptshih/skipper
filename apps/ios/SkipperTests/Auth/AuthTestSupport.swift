import Foundation
@testable import Skipper

struct FixedAuthClock: AppClock { let date: Date; func now() -> Date { date } }
struct AuthTestNetwork: NetworkAvailability { let offline: Bool; func isOffline() async -> Bool { offline } }

final class AuthTestKeychain: KeychainStore, @unchecked Sendable {
    private let lock = NSLock()
    private var data: [KeychainAddress: Data]
    private var log: [String] = []
    var readError: AuthFailure?
    var failReadback = false
    var failWrites = false
    init(rows: [KeychainAddress: Data] = [:]) { data = rows }
    func read(_ address: KeychainAddress) throws -> Data? {
        lock.lock(); defer { lock.unlock() }
        log.append("read:\(address.service):\(address.key)")
        if let readError { throw readError }
        if failReadback && address == CredentialVault.address && data[address] != nil { throw AuthFailure.keychainUnavailable(-25291) }
        return data[address]
    }
    func write(_ value: Data, at address: KeychainAddress) throws {
        lock.lock(); defer { lock.unlock() }
        if failWrites { throw AuthFailure.keychainUnavailable(-25308) }
        log.append("write:\(address.service):\(address.key)"); data[address] = value
    }
    func delete(_ address: KeychainAddress) throws {
        lock.lock(); defer { lock.unlock() }
        log.append("delete:\(address.service):\(address.key)"); data.removeValue(forKey: address)
    }
    var snapshot: [KeychainAddress: Data] { lock.lock(); defer { lock.unlock() }; return data }
    var events: [String] { lock.lock(); defer { lock.unlock() }; return log }
}

actor AuthTestService: AuthenticationService {
    var current: SessionSnapshot?
    var failure: Error?
    private var calls: [String] = []
    init(session: SessionSnapshot? = nil, failure: Error? = nil) { current = session; self.failure = failure }
    func recorded() -> [String] { calls }
    func session() throws -> SessionSnapshot? { calls.append("session"); if let failure { throw failure }; return current }
    func signInAnonymously() throws { calls.append("anonymous"); if let failure { throw failure } }
    func sendCode(email: String) { calls.append("send-code") }
    func signIn(email: String, code: String) { calls.append("sign-in-code") }
    func signIn(email: String, password: String) { calls.append("sign-in-password") }
    func requestPasswordReset(email: String) { calls.append("password-reset") }
    func updateName(_ name: String) { calls.append("update-name") }
    func accounts() -> [LinkedAccount] { [] }
    func verifyDeletionCode(email: String, code: String) { calls.append("verify-delete") }
    func deleteAccount(password: String?) { calls.append("delete-account") }
    func signOut(cookie: String?) { calls.append("sign-out") }
}
actor PurgeCounter {
    private var count = 0
    func purge() { count += 1 }
    func value() -> Int { count }
}

func syntheticSession(anonymous: Bool = false) -> SessionSnapshot {
    SessionSnapshot(user: SessionUser(id: "fixture-user", name: "Fixture", email: "rider@example.invalid", emailVerified: true,
        isAnonymous: anonymous, role: "user", createdAt: nil, updatedAt: nil),
        session: SessionDetails(id: "fixture-session", userId: "fixture-user", expiresAt: "2026-10-01T00:00:00.000Z", token: nil, createdAt: nil, updatedAt: nil))
}
func syntheticKeychain(session: SessionSnapshot = syntheticSession()) throws -> AuthTestKeychain {
    AuthTestKeychain(rows: [
        .init(service: "app:no-auth", key: "skipper_cookie"): Data(#"{"__Secure-better-auth.session_token":{"value":"SYNTHETIC","expires":"2026-10-01T00:00:00Z"}}"#.utf8),
        .init(service: "app:no-auth", key: "skipper_session_data"): try JSONEncoder().encode(session),
    ])
}
