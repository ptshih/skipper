import XCTest

/// Debug app launch contract. The app owner supplies isolated services before initialization.
/// No test injects arbitrary server URLs, real credentials, or paths into the app process.
@MainActor
struct FixtureApp {
    enum Scenario: String {
        case offlineLibrary = "offline-library"
        case offlineEmpty = "offline-empty"
        case signedOut = "signed-out"
        case migrationDeferred = "migration-deferred"
        case plannerAccountRetry = "planner-account-retry"
        case plannerAccountLostAck = "planner-account-lost-ack"
        case offlineNoPlayableClips = "offline-no-playable-clips"
        case corruptCredentialsRecovery = "corrupt-credentials-recovery"
        case plannerResetDuringStream = "planner-reset-during-stream"
        case plannerMapLandmark = "planner-map-landmark"
        case versionForce = "version-force"
        case versionRecommended = "version-recommended"
        case versionForceDelayedSheet = "version-force-delayed-sheet"
        case versionRecommendedDelayedPlanner = "version-recommended-delayed-planner"
        case drivingQATwoStops = "driving-qa-two-stops"
    }

    enum Theme: String, CaseIterable {
        case light, dark, system
    }

    let application: XCUIApplication
    let runID: String

    init(scenario: Scenario, theme: Theme = .light, runID: String = UUID().uuidString) {
        self.runID = runID
        application = XCUIApplication()
        application.launchEnvironment.merge([
            "SKIPPER_UI_TESTING": "1",
            "SKIPPER_UI_SCENARIO": scenario.rawValue,
            "SKIPPER_UI_RUN_ID": runID,
            "SKIPPER_UI_THEME": theme.rawValue,
        ], uniquingKeysWith: { _, fixtureValue in fixtureValue })
    }

    func launch() {
        application.launch()
    }

    func element(_ identifier: String) -> XCUIElement {
        application.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }
}
