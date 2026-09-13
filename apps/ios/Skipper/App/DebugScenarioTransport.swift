#if DEBUG
import Foundation

/// A deterministic local server boundary. It records bounded outcomes, never headers or prose.
final class DebugScenarioTransport: HTTPTransport, @unchecked Sendable {
    private struct State: Codable {
        var signedIn = false
        var planRequests = 0
        var proposalRequests = 0
        var createRequests = 0
        var committedDrives = 0
        var keys: [String] = []
        var allCreateKeysLowercaseUUID = true
        var sameRouteEveryAttempt = true
        var anonymousMintRequests = 0
        var unexpectedRequests = 0
        var createRequestsBeforeSignIn = 0
        var purgeCalls = 0
        // Optional fields preserve same-run receipts written before this fixture seam existed.
        var versionRequests: Int?
        var planStreamBarrierReached: Bool?
        var planStreamCancellations: Int?
        var planStreamTerminalDeliveries: Int?
        var passwordRequests: Int?
        var passwordResetRequests: Int?
        var deleteCodeSendRequests: Int?
        var deleteCodeVerifyRequests: Int?
        var deleteAccountRequests: Int?
        var signOutRequests: Int?
        var explicitlySignedOut: Bool?
        var anonymousMinted: Bool?
    }
    private struct Reply: Sendable {
        var status = 200
        var headers: [String: String] = ["Content-Type": "application/json"]
        var chunks: [Data] = []
        var delays: [Int] = []
        var disconnect = false
        var isPlan = false
        var holdAfterChunkIndex: Int?
    }
    private let lock = NSLock()
    private let input: [String: Any]
    private let root: URL
    private var state: State
    private var firstRoute: Data?
    init(input: [String: Any], root: URL) throws {
        self.input = input; self.root = root
        let stateURL = root.appendingPathComponent("mock-server.json")
        if FileManager.default.fileExists(atPath: stateURL.path) {
            state = try JSONDecoder().decode(State.self, from: Data(contentsOf: stateURL))
        } else { state = State() }
        try persist()
    }
    func open(_ request: URLRequest, timeouts: RequestTimeouts) -> HTTPStream {
        let reply: Reply
        do { reply = try prepare(request) }
        catch { return HTTPStream(events: AsyncThrowingStream { $0.finish(throwing: error) }, cancel: {}) }
        let task = DebugStreamTask()
        let events = AsyncThrowingStream<HTTPStreamEvent, Error> { continuation in
            let work = Task {
                do {
                    if reply.disconnect { throw URLError(.networkConnectionLost) }
                    let response = HTTPURLResponse(url: request.url!, statusCode: reply.status, httpVersion: nil, headerFields: reply.headers)!
                    continuation.yield(.response(response))
                    var parser = SSEParser()
                    for (index, bytes) in reply.chunks.enumerated() {
                        let delay = index < reply.delays.count ? reply.delays[index] : 0
                        if delay > 0 { try await Task.sleep(for: .milliseconds(delay)) }
                        try Task.checkCancellation()
                        if case .terminated = continuation.yield(.bytes(bytes)) { throw CancellationError() }
                        if reply.isPlan {
                            recordPlanEvent(terminals: parser.push(bytes).filter { $0.event == "turn" }.count)
                        }
                        if reply.holdAfterChunkIndex == index {
                            recordPlanEvent(barrier: true)
                            // No wall-clock release: only actual cancellation can unblock this stream.
                            try await DebugCancellationBarrier().wait()
                        }
                    }
                    continuation.finish()
                } catch {
                    if reply.isPlan, error is CancellationError { recordPlanEvent(cancelled: true) }
                    continuation.finish(throwing: error)
                }
            }
            task.set(work)
            continuation.onTermination = { _ in task.cancel() }
        }
        return HTTPStream(events: events, cancel: { task.cancel() })
    }
    func recordPurge() { lock.lock(); defer { lock.unlock() }; state.purgeCalls += 1; try? persist() }
    private func recordPlanEvent(barrier: Bool = false, cancelled: Bool = false, terminals: Int = 0) {
        lock.lock(); defer { lock.unlock() }
        if barrier { state.planStreamBarrierReached = true }
        if cancelled { state.planStreamCancellations = (state.planStreamCancellations ?? 0) + 1 }
        state.planStreamTerminalDeliveries = (state.planStreamTerminalDeliveries ?? 0) + terminals
        try? persist()
    }
    private func prepare(_ request: URLRequest) throws -> Reply {
        lock.lock(); defer { lock.unlock(); }
        defer { try? persist() }
        guard request.url?.host == "api.invalid" else { return try unexpected() }
        let route = (request.httpMethod ?? "GET") + " " + (request.url?.path ?? "")
        let responses = input["responses"] as? [String: Any] ?? [:]
        let isLifecycle = input["lifecycleScenario"] as? Bool == true
        func json(_ value: Any, status: Int = 200, cookie: Bool = false) throws -> Reply {
            var result = Reply(status: status, chunks: [try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed, .sortedKeys])])
            if cookie { result.headers["Set-Cookie"] = "__Secure-better-auth.session_token=SYNTHETIC-UI-ACCOUNT; Max-Age=86400; Path=/; Secure" }
            return result
        }
        switch route {
        case "GET /api/auth/get-session":
            if isLifecycle, state.explicitlySignedOut == true {
                let value = (state.anonymousMinted == true) ? input["guestSession"] : nil
                return try json(value ?? NSNull())
            }
            let value = state.signedIn ? input["signedInSession"] : input["initialSession"]
            return try json(value ?? NSNull())
        case "POST /account/password":
            guard isLifecycle else { return try unexpected() }
            state.passwordRequests = (state.passwordRequests ?? 0) + 1
            if state.passwordRequests == 1 {
                return try json([
                    "error": "password_already_set",
                    "message": "This account already has a password. Use password reset to change it."
                ], status: 409)
            }
            return try json(["success": true])
        case "POST /api/auth/request-password-reset":
            guard isLifecycle else { return try unexpected() }
            state.passwordResetRequests = (state.passwordResetRequests ?? 0) + 1
            return try json(["success": true])
        case "POST /api/auth/email-otp/send-verification-otp":
            // Generic BetterAuth OTP issuance endpoint; used across sign-in and account deletion verification flows.
            let body = try requestBody(request)
            guard body["email"] as? String == input["email"] as? String, body["type"] as? String == "sign-in" else { return try unexpected() }
            if isLifecycle { state.deleteCodeSendRequests = (state.deleteCodeSendRequests ?? 0) + 1 }
            return try json(["success": true])
        case "POST /api/auth/email-otp/check-verification-otp":
            guard isLifecycle else { return try unexpected() }
            state.deleteCodeVerifyRequests = (state.deleteCodeVerifyRequests ?? 0) + 1
            let body = try requestBody(request)
            guard body["email"] as? String == input["email"] as? String,
                  body["otp"] as? String == (input["otp"] as? String ?? "123456") else {
                return try json(["code": "INVALID_OTP", "message": "Invalid fixture code"], status: 400)
            }
            return try json(["success": true])
        case "POST /api/auth/delete-user":
            guard isLifecycle else { return try unexpected() }
            state.deleteAccountRequests = (state.deleteAccountRequests ?? 0) + 1
            state.signedIn = false
            state.explicitlySignedOut = true
            return try json(["success": true])
        case "POST /api/auth/sign-out":
            guard isLifecycle else { return try unexpected() }
            state.signOutRequests = (state.signOutRequests ?? 0) + 1
            state.signedIn = false
            state.explicitlySignedOut = true
            return try json(["success": true])
        case "POST /api/auth/sign-in/email-otp":
            let body = try requestBody(request)
            guard body["email"] as? String == input["email"] as? String, body["otp"] as? String == input["otp"] as? String else {
                return try json(["code": "INVALID_OTP", "message": "Invalid fixture code"], status: 400)
            }
            state.signedIn = true
            state.explicitlySignedOut = false
            state.anonymousMinted = false
            return try json(input["signedInSession"] ?? NSNull(), cookie: true)
        case "POST /api/auth/sign-in/anonymous":
            state.anonymousMintRequests += 1
            if isLifecycle, let guest = input["guestSession"] {
                state.anonymousMinted = true
                var reply = try json(guest, status: 200)
                reply.headers["Set-Cookie"] = "__Secure-better-auth.session_token=SYNTHETIC-GUEST-TOKEN; Max-Age=86400; Path=/; Secure"
                return reply
            }
            return try unexpected()
        case "GET /api/auth/list-accounts": return try json([])
        case "GET /bootstrap": return try json(responses["bootstrap"] ?? ["regions": []])
        case "GET /version":
            state.versionRequests = (state.versionRequests ?? 0) + 1
            var reply = try json(responses["version"] ?? ["policies": []])
            if let delay = input["versionDelayMs"] as? Int {
                guard (0...30_000).contains(delay) else { throw ContractError() }
                reply.delays = [delay]
            }
            return reply
        case "GET /drives":
            let initialMember = (input["initialSession"] as? [String: Any])?["user"].flatMap({ $0 as? [String: Any] })?["isAnonymous"] as? Bool == false
            if isLifecycle {
                guard (state.signedIn || initialMember), !(state.explicitlySignedOut ?? false), !(state.anonymousMinted ?? false) else {
                    return try json(["error": "account_required"], status: 401)
                }
            } else {
                guard state.signedIn || initialMember else {
                    return try json(["error": "account_required"], status: 401)
                }
            }
            return try json(responses["ownedDrives"] ?? input["ownedDrives"] ?? ["drives": []])
        case "POST /drives/plan":
            state.planRequests += 1
            guard let stream = input["stream"] as? [String: Any], let chunks = stream["chunks"] as? [[UInt8]],
                  let delays = stream["delayBeforeChunkMs"] as? [Int] else { return try unexpected() }
            let hold = stream["holdAfterChunkIndex"] as? Int
            if stream["holdAfterChunkIndex"] != nil {
                guard let hold, chunks.indices.contains(hold) else { throw ContractError() }
            }
            return Reply(headers: ["Content-Type": "text/event-stream"], chunks: chunks.map { Data($0) }, delays: delays,
                         isPlan: true, holdAfterChunkIndex: hold)
        case "POST /drives/propose":
            state.proposalRequests += 1
            guard let proposal = responses["proposal"] else { return try unexpected() }
            return try json(proposal)
        case "POST /drives":
            state.createRequests += 1
            guard state.signedIn else {
                state.createRequestsBeforeSignIn += 1
                return try json(["error": "account_required"], status: 401)
            }
            var body = try requestBody(request)
            guard let key = body.removeValue(forKey: "idempotencyKey") as? String else { return try unexpected() }
            state.keys.append(key)
            let valid = UUID(uuidString: key) != nil && key == key.lowercased()
            state.allCreateKeysLowercaseUUID = state.allCreateKeysLowercaseUUID && valid
            let routeBytes = try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
            if let firstRoute, firstRoute != routeBytes { state.sameRouteEveryAttempt = false }
            else if firstRoute == nil { firstRoute = routeBytes }
            guard valid, Set(state.keys).count == 1, state.sameRouteEveryAttempt,
                  let manifest = responses["createdManifest"] else { return try unexpected() }
            if state.createRequests == 1 {
                if input["firstCreate"] as? String == "reject-before-commit" {
                    return try json(["error": "synthetic_retry", "message": "Please retry"], status: 503)
                }
                if input["firstCreate"] as? String == "commit-then-disconnect" {
                    state.committedDrives = 1
                    return Reply(disconnect: true)
                }
            }
            state.committedDrives = 1
            return try json(manifest)
        default:
            if request.httpMethod == "GET", let manifest = responses["createdManifest"] as? [String: Any],
               let id = manifest["driveId"] as? String, request.url?.path == "/drives/" + id,
               state.signedIn, state.committedDrives == 1 { return try json(manifest) }
            return try unexpected()
        }
    }
    private func requestBody(_ request: URLRequest) throws -> [String: Any] {
        guard let body = request.httpBody, let value = try JSONSerialization.jsonObject(with: body) as? [String: Any] else { throw ContractError() }
        return value
    }
    private func unexpected() throws -> Reply {
        state.unexpectedRequests += 1
        return Reply(status: 500, chunks: [Data(#"{"error":"unexpected_fixture_request"}"#.utf8)])
    }
    private func persist() throws {
        try JSONEncoder().encode(state).write(to: root.appendingPathComponent("mock-server.json"), options: .atomic)
        let ids = ((try? FileManager.default.contentsOfDirectory(atPath: root.appendingPathComponent("drives").path)) ?? [])
            .filter { UUID(uuidString: $0) != nil }.sorted()
        let receipt: [String: Any] = ["versionRequests": state.versionRequests ?? 0,
            "planRequests": state.planRequests, "proposalRequests": state.proposalRequests,
            "createRequests": state.createRequests, "committedDrives": state.committedDrives,
            "distinctCreateKeys": Set(state.keys).count, "allCreateKeysLowercaseUUID": state.allCreateKeysLowercaseUUID,
            "sameRouteEveryAttempt": state.sameRouteEveryAttempt, "createRequestsBeforeSignIn": state.createRequestsBeforeSignIn,
            "anonymousMintRequests": state.anonymousMintRequests, "unexpectedRequests": state.unexpectedRequests,
            "purgeCalls": state.purgeCalls, "localDriveDirectoryIds": ids,
            "planStreamBarrierReached": state.planStreamBarrierReached ?? false,
            "planStreamCancellations": state.planStreamCancellations ?? 0,
            "planStreamTerminalDeliveries": state.planStreamTerminalDeliveries ?? 0,
            "passwordRequests": state.passwordRequests ?? 0,
            "passwordResetRequests": state.passwordResetRequests ?? 0,
            "deleteCodeSendRequests": state.deleteCodeSendRequests ?? 0,
            "deleteCodeVerifyRequests": state.deleteCodeVerifyRequests ?? 0,
            "deleteAccountRequests": state.deleteAccountRequests ?? 0,
            "signOutRequests": state.signOutRequests ?? 0,
            "explicitlySignedOut": state.explicitlySignedOut ?? false,
            "anonymousMinted": state.anonymousMinted ?? false]
        try JSONSerialization.data(withJSONObject: receipt, options: [.sortedKeys]).write(to: root.appendingPathComponent("qa-receipt.json"), options: .atomic)
    }
}
private final class DebugStreamTask: @unchecked Sendable {
    private let lock = NSLock()
    private var task: Task<Void, Never>?
    private var cancelled = false
    func set(_ value: Task<Void, Never>) { lock.lock(); defer { lock.unlock() }; task = value; if cancelled { value.cancel() } }
    func cancel() { lock.lock(); defer { lock.unlock() }; cancelled = true; task?.cancel() }
}
/// Handles cancellation both before and after continuation installation, exactly once.
private final class DebugCancellationBarrier: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Void, Error>?
    private var cancelled = false
    func wait() async throws {
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { install($0) }
        } onCancel: { self.cancel() }
    }
    private func install(_ value: CheckedContinuation<Void, Error>) {
        lock.lock()
        if cancelled { lock.unlock(); value.resume(throwing: CancellationError()) }
        else { continuation = value; lock.unlock() }
    }
    private func cancel() {
        lock.lock(); cancelled = true
        let value = continuation; continuation = nil; lock.unlock()
        value?.resume(throwing: CancellationError())
    }
}
#endif
