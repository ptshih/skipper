import XCTest

/// Deliberately fails if the app's fixture seam/real screen is absent; never skips to look green.
@MainActor
final class OfflineSmokeTests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testOfflineLibraryOpensRetainedPartialDrive() {
        let fixture = FixtureApp(scenario: .offlineLibrary)
        fixture.launch()
        XCTAssertTrue(fixture.element("screen.library").waitForExistence(timeout: 10))
        let drive = fixture.element("library.drive.00000002-0000-4000-8000-000000000001")
        XCTAssertTrue(drive.waitForExistence(timeout: 5))
        drive.tap()
        XCTAssertTrue(fixture.element("screen.drive-detail").waitForExistence(timeout: 5))
        XCTAssertTrue(fixture.element("drive.missing-summary").exists)
        XCTAssertTrue(fixture.element("drive.start").isEnabled)
        attachScreenshot(fixture.application, name: "offline-partial-drive")
    }

    func testOfflineEmptyStateDoesNotOfferUnavailablePlayback() {
        let fixture = FixtureApp(scenario: .offlineEmpty)
        fixture.launch()
        XCTAssertTrue(fixture.element("library.empty").waitForExistence(timeout: 10))
        XCTAssertFalse(fixture.element("drive.start").exists)
        attachScreenshot(fixture.application, name: "offline-empty-library")
    }

    func testSignedOutMarkerCannotRestoreOldLibrary() {
        let fixture = FixtureApp(scenario: .signedOut)
        fixture.launch()

        // Cold Library launch presents auth modal immediately over neutral empty state; no error screen
        XCTAssertTrue(fixture.element("account.sign-in").waitForExistence(timeout: 10))
        XCTAssertTrue(fixture.element("library.empty").exists)
        XCTAssertFalse(fixture.element("library.error").exists)
        XCTAssertFalse(fixture.element("library.drive.00000002-0000-4000-8000-000000000001").exists)
        attachScreenshot(fixture.application, name: "signed-out-library-auth-sheet")

        // Dismiss modal via Cancel: leaves stable neutral empty library without error flash or reopen loop
        let cancelButton = fixture.application.buttons["Cancel"]
        XCTAssertTrue(cancelButton.waitForExistence(timeout: 5))
        cancelButton.tap()
        XCTAssertTrue(fixture.element("library.empty").waitForExistence(timeout: 5))
        XCTAssertFalse(fixture.element("account.sign-in").exists)
        XCTAssertFalse(fixture.element("library.error").exists)
        attachScreenshot(fixture.application, name: "signed-out-library-dismissed-neutral")

        // Plan / back reopens: switching away to Plan and back to My Drives reopens the auth sheet
        let planTab = fixture.application.tabBars.buttons["Plan"]
        XCTAssertTrue(planTab.waitForExistence(timeout: 5))
        planTab.tap()
        XCTAssertTrue(fixture.element("planner.input").waitForExistence(timeout: 5))
        XCTAssertFalse(fixture.element("account.sign-in").exists)

        let libraryTab = fixture.application.tabBars.buttons["My Drives"]
        XCTAssertTrue(libraryTab.waitForExistence(timeout: 5))
        libraryTab.tap()
        XCTAssertTrue(fixture.element("account.sign-in").waitForExistence(timeout: 5))
        XCTAssertTrue(fixture.element("library.empty").exists)
        XCTAssertFalse(fixture.element("library.error").exists)
        attachScreenshot(fixture.application, name: "signed-out-library-reopened-auth-sheet")
    }

    func testDeferredMigrationOffersRetryWithoutClaimingSignOut() {
        let fixture = FixtureApp(scenario: .migrationDeferred)
        fixture.launch()
        XCTAssertTrue(fixture.element("migration.retry").waitForExistence(timeout: 10))
        XCTAssertFalse(fixture.element("account.sign-in").exists)
        attachScreenshot(fixture.application, name: "migration-deferred")
        // A locked/unavailable credential read is not signed-out state. Check every tab:
        // keeping the tab subtree alive must not expose a competing account-entry path.
        for tab in ["My Drives", "Settings", "Plan"] {
            let destination = fixture.application.tabBars.buttons[tab]
            XCTAssertTrue(destination.waitForExistence(timeout: 5))
            XCTAssertTrue(destination.isHittable)
            destination.tap()
            XCTAssertTrue(fixture.element("migration.retry").waitForExistence(timeout: 5))
            XCTAssertFalse(fixture.element("account.sign-in").exists, tab)
            XCTAssertFalse(fixture.element("migration.recover").exists, tab)
            XCTAssertFalse(fixture.element("library.drive.00000002-0000-4000-8000-000000000001").exists, tab)
            attachScreenshot(fixture.application, name: "migration-deferred-\(tab)")
        }
    }

    func testOfflineLibraryRendersAcrossThemes() {
        for theme in FixtureApp.Theme.allCases {
            let fixture = FixtureApp(scenario: .offlineLibrary, theme: theme)
            fixture.launch()
            XCTAssertTrue(fixture.element("screen.library").waitForExistence(timeout: 10))
            attachScreenshot(fixture.application, name: "offline-library-\(theme.rawValue)")
            fixture.application.terminate()
        }
    }

    func testSimulatedTwoStopDrivingCycle() {
        let fixture = FixtureApp(scenario: .drivingQATwoStops)
        fixture.launch()

        // 1. Library: verify drive card appears and open detail
        if !fixture.element("screen.library").waitForExistence(timeout: 5) {
            let libraryTab = fixture.application.tabBars.buttons["My Drives"]
            if libraryTab.waitForExistence(timeout: 5) {
                libraryTab.tap()
            }
        }
        XCTAssertTrue(fixture.element("screen.library").waitForExistence(timeout: 10))
        let drive = fixture.element("library.drive.00000002-0000-4000-8000-000000000003")
        XCTAssertTrue(drive.waitForExistence(timeout: 5))
        attachScreenshot(fixture.application, name: "driving-qa-1-library")
        drive.tap()

        // 2. Detail: verify start button enabled and tap it
        XCTAssertTrue(fixture.element("screen.drive-detail").waitForExistence(timeout: 5))
        let startButton = fixture.element("drive.start")
        XCTAssertTrue(startButton.waitForExistence(timeout: 5))
        XCTAssertTrue(startButton.isEnabled)
        attachScreenshot(fixture.application, name: "driving-qa-2-detail")
        startButton.tap()

        // 3. Departure gate: verify admin simulation trigger and tap Simulate drive
        XCTAssertTrue(fixture.element("driving-screen").waitForExistence(timeout: 5))
        let simulateButton = fixture.element("start-drive")
        XCTAssertTrue(simulateButton.waitForExistence(timeout: 5))
        attachScreenshot(fixture.application, name: "driving-qa-3-gate")
        simulateButton.tap()

        // 4. Driving phase: simulation indicator and initial zero stops counter
        let simulationText = text("SIMULATION", in: fixture.application)
        XCTAssertTrue(simulationText.waitForExistence(timeout: 5))
        let zeroStopsText = text("0 / 2 stops", in: fixture.application)
        XCTAssertTrue(zeroStopsText.waitForExistence(timeout: 5))

        // 5. Stop 0 triggers and finishes (250ms), Stop 1 triggers: 1 / 2 stops state lasts 55s
        let stop1State = text("1 / 2 stops", in: fixture.application)
        XCTAssertTrue(stop1State.waitForExistence(timeout: 20))
        let nowPlaying = text("NOW PLAYING", in: fixture.application)
        XCTAssertTrue(nowPlaying.waitForExistence(timeout: 10))
        attachScreenshot(fixture.application, name: "driving-qa-4-playing-stop1")

        // 6. Transport test during long Stop 1: Pause and Resume
        let pauseButton = fixture.application.buttons["Pause"]
        XCTAssertTrue(pauseButton.waitForExistence(timeout: 5))
        pauseButton.tap()
        let paused = text("PAUSED", in: fixture.application)
        XCTAssertTrue(paused.waitForExistence(timeout: 5))
        attachScreenshot(fixture.application, name: "driving-qa-5-paused")

        let resumeButton = fixture.application.buttons["Resume"]
        XCTAssertTrue(resumeButton.waitForExistence(timeout: 5))
        resumeButton.tap()
        XCTAssertTrue(nowPlaying.waitForExistence(timeout: 5))
        attachScreenshot(fixture.application, name: "driving-qa-6-resumed")

        // 7. Advance near end of Stop 1 audio via transport controls (required assertion, no optional skip)
        let forwardButton = fixture.application.buttons["Forward 15 seconds"]
        XCTAssertTrue(forwardButton.waitForExistence(timeout: 5))
        XCTAssertTrue(forwardButton.isHittable)
        forwardButton.tap()
        forwardButton.tap()
        forwardButton.tap()

        // 8. Bounded wait for Stop 1 completion and route finish -> That's a wrap, road crew.
        let wrapText = text("That's a wrap, road crew.", in: fixture.application)
        XCTAssertTrue(wrapText.waitForExistence(timeout: 45))
        let summaryText = text("2 stops heard. Thanks for riding along.", in: fixture.application)
        XCTAssertTrue(summaryText.waitForExistence(timeout: 5))
        attachScreenshot(fixture.application, name: "driving-qa-7-completion")

        // 9. Re-ride: tap Ride again and verify re-arming driving phase and zero stops counter
        let rideAgainButton = fixture.application.buttons["Ride again"]
        XCTAssertTrue(rideAgainButton.waitForExistence(timeout: 5))
        rideAgainButton.tap()

        XCTAssertTrue(simulationText.waitForExistence(timeout: 5))
        XCTAssertTrue(zeroStopsText.waitForExistence(timeout: 5))
        attachScreenshot(fixture.application, name: "driving-qa-8-ride-again")
    }

    private func text(_ label: String, in app: XCUIApplication) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label == %@ OR identifier == %@", label, label)).firstMatch
    }

    private func attachScreenshot(_ application: XCUIApplication, name: String) {
        let attachment = XCTAttachment(screenshot: application.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
