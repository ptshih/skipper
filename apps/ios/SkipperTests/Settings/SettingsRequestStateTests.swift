import XCTest
@testable import Skipper

@MainActor
final class SettingsRequestStateTests: XCTestCase {
    func testRejectedRequestShowsServerMessageAndCanRetry() async {
        let state = SettingsRequestState()
        let error = APIError(status: 429, code: "TOO_MANY_REQUESTS", message: "Please wait before requesting another code.")
        let failed = await state.run(success: "Code sent.") { throw error }
        XCTAssertFalse(failed)
        XCTAssertFalse(state.isRunning)
        XCTAssertEqual(state.errorMessage, error.message)
        XCTAssertNil(state.successMessage)

        let succeeded = await state.run(success: "Code sent.") {}
        XCTAssertTrue(succeeded)
        XCTAssertNil(state.errorMessage)
        XCTAssertNil(state.errorCode)
        XCTAssertEqual(state.successMessage, "Code sent.")
    }

    func testNetworkFailureDoesNotLeaveNameSaveBusyOrClaimSuccess() async {
        let state = SettingsRequestState()
        let succeeded = await state.run(success: "Name saved.") { throw URLError(.notConnectedToInternet) }
        XCTAssertFalse(succeeded)
        XCTAssertNotNil(state.errorMessage)
        XCTAssertNil(state.successMessage)
        XCTAssertFalse(state.isRunning)
    }

    func testDuplicateRequestDoesNotRunOrReplacePendingResult() async {
        let state = SettingsRequestState()
        var duplicateCalls = 0
        let first = await state.run(success: "Code sent.") {
            XCTAssertTrue(state.isRunning)
            let duplicate = await state.run(success: "Unexpected result") { duplicateCalls += 1 }
            XCTAssertFalse(duplicate)
            XCTAssertTrue(state.isRunning)
            XCTAssertNil(state.successMessage)
        }
        XCTAssertTrue(first)
        XCTAssertEqual(duplicateCalls, 0)
        XCTAssertEqual(state.successMessage, "Code sent.")
        XCTAssertFalse(state.isRunning)
    }

    func testFailedResendClearsPreviousSentConfirmation() async {
        let state = SettingsRequestState()
        await state.run(success: "Code sent.") {}
        await state.run(success: "Code sent.") { throw OfflineError() }
        XCTAssertNil(state.successMessage)
        XCTAssertNotNil(state.errorMessage)
    }
}
