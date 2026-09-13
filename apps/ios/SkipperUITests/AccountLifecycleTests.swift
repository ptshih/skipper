import XCTest

@MainActor
final class AccountLifecycleTests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testPassword409ResetAndSignOutPurgeWithSameRunOnlineRelaunch() throws {
        let runID = UUID().uuidString
        let fixture = FixtureApp(scenario: .settingsAccountLifecycle, runID: runID)
        fixture.launch()

        // 1. App opens on Settings. Check initial authenticated state.
        let passwordAction = fixture.element("settings.password-action")
        XCTAssertTrue(passwordAction.waitForExistence(timeout: 10), "Password action button must appear in Settings")
        XCTAssertEqual(passwordAction.label, "Set Password")
        capture(fixture, "initial-settings-authenticated")

        // 2. Establish focus and enter new password (< 8 characters keeps action disabled, >= 8 enables)
        let passwordField = fixture.application.secureTextFields["New password (at least 8 characters)"]
        XCTAssertTrue(passwordField.waitForExistence(timeout: 5), "Password SecureField must exist")
        passwordField.tap()

        // Wait for keyboard OR iOS AutoFill strong password panel
        let keyboard = fixture.application.keyboards.element
        let strongPasswordButton = fixture.application.buttons["GenerateStrongPasswordButton"]
        let fillStrongPasswordButton = fixture.application.buttons["Fill Strong Password"]

        let existsPredicate = NSPredicate(format: "exists == true")
        let keyboardWait = XCTNSPredicateExpectation(predicate: existsPredicate, object: keyboard)
        let autoFillWait = XCTNSPredicateExpectation(predicate: existsPredicate, object: strongPasswordButton)
        let fillWait = XCTNSPredicateExpectation(predicate: existsPredicate, object: fillStrongPasswordButton)
        _ = XCTWaiter().wait(for: [keyboardWait, autoFillWait, fillWait], timeout: 5, enforceOrder: false)

        let hasAutoFill = strongPasswordButton.exists || fillStrongPasswordButton.exists
        if hasAutoFill {
            capture(fixture, "autofill-panel-presented")
            var autoFillWindow = fixture.application.windows.containing(.button, identifier: strongPasswordButton.exists ? "GenerateStrongPasswordButton" : "Fill Strong Password").firstMatch
            var closeButton = autoFillWindow.buttons.matching(
                NSPredicate(format: "identifier == 'Close' OR label == 'Close' OR identifier == 'xmark'")
            ).firstMatch

            if !closeButton.exists {
                for i in 0..<fixture.application.windows.count {
                    let win = fixture.application.windows.element(boundBy: i)
                    if win.buttons["GenerateStrongPasswordButton"].exists || win.buttons["Fill Strong Password"].exists {
                        let candidate = win.buttons.matching(
                            NSPredicate(format: "identifier == 'Close' OR label == 'Close' OR identifier == 'xmark'")
                        ).firstMatch
                        if candidate.exists {
                            closeButton = candidate
                            break
                        }
                    }
                }
            }

            if closeButton.waitForExistence(timeout: 3) {
                closeButton.tap()
            }
        }

        // Wait for software keyboard to appear
        XCTAssertTrue(keyboard.waitForExistence(timeout: 5), "Software keyboard must appear after dismissing AutoFill panel or on field focus")

        // Type short password (< 8 characters)
        passwordField.typeText("short")
        let shortVal = passwordField.value as? String ?? ""
        XCTAssertEqual(shortVal.count, 5, "SecureField must reflect 5 characters entered")
        XCTAssertFalse(passwordAction.isEnabled, "Password action button must remain disabled when password has < 8 characters")

        // Complete password to >= 8 characters (append "12345" to make 10 chars)
        passwordField.typeText("12345")
        let fullVal = passwordField.value as? String ?? ""
        XCTAssertEqual(fullVal.count, 10, "SecureField must reflect 10 characters entered")

        // Wait with predicate for action button to become settled and enabled
        let enabledPredicate = NSPredicate(format: "isEnabled == true")
        let enabledExpectation = XCTNSPredicateExpectation(predicate: enabledPredicate, object: passwordAction)
        XCTAssertEqual(XCTWaiter().wait(for: [enabledExpectation], timeout: 5), .completed, "Password action button must become enabled once password is at least 8 characters")
        XCTAssertTrue(passwordAction.isEnabled)
        capture(fixture, "password-entered")

        // 3. Tap 'Set Password' -> server returns 409 Conflict
        passwordAction.tap()

        // 4. Server 409 message appears, button flips to 'Send Password Reset Email'
        let conflictMessage = fixture.application.staticTexts["This account already has a password. Use password reset to change it."]
        XCTAssertTrue(conflictMessage.waitForExistence(timeout: 5), "Server 409 message must be displayed")
        XCTAssertEqual(passwordAction.label, "Send Password Reset Email")
        capture(fixture, "password-409-reset-offered")

        // 5. Tap 'Send Password Reset Email' -> 200 OK
        passwordAction.tap()
        let resetSuccessMessage = fixture.application.staticTexts["Check your email for a link to change your password."]
        XCTAssertTrue(resetSuccessMessage.waitForExistence(timeout: 5), "Password reset success banner must appear")
        capture(fixture, "password-reset-sent")

        // 6. Sign Out flow
        let signOutButton = fixture.application.buttons["Sign Out"]
        XCTAssertTrue(signOutButton.waitForExistence(timeout: 5))
        scrollDownIfNeeded(fixture, signOutButton)
        signOutButton.tap()

        let alert = fixture.application.alerts["Sign Out?"]
        XCTAssertTrue(alert.waitForExistence(timeout: 5), "Sign out confirmation alert must appear")
        capture(fixture, "sign-out-alert")
        alert.buttons["Sign Out"].tap()

        // 7. Verify in-place stay on Settings: 'account.sign-in' ('Sign In or Register') appears.
        // AuthView email must be absent and Settings tab must remain selected (zero transition to Library or auth sheet).
        let signInButton = fixture.element("account.sign-in")
        XCTAssertTrue(signInButton.waitForExistence(timeout: 10), "Settings must display Sign In or Register after sign out")
        XCTAssertFalse(fixture.element("auth.email").exists, "AuthView email field must NOT be present (no auth sheet/wall)")
        XCTAssertTrue(fixture.application.navigationBars["Settings"].exists, "Settings navigation bar must be present")
        XCTAssertTrue(fixture.application.buttons["Settings"].isSelected, "Settings tab must remain selected")
        XCTAssertFalse(fixture.application.buttons["Sign Out"].exists, "Sign Out button must disappear after sign out")
        capture(fixture, "signed-out-settings-stay")

        // 8. Terminate process.
        fixture.application.terminate()
        Thread.sleep(forTimeInterval: 2)

        // 9. Same-run online relaunch: fresh process with identical runID.
        let relaunch = FixtureApp(scenario: .settingsAccountLifecycle, runID: runID)
        relaunch.launch()

        // 10. App launches onto Settings with guest session active.
        let relaunchSignIn = relaunch.element("account.sign-in")
        XCTAssertTrue(relaunchSignIn.waitForExistence(timeout: 10), "Relaunched app in guest mode still offers Sign In or Register")
        XCTAssertFalse(relaunch.element("auth.email").exists, "AuthView email field must NOT be present on relaunch")
        XCTAssertTrue(relaunch.application.navigationBars["Settings"].exists, "Settings navigation bar must be present on relaunch")
        XCTAssertTrue(relaunch.application.buttons["Settings"].isSelected, "Settings tab must be selected on relaunch")
        capture(relaunch, "relaunch-guest-active")

        relaunch.application.terminate()
    }

    func testDeleteAccountCodeVerificationPurgeWithSameRunOnlineRelaunch() throws {
        let runID = UUID().uuidString
        let fixture = FixtureApp(scenario: .settingsAccountLifecycle, runID: runID)
        fixture.launch()

        // 1. Initial settings visible
        let passwordAction = fixture.element("settings.password-action")
        XCTAssertTrue(passwordAction.waitForExistence(timeout: 10))
        capture(fixture, "initial-settings-delete-run")

        // 2. Open Delete Account sheet
        let deleteButton = fixture.application.buttons["Delete Account…"]
        XCTAssertTrue(deleteButton.waitForExistence(timeout: 5))
        scrollDownIfNeeded(fixture, deleteButton)
        deleteButton.tap()

        // 3. Delete sheet presents with OTP code entry (since hasPassword() == false for fixture)
        let sendCodeButton = fixture.element("settings.send-deletion-code")
        XCTAssertTrue(sendCodeButton.waitForExistence(timeout: 5), "Send code button must appear in delete sheet")
        capture(fixture, "delete-sheet-presented")

        // 4. Tap 'Send Code' -> success message appears
        sendCodeButton.tap()
        let codeSentBanner = fixture.application.staticTexts["Verification code sent. Check your email."]
        XCTAssertTrue(codeSentBanner.waitForExistence(timeout: 5), "Code sent confirmation banner must appear")
        capture(fixture, "delete-code-sent")

        // 5. Enter 6-digit code
        let codeField = fixture.application.textFields["6-digit code"]
        XCTAssertTrue(codeField.waitForExistence(timeout: 5))
        codeField.tap()
        XCTAssertTrue(fixture.application.keyboards.element.waitForExistence(timeout: 5), "Software keyboard must appear for code entry")
        codeField.typeText("123456")
        let codeVal = codeField.value as? String ?? ""
        XCTAssertEqual(codeVal, "123456", "Entered code must match in field")

        // 6. Tap 'Permanently Delete Account'
        let confirmDelete = fixture.application.buttons["Permanently Delete Account"]
        XCTAssertTrue(confirmDelete.waitForExistence(timeout: 5))
        let deleteEnabled = NSPredicate(format: "isEnabled == true")
        _ = XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: deleteEnabled, object: confirmDelete)], timeout: 5)
        XCTAssertTrue(confirmDelete.isEnabled)
        capture(fixture, "delete-code-entered")
        confirmDelete.tap()

        // 7. Sheet dismisses; app stays on Settings with 'account.sign-in' visible
        XCTAssertTrue(confirmDelete.waitForNonExistence(timeout: 5), "Deletion sheet/button must dismiss and not linger")
        let signInButton = fixture.element("account.sign-in")
        XCTAssertTrue(signInButton.waitForExistence(timeout: 10), "Settings must display Sign In or Register after deletion")
        XCTAssertFalse(fixture.element("auth.email").exists, "AuthView email field must NOT be present after deletion")
        XCTAssertTrue(fixture.application.navigationBars["Settings"].exists, "Settings navigation bar must be present after deletion")
        XCTAssertTrue(fixture.application.buttons["Settings"].isSelected, "Settings tab must remain selected after deletion")
        XCTAssertFalse(fixture.application.buttons["Delete Account…"].exists)
        capture(fixture, "deleted-settings-stay")

        // 8. Terminate process.
        fixture.application.terminate()
        Thread.sleep(forTimeInterval: 2)

        // 9. Same-run online relaunch: fresh process with identical runID.
        let relaunch = FixtureApp(scenario: .settingsAccountLifecycle, runID: runID)
        relaunch.launch()

        // 10. App launches onto Settings with guest session active.
        let relaunchSignIn = relaunch.element("account.sign-in")
        XCTAssertTrue(relaunchSignIn.waitForExistence(timeout: 10))
        XCTAssertFalse(relaunch.element("auth.email").exists, "AuthView email field must NOT be present on relaunch")
        XCTAssertTrue(relaunch.application.navigationBars["Settings"].exists, "Settings navigation bar must be present on relaunch")
        XCTAssertTrue(relaunch.application.buttons["Settings"].isSelected, "Settings tab must be selected on relaunch")
        capture(relaunch, "relaunch-after-delete-guest-active")

        relaunch.application.terminate()
    }

    private func scrollDownIfNeeded(_ fixture: FixtureApp, _ element: XCUIElement) {
        for _ in 0..<4 where !element.isHittable {
            fixture.application.swipeUp()
        }
    }

    private func capture(_ fixture: FixtureApp, _ state: String) {
        let attachment = XCTAttachment(screenshot: fixture.application.screenshot())
        attachment.name = "\(fixture.runID)-\(state)"
        attachment.lifetime = .keepAlways
        add(attachment)
        let hierarchy = XCTAttachment(string: fixture.application.debugDescription)
        hierarchy.name = "\(fixture.runID)-\(state)-hierarchy"
        hierarchy.lifetime = .keepAlways
        add(hierarchy)
    }
}
