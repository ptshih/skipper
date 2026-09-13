import XCTest
@testable import Skipper

@MainActor
final class SessionStoreTests: XCTestCase {
    private let clock = FixedAuthClock(date: authDate("2026-09-12T12:00:00.000Z")!)
    func testAuthoritativeNoSessionMintsOnlyOnceAcrossRefreshAndSignOut() async throws {
        let keychain = AuthTestKeychain()
        let vault = CredentialVault(keychain: keychain, clock: clock)
        let auth = AuthTestService()
        let purge = PurgeCounter()
        let store = SessionStore(auth: auth, vault: vault, network: AuthTestNetwork(offline: false), clock: clock,
                                 purgeDownloads: { await purge.purge() })
        await store.start(); await store.retry(); try await store.signOut(); await store.retry()
        let calls = await auth.recorded()
        XCTAssertEqual(calls.filter { $0 == "anonymous" }.count, 1)
        let purges = await purge.value(); XCTAssertEqual(purges, 1)
    }
    func testAnyPreexistingSessionConsumesMintAndSignOutPurgesFirst() async throws {
        for anonymous in [true, false] {
            let value = syntheticSession(anonymous: anonymous)
            let vault = CredentialVault(keychain: try syntheticKeychain(session: value), clock: clock)
            let auth = AuthTestService(session: value)
            let purge = PurgeCounter()
            let store = SessionStore(auth: auth, vault: vault, clock: clock, purgeDownloads: { await purge.purge() })
            await store.start(); XCTAssertTrue(store.anonymousAttempted)
            XCTAssertEqual(store.isSignedIn, !anonymous)
            try await store.signOut()
            let header = try await vault.cookieHeader(); XCTAssertNil(header)
            let calls = await auth.recorded(); XCTAssertFalse(calls.contains("anonymous"))
            let purges = await purge.value(); XCTAssertEqual(purges, 1)
        }
    }
    func testExpiredPreexistingSessionStillConsumesProcessMintAllowance() async throws {
        let later = FixedAuthClock(date: authDate("2026-11-01T00:00:00Z")!)
        let vault = CredentialVault(keychain: try syntheticKeychain(), clock: later)
        let auth = AuthTestService()
        let store = SessionStore(auth: auth, vault: vault, clock: later, purgeDownloads: {})
        await store.start()
        XCTAssertTrue(store.anonymousAttempted)
        let calls = await auth.recorded(); XCTAssertFalse(calls.contains("anonymous"))
        XCTAssertFalse(store.canAccessLocalDrives)
    }
    func testRecoveryWithoutSessionNeverAutomaticallyMints() async throws {
        let keychain = AuthTestKeychain(rows: [CredentialVault.address: Data("bad".utf8)])
        let vault = CredentialVault(keychain: keychain, clock: clock)
        let auth = AuthTestService()
        let store = SessionStore(auth: auth, vault: vault, clock: clock, purgeDownloads: {})
        await store.start()
        XCTAssertTrue(store.canRecoverCredentials)
        try await vault.prepareExplicitAuthentication()
        await store.retry()
        let calls = await auth.recorded(); XCTAssertFalse(calls.contains("anonymous"))
        XCTAssertFalse(store.canAccessLocalDrives)
    }
    func testOfflineWithoutSessionDoesNotConsumeMintAttempt() async {
        let auth = AuthTestService()
        let vault = CredentialVault(keychain: AuthTestKeychain(), clock: clock)
        let store = SessionStore(auth: auth, vault: vault, network: AuthTestNetwork(offline: true), clock: clock, purgeDownloads: {})
        await store.start()
        XCTAssertFalse(store.anonymousAttempted)
        XCTAssertEqual(store.state, .deferred)
        let calls = await auth.recorded(); XCTAssertTrue(calls.isEmpty)
    }
    func testAccountDeletionChecksCodeThenPurgesAndClearsWithoutMint() async throws {
        let value = syntheticSession()
        let vault = CredentialVault(keychain: try syntheticKeychain(), clock: clock)
        let auth = AuthTestService(session: value)
        let purge = PurgeCounter()
        let store = SessionStore(auth: auth, vault: vault, clock: clock, purgeDownloads: { await purge.purge() })
        await store.start(); try await store.deleteAccount(proof: .code("123456"))
        XCTAssertEqual(store.state, .signedOut)
        let calls = await auth.recorded()
        XCTAssertEqual(calls.suffix(2), ["verify-delete", "delete-account"])
        let purges = await purge.value(); XCTAssertEqual(purges, 1)
        XCTAssertTrue(store.anonymousAttempted)
    }
    func testSignOutMarkerPreventsRelaunchResurrectionAfterKeychainWriteFailure() async throws {
        let keychain = try syntheticKeychain()
        let marker = MemoryLogoutMarker()
        let vault = CredentialVault(keychain: keychain, clock: clock, logoutMarker: marker)
        _ = try await vault.initialize()
        keychain.failWrites = true
        do { try await vault.signOutLocally(); XCTFail("Expected locked write") } catch {}
        let relaunched = CredentialVault(keychain: keychain, clock: clock, logoutMarker: marker)
        let state = try await relaunched.initialize()
        XCTAssertTrue(state.explicitlySignedOut); XCTAssertNil(state.session)
        let header = try await relaunched.cookieHeader(); XCTAssertNil(header)
    }
    func testHasPasswordTriStateLookupDistinguishesFailureFromMissingPassword() async throws {
        let value = syntheticSession(anonymous: false)
        let vault = CredentialVault(keychain: try syntheticKeychain(session: value), clock: clock)

        // 1. Failing accounts lookup (e.g. offline / network timeout) must return nil, NOT collapse to false.
        let failingAuth = InjectedAccountsAuthService(session: value, failure: URLError(.notConnectedToInternet))
        let failingStore = SessionStore(auth: failingAuth, vault: vault, clock: clock, purgeDownloads: {})
        await failingStore.start()
        let unknownResult: Bool? = await failingStore.hasPassword()
        XCTAssertNil(unknownResult, "A failed accounts lookup must yield nil (unknown), not false")

        // 2. Account with credential provider yields true.
        let withPasswordAuth = InjectedAccountsAuthService(session: value, accounts: [LinkedAccount(providerId: "credential")])
        let withPasswordStore = SessionStore(auth: withPasswordAuth, vault: vault, clock: clock, purgeDownloads: {})
        await withPasswordStore.start()
        let hasPasswordResult: Bool? = await withPasswordStore.hasPassword()
        XCTAssertEqual(hasPasswordResult, true, "Account with credential provider returns true")

        // 3. Account without credential provider yields false.
        let noPasswordAuth = InjectedAccountsAuthService(session: value, accounts: [])
        let noPasswordStore = SessionStore(auth: noPasswordAuth, vault: vault, clock: clock, purgeDownloads: {})
        await noPasswordStore.start()
        let noPasswordResult: Bool? = await noPasswordStore.hasPassword()
        XCTAssertEqual(noPasswordResult, false, "Account without credential provider returns false")

        // 4. Signed out store yields false.
        let signedOutVault = CredentialVault(keychain: AuthTestKeychain(), clock: clock)
        let signedOutAuth = InjectedAccountsAuthService(session: nil)
        let signedOutStore = SessionStore(auth: signedOutAuth, vault: signedOutVault, clock: clock, purgeDownloads: {})
        await signedOutStore.start()
        try await signedOutStore.signOut()
        XCTAssertFalse(signedOutStore.isSignedIn)
        let signedOutResult: Bool? = await signedOutStore.hasPassword()
        XCTAssertEqual(signedOutResult, false, "Signed out store returns false")
    }
}

private actor InjectedAccountsAuthService: AuthenticationService {
    var sessionValue: SessionSnapshot?
    var accountsList: [LinkedAccount]
    var failure: Error?

    init(session: SessionSnapshot? = nil, accounts: [LinkedAccount] = [], failure: Error? = nil) {
        self.sessionValue = session
        self.accountsList = accounts
        self.failure = failure
    }

    func session() async throws -> SessionSnapshot? { sessionValue }
    func signInAnonymously() async throws {}
    func sendCode(email: String) async throws {}
    func signIn(email: String, code: String) async throws {}
    func signIn(email: String, password: String) async throws {}
    func requestPasswordReset(email: String) async throws {}
    func updateName(_ name: String) async throws {}
    func accounts() async throws -> [LinkedAccount] {
        if let failure { throw failure }
        return accountsList
    }
    func verifyDeletionCode(email: String, code: String) async throws {}
    func deleteAccount(password: String?) async throws {}
    func signOut(cookie: String?) async throws {}
}

