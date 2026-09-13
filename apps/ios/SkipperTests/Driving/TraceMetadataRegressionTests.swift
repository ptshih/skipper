import XCTest
@testable import Skipper

final class TraceMetadataRegressionTests: XCTestCase {
    func testMinimalHistoricalTraceAcceptsMissingMetadataWithTSDefaults() {
        let minimalJson = """
        {
            "driveId": "drive-historical-123",
            "fixes": [
                {
                    "timestamp": 1700000000000,
                    "coords": {
                        "latitude": 37.7749,
                        "longitude": -122.4194
                    }
                }
            ]
        }
        """

        let env = parseTraceEnvelope(json: minimalJson)
        XCTAssertNotNil(env, "Trace parser should accept minimal trace missing optional metadata")
        guard let env else { return }

        XCTAssertEqual(env.driveId, "drive-historical-123")
        XCTAssertEqual(env.version, 0, "TS default version is 0 when missing")
        XCTAssertEqual(env.recordedAt, "", "TS default recordedAt is empty string when missing")
        XCTAssertEqual(env.routeVertices, 0, "TS default routeVertices is 0 when missing")
        XCTAssertEqual(env.routeHash, "", "TS default routeHash is empty string when missing")
        XCTAssertFalse(env.truncated, "TS default truncated is false when missing")
        XCTAssertNil(env.label)
        XCTAssertNil(env.appVersion)
        XCTAssertEqual(env.fixes.count, 1)
        XCTAssertEqual(env.fixes[0].coords.latitude, 37.7749)
    }

    func testInvalidTraceRejections() {
        // Missing driveId
        let missingDriveId = """
        {
            "fixes": []
        }
        """
        XCTAssertNil(parseTraceEnvelope(json: missingDriveId))

        // Non-array fixes
        let badFixes = """
        {
            "driveId": "drive-1",
            "fixes": "not-an-array"
        }
        """
        XCTAssertNil(parseTraceEnvelope(json: badFixes))

        // Malformed first fix (missing latitude)
        let malformedFirstFix = """
        {
            "driveId": "drive-1",
            "fixes": [
                {
                    "timestamp": 12345,
                    "coords": {
                        "longitude": -122.0
                    }
                }
            ]
        }
        """
        XCTAssertNil(parseTraceEnvelope(json: malformedFirstFix))
    }
}
