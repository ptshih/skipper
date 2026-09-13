import XCTest
import UIKit
@testable import Skipper

final class FoundationTests: XCTestCase {
    func testRegionDecorationDegradesWithoutDisablingPlanner() throws {
        let data = Data(#"{"regions":[{"id":"00000001-0000-4000-8000-000000000001","slug":"test","displayName":"Test","ready":null,"examples":[{"shape":"unknown","title":"x","ask":"x"}],"exampleAnchors":false}],"adjustSay":null}"#.utf8)
        let response = try decodeContract(Bootstrap.self, from: data)
        XCTAssertTrue(response.regions[0].ready)
        XCTAssertEqual(response.regions[0].examples, [])
        XCTAssertEqual(response.regions[0].exampleAnchors, [])
        XCTAssertEqual(response.adjustSay, "")
    }
    func testMissingDoneDefaultsButNullIsRejected() throws {
        XCTAssertFalse(try decodeContract(DrivePlanResponse.self, from: Data(#"{"say":"Hello"}"#.utf8)).done)
        XCTAssertThrowsError(try decodeContract(DrivePlanResponse.self, from: Data(#"{"say":"Hello","done":null}"#.utf8)))
    }
    func testManifestRequiresNullableDriveIDKeyAndExactCoordinateTuple() {
        XCTAssertThrowsError(try decodeContract(DriveManifest.self, from: Data(#"{"label":"x","polyline":[],"clips":[]}"#.utf8)))
        XCTAssertThrowsError(try decodeContract(Coordinate.self, from: Data("[1,2,3]".utf8)))
    }
    func testMinutePrecisionAndCalendarDatesFollowWireContract() throws {
        let valid = Data(#"{"driveId":"00000002-0000-4000-8000-000000000001","label":"x","clipCount":0,"createdAt":"2026-09-12T01:23Z"}"#.utf8)
        XCTAssertEqual(try decodeContract(DriveSummary.self, from: valid).createdAt, "2026-09-12T01:23Z")
        let invalid = Data(String(decoding: valid, as: UTF8.self).replacingOccurrences(of: "2026-09-12T01:23Z", with: "2026-02-30T01:23:00Z").utf8)
        XCTAssertThrowsError(try decodeContract(DriveSummary.self, from: invalid))
    }
    func testUITestingIsRecognizedBeforeProductionServices() {
        let launch = AppLaunchConfiguration.read(environment: ["SKIPPER_UI_TESTING":"1", "SKIPPER_UI_SCENARIO":"unknown", "SKIPPER_UI_RUN_ID":UUID().uuidString])
        XCTAssertFalse(launch.allowsLiveServices)
        XCTAssertEqual(AppLaunchConfiguration.read(environment: ["SKIPPER_UI_TESTING":"1"]).mode, .rejectedTestConfiguration)
    }
    @MainActor func testBundledBrandFontsResolve() {
        for name in ["ZillaSlab-Bold", "Lora-Regular", "Lora-SemiBold", "Lora-Bold", "OverpassMono-Regular", "OverpassMono-SemiBold"] {
            XCTAssertNotNil(UIFont(name: name, size: 16), name)
        }
    }
    @MainActor func testDeepLinkDoesNotPerformARequest() {
        let model = AppModel(dependencies: nil)
        model.open(URL(string: "skipper://drives/00000002-0000-4000-8000-000000000001")!)
        XCTAssertEqual(model.path, [.drive("00000002-0000-4000-8000-000000000001")])
        model.open(URL(string: "https://evil.invalid/drives/anything")!)
        XCTAssertEqual(model.path.count, 1)
    }

    @MainActor func testDeepLinkWhileDrivingIsDeferredUntilStopDrive() {
        let model = AppModel(dependencies: nil)
        model.playbackPresented = true
        model.open(URL(string: "skipper://drives/00000002-0000-4000-8000-000000000003")!)
        XCTAssertTrue(model.path.isEmpty, "Path must not change while playback is presented")
        XCTAssertEqual(model.selectedTab, MainTab.planner, "Tab must not switch while playback is presented")

        model.stopDrive()
        XCTAssertFalse(model.playbackPresented)
        XCTAssertEqual(model.path, [.drive("00000002-0000-4000-8000-000000000003")])
        XCTAssertEqual(model.selectedTab, MainTab.library)
    }

    @MainActor func testForcedVersionGateSuppressesDeferredDeepLinkDelivery() async throws {
        let policyData = Data(#"{"platform":"ios","minimum":"2.0.0","recommended":"2.0.0","storeUrl":"https://apps.apple.com/app/id6778946770"}"#.utf8)
        let decodedPolicy = try JSONDecoder().decode(VersionPolicy.self, from: policyData)
        let policy = VersionPolicyController(
            currentVersion: "1.0.0",
            loadPolicies: { [decodedPolicy] },
            readDismissal: { nil },
            saveDismissal: { _ in })
        await policy.checkOnce()
        XCTAssertEqual(policy.gate, VersionPolicyController.Gate.force)

        let model = AppModel(dependencies: nil, versionPolicy: policy)
        XCTAssertTrue(model.blocksForUpdate)

        model.playbackPresented = true
        model.open(URL(string: "skipper://drives/00000002-0000-4000-8000-000000000003")!)
        XCTAssertTrue(model.path.isEmpty, "Path must not change while playback is presented")

        model.stopDrive()
        XCTAssertFalse(model.playbackPresented)
        XCTAssertTrue(model.path.isEmpty, "Deferred deep link must be suppressed when force version gate is active")
        XCTAssertEqual(model.selectedTab, MainTab.planner, "Selected tab must not switch to library when force gated")
    }
}
