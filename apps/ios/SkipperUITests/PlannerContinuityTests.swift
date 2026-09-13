import XCTest

/// Production screens over the scripted HTTP/auth dependencies in contracts/ui-flows.json.
/// Request/key/commit assertions belong to the mock receipt and service tests, not screenshots.
@MainActor
final class PlannerContinuityTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    func testAccountWallReturnsToProposalAndExplicitRetryCreatesDrive() {
        exerciseCreate(.plannerAccountRetry, theme: .light)
    }

    func testLostAcknowledgementRetryReopensCanonicalDriveInDayAndDusk() {
        for theme in [FixtureApp.Theme.light, .dark] {
            exerciseCreate(.plannerAccountLostAck, theme: theme)
        }
    }

    func testResetDuringStreamDoesNotResurrectProposal() {
        let fixture = FixtureApp(scenario: .plannerResetDuringStream)
        fixture.launch()
        defer { fixture.application.terminate() }
        sendPrompt(fixture)
        capture(fixture, "before-reset")
        let reset = fixture.element("planner.start-fresh")
        XCTAssertTrue(reset.waitForExistence(timeout: 5))
        XCTAssertTrue(reset.isHittable)
        XCTAssertTrue(fixture.element("planner.streaming").exists,
                      "Reset must occur before the fixture terminal, not after proposal generation")
        reset.tap()
        XCTAssertTrue(fixture.element("planner.empty").waitForExistence(timeout: 5))
        // The transport barrier holds after the first chunk until actual cancellation. Runner
        // acceptance also requires the receipt's barrier/cancellation/terminal counters and
        // zero proposal requests; visible empty state alone is not cancellation evidence.
        XCTAssertFalse(fixture.element("planner.proposal").exists)
        XCTAssertTrue(fixture.element("planner.empty").exists)
        capture(fixture, "after-reset-awaiting-cancellation-receipt")
    }

    private func exerciseCreate(_ scenario: FixtureApp.Scenario, theme: FixtureApp.Theme) {
        let fixture = FixtureApp(scenario: scenario, theme: theme)
        fixture.launch()
        defer { fixture.application.terminate() }
        sendPrompt(fixture)
        capture(fixture, "streaming")
        XCTAssertTrue(fixture.element("planner.proposal").waitForExistence(timeout: 10))
        capture(fixture, "proposal-before-wall")
        XCTAssertEqual(fixture.application.descendants(matching: .any).matching(identifier: "planner.proposal").count, 1)
        tap(fixture, "proposal.make")
        XCTAssertTrue(fixture.element("proposal.sign-in").waitForExistence(timeout: 5))
        capture(fixture, "account-wall")
        tap(fixture, "proposal.sign-in")
        signIn(fixture)
        // Sign-in must retain and unblock this card. It must not require redrawing a route.
        XCTAssertTrue(fixture.element("proposal.make").waitForExistence(timeout: 5))
        XCTAssertEqual(fixture.application.descendants(matching: .any).matching(identifier: "planner.proposal").count, 1)
        capture(fixture, "proposal-after-sign-in")
        tap(fixture, "proposal.make")
        XCTAssertTrue(fixture.element("proposal.retry").waitForExistence(timeout: 5))
        XCTAssertFalse(fixture.element("screen.drive-detail").exists)
        capture(fixture, "failed-create-before-explicit-retry")
        tap(fixture, "proposal.retry")
        XCTAssertTrue(fixture.element("screen.drive-detail").waitForExistence(timeout: 10))
        XCTAssertEqual(fixture.element("drive.title").label, "Fixture Retry Drive")
        capture(fixture, "canonical-drive-after-retry")
        let start = fixture.element("drive.start")
        XCTAssertTrue(start.waitForExistence(timeout: 5))
        let stored = expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: start)
        wait(for: [stored], timeout: 15)
        capture(fixture, "canonical-drive-download-committed")
        // Start becomes enabled from actual saved audio. Runner must independently read the
        // canonical manifest and nonempty referenced bytes; HTTP-time directory receipts can
        // precede the background commit and are retained separately.
        fixture.application.terminate()
        fixture.launch()
        XCTAssertTrue(fixture.element("screen.planner").waitForExistence(timeout: 10))
        capture(fixture, "same-run-relaunch-after-storage-commit")
        // The same run UUID preserves real Storage output. Runner verifies its bytes again;
        // no app launch fixture may seed the newly created drive or its manifest.
    }

    private func sendPrompt(_ fixture: FixtureApp) {
        XCTAssertTrue(fixture.element("screen.planner").waitForExistence(timeout: 10))
        let input = fixture.element("planner.input")
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        input.tap(); input.typeText("A quiet fixture drive")
        tap(fixture, "planner.send")
        XCTAssertTrue(fixture.element("planner.streaming").waitForExistence(timeout: 5),
                      "Observe a real partial stream before the terminal proposal")
        XCTAssertTrue(fixture.element("planner.streaming").label.contains("A quiet fixture drive"))
    }

    private func signIn(_ fixture: FixtureApp) {
        let email = fixture.element("auth.email")
        XCTAssertTrue(email.waitForExistence(timeout: 5))
        email.tap(); email.typeText("rider@example.invalid")
        capture(fixture, "sign-in-email")
        tap(fixture, "auth.send-code")
        let code = fixture.element("auth.code")
        XCTAssertTrue(code.waitForExistence(timeout: 5))
        code.tap(); code.typeText("123456")
        capture(fixture, "sign-in-code")
        tap(fixture, "auth.verify")
    }

    private func tap(_ fixture: FixtureApp, _ identifier: String) {
        let element = fixture.element(identifier)
        XCTAssertTrue(element.waitForExistence(timeout: 5), identifier)
        for _ in 0..<4 where !element.isHittable { fixture.application.swipeUp() }
        XCTAssertTrue(element.isEnabled, identifier)
        XCTAssertTrue(element.isHittable, identifier)
        element.tap()
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
