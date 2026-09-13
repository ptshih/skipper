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
        XCTAssertTrue(fixture.element("account.sign-in").waitForExistence(timeout: 10))
        XCTAssertFalse(fixture.element("library.drive.00000002-0000-4000-8000-000000000001").exists)
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

    private func attachScreenshot(_ application: XCUIApplication, name: String) {
        let attachment = XCTAttachment(screenshot: application.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
