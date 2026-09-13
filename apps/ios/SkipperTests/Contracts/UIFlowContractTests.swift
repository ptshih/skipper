import Foundation
import XCTest
@testable import Skipper

private struct UIFlowContract: Decodable {
    enum Responses: Decodable {
        struct Planner: Decodable {
            let bootstrap: Bootstrap
            let proposal: DriveProposal
            let createdManifest: DriveManifest
            let ownedDrives: DriveList
        }
        struct Account: Decodable {
            let bootstrap: Bootstrap
            let version: VersionResponse
        }
        case planner(Planner)
        case account(Account)

        private enum DiscriminationKeys: String, CodingKey {
            case version
            case proposal
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: DiscriminationKeys.self)
            if container.contains(.version) && !container.contains(.proposal) {
                self = .account(try Account(from: decoder))
            } else {
                self = .planner(try Planner(from: decoder))
            }
        }

        var planner: Planner? {
            if case .planner(let p) = self { return p }
            return nil
        }

        var account: Account? {
            if case .account(let a) = self { return a }
            return nil
        }
    }
    struct Stream: Decodable {
        let chunks: [[UInt8]]
        let delayBeforeChunkMs: [Int]
        let terminal: DrivePlanResponse
    }
    struct Input: Decodable {
        let prompt: String?
        let responses: Responses?
        let stream: Stream?
        let ownedDrives: DriveList?
        let coldOpenURL: String?
    }
    struct Expected: Decodable {
        let canonicalDriveId: String?
        let detailTitle: String?
        let streamingText: String?
    }
    let id: String
    let input: Input
    let expected: Expected
}

final class UIFlowContractTests: XCTestCase {
    func testLandmarkCoordinatesDecodeOnTheIntendedLandReference() throws {
        let cases = try contractFixtures("ui-flows", as: UIFlowContract.self)
        let fixture = try XCTUnwrap(cases.first { $0.id == "planner-map-landmark" })
        let responses = try XCTUnwrap(fixture.input.responses?.planner)
        // Decoded by production Coordinate, not a test-only interpretation of the tuple.
        let points = responses.proposal.polyline
        XCTAssertEqual(points.count, 4)
        XCTAssertEqual(responses.createdManifest.polyline, points)
        let first = try XCTUnwrap(points.first)
        let last = try XCTUnwrap(points.last)
        XCTAssertEqual(first.latitude, responses.proposal.start.lat, accuracy: 0.000001)
        XCTAssertEqual(first.longitude, responses.proposal.start.lng, accuracy: 0.000001)
        XCTAssertEqual(last.latitude, responses.proposal.end.lat, accuracy: 0.000001)
        XCTAssertEqual(last.longitude, responses.proposal.end.lng, accuracy: 0.000001)
        for point in points {
            XCTAssertTrue(point.latitude.isFinite && point.longitude.isFinite)
            XCTAssertTrue((-122.49 ... -122.46).contains(point.longitude), "Expected Golden Gate Park longitude")
            XCTAssertTrue((37.76 ... 37.78).contains(point.latitude), "Expected Golden Gate Park latitude")
        }
        let west = try XCTUnwrap(points.map(\.longitude).min())
        let east = try XCTUnwrap(points.map(\.longitude).max())
        let south = try XCTUnwrap(points.map(\.latitude).min())
        let north = try XCTUnwrap(points.map(\.latitude).max())
        XCTAssertGreaterThan(east - west, 0.01)
        XCTAssertGreaterThan(north - south, 0.0005)
    }

    func testEmbeddedUIResponsesDecodeThroughProductionDTOsAndPlannerClient() async throws {
        let cases = try contractFixtures("ui-flows", as: UIFlowContract.self)
        XCTAssertEqual(Set(cases.map(\.id)), Set([
            "planner-account-retry", "planner-account-lost-ack", "planner-reset-during-stream",
            "planner-map-landmark",
            "offline-no-playable-clips", "corrupt-credentials-recovery",
            "settings-account-lifecycle", "driving-qa-live",
            "cold-link-signed-in", "cold-link-signed-out",
        ]))
        var plannerCases = 0
        for c in cases {
            switch c.id {
            case "planner-account-retry", "planner-account-lost-ack", "planner-reset-during-stream", "planner-map-landmark":
                plannerCases += 1
                let responsesWrapper = try XCTUnwrap(c.input.responses, c.id)
                let responses = try XCTUnwrap(responsesWrapper.planner, c.id)
                let stream = try XCTUnwrap(c.input.stream, c.id)
                XCTAssertEqual(stream.chunks.count, stream.delayBeforeChunkMs.count, c.id)
                let region = try XCTUnwrap(responses.bootstrap.regions.first, c.id)
                let request = DrivePlanRequest(turns: [.init(role: .rider, text: try XCTUnwrap(c.input.prompt))], regionId: region.id)
                let transport = FixtureTransport(chunks: stream.chunks.map { Data($0) })
                let actual = try await PlannerClient(baseURL: URL(string: "https://api.example.invalid")!, transport: transport)
                    .turn(request) { transport.recordDelta($0) }
                XCTAssertEqual(actual, stream.terminal, c.id)
                XCTAssertEqual(transport.deltas.joined(), try XCTUnwrap(c.expected.streamingText), c.id)
                XCTAssertEqual(transport.requests.count, 1, c.id)
                let route = try XCTUnwrap(actual.route, c.id)
                XCTAssertEqual(route.start, responses.proposal.startId, c.id)
                XCTAssertEqual(route.end, responses.proposal.endId, c.id)
                if c.id != "planner-reset-during-stream" {
                    XCTAssertEqual(responses.createdManifest.driveId, try XCTUnwrap(c.expected.canonicalDriveId), c.id)
                    XCTAssertEqual(responses.createdManifest.label, try XCTUnwrap(c.expected.detailTitle), c.id)
                }
            case "settings-account-lifecycle":
                let responsesWrapper = try XCTUnwrap(c.input.responses, c.id)
                let account = try XCTUnwrap(responsesWrapper.account, c.id)
                XCTAssertNil(c.input.stream, c.id)
                XCTAssertNotNil(account.version.policies)
            case "cold-link-signed-in", "cold-link-signed-out":
                XCTAssertNil(c.input.responses, c.id)
                let urlString = try XCTUnwrap(c.input.coldOpenURL, c.id)
                let url = try XCTUnwrap(URL(string: urlString), c.id)
                XCTAssertEqual(url.scheme, "skipper", c.id)
            case "driving-qa-live":
                XCTAssertNil(c.input.responses, c.id)
                XCTAssertNil(c.input.stream, c.id)
            case "corrupt-credentials-recovery":
                XCTAssertTrue(try XCTUnwrap(c.input.ownedDrives, c.id).drives.isEmpty)
            case "offline-no-playable-clips": break // Native storage/UI tests execute this filesystem recipe.
            default: XCTFail("Missing fixture adapter: \(c.id)")
            }
        }
        XCTAssertEqual(plannerCases, 4)
        // Delays, account-wall transitions, reset and create receipts need production-view execution.
        // This host-capable test establishes only response and stream contract compatibility.
    }
}
