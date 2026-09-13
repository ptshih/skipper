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

    // MARK: - Gap C: Location Denied & Live Driving

    func testLocationPermissionDeniedGate() {
        let fixture = FixtureApp(scenario: .offlineLibrary)
        fixture.launch()
        XCTAssertTrue(fixture.element("screen.library").waitForExistence(timeout: 10))
        let drive = fixture.element("library.drive.00000002-0000-4000-8000-000000000001")
        XCTAssertTrue(drive.waitForExistence(timeout: 5))
        drive.tap()
        XCTAssertTrue(fixture.element("screen.drive-detail").waitForExistence(timeout: 5))
        let startButton = fixture.element("drive.start")
        XCTAssertTrue(startButton.waitForExistence(timeout: 5))
        XCTAssertTrue(startButton.isEnabled)
        startButton.tap()

        // Non-admin session renders "Let's roll" (start-drive)
        let letsRollButton = fixture.element("start-drive")
        XCTAssertTrue(letsRollButton.waitForExistence(timeout: 5))
        attachScreenshot(fixture.application, name: "location-denied-1-gate")
        letsRollButton.tap()

        // Location permission is denied -> transitions to .locationDenied phase
        let title = text("Let's get our bearings.", in: fixture.application)
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        let openSettingsButton = fixture.application.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] %@ OR identifier == %@", "Open Settings", "open-settings")
        ).firstMatch
        XCTAssertTrue(openSettingsButton.waitForExistence(timeout: 5))
        XCTAssertTrue(openSettingsButton.isHittable)
        attachScreenshot(fixture.application, name: "location-denied-2-settings-hittable")

        // CRITICAL: Do NOT tap "Open Settings" to avoid backgrounding the app or opening system prefs
        // Tap "Close" button in toolbar to dismiss gate back to Drive Detail
        let closeButton = fixture.application.buttons.matching(
            NSPredicate(format: "label == %@ OR identifier == %@ OR label CONTAINS[c] %@", "Close", "close", "xmark")
        ).firstMatch
        XCTAssertTrue(closeButton.waitForExistence(timeout: 5))
        closeButton.tap()

        XCTAssertTrue(fixture.element("screen.library").waitForExistence(timeout: 5))
        attachScreenshot(fixture.application, name: "location-denied-3-dismissed-to-library")
    }

    func testLiveLocationDrivingCycleNonAdminSimOff() {
        let fixture = FixtureApp(scenario: .drivingQALive)
        fixture.launch()

        // 1. Library: verify drive card appears and open detail
        XCTAssertTrue(fixture.element("screen.library").waitForExistence(timeout: 10))
        let drive = fixture.element("library.drive.00000002-0000-4000-8000-000000000003")
        XCTAssertTrue(drive.waitForExistence(timeout: 5))
        drive.tap()

        // 2. Detail: verify start button enabled and tap it
        XCTAssertTrue(fixture.element("screen.drive-detail").waitForExistence(timeout: 5))
        let startButton = fixture.element("drive.start")
        XCTAssertTrue(startButton.waitForExistence(timeout: 5))
        XCTAssertTrue(startButton.isEnabled)
        startButton.tap()

        // 3. Departure gate: non-admin renders "Let's roll"
        XCTAssertTrue(fixture.element("driving-screen").waitForExistence(timeout: 5))
        let startDriveButton = fixture.element("start-drive")
        XCTAssertTrue(startDriveButton.waitForExistence(timeout: 5))
        attachScreenshot(fixture.application, name: "driving-live-1-gate")
        startDriveButton.tap()

        // 4. Searching for GPS appears during 3.0s initial hold, then first fix clears it
        let searchingCue = text("Searching for GPS…", in: fixture.application)
        XCTAssertTrue(searchingCue.waitForExistence(timeout: 3))
        attachScreenshot(fixture.application, name: "driving-live-2-searching-gps")

        // First fix emitted after 3.0s clears searching cue immediately
        let stopCounter = text("0 / 2 stops", in: fixture.application)
        XCTAssertTrue(stopCounter.waitForExistence(timeout: 10))
        let searchingGonePredicate = NSPredicate(format: "exists == false")
        expectation(for: searchingGonePredicate, evaluatedWith: searchingCue, handler: nil)
        waitForExpectations(timeout: 10, handler: nil)
        attachScreenshot(fixture.application, name: "driving-live-3-first-fix-clears-searching")

        // 5. Stop 0 finishes quickly (250ms), Stop 1 triggers: 1 / 2 stops counter and NOW PLAYING
        let stop1State = text("1 / 2 stops", in: fixture.application)
        XCTAssertTrue(stop1State.waitForExistence(timeout: 20))
        let nowPlaying = text("NOW PLAYING", in: fixture.application)
        XCTAssertTrue(nowPlaying.waitForExistence(timeout: 10))
        attachScreenshot(fixture.application, name: "driving-live-4-now-playing")

        // 6. Pause / resume index preserved
        let pauseButton = fixture.application.buttons["Pause"]
        XCTAssertTrue(pauseButton.waitForExistence(timeout: 5))
        pauseButton.tap()
        let paused = text("PAUSED", in: fixture.application)
        XCTAssertTrue(paused.waitForExistence(timeout: 5))
        attachScreenshot(fixture.application, name: "driving-live-5-paused")

        let resumeButton = fixture.application.buttons["Resume"]
        XCTAssertTrue(resumeButton.waitForExistence(timeout: 5))
        resumeButton.tap()
        XCTAssertTrue(nowPlaying.waitForExistence(timeout: 5))
        attachScreenshot(fixture.application, name: "driving-live-6-resumed")

        // 7. Pull over safety exit flow
        let pullOverButton = fixture.application.buttons["Pull over"]
        XCTAssertTrue(pullOverButton.waitForExistence(timeout: 5))
        pullOverButton.tap()

        // Confirmation dialog: "Pull over and end this drive?"
        let dialogTitle = text("Pull over and end this drive?", in: fixture.application)
        XCTAssertTrue(dialogTitle.waitForExistence(timeout: 5))
        let endDriveButton = fixture.application.buttons["End drive"]
        XCTAssertTrue(endDriveButton.waitForExistence(timeout: 5))
        attachScreenshot(fixture.application, name: "driving-live-7-confirm-dialog")

        endDriveButton.tap()

        // Returns to Library
        XCTAssertTrue(fixture.element("screen.library").waitForExistence(timeout: 5))
        attachScreenshot(fixture.application, name: "driving-live-8-back-to-library")
    }

    // MARK: - Gap D: Cold Deep Links

    func testColdDeepLinkSignedInDirectToDriveDetail() {
        let fixture = FixtureApp(scenario: .coldLinkSignedIn)
        fixture.launch()

        // Opens directly to Drive Detail for Fixture Loop (id0001)
        XCTAssertTrue(fixture.element("screen.drive-detail").waitForExistence(timeout: 10))
        let title = text("Fixture Loop", in: fixture.application)
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        let startButton = fixture.element("drive.start")
        XCTAssertTrue(startButton.waitForExistence(timeout: 5))
        XCTAssertTrue(startButton.isEnabled)
        XCTAssertFalse(fixture.element("account.sign-in").exists)
        attachScreenshot(fixture.application, name: "cold-link-signed-in-detail")
    }

    func testColdDeepLinkSignedOutAccountWallNoCompetingSheets() {
        let fixture = FixtureApp(scenario: .coldLinkSignedOut)
        fixture.launch()

        // 1. Presents Drive Detail with inline account wall; NO tab-level auth modal
        XCTAssertTrue(fixture.element("drive.account-wall").waitForExistence(timeout: 10))
        XCTAssertFalse(fixture.element("account.sign-in").exists)
        attachScreenshot(fixture.application, name: "cold-link-signed-out-account-wall")

        // 2. Tap "Sign in" in account wall -> presents AuthView sheet with auth.email
        let signInButton = fixture.application.buttons["Sign in"]
        XCTAssertTrue(signInButton.waitForExistence(timeout: 5))
        signInButton.tap()

        let emailField = fixture.element("auth.email")
        XCTAssertTrue(emailField.waitForExistence(timeout: 5))
        attachScreenshot(fixture.application, name: "cold-link-signed-out-auth-sheet")

        // 3. Tap "Cancel" in auth sheet -> returns to account wall
        let cancelButton = fixture.application.buttons["Cancel"]
        XCTAssertTrue(cancelButton.waitForExistence(timeout: 5))
        cancelButton.tap()

        XCTAssertTrue(fixture.element("drive.account-wall").waitForExistence(timeout: 5))
        XCTAssertFalse(fixture.element("auth.email").exists)
        attachScreenshot(fixture.application, name: "cold-link-signed-out-cancel-to-wall")

        // 4. Tap "Keep browsing" in account wall -> dismisses to empty Library
        let keepBrowsingButton = fixture.application.buttons["Keep browsing"]
        XCTAssertTrue(keepBrowsingButton.waitForExistence(timeout: 5))
        keepBrowsingButton.tap()

        XCTAssertTrue(fixture.element("library.empty").waitForExistence(timeout: 5))
        XCTAssertFalse(fixture.element("screen.drive-detail").exists)
        attachScreenshot(fixture.application, name: "cold-link-signed-out-empty-library")
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
