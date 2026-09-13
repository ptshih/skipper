import XCTest

/// Real root presentation over a delayed mock /version response. Never opens the store.
@MainActor
final class VersionPolicyPresentationTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    func testForcedUpdateHasNoLaterAndBlocksAppActions() {
        let fixture = FixtureApp(scenario: .versionForce)
        fixture.launch()
        defer { fixture.application.terminate() }
        assertForcedWall(fixture)
        capture(fixture, "forced-wall")
        fixture.application.swipeDown()
        assertForcedWall(fixture)
    }

    func testRecommendedLaterPersistsAcrossSameVersionRelaunch() {
        let fixture = FixtureApp(scenario: .versionRecommended)
        fixture.launch()
        defer { fixture.application.terminate() }
        XCTAssertTrue(fixture.application.staticTexts["Update available"].waitForExistence(timeout: 10))
        let later = fixture.element("version.later")
        XCTAssertTrue(later.isHittable)
        capture(fixture, "recommended-before-later")
        later.tap()
        XCTAssertTrue(fixture.element("screen.library").waitForExistence(timeout: 10))
        XCTAssertFalse(fixture.element("version.gate").exists)
        capture(fixture, "recommended-dismissed")

        fixture.application.terminate()
        // Preserve the run's defaults, server and credentials; a fresh UUID would hide a regression.
        fixture.launch()
        XCTAssertTrue(fixture.element("screen.library").waitForExistence(timeout: 10))
        let returnedNudge = expectation(for: NSPredicate(format: "exists == true"),
                                        evaluatedWith: fixture.application.staticTexts["Update available"])
        returnedNudge.isInverted = true
        wait(for: [returnedNudge], timeout: 5)
        XCTAssertFalse(fixture.element("version.later").exists)
        capture(fixture, "recommended-still-dismissed-after-relaunch")
        // Runner must also read the same-run receipt: two /version requests, zero unexpected calls.
    }

    func testDelayedForceReplacesAlreadyVisibleSignInSheet() {
        let fixture = FixtureApp(scenario: .versionForceDelayedSheet)
        fixture.launch()
        defer { fixture.application.terminate() }
        let signIn = fixture.element("account.sign-in")
        XCTAssertTrue(signIn.waitForExistence(timeout: 5), "Settings must be usable while /version is pending")
        XCTAssertTrue(signIn.isHittable)
        XCTAssertFalse(fixture.element("version.gate").exists)
        capture(fixture, "settings-before-delayed-policy")
        signIn.tap()
        let email = fixture.element("auth.email")
        XCTAssertTrue(email.waitForExistence(timeout: 5))
        XCTAssertTrue(email.isHittable)
        capture(fixture, "sign-in-sheet-before-delayed-policy")
        assertForcedWall(fixture, timeout: 20)
        if email.exists { XCTAssertFalse(email.isHittable, "The old sign-in sheet must not remain above the wall") }
        capture(fixture, "delayed-force-above-sign-in-sheet")
    }

    func testLateRecommendedNudgePreservesProposalAndUnsentDraftAcrossLater() {
        let fixture = FixtureApp(scenario: .versionRecommendedDelayedPlanner)
        fixture.launch()
        defer { fixture.application.terminate() }
        let draft = "Keep this draft"
        let input = fixture.element("planner.input")
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        XCTAssertTrue(input.isHittable)
        input.tap()
        input.typeText("A quiet fixture drive")
        fixture.element("planner.send").tap()
        let proposal = fixture.element("planner.proposal")
        XCTAssertTrue(proposal.waitForExistence(timeout: 10))
        let make = fixture.element("proposal.make")
        XCTAssertTrue(make.waitForExistence(timeout: 5))
        let ready = expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: make)
        wait(for: [ready], timeout: 5)
        let proposalText = proposal.label
        capture(fixture, "proposal-before-draft-and-late-nudge")
        XCTAssertEqual(fixture.application.descendants(matching: .any)
            .matching(identifier: "planner.proposal").count, 1)
        input.tap()
        input.typeText(draft)
        XCTAssertEqual(input.value as? String, draft)
        XCTAssertFalse(fixture.element("version.gate").exists,
                       "The fixture must allow a real draft before the delayed policy arrives")
        capture(fixture, "planner-card-and-draft-before-late-nudge")

        XCTAssertTrue(fixture.application.staticTexts["Update available"].waitForExistence(timeout: 20))
        let later = fixture.element("version.later")
        XCTAssertTrue(later.isHittable)
        capture(fixture, "late-nudge-over-planner-draft")
        later.tap()
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        XCTAssertTrue(input.isHittable)
        XCTAssertEqual(input.value as? String, draft,
                       "Presenting and dismissing a nudge must preserve the production planner state")
        XCTAssertTrue(proposal.exists)
        XCTAssertEqual(proposal.label, proposalText)
        XCTAssertTrue(fixture.element("proposal.make").exists)
        XCTAssertEqual(fixture.application.descendants(matching: .any)
            .matching(identifier: "planner.proposal").count, 1)
        XCTAssertFalse(fixture.element("version.gate").exists)
        capture(fixture, "planner-draft-preserved-after-later")
        // Exactly one plan/proposal and no creates. Key identity needs the model's lifecycle
        // regression: a visible card label is not proof of its private idempotency UUID.
    }

    private func assertForcedWall(_ fixture: FixtureApp, timeout: TimeInterval = 10) {
        XCTAssertTrue(fixture.application.staticTexts["Update required"].waitForExistence(timeout: timeout))
        let update = fixture.element("version.update")
        // The title can enter accessibility before the outgoing sheet releases hit testing.
        let updateReady = expectation(for: NSPredicate(format: "isHittable == true"), evaluatedWith: update)
        wait(for: [updateReady], timeout: 5)
        XCTAssertTrue(update.isHittable)
        XCTAssertFalse(fixture.element("version.later").exists)
        XCTAssertFalse(fixture.application.buttons["Later"].exists)
        for identifier in ["planner.input", "planner.send", "drive.start", "account.sign-in", "auth.email"] {
            let action = fixture.element(identifier)
            if action.exists { XCTAssertFalse(action.isHittable, identifier) }
        }
        for tab in ["Plan", "My Drives", "Settings"] {
            let action = fixture.application.tabBars.buttons[tab]
            if action.exists { XCTAssertFalse(action.isHittable, tab) }
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
