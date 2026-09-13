import Foundation

struct APIError: LocalizedError, Sendable, Equatable {
    let status: Int
    let code: String?
    let message: String
    var needsAccount: Bool { status == 401 }
    var errorDescription: String? { message }
}
struct ContractError: LocalizedError, Sendable {
    let message = "Please update Skipper to the latest version."
    var errorDescription: String? { message }
}
struct OfflineError: LocalizedError, Sendable {
    var errorDescription: String? {
        "No signal out here, and this one needs a bar or two. Try again when they’re back."
    }
}

/// Keep server guidance and known client guidance intact without exposing arbitrary transport details.
func userMessage(for error: Error, fallback: String) -> String {
    switch error {
    case let error as APIError: error.message
    case let error as ContractError: error.message
    case let error as OfflineError: error.localizedDescription
    default: fallback
    }
}
struct CredentialMigrationPending: Error, Sendable {}

struct SessionCookieSnapshot: Sendable { let header: String?; let generation: Int? }

protocol SessionCookieProvider: Sendable {
    /// This is an HTTP Cookie header, reconstructed from non-expired entries, never raw legacy JSON.
    func cookieHeader() async throws -> String?
    /// Persist rotated cookies before any legacy cleanup. Failure must be visible to the auth owner.
    func receive(_ response: HTTPURLResponse) async throws
    func capture() async throws -> SessionCookieSnapshot
    func didValidateOwnedDrives(_ ids: [String], for snapshot: SessionCookieSnapshot) async throws
    func receive(_ response: HTTPURLResponse, for snapshot: SessionCookieSnapshot) async throws
}
extension SessionCookieProvider {
    func didValidateOwnedDrives(_ ids: [String], for snapshot: SessionCookieSnapshot) async throws {}
    func capture() async throws -> SessionCookieSnapshot { .init(header: try await cookieHeader(), generation: nil) }
    func receive(_ response: HTTPURLResponse, for snapshot: SessionCookieSnapshot) async throws { try await receive(response) }
}
struct DeferredSessionCookies: SessionCookieProvider {
    func cookieHeader() async throws -> String? { throw CredentialMigrationPending() }
    func receive(_ response: HTTPURLResponse) async throws {}
}
struct EmptyCookieProvider: SessionCookieProvider {
    func cookieHeader() async throws -> String? { nil }
    func receive(_ response: HTTPURLResponse) async throws {}
}
protocol NetworkAvailability: Sendable { func isOffline() async -> Bool }
struct UnknownNetworkAvailability: NetworkAvailability { func isOffline() async -> Bool { false } }

protocol SkipperAPI: Sendable {
    func bootstrap(rotation: Int) async throws -> Bootstrap
    func listDrives() async throws -> DriveList
    func drive(id: String) async throws -> DriveManifest
    func propose(_ request: DriveProposeRequest) async throws -> DriveProposal
    func create(_ request: CreateDriveRequest) async throws -> DriveManifest
    func deleteDrive(id: String) async throws
    func setAccountPassword(_ password: String) async throws
    func version() async throws -> [VersionPolicy]
}

struct APIClient: SkipperAPI {
    let baseURL: URL
    let transport: any HTTPTransport
    let cookies: any SessionCookieProvider
    var network: any NetworkAvailability = UnknownNetworkAvailability()

    init(
        baseURL: URL,
        transport: any HTTPTransport,
        cookies: any SessionCookieProvider = EmptyCookieProvider(),
        network: any NetworkAvailability = UnknownNetworkAvailability()
    ) {
        self.baseURL = baseURL
        self.transport = transport
        self.cookies = cookies
        self.network = network
    }

    func bootstrap(rotation: Int) async throws -> Bootstrap {
        try await request("/bootstrap", query: [URLQueryItem(name: "rotation", value: String(rotation))], publicRead: true)
    }
    func listDrives() async throws -> DriveList {
        let credentials = try await cookies.capture()
        let result = try await perform("/drives", credentials: credentials)
        let list = try decodeContract(DriveList.self, from: result.data)
        try await cookies.didValidateOwnedDrives(list.drives.map(\.driveId), for: credentials)
        return list
    }
    func drive(id: String) async throws -> DriveManifest {
        let credentials = try await cookies.capture()
        let result = try await perform(drivePath(id), credentials: credentials)
        let detail = try decodeContract(DriveManifest.self, from: result.data)
        guard detail.driveId?.lowercased() == id.lowercased() else { throw ContractError() }
        try await cookies.didValidateOwnedDrives([id.lowercased()], for: credentials)
        return detail
    }
    func propose(_ value: DriveProposeRequest) async throws -> DriveProposal {
        guard !value.isDegenerate, isWireUUID(value.start), isWireUUID(value.end),
              (value.via?.count ?? 0) <= 8, value.via?.allSatisfy(isWireUUID) ?? true else { throw ContractError() }
        return try await request("/drives/propose", method: "POST", body: JSONEncoder().encode(value), publicRead: true)
    }
    func create(_ value: CreateDriveRequest) async throws -> DriveManifest {
        guard !value.isDegenerate, isWireUUID(value.start), isWireUUID(value.end),
              (value.via?.count ?? 0) <= 8, value.via?.allSatisfy(isWireUUID) ?? true else { throw ContractError() }
        return try await request("/drives", method: "POST", body: JSONEncoder().encode(value))
    }
    func deleteDrive(id: String) async throws { _ = try await perform(drivePath(id), method: "DELETE") }
    func setAccountPassword(_ password: String) async throws {
        struct Body: Encodable { let newPassword: String }
        _ = try await perform("/account/password", method: "POST", body: JSONEncoder().encode(Body(newPassword: password)))
    }
    func version() async throws -> [VersionPolicy] {
        let response: VersionResponse = try await request("/version", publicRead: true); return response.policies
    }
    private func drivePath(_ id: String) throws -> String {
        guard UUID(uuidString: id) != nil else { throw ContractError() }
        return "/drives/" + id
    }
    private func request<T: Decodable>(_ path: String, method: String = "GET", body: Data? = nil,
                                        query: [URLQueryItem] = [], publicRead: Bool = false) async throws -> T {
        let result = try await perform(path, method: method, body: body, query: query, publicRead: publicRead)
        return try decodeContract(T.self, from: result.data)
    }
    private func perform(_ path: String, method: String = "GET", body: Data? = nil,
                         query: [URLQueryItem] = [], publicRead: Bool = false, credentials providedCredentials: SessionCookieSnapshot? = nil) async throws -> HTTPResult {
        try Task.checkCancellation()
        if await network.isOffline() { throw OfflineError() }
        var request = try makeAPIRequest(baseURL: baseURL, path: path, method: method, body: body, query: query)
        // Public reads/proposals must remain usable while migration waits. They carry a known
        // session when available (bootstrap's admin release bypass), but never mint or guess one.
        let credentials: SessionCookieSnapshot?
        if let providedCredentials { credentials = providedCredentials }
        else if publicRead { credentials = try? await cookies.capture() }
        else { credentials = try await cookies.capture() }
        if let cookie = credentials?.header, !cookie.isEmpty { request.setValue(cookie, forHTTPHeaderField: "Cookie") }
        let result = try await transport.send(request)
        if let credentials { try await cookies.receive(result.response, for: credentials) }
        try requireSuccess(result)
        return result
    }
}

func makeAPIRequest(baseURL: URL, path: String, method: String, body: Data? = nil,
                    query: [URLQueryItem] = []) throws -> URLRequest {
    guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false),
          let scheme = components.scheme, ["https", "http"].contains(scheme), components.host != nil else { throw ContractError() }
    components.path = components.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    components.path = "/" + [components.path, path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))].filter { !$0.isEmpty }.joined(separator: "/")
    components.queryItems = query.isEmpty ? nil : query
    guard let url = components.url else { throw ContractError() }
    var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
    request.httpMethod = method; request.httpBody = body; request.httpShouldHandleCookies = false
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    return request
}
func decodeContract<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
    do { return try JSONDecoder().decode(type, from: data) } catch { throw ContractError() }
}
func requireSuccess(_ result: HTTPResult) throws {
    guard !(200...299).contains(result.response.statusCode) else { return }
    struct Envelope: Decodable { let error: String?; let code: String?; let message: String? }
    let envelope = try? JSONDecoder().decode(Envelope.self, from: result.data)
    throw APIError(status: result.response.statusCode, code: envelope?.error ?? envelope?.code,
                   message: envelope?.message ?? "Request failed (\(result.response.statusCode))")
}
