import XCTest
@testable import Skipper

final class SayBufferTests: XCTestCase {
    func testStreamingSentenceBoundaries() {
        var buffer = SayBuffer()

        buffer.appendDelta("Welcome to the drive. ")
        XCTAssertEqual(buffer.shown, "Welcome to the drive. ")
        XCTAssertEqual(buffer.buffer, "")

        buffer.appendDelta("We are heading ")
        XCTAssertEqual(buffer.shown, "Welcome to the drive. ")
        XCTAssertEqual(buffer.buffer, "We are heading ")

        buffer.appendDelta("towards the coast! ")
        XCTAssertEqual(buffer.shown, "Welcome to the drive. We are heading towards the coast! ")
        XCTAssertEqual(buffer.buffer, "")

        buffer.appendDelta("Keep an eye out for scenic views.")
        // Without trailing delimiter or flush, it stays in buffer
        XCTAssertEqual(buffer.shown, "Welcome to the drive. We are heading towards the coast! ")

        buffer.flushRemaining()
        XCTAssertEqual(buffer.shown, "Welcome to the drive. We are heading towards the coast! Keep an eye out for scenic views.")
        XCTAssertEqual(buffer.buffer, "")
    }

    func testReset() {
        var buffer = SayBuffer()
        buffer.appendDelta("Some text")
        buffer.reset()
        XCTAssertEqual(buffer.shown, "")
        XCTAssertEqual(buffer.buffer, "")
    }
}
