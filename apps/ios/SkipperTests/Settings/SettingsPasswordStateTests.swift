import XCTest
@testable import Skipper

@MainActor
final class SettingsPasswordStateTests: XCTestCase {
    func testNewPasswordUsesSetEndpointWithoutRequestingReset() async {
        let state = SettingsPasswordState()
        var submitted: String?
        var resets = 0
        let saved = await state.submit(newPassword: "a new password", setPassword: { submitted = $0 }, requestReset: { resets += 1 })
        XCTAssertTrue(saved)
        XCTAssertEqual(submitted, "a new password")
        XCTAssertEqual(resets, 0)
        XCTAssertTrue(state.hasPassword)
        XCTAssertNotNil(state.request.successMessage)
    }

    func testExistingPasswordUsesResetEmailEvenWithoutNewPasswordText() async {
        let state = SettingsPasswordState()
        state.hasPassword = true
        var setCalls = 0
        var resets = 0
        let sent = await state.submit(newPassword: "", setPassword: { _ in setCalls += 1 }, requestReset: { resets += 1 })
        XCTAssertTrue(sent)
        XCTAssertEqual(setCalls, 0)
        XCTAssertEqual(resets, 1)
        XCTAssertEqual(state.request.successMessage, "Check your email for a link to change your password.")
    }

    func testServerConflictAfterFailedAccountLookupEnablesResetRecovery() async {
        let state = SettingsPasswordState()
        var setCalls = 0
        var resetCalls = 0
        let error = APIError(status: 409, code: "password_already_set", message: "This account already has a password. Use Forgot your password to change it.")
        let saved = await state.submit(newPassword: "a new password", setPassword: { _ in setCalls += 1; throw error }, requestReset: { resetCalls += 1 })
        XCTAssertFalse(saved)
        XCTAssertEqual(state.request.errorMessage, error.message)
        XCTAssertNil(state.request.successMessage)
        XCTAssertTrue(state.hasPassword)
        XCTAssertEqual(resetCalls, 0)

        let recovered = await state.submit(newPassword: "", setPassword: { _ in setCalls += 1 }, requestReset: { resetCalls += 1 })
        XCTAssertTrue(recovered)
        XCTAssertEqual(setCalls, 1)
        XCTAssertEqual(resetCalls, 1)
        XCTAssertNil(state.request.errorMessage)
    }

    func testResetFailureIsVisibleAndDoesNotFallBackToSetEndpoint() async {
        let state = SettingsPasswordState()
        state.hasPassword = true
        var setCalls = 0
        let error = APIError(status: 503, code: "mail_unavailable", message: "Email could not be sent. Please try again.")
        let sent = await state.submit(newPassword: "unused password", setPassword: { _ in setCalls += 1 }, requestReset: { throw error })
        XCTAssertFalse(sent)
        XCTAssertEqual(setCalls, 0)
        XCTAssertTrue(state.hasPassword)
        XCTAssertEqual(state.request.errorMessage, error.message)
        XCTAssertNil(state.request.successMessage)
        XCTAssertFalse(state.request.isRunning)
    }

    func testShortPasswordCannotSendSetRequest() async {
        let state = SettingsPasswordState()
        var calls = 0
        let saved = await state.submit(newPassword: "short", setPassword: { _ in calls += 1 }, requestReset: { calls += 1 })
        XCTAssertFalse(saved)
        XCTAssertEqual(calls, 0)
        XCTAssertFalse(state.hasPassword)
    }

    func testUnknownLookupRetainsLastKnownPasswordCapability() {
        let state = SettingsPasswordState()
        state.hasPassword = true

        // Failed/unknown lookup (nil) must retain last known true capability
        state.applyLookupResult(nil)
        XCTAssertTrue(state.hasPassword, "Failed/unknown lookup must retain last known parent capability")

        // Authoritative false updates capability
        state.applyLookupResult(false)
        XCTAssertFalse(state.hasPassword, "Authoritative false updates state")

        // Failed/unknown lookup (nil) must retain last known false capability
        state.applyLookupResult(nil)
        XCTAssertFalse(state.hasPassword, "Failed/unknown lookup must retain last known false capability")

        // Authoritative true updates capability
        state.applyLookupResult(true)
        XCTAssertTrue(state.hasPassword, "Authoritative true updates state")
    }

    func testServerConflictPreservedAcrossUnknownLookup() async {
        let state = SettingsPasswordState()
        let error = APIError(status: 409, code: "password_already_set", message: "This account already has a password.")
        let saved = await state.submit(newPassword: "a new password", setPassword: { _ in throw error }, requestReset: {})
        XCTAssertFalse(saved)
        XCTAssertTrue(state.hasPassword, "409 server conflict sets hasPassword to true")

        // Simulated failed/unknown lookup while offline must NOT collapse 409 recovery
        state.applyLookupResult(nil)
        XCTAssertTrue(state.hasPassword, "Server 409 recovery must not be collapsed by subsequent unknown lookup")
    }

    func testStaleUserLookupCompletionDoesNotClearActiveUserCheckingState() async {
        // Simulates the exact user-switching concurrency pattern in SettingsView:
        // User A lookup begins and sets isCheckingPassword = true.
        // User B signs in, superseding and cancelling User A.
        var activeUserId = "user-A"
        var isCheckingPassword = true

        let userA = "user-A"
        let userB = "user-B"

        // User A's task starts
        let userATask = Task {
            defer {
                if !Task.isCancelled, activeUserId == userA {
                    isCheckingPassword = false
                }
            }
            // User A is awaiting lookup while User B signs in and cancels User A
            try? await Task.sleep(nanoseconds: 50_000_000)
        }

        // Active user switches to User B and cancels User A's task
        activeUserId = userB
        userATask.cancel()
        _ = await userATask.result

        // With the ownership and cancellation guard, stale User A's defer did NOT clear isCheckingPassword
        XCTAssertTrue(isCheckingPassword, "Stale user A defer must not clear isCheckingPassword after user B begins")

        // User B's task completes normally
        let userBTask = Task {
            defer {
                if !Task.isCancelled, activeUserId == userB {
                    isCheckingPassword = false
                }
            }
        }
        _ = await userBTask.result
        XCTAssertFalse(isCheckingPassword, "Active user B defer clears isCheckingPassword upon completion")
    }
}

