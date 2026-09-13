import XCTest
@testable import Skipper

@MainActor final class MapLifecycleTests: XCTestCase {
    private let viewport = CGRect(x: 0, y: 0, width: 338, height: 180)
    private let rider = Coordinate(longitude: -122.47, latitude: 37.77)

    func testRiderBeforeFirstLayoutFollowsWithoutOverviewOnLaterLayouts() {
        let camera = MapCameraLifecycle()
        var commands: [MapCameraLifecycle.Command] = []
        camera.apply = { commands.append($0); return true }
        camera.update(rider: rider, heading: 90, isFollowing: true, canFit: true, recenter: false)
        camera.layout(.zero)
        XCTAssertTrue(commands.isEmpty)
        XCTAssertFalse(camera.hasPositionedCamera)
        camera.layout(viewport)
        XCTAssertEqual(commands, [.follow(rider, 90)])
        XCTAssertTrue(camera.hasPositionedCamera)
        camera.layout(viewport)
        camera.layout(CGRect(x: 0, y: 0, width: 375, height: 360))
        XCTAssertEqual(commands, [.follow(rider, 90)], "Layout must never overwrite a rider camera with overview")
    }

    func testRiderAfterInitialOverviewPreservesFollowAcrossLayoutAndNewFixes() {
        let camera = MapCameraLifecycle()
        var commands: [MapCameraLifecycle.Command] = []
        camera.apply = { commands.append($0); return true }
        camera.update(rider: nil, heading: nil, isFollowing: true, canFit: true, recenter: false)
        camera.layout(viewport)
        camera.update(rider: rider, heading: 180, isFollowing: true, canFit: true, recenter: false)
        camera.layout(viewport)
        let next = Coordinate(longitude: -122.471, latitude: 37.771)
        camera.update(rider: next, heading: 181, isFollowing: true, canFit: true, recenter: false)
        camera.layout(viewport)
        XCTAssertEqual(commands, [.overview, .follow(rider, 180), .follow(next, 181)])
    }

    func testPanBeforeLayoutCancelsPendingFollowUntilExplicitRecenter() {
        let camera = MapCameraLifecycle()
        var commands: [MapCameraLifecycle.Command] = []
        camera.apply = { commands.append($0); return true }
        camera.update(rider: rider, heading: 10, isFollowing: true, canFit: true, recenter: false)
        camera.userPanned()
        camera.layout(viewport)
        camera.update(rider: rider, heading: 20, isFollowing: false, canFit: true, recenter: false)
        XCTAssertTrue(commands.isEmpty)
        camera.update(rider: rider, heading: 20, isFollowing: true, canFit: true, recenter: true)
        camera.layout(viewport)
        XCTAssertEqual(commands, [.follow(rider, 20)])
    }

    func testReplacementRendererWithFollowOffGetsOneOverviewWithoutResumingLiveFollow() {
        // Geometry identity creates a new renderer while the outer map preserves follow-off.
        // Cover both Detail's route-only map and a driving map with a current rider fix.
        for current in [nil, rider] as [Coordinate?] {
            let camera = MapCameraLifecycle()
            var commands: [MapCameraLifecycle.Command] = []
            camera.apply = { commands.append($0); return true }
            camera.update(rider: current, heading: 90, isFollowing: false, canFit: true, recenter: false)
            camera.layout(.zero)
            XCTAssertTrue(commands.isEmpty)
            camera.layout(viewport)
            XCTAssertTrue(camera.hasPositionedCamera)
            XCTAssertEqual(commands, [.overview])
            camera.layout(CGRect(x: 0, y: 0, width: 375, height: 360))
            let next = current.map { Coordinate(longitude: $0.longitude + 0.001, latitude: $0.latitude) }
            camera.update(rider: next, heading: 95, isFollowing: false, canFit: true, recenter: false)
            XCTAssertEqual(commands, [.overview], "New fixes must not silently re-enable live follow")
            camera.userPanned()
            camera.layout(viewport)
            XCTAssertEqual(commands, [.overview], "Keep the rider's manual camera")
            camera.update(rider: next, heading: 95, isFollowing: true, canFit: true, recenter: true)
            XCTAssertEqual(commands, [.overview, next.map { .follow($0, 95) } ?? .overview])
        }
    }

    func testOverviewWaitsForValidSizeAndRecenterDoesNotRefitRepeatedly() {
        let camera = MapCameraLifecycle()
        var commands: [MapCameraLifecycle.Command] = []
        camera.apply = { commands.append($0); return true }
        camera.update(rider: nil, heading: nil, isFollowing: true, canFit: true, recenter: false)
        for bounds in [CGRect.zero, CGRect(x: 0, y: 0, width: 338, height: 0),
                       CGRect(x: 0, y: 0, width: 29, height: 180)] { camera.layout(bounds) }
        XCTAssertTrue(commands.isEmpty)
        camera.layout(viewport)
        camera.layout(viewport)
        camera.userPanned()
        camera.update(rider: nil, heading: nil, isFollowing: true, canFit: true, recenter: true)
        camera.layout(viewport)
        XCTAssertEqual(commands, [.overview, .overview])
        XCTAssertEqual(GoogleRouteMap.safePadding(for: .zero, requested: 40), 0)
        XCTAssertEqual(GoogleRouteMap.safePadding(for: viewport, requested: 30), 30)
        XCTAssertEqual(GoogleRouteMap.safePadding(for: CGRect(x: 0, y: 0, width: 60, height: 60), requested: 30), 21, accuracy: 0.001)
    }

    func testFailedCameraApplicationRemainsPendingAndSynchronousLayoutCannotDuplicateIt() {
        let camera = MapCameraLifecycle()
        var succeeds = false
        var commands: [MapCameraLifecycle.Command] = []
        camera.apply = { command in
            commands.append(command)
            camera.layout(self.viewport)
            return succeeds
        }
        camera.update(rider: rider, heading: nil, isFollowing: true, canFit: true, recenter: false)
        camera.layout(viewport)
        XCTAssertFalse(camera.hasPositionedCamera)
        succeeds = true
        camera.layout(viewport)
        XCTAssertTrue(camera.hasPositionedCamera)
        XCTAssertEqual(commands, [.follow(rider, nil), .follow(rider, nil)])
    }

    func testGeometryChangeResetsGenerationButMarkerProgressDoesNotChangeGeometryIdentity() {
        let route = [rider, Coordinate(longitude: -122.48, latitude: 37.78)]
        let upcoming = MapStopMarker(seq: 0, name: "Fixture", latitude: 37.77, longitude: -122.47)
        let playing = MapStopMarker(seq: 0, name: "Fixture", latitude: 37.77, longitude: -122.47, state: .playing)
        XCTAssertEqual(MapRouteGeometry(coordinates: route, stops: [upcoming]), MapRouteGeometry(coordinates: route, stops: [playing]))
        XCTAssertNotEqual(MapRouteGeometry(coordinates: route, stops: []), MapRouteGeometry(coordinates: route.reversed(), stops: []))
        let old = MapRenderLifecycle()
        XCTAssertTrue(old.acceptSnapshot(cameraPositioned: true, validLayout: true, routeAttached: true))
        old.invalidate()
        let replacement = MapRenderLifecycle()
        XCTAssertNotEqual(old.generation, replacement.generation)
        XCTAssertFalse(replacement.isReady)
        XCTAssertFalse(old.acceptSnapshot(cameraPositioned: true, validLayout: true, routeAttached: true))
        XCTAssertFalse(replacement.acceptSnapshot(cameraPositioned: false, validLayout: true, routeAttached: true))
        XCTAssertFalse(replacement.acceptSnapshot(cameraPositioned: true, validLayout: false, routeAttached: true))
        XCTAssertFalse(replacement.acceptSnapshot(cameraPositioned: true, validLayout: true, routeAttached: false))
        XCTAssertTrue(replacement.acceptSnapshot(cameraPositioned: true, validLayout: true, routeAttached: true))
        XCTAssertFalse(replacement.acceptSnapshot(cameraPositioned: true, validLayout: true, routeAttached: true), "Notify once per generation")
    }

    func testNonFixtureAndRejectedLaunchesNeverCreateDiagnosticOutput() {
        let launches = [AppLaunchConfiguration(mode: .production), .init(mode: .unitTest),
            .init(mode: .rejectedTestConfiguration),
            .init(mode: .uiTest(scenario: "unknown-map-run", runID: UUID().uuidString, theme: .light)),
            .init(mode: .uiTest(scenario: "planner-map-landmark", runID: "invalid", theme: .light))]
        for launch in launches {
            XCTAssertNil(MapRenderDiagnostics(launch: launch, generation: UUID(), write: { _, _ in
                XCTFail("Only the validated fixture run directory can receive diagnostics")
            }))
        }
    }

    func testActualDiagnosticLifecycleClearsOldReadinessAndRejectsLateGenerationWrites() throws {
        let launch = AppLaunchConfiguration(mode: .uiTest(scenario: "planner-map-landmark", runID: UUID().uuidString, theme: .light))
        let destination = try XCTUnwrap(DebugDependencies.runDirectory(for: launch)).appendingPathComponent("map-render-receipt.json")
        var writes: [(Data, URL)] = []
        let first = try XCTUnwrap(MapRenderDiagnostics(launch: launch, generation: UUID(), write: { writes.append(($0, $1)) }))
        first.tilesFinished()
        first.snapshot(viewSize: viewport.size, zoom: 15, routePointCount: 4,
            projected: .init(minX: 40, minY: 40, maxX: 298, maxY: 140), fits: true)
        var receipt = try JSONDecoder().decode(MapRenderReceipt.self, from: XCTUnwrap(writes.last).0)
        XCTAssertEqual(receipt.snapshotReadyCount, 1)
        XCTAssertEqual(receipt.tileRenderingFinishedCount, 1)
        XCTAssertTrue(receipt.routeFitsViewport)
        let second = try XCTUnwrap(MapRenderDiagnostics(launch: launch, generation: UUID(), write: { writes.append(($0, $1)) }))
        receipt = try JSONDecoder().decode(MapRenderReceipt.self, from: XCTUnwrap(writes.last).0)
        XCTAssertEqual(receipt.generation, second.generation)
        XCTAssertEqual(receipt.snapshotReadyCount, 0)
        XCTAssertEqual(receipt.tileRenderingFinishedCount, 0)
        XCTAssertFalse(receipt.routeFitsViewport)
        let count = writes.count
        first.snapshot(viewSize: viewport.size, zoom: 15, routePointCount: 4,
            projected: .init(minX: 40, minY: 40, maxX: 298, maxY: 140), fits: true)
        XCTAssertEqual(writes.count, count, "A superseded map cannot replace current-generation evidence")
        XCTAssertTrue(writes.allSatisfy { $0.1 == destination })
        for (data, _) in writes {
            let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
            XCTAssertEqual(Set(object.keys), ["generation", "snapshotReadyCount", "tileRenderingFinishedCount", "viewWidth", "viewHeight", "cameraZoom", "routePointCount", "projectedRouteBounds", "routeFitsViewport"])
            let bounds = try XCTUnwrap(object["projectedRouteBounds"] as? [String: Any])
            XCTAssertEqual(Set(bounds.keys), ["minX", "minY", "maxX", "maxY"])
        }
    }
}
