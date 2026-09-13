import Foundation

struct CredentialEnvelope: Codable, Sendable {
    let version: Int
    var jar: CookieJar
    var session: SessionSnapshot?
    var explicitlySignedOut: Bool
    var legacyKeys: [KeychainAddress]
    var unknownLocalOwner: Bool? = nil
    var verifiedDriveOwners: [String: String]? = nil
    var preservedRecoveryKeys: [KeychainAddress]? = nil
}

/// One atomic Keychain item holds the native cookie jar and cached session. The actor serializes
/// read/merge/write so concurrent responses never overwrite a newer jar with an old snapshot.
actor CredentialVault: SessionCookieProvider {
    static let address = KeychainAddress(service: "fm.skipper.app.native-auth", key: "session.v1")
    static let recoveryAddress = KeychainAddress(service: "fm.skipper.app.native-auth", key: "session.recovery.v1")
    private var activeAddress = CredentialVault.address
    let keychain: any KeychainStore
    let clock: any AppClock
    private let logoutMarker: any LogoutMarkerStore
    private var envelope: CredentialEnvelope?
    private var generation = 0

    init(keychain: any KeychainStore, clock: any AppClock = SystemAppClock(), logoutMarker: any LogoutMarkerStore = MemoryLogoutMarker()) {
        self.keychain = keychain; self.clock = clock; self.logoutMarker = logoutMarker
    }
    func initialize() throws -> CredentialEnvelope {
        if logoutMarker.isMarked() {
            // Recover cleanup metadata after a prior locked logout write; never recover its identity.
            if envelope == nil {
                if let data = try keychain.read(Self.recoveryAddress) {
                    guard let prior = try? JSONDecoder().decode(CredentialEnvelope.self, from: data), prior.version == 1 else {
                        throw AuthFailure.malformedCredentials
                    }
                    activeAddress = Self.recoveryAddress; envelope = prior
                } else if let data = try keychain.read(Self.address) {
                    guard let prior = try? JSONDecoder().decode(CredentialEnvelope.self, from: data), prior.version == 1 else {
                        throw AuthFailure.malformedCredentials
                    }
                    envelope = prior
                }
            }
            let signedOut = CredentialEnvelope(version: 1, jar: CookieJar(), session: nil, explicitlySignedOut: true,
                legacyKeys: envelope?.legacyKeys ?? [], unknownLocalOwner: envelope?.unknownLocalOwner,
                verifiedDriveOwners: envelope?.verifiedDriveOwners, preservedRecoveryKeys: envelope?.preservedRecoveryKeys)
            envelope = signedOut
            return signedOut
        }
        if let envelope { return envelope }
        if let recovered = try keychain.read(Self.recoveryAddress) {
            guard let value = try? JSONDecoder().decode(CredentialEnvelope.self, from: recovered), value.version == 1 else {
                throw AuthFailure.malformedCredentials
            }
            activeAddress = Self.recoveryAddress; envelope = value; return value
        }
        if let data = try keychain.read(Self.address) {
            guard let value = try? JSONDecoder().decode(CredentialEnvelope.self, from: data), value.version == 1 else {
                throw AuthFailure.malformedCredentials
            }
            envelope = value
            return value
        }
        let legacy = LegacySecureStore(keychain: keychain)
        let cookie = try legacy.read("skipper_cookie")
        let cache = try legacy.read("skipper_session_data")
        let sentinel = cookie?.text.trimmingCharacters(in: .whitespacesAndNewlines) == "{}" ||
                       cache?.text.trimmingCharacters(in: .whitespacesAndNewlines) == "{}"
        var jar = CookieJar()
        var session: SessionSnapshot?
        if !sentinel {
            if let cookie { jar = try CookieJar(legacyJSON: cookie.text) }
            if let cache, cache.text != "null", let data = cache.text.data(using: .utf8),
               let parsed = try? JSONDecoder().decode(SessionSnapshot.self, from: data),
               !parsed.user.id.isEmpty, !parsed.session.id.isEmpty, parsed.user.id == parsed.session.userId,
               authDate(parsed.session.expiresAt) != nil {
                session = parsed
            }
            // An unusable session cache cannot authorize offline access, but a valid cookie can
            // still recover through get-session. Keep the original cache until server validation.

        }
        let value = CredentialEnvelope(version: 1, jar: jar, session: session, explicitlySignedOut: sentinel,
            legacyKeys: (cookie?.addresses ?? []) + (cache?.addresses ?? []))
        try persist(value)
        return value
    }
    private func persist(_ value: CredentialEnvelope) throws {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(value)
        try keychain.write(data, at: activeAddress)
        guard try keychain.read(activeAddress) == data else { throw AuthFailure.verificationFailed }
        envelope = value
    }
    /// Called only from an explicit email/password flow, never initialization or anonymous mint.
    /// An independent record leaves unknown-version native data and all legacy bytes untouched.
    func prepareExplicitAuthentication() throws {
        do { _ = try initialize(); generation += 1; return }
        catch let error as AuthFailure {
            guard error == .malformedCredentials || error == .incompleteLegacyChunks else { throw error }
        }
        var preservedKeys: [KeychainAddress] = []
        if let damagedRecovery = try keychain.read(Self.recoveryAddress) {
            let preserved = KeychainAddress(service: Self.recoveryAddress.service,
                key: "session.recovery.preserved." + UUID().uuidString.lowercased())
            try keychain.write(damagedRecovery, at: preserved)
            guard try keychain.read(preserved) == damagedRecovery else { throw AuthFailure.verificationFailed }
            preservedKeys.append(preserved)
        }
        activeAddress = Self.recoveryAddress
        generation += 1
        let recovery = CredentialEnvelope(version: 1, jar: CookieJar(), session: nil, explicitlySignedOut: false,
            legacyKeys: [], unknownLocalOwner: true, verifiedDriveOwners: [:], preservedRecoveryKeys: preservedKeys)
        try persist(recovery)
    }
    func canAccessLocalDrive(_ id: String, userID: String) throws -> Bool {
        let value = try initialize()
        guard value.session?.user.id == userID, value.session?.isFresh(at: clock.now()) == true else { return false }
        return value.unknownLocalOwner != true || value.verifiedDriveOwners?[id.lowercased()] == userID
    }
    func didValidateOwnedDrives(_ ids: [String], for snapshot: SessionCookieSnapshot) async throws {
        guard snapshot.generation == generation else { return }
        var value = try initialize()
        guard value.unknownLocalOwner == true, let session = value.session, session.user.isAccount,
              session.isFresh(at: clock.now()) else { return }
        var owners = value.verifiedDriveOwners ?? [:]
        for id in ids where isWireUUID(id) { owners[id.lowercased()] = session.user.id }
        value.verifiedDriveOwners = owners
        try persist(value)
    }
    func cookieHeader() async throws -> String? { try initialize().jar.header(at: clock.now()) }
    func capture() async throws -> SessionCookieSnapshot {
        SessionCookieSnapshot(header: try initialize().jar.header(at: clock.now()), generation: generation)
    }
    func receive(_ response: HTTPURLResponse) async throws { try mergeResponse(response) }
    func receive(_ response: HTTPURLResponse, for snapshot: SessionCookieSnapshot) async throws {
        guard snapshot.generation == generation else { return }
        try mergeResponse(response)
    }
    private func mergeResponse(_ response: HTTPURLResponse) throws {
        guard response.value(forHTTPHeaderField: "Set-Cookie") != nil else { return }
        var value = try initialize()
        try value.jar.merge(response, at: clock.now())
        try persist(value)
        // A new authenticated response is the only thing that lifts the explicit sign-out marker.
        if value.jar.header(at: clock.now()) != nil { logoutMarker.setMarked(false) }
    }
    func acceptSession(_ session: SessionSnapshot?, generation expectedGeneration: Int? = nil) throws {
        if let expectedGeneration, expectedGeneration != generation { throw AuthFailure.operationInProgress }
        var value = try initialize()
        if value.session?.user.id != session?.user.id { generation += 1 }
        value.session = session
        value.explicitlySignedOut = false
        if session == nil { value.jar = CookieJar() }
        try persist(value)
        // Only an authoritative successful get-session response reaches here, after rotated cookies
        // were durably merged. Offline import never deletes its recovery source.
        try finishLegacyCleanup()
    }
    func finishLegacyCleanup() throws {
        var value = try initialize()
        guard value.unknownLocalOwner != true, !value.legacyKeys.isEmpty else { return }
        try LegacySecureStore(keychain: keychain).removeKnownKeys(value.legacyKeys)
        value.legacyKeys = []
        try persist(value)
    }
    func signOutLocally() throws {
        generation += 1
        logoutMarker.setMarked(true)
        var value = try initialize()
        value.jar = CookieJar(); value.session = nil; value.explicitlySignedOut = true
        envelope = value
        try persist(value)
        // A native signed-out sentinel wins on relaunch even if deleting a legacy row is interrupted.
        try finishLegacyCleanup()
    }
    func invalidateInFlightResponses() { generation += 1 }
}
