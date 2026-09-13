import XCTest
@testable import Skipper

private final class AuthHTTPRecorder: HTTPTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var requests: [URLRequest] = []
    var body = Data("{}".utf8)
    var status = 200
    var headers: [String: String] = [:]
    var beforeResponse: (@Sendable () async -> Void)?
    func open(_ request: URLRequest, timeouts: RequestTimeouts) -> HTTPStream {
        lock.lock(); requests.append(request); lock.unlock()
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: headers)!
        let bytes = body, beforeResponse = beforeResponse
        return HTTPStream(events: AsyncThrowingStream { continuation in
            Task {
                await beforeResponse?()
                continuation.yield(.response(response)); continuation.yield(.bytes(bytes)); continuation.finish()
            }
        }, cancel: {})
    }
    var recorded: [URLRequest] { lock.lock(); defer { lock.unlock() }; return requests }
}

final class AuthClientTests: XCTestCase {
    private let clock = FixedAuthClock(date: authDate("2026-09-12T12:00:00Z")!)
    func testShippedEndpointsOriginAndExplicitCookieContract() async throws {
        let transport = AuthHTTPRecorder()
        let vault = CredentialVault(keychain: try syntheticKeychain(), clock: clock)
        let client = AuthClient(baseURL: URL(string: "https://api.invalid")!, transport: transport, vault: vault)
        try await client.sendCode(email: "rider@example.invalid")
        try await client.signIn(email: "rider@example.invalid", code: "123456")
        try await client.signIn(email: "rider@example.invalid", password: "synthetic-password")
        try await client.requestPasswordReset(email: "rider@example.invalid")
        try await client.updateName("Fixture")
        try await client.verifyDeletionCode(email: "rider@example.invalid", code: "123456")
        try await client.deleteAccount(password: nil)
        try await client.signOut(cookie: "captured=synthetic")
        let requests = transport.recorded
        XCTAssertEqual(requests.map { $0.url!.path }, [
            "/api/auth/email-otp/send-verification-otp", "/api/auth/sign-in/email-otp",
            "/api/auth/sign-in/email", "/api/auth/request-password-reset", "/api/auth/update-user",
            "/api/auth/email-otp/check-verification-otp", "/api/auth/delete-user", "/api/auth/sign-out"
        ])
        for request in requests {
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "expo-origin"), "skipper://")
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-skip-oauth-proxy"), "true")
            XCTAssertNil(request.value(forHTTPHeaderField: "Origin"))
            XCTAssertFalse(request.httpShouldHandleCookies)
        }
        XCTAssertEqual(requests[0].value(forHTTPHeaderField: "Cookie"), "__Secure-better-auth.session_token=SYNTHETIC")
        XCTAssertEqual(requests.last?.value(forHTTPHeaderField: "Cookie"), "captured=synthetic")
        let first = try JSONSerialization.jsonObject(with: requests[0].httpBody!) as! [String: String]
        XCTAssertEqual(first, ["email": "rider@example.invalid", "type": "sign-in"])
        let reset = try JSONSerialization.jsonObject(with: requests[3].httpBody!) as! [String: String]
        XCTAssertEqual(reset["redirectTo"], "https://skipper.fm/reset-password")
        XCTAssertEqual(try JSONSerialization.jsonObject(with: requests[6].httpBody!) as? [String: String], [:])
    }

    func testLateSessionResponseCannotRestoreSignedOutIdentity() async throws {
        let transport = AuthHTTPRecorder()
        let vault = CredentialVault(keychain: try syntheticKeychain(), clock: clock)
        transport.body = try JSONEncoder().encode(syntheticSession())
        transport.headers = ["Set-Cookie": "__Secure-better-auth.session_token=STALE; Max-Age=3600"]
        transport.beforeResponse = { try? await vault.signOutLocally() }
        let client = AuthClient(baseURL: URL(string: "https://api.invalid")!, transport: transport, vault: vault)
        do { _ = try await client.session(); XCTFail("A late get-session response must fail its generation check") }
        catch { XCTAssertEqual(error as? AuthFailure, .operationInProgress) }
        let restored = try await vault.initialize()
        XCTAssertNil(restored.session); XCTAssertTrue(restored.explicitlySignedOut)
        let header = try await vault.cookieHeader(); XCTAssertNil(header)
    }

    func testExplicitRecoveryPreservesDamagedBytesAndRequiresPerDriveOwnerEvidence() async throws {
        let original = Data(#"{"version":99,"future":"preserve exactly"}"#.utf8)
        let keychain = AuthTestKeychain(rows: [CredentialVault.address: original])
        let vault = CredentialVault(keychain: keychain, clock: clock)
        do { _ = try await vault.initialize(); XCTFail("Unknown native version must defer") } catch {}
        let transport = AuthHTTPRecorder()
        transport.headers = ["Set-Cookie": "__Secure-better-auth.session_token=RECOVERED; Max-Age=3600"]
        let client = AuthClient(baseURL: URL(string: "https://api.invalid")!, transport: transport, vault: vault)
        try await client.signIn(email: "rider@example.invalid", password: "synthetic-password")
        transport.body = try JSONEncoder().encode(syntheticSession())
        _ = try await client.session()
        XCTAssertEqual(try keychain.read(CredentialVault.address), original)
        XCTAssertFalse(keychain.events.contains { $0.hasPrefix("delete:") })
        let id = "00000002-0000-4000-8000-000000000001"
        let before = try await vault.canAccessLocalDrive(id, userID: "fixture-user"); XCTAssertFalse(before)
        transport.body = Data(#"{"drives":[{"driveId":"00000002-0000-4000-8000-000000000001","label":"Owned","clipCount":1,"createdAt":"2026-09-12T12:00Z"}]}"#.utf8)
        _ = try await APIClient(baseURL: URL(string: "https://api.invalid")!, transport: transport, cookies: vault).listDrives()
        let after = try await vault.canAccessLocalDrive(id, userID: "fixture-user"); XCTAssertTrue(after)
        let other = try await vault.canAccessLocalDrive("00000002-0000-4000-8000-000000000002", userID: "fixture-user")
        XCTAssertFalse(other)
        let relaunched = CredentialVault(keychain: keychain, clock: clock)
        let persisted = try await relaunched.canAccessLocalDrive(id, userID: "fixture-user"); XCTAssertTrue(persisted)
    }
    func testMalformedLegacyRowsCanExplicitlyAuthenticateButRemainPreserved() async throws {
        for damaged in ["", "bad-json", "\u{0001}ba-chunks:bad", "\u{0001}ba-chunks:2"] {
            let address = KeychainAddress(service: "app:no-auth", key: "skipper_cookie")
            let original = Data(damaged.utf8)
            let keychain = AuthTestKeychain(rows: [address: original])
            let vault = CredentialVault(keychain: keychain, clock: clock)
            let transport = AuthHTTPRecorder()
            let client = AuthClient(baseURL: URL(string: "https://api.invalid")!, transport: transport, vault: vault)
            try await client.sendCode(email: "rider@example.invalid")
            XCTAssertEqual(transport.recorded.count, 1)
            XCTAssertNil(transport.recorded.first?.value(forHTTPHeaderField: "Cookie"))
            XCTAssertEqual(try keychain.read(address), original)
            let state = try await vault.initialize()
            XCTAssertTrue(state.unknownLocalOwner == true); XCTAssertNil(state.session)
        }
    }
    func testLockedKeychainCannotEnterCorruptionRecovery() async throws {
        let keychain = AuthTestKeychain(); keychain.readError = .keychainUnavailable(-25308)
        let vault = CredentialVault(keychain: keychain, clock: clock)
        let transport = AuthHTTPRecorder()
        let client = AuthClient(baseURL: URL(string: "https://api.invalid")!, transport: transport, vault: vault)
        do { try await client.sendCode(email: "rider@example.invalid"); XCTFail("Transient lock must defer") }
        catch { XCTAssertEqual(error as? AuthFailure, .keychainUnavailable(-25308)) }
        XCTAssertTrue(transport.recorded.isEmpty)
        XCTAssertFalse(keychain.events.contains { $0.hasPrefix("write:") || $0.hasPrefix("delete:") })
    }

    func testServerRejectionPreservesCredentialsAndDoesNotRetry() async throws {
        let transport = AuthHTTPRecorder(); transport.status = 401
        transport.body = Data(#"{"code":"INVALID_OTP","message":"Invalid code"}"#.utf8)
        let keychain = try syntheticKeychain()
        let vault = CredentialVault(keychain: keychain, clock: clock)
        let client = AuthClient(baseURL: URL(string: "https://api.invalid")!, transport: transport, vault: vault)
        do { try await client.signIn(email: "rider@example.invalid", code: "123456"); XCTFail("Must reject") }
        catch { XCTAssertEqual(error as? APIError, APIError(status: 401, code: "INVALID_OTP", message: "Invalid code")) }
        XCTAssertEqual(transport.recorded.count, 1)
        XCTAssertFalse(keychain.events.contains { $0.hasPrefix("delete:") })
        let header = try await vault.cookieHeader(); XCTAssertNotNil(header)
    }
}
