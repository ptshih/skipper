import Foundation
import XCTest
@testable import Skipper

private struct VersionPolicyUIFixture: Decodable {
    struct Input: Decodable {
        struct Responses: Decodable { let version: VersionResponse }
        let responses: Responses
        let versionDelayMs: Int
    }
    let id: String
    let input: Input
}

final class VersionPolicyUIContractTests: XCTestCase {
    func testUIFixturePoliciesDecodeThroughRealVersionEndpoint() async throws {
        let cases = try contractFixtures("version-policy-ui", as: VersionPolicyUIFixture.self)
        XCTAssertEqual(Set(cases.map(\.id)), Set([
            "version-force", "version-recommended", "version-force-delayed-sheet",
            "version-recommended-delayed-planner",
        ]))
        for fixture in cases {
            let response = fixture.input.responses.version
            let transport = FixtureTransport(contentType: "application/json", chunks: [try JSONEncoder().encode(response)])
            let api = APIClient(baseURL: URL(string: "https://api.example.invalid")!, transport: transport,
                                cookies: EmptyFixtureCookies())
            let actual = try await api.version()
            XCTAssertEqual(actual, response.policies, fixture.id)
            XCTAssertEqual(transport.requests.count, 1, fixture.id)
            XCTAssertEqual(transport.requests.first?.url?.path, "/version", fixture.id)
            XCTAssertEqual(transport.requests.first?.httpMethod, "GET", fixture.id)
        }
        // No delay/presentation claim: those require the actual app root and its sheets.
    }
}
