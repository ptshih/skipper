import XCTest

/// Run on the standard iPhone and SE at the runner-selected Dynamic Type size.
/// Hittability and screenshots complement each other; neither proves VoiceOver behavior.
@MainActor
final class AccessibilityScrollTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    func testPartialDriveBadgeAndStartRemainReachableByScrolling() {
        for theme in [FixtureApp.Theme.light, .dark] {
            let fixture = FixtureApp(scenario: .offlineLibrary, theme: theme)
            fixture.launch()
            defer { fixture.application.terminate() }
            XCTAssertTrue(fixture.element("screen.library").waitForExistence(timeout: 10))
            capture(fixture, "library-before-scroll")
            let badge = fixture.element("library.badge.partial")
            let row = fixture.application.buttons.matching(
                NSPredicate(format: "identifier BEGINSWITH %@", "library.drive.")
            ).firstMatch
            let list = fixture.application.collectionViews.firstMatch
            reveal(in: list, fixture: fixture, description: "readable partial count and drive row",
                   targetFrame: { badge.exists ? badge.frame : nil }) {
                guard row.exists && row.isHittable else { return false }
                // SwiftUI may combine a static badge into the row's accessible label.
                // A badge is information, not an independently tappable control.
                if badge.exists {
                    return badge.label.contains("1 of 2") && self.isFullyVisible(badge, in: list, app: fixture.application)
                }
                return row.label.contains("1 of 2")
            }
            XCTAssertTrue(row.label.contains("1 of 2") || (badge.exists && badge.label.contains("1 of 2")))
            XCTAssertFalse(fixture.element("library.badge.downloaded").exists)
            capture(fixture, "partial-badge-after-scroll")
            row.tap()
            XCTAssertTrue(fixture.element("screen.drive-detail").waitForExistence(timeout: 5))
            let detail = fixture.application.scrollViews.firstMatch
            let summary = fixture.element("drive.missing-summary")
            reveal(in: detail, fixture: fixture, description: "readable missing-audio summary",
                   targetFrame: { summary.exists ? summary.frame : nil }) {
                summary.exists && self.isFullyVisible(summary, in: detail, app: fixture.application)
            }
            capture(fixture, "missing-audio-summary-after-scroll")
            let start = fixture.element("drive.start")
            reveal(in: detail, fixture: fixture, description: "reachable Start control",
                   targetFrame: { start.exists ? start.frame : nil }) {
                start.exists && start.isHittable && self.isFullyVisible(start, in: detail, app: fixture.application)
            }
            XCTAssertTrue(start.isEnabled)
            capture(fixture, "start-reachable-after-scroll")
        }
    }

    func testDeferredRetryAndPublicTabsRemainReachable() {
        for theme in [FixtureApp.Theme.light, .dark] {
            let fixture = FixtureApp(scenario: .migrationDeferred, theme: theme)
            fixture.launch()
            defer { fixture.application.terminate() }
            let retry = fixture.element("migration.retry")
            XCTAssertTrue(retry.waitForExistence(timeout: 10))
            XCTAssertTrue(retry.isHittable)
            XCTAssertTrue(retry.isEnabled)
            capture(fixture, "deferred-retry-before-tap")
            retry.tap()
            XCTAssertTrue(retry.waitForExistence(timeout: 5))
            for tab in ["My Drives", "Settings", "Plan"] {
                let button = fixture.application.tabBars.buttons[tab]
                XCTAssertTrue(button.isHittable, tab)
                button.tap()
                XCTAssertTrue(retry.isHittable, tab)
                XCTAssertFalse(fixture.element("account.sign-in").exists, tab)
                XCTAssertFalse(fixture.element("migration.recover").exists, tab)
                capture(fixture, "deferred-\(tab)")
            }
        }
    }

    // MARK: - Gap E: iPhone SE AX5

    func testSEAX5DrivingDepartureTransportAndWrapRemainReachable() {
        let fixture = FixtureApp(scenario: .drivingQATwoStops)
        fixture.launch()
        defer { fixture.application.terminate() }

        // Open drive detail -> tap start
        XCTAssertTrue(fixture.element("screen.library").waitForExistence(timeout: 10))
        let drive = fixture.element("library.drive.00000002-0000-4000-8000-000000000003")
        XCTAssertTrue(drive.waitForExistence(timeout: 5))
        drive.tap()
        XCTAssertTrue(fixture.element("screen.drive-detail").waitForExistence(timeout: 5))
        let startButton = fixture.element("drive.start")
        XCTAssertTrue(startButton.waitForExistence(timeout: 5))
        startButton.tap()

        // Scoped scroll inside driving-screen
        let scroll = fixture.application.scrollViews.matching(identifier: "driving-screen").firstMatch
        XCTAssertTrue(scroll.waitForExistence(timeout: 5))
        let simulateButton = fixture.element("start-drive")
        reveal(in: scroll, fixture: fixture, description: "departure gate start-drive under AX5",
               targetFrame: { simulateButton.exists ? simulateButton.frame : nil }) {
            simulateButton.exists && simulateButton.isHittable && self.isFullyVisible(simulateButton, in: scroll, app: fixture.application)
        }
        capture(fixture, "se-ax5-gate-start-hittable")
        simulateButton.tap()

        // Wait for Stop 0 to complete and Stop 1 to become active (1 / 2 stops)
        let stop1State = fixture.application.staticTexts.matching(
            NSPredicate(format: "label == %@ OR identifier == %@", "1 / 2 stops", "1 / 2 stops")
        ).firstMatch
        XCTAssertTrue(stop1State.waitForExistence(timeout: 20))

        let nowPlayingText = fixture.application.staticTexts.matching(
            NSPredicate(format: "label == %@ OR identifier == %@", "NOW PLAYING", "NOW PLAYING")
        ).firstMatch
        XCTAssertTrue(nowPlayingText.waitForExistence(timeout: 10))

        // Transport Pause and Resume under AX5
        let pauseButton = fixture.application.buttons["Pause"]
        reveal(in: scroll, fixture: fixture, description: "transport Pause button under AX5",
               targetFrame: { pauseButton.exists ? pauseButton.frame : nil }) {
            pauseButton.exists && pauseButton.isHittable && self.isFullyVisible(pauseButton, in: scroll, app: fixture.application)
        }
        capture(fixture, "se-ax5-transport-pause-hittable")
        pauseButton.tap()

        let pausedText = fixture.application.staticTexts.matching(
            NSPredicate(format: "label == %@ OR identifier == %@", "PAUSED", "PAUSED")
        ).firstMatch
        XCTAssertTrue(pausedText.waitForExistence(timeout: 5))

        let resumeButton = fixture.application.buttons["Resume"]
        reveal(in: scroll, fixture: fixture, description: "transport Resume button under AX5",
               targetFrame: { resumeButton.exists ? resumeButton.frame : nil }) {
            resumeButton.exists && resumeButton.isHittable && self.isFullyVisible(resumeButton, in: scroll, app: fixture.application)
        }
        capture(fixture, "se-ax5-transport-resume-hittable")
        resumeButton.tap()

        XCTAssertTrue(nowPlayingText.waitForExistence(timeout: 5))

        // Pull over button hittability under AX5: reveal in scroll before asserting hittable
        let pullOverButton = fixture.application.buttons["Pull over"]
        reveal(in: scroll, fixture: fixture, description: "transport Pull over button under AX5",
               targetFrame: { pullOverButton.exists ? pullOverButton.frame : nil }) {
            pullOverButton.exists && pullOverButton.isHittable && self.isFullyVisible(pullOverButton, in: scroll, app: fixture.application)
        }
        capture(fixture, "se-ax5-transport-pullover-hittable")

        // Forward 15 seconds: reveal in scroll before hittability/tap, then tap x3
        let forwardButton = fixture.application.buttons["Forward 15 seconds"]
        reveal(in: scroll, fixture: fixture, description: "transport Forward 15 seconds under AX5",
               targetFrame: { forwardButton.exists ? forwardButton.frame : nil }) {
            forwardButton.exists && forwardButton.isHittable && self.isFullyVisible(forwardButton, in: scroll, app: fixture.application)
        }
        capture(fixture, "se-ax5-transport-forward-hittable")
        forwardButton.tap()
        forwardButton.tap()
        forwardButton.tap()

        // Bounded wait for wrap completion (~45s)
        let wrapText = fixture.application.staticTexts.matching(
            NSPredicate(format: "label CONTAINS[c] %@", "That's a wrap")
        ).firstMatch
        XCTAssertTrue(wrapText.waitForExistence(timeout: 45))

        // Verify Ride again and Back to your drive controls: reveal both in scroll
        let rideAgainButton = fixture.application.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] %@ OR identifier == %@", "Ride again", "ride-again")
        ).firstMatch
        reveal(in: scroll, fixture: fixture, description: "wrap completion Ride again button under AX5",
               targetFrame: { rideAgainButton.exists ? rideAgainButton.frame : nil }) {
            rideAgainButton.exists && rideAgainButton.isHittable && self.isFullyVisible(rideAgainButton, in: scroll, app: fixture.application)
        }
        capture(fixture, "se-ax5-wrap-rideagain-hittable")

        let backButton = fixture.application.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] %@ OR identifier == %@", "Back to your drive", "back-to-drive")
        ).firstMatch
        reveal(in: scroll, fixture: fixture, description: "wrap completion back button under AX5",
               targetFrame: { backButton.exists ? backButton.frame : nil }) {
            backButton.exists && backButton.isHittable && self.isFullyVisible(backButton, in: scroll, app: fixture.application)
        }
        capture(fixture, "se-ax5-wrap-back-hittable")
        backButton.tap()

        XCTAssertTrue(fixture.element("screen.library").waitForExistence(timeout: 5))
    }

    func testSEAX5PlannerComposerAndProposalCardRemainReachable() {
        let fixture = FixtureApp(scenario: .plannerAccountRetry)
        fixture.launch()
        defer { fixture.application.terminate() }

        // Planner composer bar: verify input field and send button are visible and hittable
        let inputField = fixture.element("planner.input")
        XCTAssertTrue(inputField.waitForExistence(timeout: 10))
        XCTAssertTrue(inputField.isHittable)

        let sendButton = fixture.element("planner.send")
        XCTAssertTrue(sendButton.waitForExistence(timeout: 5))
        XCTAssertTrue(sendButton.isHittable)
        capture(fixture, "se-ax5-planner-composer-hittable")

        // Tap input, type prompt, and send
        inputField.tap()
        inputField.typeText("A quiet fixture drive")
        sendButton.tap()

        // Proposal card appears inside scroll container
        let proposal = fixture.element("planner.proposal")
        XCTAssertTrue(proposal.waitForExistence(timeout: 10))
        // The transcript by name: the multiline composer is a text view, so it is also a
        // scroll view and `firstMatch` can land on its 40 pt viewport instead (2026-09-16).
        let scroll = fixture.application.scrollViews.matching(identifier: "planner.transcript").firstMatch

        // Make drive button: reveal in scroll before asserting hittable / tapping
        let makeButton = fixture.element("proposal.make")
        reveal(in: scroll, fixture: fixture, description: "planner proposal make button under AX5",
               targetFrame: { makeButton.exists ? makeButton.frame : nil }) {
            makeButton.exists && makeButton.isHittable && self.isFullyVisible(makeButton, in: scroll, app: fixture.application)
        }
        capture(fixture, "se-ax5-planner-proposal-card-hittable")
        makeButton.tap()

        // Sign in button: reveal in scroll before asserting hittable / tapping
        let signInButton = fixture.element("proposal.sign-in")
        reveal(in: scroll, fixture: fixture, description: "planner proposal sign in button under AX5",
               targetFrame: { signInButton.exists ? signInButton.frame : nil }) {
            signInButton.exists && signInButton.isHittable && self.isFullyVisible(signInButton, in: scroll, app: fixture.application)
        }
        capture(fixture, "se-ax5-planner-proposal-signin-hittable")
        signInButton.tap()

        // Auth sheet appears with hittable fields
        let emailField = fixture.element("auth.email")
        XCTAssertTrue(emailField.waitForExistence(timeout: 5))
        XCTAssertTrue(emailField.isHittable)
        capture(fixture, "se-ax5-planner-auth-sheet-hittable")
    }

    private func reveal(in scrollContainer: XCUIElement, fixture: FixtureApp, description: String,
                        targetFrame: () -> CGRect?,
                        file: StaticString = #filePath, line: UInt = #line,
                        isRevealed: () -> Bool) {
        var lastDirection: CGFloat?
        for attempt in 0..<12 {
            if isRevealed() { return }
            if attempt == 0 {
                guard scrollContainer.waitForExistence(timeout: 5) else {
                    capture(fixture, "unreachable-\(description)")
                    XCTFail("Required content/control is offscreen and no scroll view exists to reveal it: \(description)", file: file, line: line)
                    return
                }
            }
            let viewport = visibleViewport(scrollContainer, app: fixture.application)
            guard viewport.height > 40, viewport.width > 0 else {
                XCTFail("No unobscured scroll viewport for \(description)", file: file, line: line)
                return
            }
            // The collection's frame extends behind iOS 26's floating tab bar. A default
            // swipe can start on that bar; derive this gesture from the unobscured frame.
            // Align a known target rather than jumping past a tall AX5 paragraph.
            let desiredDelta = targetFrame().map { $0.midY - viewport.midY } ?? viewport.height * 0.4
            let direction: CGFloat = desiredDelta >= 0 ? 1 : -1
            let inset: CGFloat = 20
            var travel = min(abs(desiredDelta), viewport.height * 0.4)
            if let lastDirection, lastDirection != direction {
                travel /= 2
            }
            lastDirection = direction
            let startY = desiredDelta >= 0 ? viewport.maxY - inset : viewport.minY + inset
            let endY = desiredDelta >= 0 ? startY - travel : startY + travel
            let x = viewport.midX
            let origin = fixture.application.coordinate(withNormalizedOffset: .zero)
            let start = origin.withOffset(CGVector(dx: x, dy: startY))
            let end = origin.withOffset(CGVector(dx: x, dy: endY))
            start.press(forDuration: 0.1, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.3)
        }
        if isRevealed() { return }
        capture(fixture, "unreachable-\(description)")
        XCTFail("Required content/control cannot be reached by scrolling: \(description)", file: file, line: line)
    }

    private func visibleViewport(_ container: XCUIElement, app: XCUIApplication) -> CGRect {
        let base = container.exists ? container.frame : app.frame
        var viewport = base.intersection(app.frame)
        let tabBar = app.tabBars.firstMatch
        if tabBar.exists && tabBar.isHittable && viewport.intersects(tabBar.frame) {
            viewport.size.height = max(0, tabBar.frame.minY - viewport.minY)
        }
        return viewport
    }

    private func isFullyVisible(_ element: XCUIElement, in container: XCUIElement, app: XCUIApplication) -> Bool {
        let frame = element.frame
        return !frame.isEmpty && visibleViewport(container, app: app).contains(frame)
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
