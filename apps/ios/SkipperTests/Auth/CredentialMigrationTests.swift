import XCTest
import Security
@testable import Skipper

@MainActor
final class CredentialMigrationTests: XCTestCase {
    private let clock = FixedAuthClock(date: authDate("2026-09-12T12:00:00.000Z")!)

    func testPublishedCredentialCasesPreserveAccessAndFailClosed() async throws {
        let root = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "native-ios", withExtension: nil))
        let data = try Data(contentsOf: root.appendingPathComponent("migration/credentials.json"))
        let suite = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        let cases = suite["cases"] as! [[String: Any]]
        for fixture in cases {
            let id = fixture["id"] as! String
            let input = fixture["input"] as! [String: Any]
            let expected = fixture["expected"] as! [String: Any]
            var rows: [KeychainAddress: Data] = [:]
            for row in input["rows"] as! [[String: Any]] {
                rows[.init(service: row["service"] as! String, key: row["key"] as! String)] = Data((row["value"] as! String).utf8)
            }
            let keychain = AuthTestKeychain(rows: rows)
            if input["keychainStatus"] as? String != "success" { keychain.readError = .keychainUnavailable(-25308) }
            keychain.failReadback = input["nativeReadback"] as? String == "notAvailable"
            let vault = CredentialVault(keychain: keychain, clock: clock)
            let auth = AuthTestService(failure: URLError(.timedOut))
            let purge = PurgeCounter()
            let store = SessionStore(auth: auth, vault: vault, network: AuthTestNetwork(offline: input["network"] as? String == "offline"),
                                     clock: clock, purgeDownloads: { await purge.purge() })
            await store.start()
            if let access = expected["localAccountAccess"] as? Bool { XCTAssertEqual(store.canAccessLocalDrives, access, id) }
            if let header = expected["cookieHeader"] as? String {
                let actual = try? await vault.cookieHeader()
                XCTAssertEqual(actual ?? "", header, id)
            }
            let calls = await auth.recorded()
            XCTAssertFalse(calls.contains("anonymous"), id)
            let purges = await purge.value(); XCTAssertEqual(purges, 0, id)
            XCTAssertFalse(keychain.events.contains { $0.hasPrefix("delete:") }, id)
            if expected["migration"] as? String == "signedOut" { XCTAssertEqual(store.state, .signedOut, id) }
        }
        XCTAssertEqual(cases.count, 25)
    }
    func testRotatedCookieIsVerifiedBeforeLegacyDeletionAndSurvivesRelaunch() async throws {
        let keychain = try syntheticKeychain()
        let vault = CredentialVault(keychain: keychain, clock: clock)
        _ = try await vault.initialize()
        let response = HTTPURLResponse(url: URL(string: "https://api.invalid/api/auth/get-session")!, statusCode: 200, httpVersion: nil,
            headerFields: ["Set-Cookie":"__Secure-better-auth.session_token=ROTATED; Max-Age=3600; Path=/; Secure"])!
        try await vault.receive(response)
        try await vault.acceptSession(syntheticSession())
        let events = keychain.events
        let firstDeletion = try XCTUnwrap(events.firstIndex { $0.hasPrefix("delete:") })
        XCTAssertTrue(events[..<firstDeletion].contains("read:fm.skipper.app.native-auth:session.v1"))
        let restored = CredentialVault(keychain: keychain, clock: clock)
        let header = try await restored.cookieHeader()
        XCTAssertEqual(header, "__Secure-better-auth.session_token=ROTATED")
    }
    func testFailedReadbackNeverDeletesLegacy() async throws {
        let keychain = try syntheticKeychain(); keychain.failReadback = true
        let vault = CredentialVault(keychain: keychain, clock: clock)
        do { _ = try await vault.initialize(); XCTFail("Readback must succeed") } catch {}
        XCTAssertFalse(keychain.events.contains { $0.hasPrefix("delete:") })
    }
    func testStaleResponseAfterSignOutCannotRestoreCookie() async throws {
        let keychain = try syntheticKeychain()
        let vault = CredentialVault(keychain: keychain, clock: clock)
        let beforeSignOut = try await vault.capture()
        try await vault.signOutLocally()
        let response = HTTPURLResponse(url: URL(string: "https://api.invalid")!, statusCode: 200, httpVersion: nil,
            headerFields: ["Set-Cookie":"__Secure-better-auth.session_token=STALE; Max-Age=3600"])!
        try await vault.receive(response, for: beforeSignOut)
        let header = try await vault.cookieHeader(); XCTAssertNil(header)
    }
    func testMarkerReadFailureDefersWithoutSelectingOrOverwritingPrimaryRecord() async throws {
        let original = Data(#"{"version":99}"#.utf8)
        let keychain = AuthTestKeychain(rows: [CredentialVault.address: original])
        let marker = MemoryLogoutMarker()
        let vault = CredentialVault(keychain: keychain, clock: clock, logoutMarker: marker)
        try await vault.prepareExplicitAuthentication()
        try await vault.signOutLocally()
        keychain.readError = .keychainUnavailable(-25308)
        let restarted = CredentialVault(keychain: keychain, clock: clock, logoutMarker: marker)
        do { _ = try await restarted.initialize(); XCTFail("A locked recovery read must not select primary storage") }
        catch { XCTAssertEqual(error as? AuthFailure, .keychainUnavailable(-25308)) }
        keychain.readError = nil
        _ = try await restarted.initialize()
        try await restarted.signOutLocally()
        XCTAssertEqual(try keychain.read(CredentialVault.address), original)
        XCTAssertNotNil(try keychain.read(CredentialVault.recoveryAddress))
    }
    func testRepeatedDamagedRecoveryRecordsRemainPreservedAndRecoverable() async throws {
        let keychain = AuthTestKeychain(rows: [CredentialVault.address: Data("original unknown version".utf8)])
        for text in ["damaged recovery one", "damaged recovery two"] {
            try keychain.write(Data(text.utf8), at: CredentialVault.recoveryAddress)
            let restarted = CredentialVault(keychain: keychain, clock: clock)
            try await restarted.prepareExplicitAuthentication()
            let state = try await restarted.initialize()
            XCTAssertTrue(state.unknownLocalOwner == true)
        }
        let preserved = keychain.snapshot.filter { $0.key.key.hasPrefix("session.recovery.preserved.") }
        XCTAssertEqual(preserved.count, 2)
        XCTAssertEqual(Set(preserved.values), Set([Data("damaged recovery one".utf8), Data("damaged recovery two".utf8)]))
        XCTAssertEqual(try keychain.read(CredentialVault.address), Data("original unknown version".utf8))
        XCTAssertFalse(keychain.events.contains { $0.hasPrefix("delete:") })
    }
    func testKeychainQueryMatchesExpoDataAttributesAndNoSync() {
        let address = KeychainAddress(service: "app:no-auth", key: "skipper_cookie")
        let query = SystemKeychainStore.query(address)
        XCTAssertEqual(query[kSecAttrAccount as String] as? Data, Data("skipper_cookie".utf8))
        XCTAssertEqual(query[kSecAttrGeneric as String] as? Data, Data("skipper_cookie".utf8))
        XCTAssertEqual(query[kSecAttrSynchronizable as String] as? Bool, false)
    }
    func testCookieExpiresCommaAndMaxAgeDeletion() throws {
        var jar = CookieJar()
        let response = HTTPURLResponse(url: URL(string: "https://api.invalid")!, statusCode: 200, httpVersion: nil,
            headerFields: ["Set-Cookie":"better-auth.session_token=good; Expires=Thu, 01 Oct 2026 00:00:00 GMT, better-auth.session_data=gone; Max-Age=0"])!
        try jar.merge(response, at: clock.now())
        XCTAssertEqual(jar.header(at: clock.now()), "better-auth.session_token=good")
    }
}
