import XCTest

/// Adversarial runtime audit probes exploring Judge Priority Flows:
/// 1. Returning after authCancel (e.g. from proposal "Make this drive" account wall)
/// 2. Deep link arriving under active driving cover
/// 3. Password reset retry after back navigation (AuthView resetSent clearance)
@MainActor
final class AdversarialAuditUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    /// Priority: Returning after authCancel.
    /// Tests proposal account wall -> Sign in -> Cancel -> verify proposal card remains intact and retryable.
    func testReturningAfterAuthCancel() {
        let fixture = FixtureApp(scenario: .plannerAccountRetry)
        fixture.launch()
        defer { fixture.application.terminate() }

        // Send prompt to generate proposal
        XCTAssertTrue(fixture.element("screen.planner").waitForExistence(timeout: 10))
        let input = fixture.element("planner.input")
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        input.tap()
        input.typeText("A quiet fixture drive")

        let send = fixture.element("planner.send")
        XCTAssertTrue(send.waitForExistence(timeout: 5))
        send.tap()

        XCTAssertTrue(fixture.element("planner.proposal").waitForExistence(timeout: 10))
        capture(fixture, "proposal-ready")

        // Tap Make this drive
        let makeButton = fixture.element("proposal.make")
        XCTAssertTrue(makeButton.waitForExistence(timeout: 5))
        makeButton.tap()

        // Account wall appears with Sign In button
        let signInButton = fixture.element("proposal.sign-in")
        XCTAssertTrue(signInButton.waitForExistence(timeout: 5))
        signInButton.tap()

        // Auth sheet appears (root identifier is account.sign-in / auth.email)
        let authEmail = fixture.element("auth.email")
        XCTAssertTrue(authEmail.waitForExistence(timeout: 5))
        capture(fixture, "auth-sheet-from-proposal")

        // User cancels out of Auth
        let cancel = fixture.application.buttons["Cancel"]
        XCTAssertTrue(cancel.waitForExistence(timeout: 5))
        cancel.tap()

        // Verify returning state: auth sheet dismissed, proposal card must still exist and be interactive
        XCTAssertTrue(fixture.element("screen.planner").waitForExistence(timeout: 5))
        XCTAssertFalse(authEmail.exists, "Auth sheet must be dismissed on Cancel")
        XCTAssertTrue(fixture.element("planner.proposal").waitForExistence(timeout: 5))
        XCTAssertTrue(fixture.element("proposal.sign-in").exists, "Sign in prompt on proposal must remain accessible")
        capture(fixture, "proposal-after-auth-cancel")
    }

    /// Priority: Warm deeplink arriving under driving cover.
    /// Drives into active simulation cover, receives a warm deep link for seeded drive 0003
    /// via supported XCTest SDK open(_:), asserts driving cover remains frontmost and underlying
    /// views are not hittable, then triggers Pull Over / End Drive to probe delivery of target detail.
    func testDeeplinkArrivingUnderDrivingCover() {
        let fixture = FixtureApp(scenario: .drivingQATwoStops)
        fixture.launch()
        defer { fixture.application.terminate() }

        // 1. Enter Drive Detail and start driving
        let drive = fixture.element("library.drive.00000002-0000-4000-8000-000000000003")
        XCTAssertTrue(drive.waitForExistence(timeout: 10))
        drive.tap()

        XCTAssertTrue(fixture.element("screen.drive-detail").waitForExistence(timeout: 5))
        let startButton = fixture.element("drive.start")
        XCTAssertTrue(startButton.waitForExistence(timeout: 5))
        startButton.tap()

        XCTAssertTrue(fixture.element("driving-screen").waitForExistence(timeout: 10))

        // 2. Start simulation
        let simulateButton = fixture.element("start-drive")
        if simulateButton.waitForExistence(timeout: 5) {
            simulateButton.tap()
        }

        XCTAssertTrue(fixture.element("driving-screen").waitForExistence(timeout: 5))
        capture(fixture, "driving-active-before-deeplink")

        // 3. Receive warm deep link targeting seeded 00000002-0000-4000-8000-000000000003
        let pidBefore = extractPID(fixture.application)
        let targetURL = URL(string: "skipper://drives/00000002-0000-4000-8000-000000000003")!
        XCUIDevice.shared.system.open(targetURL)
        XCTAssertTrue(fixture.application.wait(for: .runningForeground, timeout: 5))
        let pidAfter = extractPID(fixture.application)
        if let pidBefore, let pidAfter {
            XCTAssertEqual(pidBefore, pidAfter, "Process ID must remain identical (warm deep link delivery)")
        }

        // 4. Assert driving screen remains frontmost; underlying detail or wall are not hittable
        capture(fixture, "driving-state-after-deeplink")
        XCTAssertTrue(fixture.element("driving-screen").exists, "Driving screen must remain active when deep link arrives")
        let underlyingDetail = fixture.element("screen.drive-detail")
        let underlyingWall = fixture.element("account-wall")
        XCTAssertFalse(underlyingDetail.isHittable, "Underlying detail must not be hittable while driving cover is active")
        XCTAssertFalse(underlyingWall.isHittable, "Underlying account wall must not be hittable while driving cover is active")

        // 5. Pull over and End Drive
        let pullOverButton = fixture.application.buttons["Pull over"]
        XCTAssertTrue(pullOverButton.waitForExistence(timeout: 5), "Pull over button must exist")
        pullOverButton.tap()

        let endDriveButton = fixture.application.buttons["End drive"]
        XCTAssertTrue(endDriveButton.waitForExistence(timeout: 5), "End drive confirmation button must exist")
        endDriveButton.tap()

        // 6. Capture Library->Detail outcome after driving cover dismissal
        let detailScreen = fixture.element("screen.drive-detail")
        let hasDeliveredDetail = detailScreen.waitForExistence(timeout: 5)
        capture(fixture, "after-end-drive-outcome")
        XCTAssertTrue(hasDeliveredDetail, "Drive Detail must be delivered after ending drive following warm deep link")
        if hasDeliveredDetail {
            let title = fixture.application.staticTexts["Two-Stop Simulated QA Drive"]
            XCTAssertTrue(title.exists, "Delivered detail must show Two-Stop Simulated QA Drive")
        }
    }

    /// Priority: AuthView password reset retry after back navigation.
    /// Signs out on Settings, enters sign-in, toggles to password, taps "Forgot password?",
    /// sends reset link, navigates "Back to sign in", and re-enters "Forgot password?".
    /// Asserts editable email field and "Send Reset Link" button are restored (not trapped on "Check your inbox"),
    /// and triggers a second reset to confirm resend is operable.
    func testPasswordResetRetryAfterBackNavigation() {
        let fixture = FixtureApp(scenario: .settingsAccountLifecycle)
        fixture.launch()
        defer { fixture.application.terminate() }

        // 1. Initial settings visible; scroll to and tap Sign Out
        let signOutButton = fixture.application.buttons["Sign Out"]
        for _ in 0..<4 where !signOutButton.isHittable {
            fixture.application.swipeUp()
        }
        XCTAssertTrue(signOutButton.waitForExistence(timeout: 5))
        signOutButton.tap()

        let confirmSignOut = fixture.application.alerts["Sign Out?"].buttons["Sign Out"]
        XCTAssertTrue(confirmSignOut.waitForExistence(timeout: 5))
        confirmSignOut.tap()

        // 2. Settings now displays Sign In button
        let signInButton = fixture.element("account.sign-in")
        XCTAssertTrue(signInButton.waitForExistence(timeout: 5))
        signInButton.tap()

        // 3. Auth sheet presents; enter email
        let emailField = fixture.element("auth.email")
        XCTAssertTrue(emailField.waitForExistence(timeout: 5))
        emailField.tap()
        emailField.typeText("member@example.invalid")

        // 4. Switch to password -> tap Forgot password?
        let usePassword = fixture.application.buttons["Use password instead"]
        XCTAssertTrue(usePassword.waitForExistence(timeout: 5))
        usePassword.tap()

        let forgotPassword = fixture.element("account.reset")
        XCTAssertTrue(forgotPassword.waitForExistence(timeout: 5))
        forgotPassword.tap()

        // 5. Reset screen: tap Send Reset Link
        let sendResetButton = fixture.application.buttons["Send Reset Link"]
        XCTAssertTrue(sendResetButton.waitForExistence(timeout: 5))
        sendResetButton.tap()

        // Verify sent confirmation banner/state
        let inboxNotice = fixture.application.staticTexts["Check your inbox for a password reset link."]
        XCTAssertTrue(inboxNotice.waitForExistence(timeout: 5))
        capture(fixture, "first-reset-sent")

        // 6. Tap Back to sign in
        let backButton = fixture.application.buttons["Back to sign in"]
        XCTAssertTrue(backButton.waitForExistence(timeout: 5))
        backButton.tap()

        // 7. Re-enter Forgot password flow: password -> Forgot password?
        XCTAssertTrue(usePassword.waitForExistence(timeout: 5))
        usePassword.tap()

        XCTAssertTrue(forgotPassword.waitForExistence(timeout: 5))
        forgotPassword.tap()

        // 8. Assert editable email and Send Reset Link are restored (not blocked by stale resetSent)
        let resetEmailField = fixture.application.textFields["Email address"]
        XCTAssertTrue(resetEmailField.waitForExistence(timeout: 5), "Email address field must be present after re-entering forgot password")
        XCTAssertTrue(sendResetButton.waitForExistence(timeout: 5), "Send Reset Link button must be restored after re-entering forgot password")
        capture(fixture, "reset-screen-re-entered")

        // Resend reset link to prove resend is operable
        sendResetButton.tap()
        XCTAssertTrue(inboxNotice.waitForExistence(timeout: 5))
        capture(fixture, "second-reset-sent")
    }

    private func capture(_ fixture: FixtureApp, _ name: String) {
        let attachment = XCTAttachment(screenshot: fixture.application.screenshot())
        attachment.name = "\(fixture.runID)-\(name)"
        attachment.lifetime = .keepAlways
        add(attachment)
        let hierarchy = XCTAttachment(string: fixture.application.debugDescription)
        hierarchy.name = "\(fixture.runID)-\(name)-hierarchy"
        hierarchy.lifetime = .keepAlways
        add(hierarchy)
    }

    private func extractPID(_ app: XCUIApplication) -> String? {
        let desc = app.debugDescription
        if let range = desc.range(of: "pid: \\d+", options: .regularExpression) {
            return String(desc[range])
        }
        return nil
    }
}
