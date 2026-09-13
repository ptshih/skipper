import Foundation

struct PlannerTurn: Codable, Sendable, Equatable {
    enum Role: String, Codable, Sendable { case rider, skipper }
    let role: Role
    let text: String
}

struct PlannedRoute: Codable, Sendable, Equatable {
    let start: String
    let end: String
    let via: [String]?
    let targetMinutes: Int?
    enum CodingKeys: String, CodingKey { case start, end, via, targetMinutes }
    init(start: String, end: String, via: [String]? = nil, targetMinutes: Int? = nil) {
        self.start = start; self.end = end; self.via = via; self.targetMinutes = targetMinutes
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        start = try c.uuid(.start)!; end = try c.uuid(.end)!
        via = try c.optional([String].self, forKey: .via)
        if let via { guard via.count <= 8, via.allSatisfy({ isWireUUID($0) }) else { throw c.invalid(.via) } }
        targetMinutes = try c.integer(.targetMinutes, nullish: true)
        if let targetMinutes, targetMinutes <= 0 { throw c.invalid(.targetMinutes) }
    }
    var isDegenerate: Bool { start == end && (via?.isEmpty ?? true) }
}

struct DrivePlanRequest: Encodable, Sendable {
    let turns: [PlannerTurn]
    let regionId: String
    var drawn: [PlannedRoute]? = nil
}

struct DrivePlanResponse: Codable, Sendable, Equatable {
    let say: String
    let route: PlannedRoute?
    let done: Bool
    enum CodingKeys: String, CodingKey { case say, route, done }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        say = try c.decode(String.self, forKey: .say)
        route = try c.decodeIfPresent(PlannedRoute.self, forKey: .route)
        // Only an absent done defaults. Explicit null/wrong type is a contract error.
        done = c.contains(.done) ? try c.decode(Bool.self, forKey: .done) : false
    }

    init(say: String, route: PlannedRoute? = nil, done: Bool = false) {
        self.say = say
        self.route = route
        self.done = done
    }
}

struct DriveProposeRequest: Encodable, Sendable {
    let start: String
    let end: String
    let via: [String]?
    init(route: PlannedRoute) { start = route.start; end = route.end; via = route.via }
    var isDegenerate: Bool { start == end && (via?.isEmpty ?? true) }
}

struct CreateDriveRequest: Encodable, Sendable {
    let start: String
    let end: String
    let via: [String]?
    /// Mint once per explicit "Make this drive" intent and retain across user-requested retries.
    let idempotencyKey: String
    init(route: PlannedRoute, idempotencyKey: UUID) {
        start = route.start; end = route.end; via = route.via
        self.idempotencyKey = idempotencyKey.uuidString.lowercased()
    }
    var isDegenerate: Bool { start == end && (via?.isEmpty ?? true) }
}
