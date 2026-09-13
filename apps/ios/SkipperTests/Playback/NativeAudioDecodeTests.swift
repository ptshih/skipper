import AVFoundation
import XCTest
@testable import Skipper

@MainActor final class NativeAudioDecodeTests: XCTestCase {
    func testNativePlayerDecodesLocalBytesAndCompletes() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension("wav")
        defer { try? FileManager.default.removeItem(at: url) }
        // Synthetic local PCM tests the actual AVFoundation item/decode/clock/delegate path.
        // It contains no corpus content and cannot make a network request.
        let rate: UInt32 = 16_000
        let samples = Int(rate)
        var data = Data("RIFF".utf8)
        func append<T: FixedWidthInteger>(_ value: T) { var little = value.littleEndian; withUnsafeBytes(of: &little) { data.append(contentsOf: $0) } }
        append(UInt32(36 + samples * 2)); data.append(Data("WAVEfmt ".utf8))
        append(UInt32(16)); append(UInt16(1)); append(UInt16(1)); append(rate)
        append(rate * 2); append(UInt16(2)); append(UInt16(16)); data.append(Data("data".utf8)); append(UInt32(samples * 2))
        for index in 0..<samples { append(Int16(sin(Double(index) * 2 * .pi * 440 / Double(rate)) * 2000)) }
        try data.write(to: url)
        let player = NativeNarrationPlayer(); defer { player.stop() }
        var finished = false
        player.onFinish = { finished = true }
        try player.load(url: url); player.play()
        var sawProgress = false
        for _ in 0..<60 {
            try await Task.sleep(for: .milliseconds(100))
            if player.snapshot.position > 0.1 { sawProgress = true }
            if finished { break }
        }
        XCTAssertTrue(sawProgress, "AVFoundation must advance the local audio clock")
        XCTAssertTrue(finished, "The real local item must deliver its completion")
        XCTAssertFalse(player.snapshot.failed)
    }
}
