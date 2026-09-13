import XCTest
@testable import Skipper

@MainActor final class DriveLocationLifecycleTests: XCTestCase {
    func testDriveCanRestartAfterFinishingInBackground() throws {
        let rig = PlaybackRig(); defer { rig.controller.stop() }
        try rig.start(); rig.fix(0); rig.heard()
        rig.controller.routeEnded(); rig.channel.send(.enteredBackground); rig.audio.finish()
        XCTAssertEqual(rig.controller.phase, .done)
        rig.location.onForeground?()
        rig.controller.start(); rig.fix(0)
        XCTAssertEqual(rig.controller.activeSeq, 0)
        XCTAssertTrue(rig.location.running)
    }

    func testBackgroundStopsGPSWhileAudioContinuesAndForegroundReacquiresIt() throws {
        let rig = PlaybackRig(); defer { rig.controller.stop() }
        try rig.start(); rig.fix(0); rig.heard()
        rig.channel.send(.enteredBackground)
        XCTAssertFalse(rig.location.running)
        XCTAssertFalse(rig.awake.awake)
        XCTAssertTrue(rig.audio.snapshot.playing)
        rig.fix(1)
        XCTAssertEqual(rig.controller.firedSeqs, [0])
        rig.location.onForeground?()
        XCTAssertTrue(rig.location.running)
        rig.fix(1)
        XCTAssertEqual(rig.controller.firedSeqs, [0, 1])
        rig.controller.pause()
        rig.channel.send(.enteredBackground); rig.location.onForeground?()
        XCTAssertFalse(rig.location.running)
    }

    func testPermissionPromptOnlyFollowsExplicitStartAndPrimeConfirmation() throws {
        let rig = PlaybackRig(); defer { rig.controller.stop() }
        rig.location.permission = .undetermined
        try rig.controller.load(rig.playback(), online: false)
        XCTAssertEqual(rig.location.requests, 0)
        rig.controller.start()
        XCTAssertEqual(rig.controller.phase, .locationPrime)
        XCTAssertEqual(rig.location.requests, 0)
        rig.controller.confirmLocationPermission()
        rig.controller.confirmLocationPermission()
        XCTAssertEqual(rig.location.requests, 1)
        rig.location.permission = .precise; rig.location.onPermission?(.precise)
        XCTAssertEqual(rig.controller.phase, .driving)
        XCTAssertEqual(rig.location.starts, 1)
    }
    func testReducedAccuracyBlocksAndSettingsReturnStartsDrive() throws {
        let rig = PlaybackRig(); defer { rig.controller.stop() }
        rig.location.permission = .reduced
        try rig.controller.load(rig.playback(), online: false); rig.controller.start()
        XCTAssertEqual(rig.controller.phase, .locationReduced)
        XCTAssertFalse(rig.awake.awake)
        rig.location.permission = .precise; rig.location.onPermission?(.precise)
        XCTAssertEqual(rig.controller.phase, .driving)
    }
    func testRejectedFixDoesNotTriggerAndSearchingRecoversOnAcceptedFix() throws {
        let rig = PlaybackRig(); defer { rig.controller.stop() }
        try rig.start()
        rig.controller.receiveRawFix(RawFix(coords: RawFixCoords(latitude: 0, longitude: 0, accuracy: -1), timestamp: 1000))
        XCTAssertNil(rig.controller.activeSeq)
        XCTAssertTrue(rig.controller.gpsSearching)
        rig.controller.receiveRawFix(RawFix(coords: RawFixCoords(latitude: 0, longitude: 0, accuracy: 5, speed: 0, heading: -1), timestamp: 2000))
        XCTAssertEqual(rig.controller.activeSeq, 0)
        XCTAssertFalse(rig.controller.gpsSearching)
        rig.clock.advance(8.1); rig.controller.tick()
        XCTAssertTrue(rig.controller.gpsSearching)
        rig.location.onForeground?()
        XCTAssertTrue(rig.controller.gpsSearching)
    }
}
