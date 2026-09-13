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

    private func reveal(in scrollContainer: XCUIElement, fixture: FixtureApp, description: String,
                        targetFrame: () -> CGRect?,
                        file: StaticString = #filePath, line: UInt = #line,
                        isRevealed: () -> Bool) {
        XCTAssertTrue(scrollContainer.waitForExistence(timeout: 5), file: file, line: line)
        for _ in 0..<12 {
            if isRevealed() { return }
            let viewport = visibleViewport(scrollContainer, app: fixture.application)
            guard viewport.height > 40, viewport.width > 0 else {
                XCTFail("No unobscured scroll viewport for \(description)", file: file, line: line)
                return
            }
            // The collection's frame extends behind iOS 26's floating tab bar. A default
            // swipe can start on that bar; derive this gesture from the unobscured frame.
            // Align a known target rather than jumping past a tall AX5 paragraph.
            let desiredDelta = targetFrame().map { $0.midY - viewport.midY } ?? viewport.height * 0.4
            let delta = max(-viewport.height * 0.4, min(viewport.height * 0.4, desiredDelta))
            let origin = fixture.application.coordinate(withNormalizedOffset: .zero)
            let start = origin.withOffset(CGVector(dx: viewport.midX, dy: viewport.midY + delta / 2))
            let end = origin.withOffset(CGVector(dx: viewport.midX, dy: viewport.midY - delta / 2))
            start.press(forDuration: 0.05, thenDragTo: end)
        }
        if isRevealed() { return }
        capture(fixture, "unreachable-\(description)")
        XCTFail("Required content/control cannot be reached by scrolling: \(description)", file: file, line: line)
    }

    private func visibleViewport(_ container: XCUIElement, app: XCUIApplication) -> CGRect {
        var viewport = container.frame.intersection(app.frame)
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
