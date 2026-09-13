import GoogleMaps
import XCTest
@testable import Skipper

@MainActor final class MapSDKBootstrapTests: XCTestCase {
    func testMapsLaunchPermissionDoesNotEnableLiveAppServicesForUIFixtures() {
        let ui = AppLaunchConfiguration(mode: .uiTest(scenario: "planner-account-retry", runID: UUID().uuidString, theme: .system))
        XCTAssertTrue(ui.allowsMapsSDK)
        XCTAssertFalse(ui.allowsLiveServices)
        XCTAssertTrue(AppLaunchConfiguration(mode: .production).allowsMapsSDK)
        XCTAssertTrue(AppLaunchConfiguration(mode: .production).allowsLiveServices)
        for mode: AppLaunchConfiguration.Mode in [.unitTest, .rejectedTestConfiguration] {
            XCTAssertFalse(AppLaunchConfiguration(mode: mode).allowsMapsSDK)
            XCTAssertFalse(AppLaunchConfiguration(mode: mode).allowsLiveServices)
        }
    }

    func testMissingInvalidOrDisabledKeyNeverRegistersAndSuccessfulRegistrationRunsOnce() {
        let bootstrap = MapSDKBootstrap()
        var calls: [String] = []
        let register: (String) -> Bool = { calls.append($0); return true }
        for key: String? in [nil, "", "  ", "$(SKIPPER_GOOGLE_MAPS_API_KEY)"] {
            bootstrap.configure(apiKey: key, allowed: true, register: register)
            XCTAssertFalse(bootstrap.isReady)
        }
        bootstrap.configure(apiKey: "SYNTHETIC", allowed: false, register: register)
        XCTAssertFalse(bootstrap.isReady)
        XCTAssertTrue(calls.isEmpty)
        bootstrap.configure(apiKey: "SYNTHETIC", allowed: true, register: register)
        XCTAssertTrue(bootstrap.isReady)
        bootstrap.configure(apiKey: "DIFFERENT", allowed: true, register: register)
        XCTAssertEqual(calls, ["SYNTHETIC"])
    }

    func testRejectedRegistrationDoesNotPermitConstructingMapObjects() {
        let bootstrap = MapSDKBootstrap()
        bootstrap.configure(apiKey: "SYNTHETIC", allowed: true) { _ in false }
        XCTAssertFalse(bootstrap.isReady)
    }
}
