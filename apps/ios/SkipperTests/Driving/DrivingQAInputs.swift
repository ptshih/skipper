import Foundation
import XCTest
@testable import Skipper

/// Deterministic source recipes from the legacy engine tests, never a recorded rider trace.
enum DrivingQAInputs {
    static var route: [LngLat] { (0...500).map { LngLat(0, Double($0) * 0.0001) } }
    static var stops: [DriveStopRef] {
        [100, 200, 300, 400].enumerated().map { seq, index in
            DriveStopRef(seq: seq, lat: route[index].latitude, lng: 0, triggerRadiusM: 250,
                         durationMs: 60_000, name: "stop \(seq)", stopType: "story")
        }
    }
    static func data(_ relativePath: String) throws -> Data {
        #if SWIFT_PACKAGE
        let bundle = Bundle.module
        #else
        let bundle = Bundle(for: DrivingQARegressionTests.self)
        #endif
        let root = try XCTUnwrap(bundle.url(forResource: "native-ios", withExtension: nil), "Missing bundled driving fixtures")
        return try Data(contentsOf: root.appendingPathComponent(relativePath))
    }
}
