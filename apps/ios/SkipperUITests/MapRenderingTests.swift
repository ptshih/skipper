import XCTest

/// The real Google renderer uses synthetic public-land geometry. No Make/account action.
/// Snapshot readiness is necessary, but inspected tiles/route and the render receipt are
/// separate acceptance evidence; neither a callback nor a passing UI assertion proves them.
@MainActor
final class MapRenderingTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    func testKnownLandProposalRendersInDayAndDusk() {
        for theme in [FixtureApp.Theme.light, .dark] {
            let fixture = FixtureApp(scenario: .plannerMapLandmark, theme: theme)
            fixture.launch()
            defer { fixture.application.terminate() }
            let input = fixture.element("planner.input")
            XCTAssertTrue(input.waitForExistence(timeout: 10))
            input.tap()
            input.typeText("A quiet fixture drive")
            fixture.element("planner.send").tap()
            let proposal = fixture.element("planner.proposal")
            XCTAssertTrue(proposal.waitForExistence(timeout: 10))
            let status = fixture.element("map.render-status")
            capture(fixture, "landmark-before-snapshot")
            XCTAssertTrue(status.waitForExistence(timeout: 10))
            let snapshot = expectation(for: NSPredicate(format: "value == %@", "snapshot-ready"), evaluatedWith: status)
            wait(for: [snapshot], timeout: 30)
            XCTAssertEqual(fixture.application.descendants(matching: .any)
                .matching(identifier: "planner.proposal").count, 1)
            XCTAssertTrue(fixture.element("proposal.make").exists)
            capture(fixture, "landmark-after-snapshot-\(theme.rawValue)")
            // Runner inspects recognizable land tiles, route and attribution, then reads
            // map-render-receipt.json for nonzero view size, fitted projected route span
            // >= 40 points, all route points in bounds, and an actual snapshot callback.
            // qa-receipt.json must show one plan/proposal and zero creates/unexpected calls.
        }
    }

    private func capture(_ fixture: FixtureApp, _ state: String) {
        let image = XCTAttachment(screenshot: fixture.application.screenshot())
        image.name = "\(fixture.runID)-\(state)"
        image.lifetime = .keepAlways
        add(image)
        let hierarchy = XCTAttachment(string: fixture.application.debugDescription)
        hierarchy.name = "\(fixture.runID)-\(state)-hierarchy"
        hierarchy.lifetime = .keepAlways
        add(hierarchy)
    }
}
