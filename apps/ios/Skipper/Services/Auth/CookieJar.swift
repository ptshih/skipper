import Foundation

struct CookieJar: Codable, Sendable, Equatable {
    struct Entry: Codable, Sendable, Equatable { let value: String; let expires: String? }
    var cookies: [String: Entry]
    init(cookies: [String: Entry] = [:]) { self.cookies = cookies }
    init(legacyJSON: String) throws {
        guard let data = legacyJSON.data(using: .utf8),
              let decoded = try? JSONDecoder().decode([String: Entry].self, from: data) else { throw AuthFailure.malformedCredentials }
        guard decoded.allSatisfy({ name, entry in
            Self.validName(name) && Self.validValue(entry.value) && (entry.expires == nil || authDate(entry.expires!) != nil)
        }) else { throw AuthFailure.malformedCredentials }
        cookies = decoded
    }
    enum CodingKeys: String, CodingKey { case cookies }
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let entries = try container.decode([String: Entry].self, forKey: .cookies)
        let encoded = try JSONEncoder().encode(entries)
        try self.init(legacyJSON: String(decoding: encoded, as: UTF8.self))
    }
    func header(at date: Date) -> String? {
        let pairs = cookies.keys.sorted().compactMap { name -> String? in
            guard let entry = cookies[name], entry.expires.flatMap(authDate).map({ $0 >= date }) ?? true else { return nil }
            return "\(name)=\(entry.value)"
        }
        return pairs.isEmpty ? nil : pairs.joined(separator: "; ")
    }
    mutating func merge(_ response: HTTPURLResponse, at now: Date) throws {
        guard let value = response.value(forHTTPHeaderField: "Set-Cookie") else { return }
        // Split only where a new cookie name begins; the comma in an Expires date is not a boundary.
        let lines = value.components(separatedBy: try NSRegularExpression(pattern: ",(?=\\s*[^;,=\\s]+\\s*=)"))
        for line in lines {
            let parts = line.split(separator: ";", omittingEmptySubsequences: false).map { $0.trimmingCharacters(in: .whitespaces) }
            guard let first = parts.first, let equal = first.firstIndex(of: "=") else { continue }
            let name = String(first[..<equal]); let cookieValue = String(first[first.index(after: equal)...])
            // Only the existing Better Auth cookie family is persisted. Vendor/third-party cookies aren't identities.
            let unprefixed = name.hasPrefix("__Secure-") ? String(name.dropFirst(9)) : name
            guard unprefixed.hasPrefix("better-auth"), Self.validName(name), Self.validValue(cookieValue) else { continue }
            var expires: Date?
            var maxAge: Double?
            for attribute in parts.dropFirst() {
                let pair = attribute.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
                guard pair.count == 2 else { continue }
                switch pair[0].lowercased() {
                case "max-age": maxAge = Double(pair[1])
                case "expires":
                    let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX")
                    formatter.timeZone = TimeZone(secondsFromGMT: 0); formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
                    expires = formatter.date(from: String(pair[1]))
                default: break
                }
            }
            if let maxAge, maxAge.isFinite { expires = now.addingTimeInterval(maxAge) }
            if expires.map({ $0 <= now }) == true { cookies.removeValue(forKey: name); continue }
            let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            cookies[name] = Entry(value: cookieValue, expires: expires.map(formatter.string))
        }
    }
    private static func validName(_ value: String) -> Bool {
        !value.isEmpty && value.range(of: #"[\s\x00-\x1F\x7F()<>@,;:\\"/\[\]?={}]"#, options: .regularExpression) == nil
    }
    private static func validValue(_ value: String) -> Bool {
        value.range(of: #"[\r\n\x00;]"#, options: .regularExpression) == nil
    }
}
private extension String {
    func components(separatedBy regex: NSRegularExpression) -> [String] {
        var result: [String] = []; var start = startIndex
        for match in regex.matches(in: self, range: NSRange(startIndex..., in: self)) {
            guard let range = Range(match.range, in: self) else { continue }
            result.append(String(self[start..<range.lowerBound])); start = range.upperBound
        }
        result.append(String(self[start...])); return result
    }
}
