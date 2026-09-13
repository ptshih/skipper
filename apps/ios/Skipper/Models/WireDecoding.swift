import Foundation

/// Wire strings remain strings (including UUID casing) so cache filenames and request values survive a port.
/// Validation mirrors the shipped Zod boundary, including optional versus nullish fields.
extension KeyedDecodingContainer {
    func optional<T: Decodable>(_ type: T.Type, forKey key: Key) throws -> T? {
        contains(key) ? try decode(type, forKey: key) : nil
    }
    func uuid(_ key: Key, nullish: Bool = false) throws -> String? {
        let value = nullish ? try decodeIfPresent(String.self, forKey: key) : try decode(String.self, forKey: key)
        if let value {
            guard isWireUUID(value) else { throw invalid(key) }
        }
        return value
    }
    func integer(_ key: Key, nullish: Bool = false) throws -> Int? {
        let value = nullish ? try decodeIfPresent(Int.self, forKey: key) : try decode(Int.self, forKey: key)
        // Zod int rejects numbers outside JavaScript's exactly representable range.
        if let value, !(-9_007_199_254_740_991...9_007_199_254_740_991).contains(value) { throw invalid(key) }
        return value
    }
    func url(_ key: Key, nullish: Bool = false) throws -> String? {
        let value = nullish ? try decodeIfPresent(String.self, forKey: key) : try decode(String.self, forKey: key)
        if let value { guard let url = URL(string: value), url.scheme != nil else { throw invalid(key) } }
        return value
    }
    func timestamp(_ key: Key, nullish: Bool = false) throws -> String? {
        let value = nullish ? try decodeIfPresent(String.self, forKey: key) : try decode(String.self, forKey: key)
        if let value {
            // Zod's ISO datetime uses UTC only; offsets and date-only strings are not the contract.
            let pattern = "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?Z$"
            guard value.range(of: pattern, options: .regularExpression) != nil else { throw invalid(key) }
            let parts = value.dropLast().split(separator: "T")
            let date = parts[0].split(separator: "-").compactMap { Int($0) }
            let time = parts[1].split(separator: ":")
            guard date.count == 3, (1...12).contains(date[1]),
                  let hour = Int(time[0]), (0...23).contains(hour),
                  let minute = Int(time[1]), (0...59).contains(minute) else { throw invalid(key) }
            let leap = date[0].isMultiple(of: 4) && (!date[0].isMultiple(of: 100) || date[0].isMultiple(of: 400))
            let days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
            guard (1...days[date[1] - 1]).contains(date[2]) else { throw invalid(key) }
            if time.count == 3 {
                guard let second = Int(time[2].split(separator: ".")[0]), (0...59).contains(second) else { throw invalid(key) }
            }
        }
        return value
    }
    func invalid(_ key: Key) -> DecodingError {
        .dataCorrupted(.init(codingPath: codingPath + [key], debugDescription: "Value does not match the app wire contract"))
    }
}

struct Coordinate: Codable, Sendable, Equatable {
    let longitude: Double
    let latitude: Double
    init(longitude: Double, latitude: Double) { self.longitude = longitude; self.latitude = latitude }
    init(from decoder: Decoder) throws {
        var values = try decoder.unkeyedContainer()
        longitude = try values.decode(Double.self); latitude = try values.decode(Double.self)
        guard values.isAtEnd, longitude.isFinite, latitude.isFinite else {
            throw DecodingError.dataCorruptedError(in: values, debugDescription: "Expected one finite [longitude, latitude] pair")
        }
    }
    func encode(to encoder: Encoder) throws {
        var values = encoder.unkeyedContainer(); try values.encode(longitude); try values.encode(latitude)
    }
}

func isWireUUID(_ value: String) -> Bool {
    let pattern = "^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
    return value.range(of: pattern, options: .regularExpression) != nil
}
