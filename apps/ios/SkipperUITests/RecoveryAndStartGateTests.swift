import XCTest

@MainActor
final class RecoveryAndStartGateTests: XCTestCase {
    private let oldDrive = "library.drive.00000002-0000-4000-8000-000000000001"
    override func setUpWithError() throws { continueAfterFailure = false }

    func testOfflinePartialDriveReachesPlaybackPreparation() {
        let fixture = FixtureApp(scenario: .offlineLibrary)
        fixture.launch()
        defer { fixture.application.terminate() }
        openSavedDetail(fixture)
        let start = fixture.element("drive.start")
        XCTAssertTrue(start.isEnabled)
        capture(fixture, "partial-before-start")
        start.tap()
        XCTAssertTrue(fixture.element("driving-screen").waitForExistence(timeout: 10))
        capture(fixture, "partial-playback-preparation")
        // Do not press Let's roll: this proves the gate and navigation, not decoding or GPS.
    }

    func testOfflineManifestWithNoUsableClipsCannotStart() {
        let fixture = FixtureApp(scenario: .offlineNoPlayableClips)
        fixture.launch()
        defer { fixture.application.terminate() }
        // The shipped Library omits saved drives with zero present clips.
        XCTAssertTrue(fixture.element("library.empty").waitForExistence(timeout: 10))
        XCTAssertFalse(fixture.element(oldDrive).exists)
        XCTAssertFalse(fixture.element("drive.start").exists)
        XCTAssertFalse(fixture.element("driving-screen").exists)
        capture(fixture, "offline-no-playable-clips")
    }

    func testManualCredentialRecoveryNeverExposesUnknownOwnerDrive() {
        let fixture = FixtureApp(scenario: .corruptCredentialsRecovery)
        fixture.launch()
        defer { fixture.application.terminate() }
        XCTAssertTrue(fixture.element("migration.recover").waitForExistence(timeout: 10))
        XCTAssertFalse(fixture.element(oldDrive).exists)
        capture(fixture, "corrupt-before-manual-recovery")
        fixture.element("migration.recover").tap()
        let email = fixture.element("auth.email")
        XCTAssertTrue(email.waitForExistence(timeout: 5))
        email.tap(); email.typeText("rider@example.invalid")
        fixture.element("auth.send-code").tap()
        let code = fixture.element("auth.code")
        XCTAssertTrue(code.waitForExistence(timeout: 5))
        code.tap(); code.typeText("123456")
        fixture.element("auth.verify").tap()
        XCTAssertTrue(fixture.element("screen.library").waitForExistence(timeout: 10))
        XCTAssertFalse(fixture.element(oldDrive).exists)
        capture(fixture, "recovered-unknown-owner-still-hidden")
        fixture.application.terminate()
        // The same run ID must retain the mock Keychain and file mutations, not reseed identity.
        fixture.launch()
        XCTAssertTrue(fixture.element("screen.library").waitForExistence(timeout: 10))
        XCTAssertFalse(fixture.element(oldDrive).exists)
        capture(fixture, "recovered-after-relaunch")
    }

    private func openSavedDetail(_ fixture: FixtureApp) {
        XCTAssertTrue(fixture.element("screen.library").waitForExistence(timeout: 10))
        let drive = fixture.element(oldDrive)
        XCTAssertTrue(drive.waitForExistence(timeout: 5))
        capture(fixture, "library-before-open")
        drive.tap()
        XCTAssertTrue(fixture.element("screen.drive-detail").waitForExistence(timeout: 5))
    }

    private func capture(_ fixture: FixtureApp, _ state: String) {
        let attachment = XCTAttachment(screenshot: fixture.application.screenshot())
        attachment.name = "\(fixture.runID)-\(state)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
