import XCTest
@testable import Skipper

final class RawFixNullEncodingTests: XCTestCase {
    func testRawFixCoordsEncodesNullForNilOptionalFields() throws {
        let coords = RawFixCoords(latitude: 34.01, longitude: -118.49, accuracy: nil, speed: nil, heading: nil)
        let data = try JSONEncoder().encode(coords)
        let jsonString = String(data: data, encoding: .utf8)!

        // Verify JSON contains explicit null for accuracy, speed, heading
        XCTAssertTrue(jsonString.contains("\"accuracy\":null"), "accuracy must serialize as null, got: \(jsonString)")
        XCTAssertTrue(jsonString.contains("\"speed\":null"), "speed must serialize as null, got: \(jsonString)")
        XCTAssertTrue(jsonString.contains("\"heading\":null"), "heading must serialize as null, got: \(jsonString)")

        // Verify round-trip decoding
        let decoded = try JSONDecoder().decode(RawFixCoords.self, from: data)
        XCTAssertEqual(decoded.latitude, 34.01)
        XCTAssertEqual(decoded.longitude, -118.49)
        XCTAssertNil(decoded.accuracy)
        XCTAssertNil(decoded.speed)
        XCTAssertNil(decoded.heading)
    }

    func testRawFixCoordsEncodesValuesWhenPresent() throws {
        let coords = RawFixCoords(latitude: 34.01, longitude: -118.49, accuracy: 5.0, speed: 12.5, heading: 180.0)
        let data = try JSONEncoder().encode(coords)
        let jsonString = String(data: data, encoding: .utf8)!

        XCTAssertTrue(jsonString.contains("\"accuracy\":5"))
        XCTAssertTrue(jsonString.contains("\"speed\":12.5"))
        XCTAssertTrue(jsonString.contains("\"heading\":180"))
    }
}
