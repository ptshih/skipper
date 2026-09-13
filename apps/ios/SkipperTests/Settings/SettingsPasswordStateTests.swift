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
}
