import XCTest
@testable import Skipper

final class AnalyticsContractTests: XCTestCase {
    func testRejectsUnknownEventsAndIdentityOrProseProperties() {
        XCTAssertNil(AnalyticsContract.validate("arbitrary", properties: [:]))
        for key in ["driveId", "email", "url", "prompt", "latitude", "message", "$set"] {
            XCTAssertNil(AnalyticsContract.validate("drive_created", properties: [key: "never-send"]))
        }
        XCTAssertNil(AnalyticsContract.validate("wall_shown", properties: ["source": "a rider's prose"]))
    }
    func testNullableProposalCountsAndFiniteTypedValues() {
        let valid: [String: Any] = ["stop_count": NSNull(), "duration_min": 3.5, "round_trip": false, "has_clip": true]
        XCTAssertNotNil(AnalyticsContract.validate("proposal_shown", properties: valid))
        for value: Any in [Double.nan, Double.infinity, -1, "3", true] {
            var invalid = valid; invalid["duration_min"] = value
            XCTAssertNil(AnalyticsContract.validate("proposal_shown", properties: invalid))
        }
        XCTAssertNil(AnalyticsContract.validate("plan_turn_sent", properties: ["turn_index": 1.5, "retry": false]))
        XCTAssertNil(AnalyticsContract.validate("preview_clip_played", properties: ["completed": 1]))
    }
    func testDriveEventsUseOnlyOrdinalsAndClosedFormReasonMode() {
        let properties: [String: Any] = ["mode": "live", "elapsed_sec": 12, "stop_index": 1, "stop_form": "scenic", "reason": "no_audio"]
        XCTAssertNotNil(AnalyticsContract.validate("stop_skipped", properties: properties))
        var bad = properties; bad["stop_form"] = "unrecognized prose"
        XCTAssertNil(AnalyticsContract.validate("stop_skipped", properties: bad))
    }
}
