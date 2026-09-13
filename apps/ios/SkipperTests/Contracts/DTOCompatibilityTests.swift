import Foundation
import XCTest
@testable import Skipper

final class DTOCompatibilityTests: XCTestCase {
    func testResponseAndRouteDecodersMatchLegacyGoldens() throws {
        let cases = try contractFixtures("dto", as: DTOFixture.self)
        var checked = 0
        for fixture in cases {
            // These request-only types are Encodable in Swift. Their construction/transport guard
            // is tested separately; there is no native inbound decoder to pretend to validate.
            if ["driveProposeRequest", "createDriveRequest"].contains(fixture.schema) { continue }
            switch fixture.schema {
            case "region": try check(Region.self, fixture)
            case "bootstrap": try check(Bootstrap.self, fixture)
            case "drivePlanResponse": try check(DrivePlanResponse.self, fixture)
            case "plannedRoute": try check(PlannedRoute.self, fixture)
            case "driveClip": try check(DriveClip.self, fixture)
            case "driveManifest": try check(DriveManifest.self, fixture)
            case "driveSummary": try check(DriveSummary.self, fixture)
            case "driveList": try check(DriveList.self, fixture)
            case "driveProposal": try check(DriveProposal.self, fixture)
            case "drivePreviewClip": try check(DrivePreviewClip.self, fixture)
            default: XCTFail("Uncovered native DTO fixture schema: \(fixture.schema)")
            }
            checked += 1
        }
        XCTAssertGreaterThanOrEqual(checked, 30, "The substantive decoder matrix must actually execute")
    }

    func testCreateEncodingKeepsOneCanonicalKeyAndRoute() throws {
        let route = PlannedRoute(start: "00000006-0000-4000-8000-000000000001",
                                 end: "00000007-0000-4000-8000-000000000001")
        let uuid = try XCTUnwrap(UUID(uuidString: "ABCDEF12-3456-4789-8ABC-DEF012345678"))
        let intent = CreateDriveRequest(route: route, idempotencyKey: uuid)
        let first = try JSONEncoder().encode(intent)
        let retry = try JSONEncoder().encode(intent)
        let expected: FixtureJSON = .object([
            "start": .string(route.start), "end": .string(route.end),
            "idempotencyKey": .string("abcdef12-3456-4789-8abc-def012345678"),
        ])
        XCTAssertEqual(try JSONDecoder().decode(FixtureJSON.self, from: first), expected)
        XCTAssertEqual(try JSONDecoder().decode(FixtureJSON.self, from: retry), expected)
        // Per-card retention across sign-in, conflict reminting and server-id directory selection
        // belong to the app coordinator and remain covered by idempotency.json acceptance inputs.
    }

    private func check<T: Codable>(_ type: T.Type, _ fixture: DTOFixture) throws {
        let data = try JSONEncoder().encode(fixture.input)
        if !fixture.expected.valid {
            XCTAssertThrowsError(try JSONDecoder().decode(type, from: data), fixture.id)
            return
        }
        do {
            let value = try JSONDecoder().decode(type, from: data)
            let actual = try JSONDecoder().decode(FixtureJSON.self, from: JSONEncoder().encode(value))
            let expected = try XCTUnwrap(fixture.expected.value, fixture.id)
            XCTAssertEqual(actual.omittingNullObjectFields, expected.omittingNullObjectFields, fixture.id)
        } catch {
            XCTFail("\(fixture.id): valid legacy DTO rejected: \(error)")
        }
    }
}
