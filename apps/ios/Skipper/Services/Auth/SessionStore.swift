import Foundation
import Observation

/// The app's sole identity source. Screens consume state and invoke these operations; they never
/// infer account access from a truthy session or manipulate Keychain/cookies/download cleanup directly.
@MainActor @Observable
final class SessionStore {
    private(set) var state: SessionState = .loading
    private(set) var isBusy = false
    private(set) var needsRefresh = false
    private(set) var lastError: String?
    private(set) var anonymousAttempted = false
    private(set) var canRecoverCredentials = false
    private(set) var hasUnverifiedLocalOwnership = false
    private let auth: any AuthenticationService
    private let vault: CredentialVault
    private let network: any NetworkAvailability
    private let clock: any AppClock
    private let purgeDownloads: @Sendable () async -> Void

    var session: SessionSnapshot? { state.snapshot }
    var user: SessionUser? { session?.user }
    var isSignedIn: Bool { state.isSignedIn }
    var wasRecentlyCreated: Bool {
        guard isSignedIn, let raw = user?.createdAt, let created = authDate(raw) else { return false }
        return clock.now().timeIntervalSince(created) < 5 * 60
    }
    var isAdmin: Bool { user?.isAdmin == true }
    var canAccessLocalDrives: Bool { isSignedIn && session?.isFresh(at: clock.now()) == true && !hasUnverifiedLocalOwnership }
    func canAccessLocalDrive(_ id: String) async -> Bool {
        guard isSignedIn, let session, session.isFresh(at: clock.now()) else { return false }
        return (try? await vault.canAccessLocalDrive(id, userID: session.user.id)) == true
    }

    init(auth: any AuthenticationService, vault: CredentialVault,
         network: any NetworkAvailability = UnknownNetworkAvailability(), clock: any AppClock = SystemAppClock(),
         purgeDownloads: @escaping @Sendable () async -> Void) {
        self.auth = auth; self.vault = vault; self.network = network; self.clock = clock
        self.purgeDownloads = purgeDownloads
    }

    func start() async { await refresh() }
    func retry() async { await refresh() }
    func refresh() async {
        guard !isBusy else { return }
        isBusy = true; lastError = nil
        defer { isBusy = false }
        do {
            let local = try await vault.initialize()
            canRecoverCredentials = false
            hasUnverifiedLocalOwnership = local.unknownLocalOwner == true
            if hasUnverifiedLocalOwnership { anonymousAttempted = true }
            // Presence consumes the process allowance even if the cache has since expired.
            if local.session != nil { anonymousAttempted = true }
            if local.explicitlySignedOut { state = .signedOut }
            else if let session = local.session, session.isFresh(at: clock.now()) {
                setSession(session); anonymousAttempted = true
            } else { state = .deferred }
            if await network.isOffline() {
                needsRefresh = true
                return
            }
            let remote = try await auth.session()
            setSession(remote); needsRefresh = false
            if remote != nil { anonymousAttempted = true }
            else if !anonymousAttempted {
                // Synchronously consume before the first await. No retries in this process,
                // including after sign-out/deletion or a failed anonymous request.
                anonymousAttempted = true
                do {
                    try await auth.signInAnonymously()
                    setSession(try await auth.session())
                } catch {
                    // An anonymous mint is a convenience; the planner remains usable without it.
                    needsRefresh = true
                }
            }
        } catch {
            canRecoverCredentials = (error as? AuthFailure) == .malformedCredentials || (error as? AuthFailure) == .incompleteLegacyChunks
            needsRefresh = true
            // Valid imported cached state continues to authorize its own local downloads offline.
            // A missing/expired/unreadable state remains unknown, never an invitation to mint.
            if session?.isFresh(at: clock.now()) != true, state != .signedOut { state = .deferred }
            lastError = "Your account could not be checked. Please try again when you have a connection."
        }
    }
    func sendCode(email: String) async throws {
        try await perform { try await self.auth.sendCode(email: email.trimmingCharacters(in: .whitespacesAndNewlines)) }
    }
    func signIn(email: String, code: String) async throws {
        try await perform {
            try await self.auth.signIn(email: email.trimmingCharacters(in: .whitespacesAndNewlines), code: code.trimmingCharacters(in: .whitespacesAndNewlines))
            try await self.finishSignIn()
        }
    }
    func signIn(email: String, password: String) async throws {
        try await perform {
            try await self.auth.signIn(email: email.trimmingCharacters(in: .whitespacesAndNewlines), password: password)
            try await self.finishSignIn()
        }
    }
    func requestPasswordReset(email: String) async throws {
        try await perform { try await self.auth.requestPasswordReset(email: email.trimmingCharacters(in: .whitespacesAndNewlines)) }
    }
    func updateName(_ name: String) async throws {
        guard isSignedIn else { throw AuthFailure.accountRequired }
        try await perform {
            try await self.auth.updateName(name.trimmingCharacters(in: .whitespacesAndNewlines))
            try await self.finishSignIn()
        }
    }
    func hasPassword() async -> Bool? {
        guard isSignedIn else { return false }
        return try? await auth.accounts().contains { $0.providerId == "credential" }
    }
    func sendDeletionCode() async throws {
        guard let user, isSignedIn else { throw AuthFailure.accountRequired }
        try await sendCode(email: user.email)
    }
    enum DeletionProof: Sendable { case password(String), code(String) }
    func deleteAccount(proof: DeletionProof) async throws {
        guard let user, isSignedIn else { throw AuthFailure.accountRequired }
        try await perform {
            switch proof {
            case .code(let code):
                guard !code.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw AuthFailure.verificationFailed }
                try await self.auth.verifyDeletionCode(email: user.email, code: code.trimmingCharacters(in: .whitespacesAndNewlines))
                try await self.auth.deleteAccount(password: nil)
            case .password(let password):
                guard !password.isEmpty else { throw AuthFailure.verificationFailed }
                try await self.auth.deleteAccount(password: password)
            }
            self.anonymousAttempted = true
            await self.purgeDownloads()
            defer { self.state = .signedOut; self.needsRefresh = false }
            try await self.vault.signOutLocally()
        }
    }
    func signOut() async throws {
        try await perform {
            self.anonymousAttempted = true
            let cookie = try? await self.vault.cookieHeader()
            await self.purgeDownloads()
            // The non-secret logout marker prevents old credentials resurrecting even if the
            // device locks between the button tap and the Keychain write.
            try? await self.vault.signOutLocally()
            self.state = .signedOut; self.needsRefresh = false
            // Local sign-out is complete even in a dead zone. A network rejection cannot restore it.
            try? await self.auth.signOut(cookie: cookie)
        }
    }
    private func finishSignIn() async throws {
        anonymousAttempted = true
        guard let value = try await auth.session(), value.user.isAccount else { throw AuthFailure.sessionUnavailable }
        let local = try await vault.initialize()
        hasUnverifiedLocalOwnership = local.unknownLocalOwner == true
        canRecoverCredentials = false
        setSession(value); needsRefresh = false
    }
    private func setSession(_ value: SessionSnapshot?) {
        guard let value else { state = .signedOut; return }
        state = value.user.isAccount ? .signedIn(value) : .anonymous(value)
    }
    private func perform(_ operation: () async throws -> Void) async throws {
        guard !isBusy else { throw AuthFailure.operationInProgress }
        isBusy = true; lastError = nil
        defer { isBusy = false }
        do { try await operation() }
        catch {
            if let apiError = error as? APIError { lastError = apiError.message }
            else { lastError = "That didn’t go through. Please try again." }
            throw error
        }
    }
}
