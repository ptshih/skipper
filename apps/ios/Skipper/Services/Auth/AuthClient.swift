import Foundation

protocol AuthenticationService: Sendable {
    func session() async throws -> SessionSnapshot?
    func signInAnonymously() async throws
    func sendCode(email: String) async throws
    func signIn(email: String, code: String) async throws
    func signIn(email: String, password: String) async throws
    func requestPasswordReset(email: String) async throws
    func updateName(_ name: String) async throws
    func accounts() async throws -> [LinkedAccount]
    func verifyDeletionCode(email: String, code: String) async throws
    func deleteAccount(password: String?) async throws
    func signOut(cookie: String?) async throws
}

struct AuthClient: AuthenticationService {
    let baseURL: URL
    let transport: any HTTPTransport
    let vault: CredentialVault
    var network: any NetworkAvailability = UnknownNetworkAvailability()

    func session() async throws -> SessionSnapshot? {
        let credentials = try await vault.capture()
        let data = try await request("/get-session", method: "GET", credentials: credentials)
        let session = try decodeContract(Optional<SessionSnapshot>.self, from: data)
        if let session {
            guard !session.user.id.isEmpty, !session.session.id.isEmpty, session.user.id == session.session.userId,
                  authDate(session.session.expiresAt) != nil else { throw ContractError() }
        }
        try await vault.acceptSession(session, generation: credentials.generation)
        return session
    }
    func signInAnonymously() async throws { _ = try await request("/sign-in/anonymous", body: EmptyBody()) }
    func sendCode(email: String) async throws {
        try await vault.prepareExplicitAuthentication()
        _ = try await request("/email-otp/send-verification-otp", body: OTPBody(email: email, type: "sign-in", otp: nil))
    }
    func signIn(email: String, code: String) async throws {
        try await vault.prepareExplicitAuthentication()
        struct Body: Encodable { let email: String; let otp: String }
        _ = try await request("/sign-in/email-otp", body: Body(email: email, otp: code))
    }
    func signIn(email: String, password: String) async throws {
        try await vault.prepareExplicitAuthentication()
        struct Body: Encodable { let email: String; let password: String }
        _ = try await request("/sign-in/email", body: Body(email: email, password: password))
    }
    func requestPasswordReset(email: String) async throws {
        try await vault.prepareExplicitAuthentication()
        struct Body: Encodable { let email: String; let redirectTo: String }
        _ = try await request("/request-password-reset", body: Body(email: email, redirectTo: "https://skipper.fm/reset-password"))
    }
    func updateName(_ name: String) async throws {
        struct Body: Encodable { let name: String }
        _ = try await request("/update-user", body: Body(name: name))
    }
    func accounts() async throws -> [LinkedAccount] {
        try decodeContract([LinkedAccount].self, from: await request("/list-accounts", method: "GET"))
    }
    func verifyDeletionCode(email: String, code: String) async throws {
        _ = try await request("/email-otp/check-verification-otp", body: OTPBody(email: email, type: "sign-in", otp: code))
    }
    func deleteAccount(password: String?) async throws {
        struct Body: Encodable { let password: String? }
        _ = try await request("/delete-user", method: "POST", data: JSONEncoder().encode(Body(password: password)), persistCookies: false)
    }
    func signOut(cookie: String?) async throws {
        // Local purge/sentinel happen first. Sending this captured header can revoke the old session,
        // but its response must never repopulate the newly cleared jar.
        var request = try authRequest("/sign-out", method: "POST", data: Data("{}".utf8))
        if let cookie { request.setValue(cookie, forHTTPHeaderField: "Cookie") }
        let result = try await transport.send(request)
        try requireSuccess(result)
    }
    private struct EmptyBody: Encodable {}
    private struct OTPBody: Encodable { let email: String; let type: String; let otp: String? }
    private func request<B: Encodable>(_ path: String, body: B) async throws -> Data {
        try await request(path, method: "POST", data: JSONEncoder().encode(body))
    }
    private func request(_ path: String, method: String, data: Data? = nil, persistCookies: Bool = true, credentials providedCredentials: SessionCookieSnapshot? = nil) async throws -> Data {
        try Task.checkCancellation()
        if await network.isOffline() { throw OfflineError() }
        let credentials: SessionCookieSnapshot
        if let providedCredentials { credentials = providedCredentials }
        else { credentials = try await vault.capture() }
        var request = try authRequest(path, method: method, data: data)
        if let cookie = credentials.header { request.setValue(cookie, forHTTPHeaderField: "Cookie") }
        let result = try await transport.send(request)
        // Persist rotation before accepting session state or cleaning up any migration source.
        if persistCookies { try await vault.receive(result.response, for: credentials) }
        try requireSuccess(result)
        return result.data
    }
    private func authRequest(_ path: String, method: String, data: Data?) throws -> URLRequest {
        var request = try makeAPIRequest(baseURL: baseURL, path: "/api/auth" + path, method: method, body: data)
        // The existing server's Expo plugin promotes expo-origin to Origin. Preserve its exact
        // protocol while the application runtime itself is now entirely native.
        request.setValue("skipper://", forHTTPHeaderField: "expo-origin")
        request.setValue("true", forHTTPHeaderField: "x-skip-oauth-proxy")
        return request
    }
}
