import Foundation

struct PlannerExample: Codable, Sendable, Equatable {
    enum Shape: String, Codable, Sendable { case aToB, via, fromStart, toEnd, open }
    let shape: Shape
    let title: String
    let ask: String
}

struct Region: Codable, Sendable, Equatable, Identifiable {
    let id: String
    let slug: String
    let displayName: String
    let ready: Bool
    let exampleAnchors: [String]
    let examples: [PlannerExample]
    let exampleNames: [String]
    enum CodingKeys: String, CodingKey { case id, slug, displayName, ready, exampleAnchors, examples, exampleNames }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.uuid(.id)!; slug = try c.decode(String.self, forKey: .slug)
        displayName = try c.decode(String.self, forKey: .displayName)
        // Decoration degrades as a whole; malformed readiness must never disable the planner.
        ready = (try? c.decode(Bool.self, forKey: .ready)) ?? true
        exampleAnchors = (try? c.decode([String].self, forKey: .exampleAnchors)) ?? []
        examples = (try? c.decode([PlannerExample].self, forKey: .examples)) ?? []
        exampleNames = (try? c.decode([String].self, forKey: .exampleNames)) ?? []
    }
}

struct Bootstrap: Codable, Sendable, Equatable {
    let regions: [Region]
    let adjustSay: String
    let noStopsSay: String
    enum CodingKeys: String, CodingKey { case regions, adjustSay, noStopsSay }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        regions = try c.decode([Region].self, forKey: .regions)
        adjustSay = (try? c.decode(String.self, forKey: .adjustSay)) ?? ""
        noStopsSay = (try? c.decode(String.self, forKey: .noStopsSay)) ?? ""
    }
}

struct VersionPolicy: Codable, Sendable, Equatable {
    enum Platform: String, Codable, Sendable { case ios, android }
    let platform: Platform
    let minimum: String
    let recommended: String
    let storeUrl: String
    enum CodingKeys: String, CodingKey { case platform, minimum, recommended, storeUrl }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        platform = try c.decode(Platform.self, forKey: .platform)
        minimum = try c.decode(String.self, forKey: .minimum)
        recommended = try c.decode(String.self, forKey: .recommended)
        storeUrl = try c.url(.storeUrl)!
    }
}
struct VersionResponse: Codable, Sendable, Equatable { let policies: [VersionPolicy] }
