import Foundation

protocol AppClock: Sendable { func now() -> Date }
struct SystemAppClock: AppClock { func now() -> Date { Date() } }

struct SessionUser: Codable, Sendable, Equatable, Identifiable {
    let id: String
    let name: String
    let email: String
    let emailVerified: Bool
    let isAnonymous: Bool?
    let role: String?
    let createdAt: String?
    let updatedAt: String?
    var isAccount: Bool { isAnonymous != true }
    var isAdmin: Bool { isAccount && role == "admin" }
}
struct SessionDetails: Codable, Sendable, Equatable {
    let id: String
    let userId: String
    let expiresAt: String
    let token: String?
    let createdAt: String?
    let updatedAt: String?
}
struct SessionSnapshot: Codable, Sendable, Equatable {
    let user: SessionUser
    let session: SessionDetails
    func isFresh(at date: Date) -> Bool {
        !user.id.isEmpty && !session.id.isEmpty && session.userId == user.id &&
        (authDate(session.expiresAt).map { $0 > date } ?? false)
    }
}
struct LinkedAccount: Decodable, Sendable { let providerId: String }

enum SessionState: Sendable, Equatable {
    case loading
    case deferred
    case signedOut
    case anonymous(SessionSnapshot)
    case signedIn(SessionSnapshot)
    var snapshot: SessionSnapshot? {
        switch self { case .signedIn(let value), .anonymous(let value): value; default: nil }
    }
    var isSignedIn: Bool { if case .signedIn = self { true } else { false } }
}
enum AuthFailure: Error, Sendable, Equatable {
    case malformedCredentials, incompleteLegacyChunks, keychainUnavailable(Int32), verificationFailed
    case migrationPending, operationInProgress, accountRequired, sessionUnavailable, unsupportedEmailChange
}

func authDate(_ value: String) -> Date? {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = formatter.date(from: value) { return date }
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.date(from: value)
}
