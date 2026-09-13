import Foundation
import Observation

/// Keeps each account action's result beside its control, including failures before a session exists.
@MainActor @Observable
final class SettingsRequestState {
    private(set) var isRunning = false
    private(set) var errorMessage: String?
    private(set) var errorCode: String?
    private(set) var successMessage: String?

    func clearResult() {
        errorMessage = nil
        errorCode = nil
        successMessage = nil
    }

    @discardableResult
    func run(success: String? = nil, operation: () async throws -> Void) async -> Bool {
        guard !isRunning else { return false }
        isRunning = true
        clearResult()
        defer { isRunning = false }
        do {
            try await operation()
            successMessage = success
            return true
        } catch is CancellationError {
            return false
        } catch let error as APIError {
            errorMessage = error.message
            errorCode = error.code
        } catch let error as ContractError {
            errorMessage = error.message
        } catch {
            errorMessage = "That didn’t go through. Please try again."
        }
        return false
    }
}

@MainActor @Observable
final class SettingsPasswordState {
    var hasPassword = false
    let request = SettingsRequestState()

    /// `/account/password` only creates a credential. Existing credentials use the reset email flow.
    @discardableResult
    func submit(newPassword: String, setPassword: (String) async throws -> Void,
                requestReset: () async throws -> Void) async -> Bool {
        if hasPassword {
            return await request.run(success: "Check your email for a link to change your password.", operation: requestReset)
        }
        guard newPassword.count >= 8 else { return false }
        let saved = await request.run(success: "Password set. You can now sign in with a password or an emailed code.") {
            try await setPassword(newPassword)
        }
        // An account lookup can fail offline. The server remains authoritative and gives a recovery path.
        if saved || request.errorCode == "password_already_set" { hasPassword = true }
        return saved
    }

    /// Retains last known capability when the lookup is unknown (nil).
    func applyLookupResult(_ result: Bool?) {
        if let result {
            hasPassword = result
        }
    }
}
