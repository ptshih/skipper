import SwiftUI
import UIKit
import XCTest
@testable import Skipper

@MainActor final class VersionNudgeIntegrationTests: XCTestCase {
    private struct ReplyPlanner: PlannerService {
        func turn(_ request: DrivePlanRequest, onDelta: @escaping @Sendable (String) -> Void) async throws -> DrivePlanResponse {
            DrivePlanResponse(say: "A synthetic route suggestion.")
        }
    }

    private struct PolicyAPI: SkipperAPI {
        let force: Bool
        func version() throws -> [VersionPolicy] {
            let minimum = force ? "999.0.0" : "0.0.0"
            let data = Data("{\"platform\":\"ios\",\"minimum\":\"\(minimum)\",\"recommended\":\"999.0.0\",\"storeUrl\":\"https://apps.apple.com/app/id6778946770\"}".utf8)
            return [try JSONDecoder().decode(VersionPolicy.self, from: data)]
        }
        func bootstrap(rotation: Int) throws -> Bootstrap { throw OfflineError() }
        func listDrives() throws -> DriveList { throw OfflineError() }
        func drive(id: String) throws -> DriveManifest { throw OfflineError() }
        func propose(_ request: DriveProposeRequest) throws -> DriveProposal { throw OfflineError() }
        func create(_ request: CreateDriveRequest) throws -> DriveManifest { throw OfflineError() }
        func deleteDrive(id: String) throws {}
        func setAccountPassword(_ password: String) throws {}
    }

    private final class ProbeLog {
        var planner: PlannerViewModel?
        var appeared = 0
        var disappeared = 0
        let mounted: XCTestExpectation
        var policyRendered: XCTestExpectation?
        init(mounted: XCTestExpectation) { self.mounted = mounted }
    }

    /// Hosts a real planner model with the same State lifetime as MainTab's PlannerView.
    /// Rebuilding this subtree would replace its conversation and proposal idempotency key.
    private struct PlannerStateProbe: View {
        @State private var planner: PlannerViewModel
        let log: ProbeLog
        init(makePlanner: () -> PlannerViewModel, log: ProbeLog) {
            _planner = State(initialValue: makePlanner()); self.log = log
        }
        var body: some View {
            Text("\(planner.turns.count) turns; \(planner.cards.count) cards")
                .onAppear { log.planner = planner; log.appeared += 1; log.mounted.fulfill() }
                .onDisappear { log.disappeared += 1 }
        }
    }

    private struct NudgeHarness: View {
        let model: AppModel
        let dependencies: AppDependencies
        let log: ProbeLog
        var body: some View {
            AppVersionPresentation(controller: model.versionPolicy) {
                PlannerStateProbe(makePlanner: {
                    PlannerViewModel(planner: dependencies.planner, api: dependencies.api,
                        session: dependencies.session, defaults: dependencies.defaults)
                }, log: log)
            }
            .onChange(of: model.versionPolicy?.gate) { _, _ in
                model.versionGateDidChange()
                log.policyRendered?.fulfill()
            }
        }
    }

    private func dependencies(force: Bool = false, defaults: UserDefaults, root: URL,
                              preview: AudioPreviewController? = nil) throws -> AppDependencies {
        let clock = FixedAuthClock(date: authDate("2026-09-12T12:00:00Z")!)
        let vault = CredentialVault(keychain: try syntheticKeychain(), clock: clock)
        let session = SessionStore(auth: AuthTestService(session: syntheticSession()), vault: vault,
                                   network: AuthTestNetwork(offline: true), clock: clock, purgeDownloads: {})
        return AppDependencies(api: PolicyAPI(force: force), planner: ReplyPlanner(), documentsURL: root,
            launch: .init(mode: .unitTest), session: session, storage: StorageService(rootURL: root),
            network: AuthTestNetwork(offline: true), defaults: defaults, preview: preview, analytics: nil,
            makePlayback: { fatalError("Test explicitly injects a running playback controller") })
    }

    func testLateNudgeAndLaterPreserveMountedPlannerCardAndRunningDrive() async throws {
        let suite = "VersionNudge.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { defaults.removePersistentDomain(forName: suite); try? FileManager.default.removeItem(at: root) }
        let dependencies = try dependencies(defaults: defaults, root: root)
        await dependencies.session.start()
        let model = AppModel(dependencies: dependencies)
        let policy = try XCTUnwrap(model.versionPolicy)
        let mounted = expectation(description: "Planner subtree mounted")
        let log = ProbeLog(mounted: mounted)
        let host = UIHostingController(rootView: NudgeHarness(model: model, dependencies: dependencies, log: log))
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = host; window.makeKeyAndVisible()
        defer { window.isHidden = true; window.rootViewController = nil }
        await fulfillment(of: [mounted], timeout: 3)
        let planner = try XCTUnwrap(log.planner)
        let region = try JSONDecoder().decode(Region.self, from: Data(#"{"id":"00000001-0000-4000-8000-000000000001","slug":"fixture","displayName":"Fixture"}"#.utf8))
        planner.selectRegion(region)
        await planner.sendTurn(prompt: "A synthetic request")
        let card = ProposalCardItem(afterTurn: 1, route: PlannedRoute(
            start: "00000001-0000-4000-8000-000000000002", end: "00000001-0000-4000-8000-000000000003"),
            isLoadingProposal: false, state: .needsAccount)
        planner.cards = [card]
        let turns = planner.turns
        XCTAssertEqual(turns.count, 2)

        let rig = PlaybackRig()
        defer { rig.controller.stop() }
        try rig.start(); rig.fix(1)
        XCTAssertTrue(rig.audio.snapshot.playing)
        model.activePlayback = rig.controller; model.playbackPresented = true
        let stops = rig.audio.stops
        let deactivations = rig.audioSession.deactivations
        let nudged = expectation(description: "Late recommendation rendered")
        log.policyRendered = nudged
        await policy.checkOnce()
        await fulfillment(of: [nudged], timeout: 3)
        XCTAssertEqual(policy.gate, .nudge)
        XCTAssertEqual(log.appeared, 1)
        XCTAssertEqual(log.disappeared, 0, "A recommendation must keep the live subtree mounted")
        XCTAssertTrue(log.planner === planner)
        XCTAssertEqual(planner.turns, turns)
        XCTAssertEqual(planner.cards, [card])
        XCTAssertEqual(planner.cards.first?.idempotencyKey, card.idempotencyKey)
        XCTAssertTrue(model.activePlayback === rig.controller)
        XCTAssertTrue(model.presentsDriving, "The existing driving cover must not dismiss")
        XCTAssertEqual(rig.controller.phase, .driving)
        XCTAssertTrue(rig.audio.snapshot.playing)
        XCTAssertEqual(rig.audio.stops, stops)
        XCTAssertEqual(rig.audioSession.deactivations, deactivations)

        let dismissed = expectation(description: "Later restored the same subtree")
        log.policyRendered = dismissed
        policy.dismissNudge()
        await fulfillment(of: [dismissed], timeout: 3)
        XCTAssertEqual(log.appeared, 1)
        XCTAssertEqual(log.disappeared, 0)
        XCTAssertEqual(planner.turns, turns)
        XCTAssertEqual(planner.cards, [card])
        XCTAssertTrue(model.presentsDriving)
    }

    func testLateRecommendationKeepsPreviewPlayingButForceStopsActiveAudio() async throws {
        for force in [false, true] {
            let suite = "VersionPreview.\(UUID().uuidString)"
            let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
            defer { defaults.removePersistentDomain(forName: suite) }
            let audio = PlaybackTestAudio()
            let session = PlaybackTestSession()
            let channel = AudioChannel(session: session, observeSystem: false)
            let preview = AudioPreviewController(player: audio, channel: channel)
            defer { preview.stop() }
            let dependencies = try dependencies(force: force, defaults: defaults,
                root: FileManager.default.temporaryDirectory, preview: preview)
            let model = AppModel(dependencies: dependencies)
            preview.playLocal(id: "fixture", url: URL(fileURLWithPath: "/fixture/preview.m4a"))
            XCTAssertTrue(audio.snapshot.playing)
            await model.versionPolicy?.checkOnce()
            model.versionGateDidChange()
            XCTAssertEqual(model.blocksForUpdate, force)
            XCTAssertEqual(audio.snapshot.playing, !force)
            XCTAssertEqual(preview.activeID, force ? nil : "fixture")
        }
    }
}
