import Foundation
import XCTest
@testable import Skipper

/// Test data only. Production DTOs remain the decoder under test.
enum FixtureJSON: Codable, Equatable {
    case object([String: FixtureJSON]), array([FixtureJSON]), string(String), number(Double), bool(Bool), null

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let value = try? c.decode(Bool.self) { self = .bool(value) }
        else if let value = try? c.decode(Double.self) { self = .number(value) }
        else if let value = try? c.decode(String.self) { self = .string(value) }
        else if let value = try? c.decode([String: FixtureJSON].self) { self = .object(value) }
        else { self = .array(try c.decode([FixtureJSON].self)) }
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .object(let value): try c.encode(value)
        case .array(let value): try c.encode(value)
        case .string(let value): try c.encode(value)
        case .number(let value): try c.encode(value)
        case .bool(let value): try c.encode(value)
        case .null: try c.encodeNil()
        }
    }
    /// Response nullish values intentionally become Swift nil. Optional-only null still must fail
    /// decoding. This comparison never loosens input acceptance or drops non-null fields/defaults.
    var omittingNullObjectFields: FixtureJSON {
        switch self {
        case .object(let values):
            return .object(values.filter { $0.value != .null }.mapValues(\.omittingNullObjectFields))
        case .array(let values): return .array(values.map(\.omittingNullObjectFields))
        default: return self
        }
    }
}

struct ContractSuite<C: Decodable>: Decodable {
    let fixtureVersion: Int
    let cases: [C]
}
struct DTOFixture: Decodable {
    struct Expected: Decodable { let valid: Bool; let value: FixtureJSON? }
    let id: String
    let schema: String
    let input: FixtureJSON
    let expected: Expected
}
struct StreamFixture: Decodable {
    struct Input: Decodable { let chunks: [[UInt8]]; let finish: String }
    struct Frame: Decodable { let event: String; let data: String }
    struct Expected: Decodable {
        let frames: [Frame]
        let deltas: [String]
        let outcome: String
        let terminal: DrivePlanResponse?
        let automaticRetryCount: Int
    }
    let id: String
    let input: Input
    let expected: Expected
}

private final class FixtureBundleAnchor {}
func contractFixtures<C: Decodable>(_ name: String, as: C.Type) throws -> [C] {
    #if SWIFT_PACKAGE
    let bundle = Bundle.module
    #else
    let bundle = Bundle(for: FixtureBundleAnchor.self)
    #endif
    let root = try XCTUnwrap(bundle.url(forResource: "native-ios", withExtension: nil),
                            "Add fixtures/native-ios as a folder resource to SkipperTests; never skip missing fixtures")
    let data = try Data(contentsOf: root.appendingPathComponent("contracts").appendingPathComponent(name + ".json"))
    let suite = try JSONDecoder().decode(ContractSuite<C>.self, from: data)
    XCTAssertEqual(suite.fixtureVersion, 1)
    XCTAssertFalse(suite.cases.isEmpty)
    return suite.cases
}
