import XCTest
@testable import Skipper

@MainActor final class PlaybackTestClock {
    var date = Date(timeIntervalSince1970: 1_800_000_000)
    func advance(_ seconds: Double) { date = date.addingTimeInterval(seconds) }
}
@MainActor final class PlaybackTestAudio: NarrationPlaying {
    enum Failure: Error { case cannotLoad }
    var snapshot = AudioSnapshot()
    var onFinish: (() -> Void)?
    var loaded: [URL] = []
    var seeks: [Double] = []
    var plays = 0
    var stops = 0
    var failLoad = false
    func load(url: URL) throws {
        loaded.append(url)
        if failLoad { throw Failure.cannotLoad }
        snapshot = AudioSnapshot(duration: 30, ready: true)
    }
    func play() { plays += 1; snapshot.playing = true }
    func pause() { snapshot.playing = false }
    func seek(to seconds: Double) { seeks.append(seconds) }
    func stop() { stops += 1; snapshot = AudioSnapshot() }
    func finish() { snapshot.position = snapshot.duration; snapshot.playing = false; onFinish?() }
}
@MainActor final class PlaybackTestSession: AudioSessionDriving {
    enum Failure: Error { case unavailable }
    var activations = 0
    var deactivations = 0
    var unavailable = false
    func activate() throws { activations += 1; if unavailable { throw Failure.unavailable } }
    func deactivate() { deactivations += 1 }
}
@MainActor final class PlaybackTestMusic: DriveMusicPlaying {
    var legs = 0
    var audible = false
    func setAudible(_ audible: Bool, newLeg: Bool) { self.audible = audible; if newLeg { legs += 1 } }
    func stop() { audible = false }
}
@MainActor final class PlaybackTestLocation: DriveLocationSourcing {
    var permission = DriveLocationPermission.precise
    var onPermission: ((DriveLocationPermission) -> Void)?
    var onRawFix: ((RawFix) -> Void)?
    var onError: (() -> Void)?
    var onForeground: (() -> Void)?
    var starts = 0
    var requests = 0
    var running = false
    func requestPermission() { requests += 1 }
    func start() { starts += 1; running = true }
    func pause() { running = false }
    func resume() { running = true }
    func stop() { running = false }
}
@MainActor final class PlaybackTestAwake: ScreenAwakeControlling {
    var awake = false
    func setAwake(_ awake: Bool) { self.awake = awake }
}

@MainActor final class PlaybackRig {
    let clock = PlaybackTestClock()
    let audio = PlaybackTestAudio()
    let music = PlaybackTestMusic()
    let location = PlaybackTestLocation()
    let awake = PlaybackTestAwake()
    let audioSession = PlaybackTestSession()
    let channel: AudioChannel
    var account: SessionSnapshot?
    let traceDirectory: URL?
    lazy var controller = DrivePlaybackController(player: audio, music: music, location: location, awake: awake,
                                                  channel: channel, systemControls: false,
                                                  now: { [unowned self] in self.clock.date },
                                                  session: { [unowned self] in self.account }, traceDirectory: traceDirectory)
    init(admin: Bool = true, traceDirectory: URL? = nil) {
        self.traceDirectory = traceDirectory
        channel = AudioChannel(session: audioSession, observeSystem: false)
        account = SessionSnapshot(user: SessionUser(id: "rider", name: "Rider", email: "rider@example.invalid", emailVerified: true,
                                                    isAnonymous: false, role: admin ? "admin" : nil, createdAt: nil, updatedAt: nil),
                                  session: SessionDetails(id: "session", userId: "rider", expiresAt: "2099-01-01T00:00:00Z", token: nil, createdAt: nil, updatedAt: nil))
    }
    func playback(missing: Set<Int> = [], remote: Set<Int> = []) -> StoragePlayback {
        let clips = [0, 1, 2].map { seq in StorageSavedDriveClip(seq: seq, alongSec: Double(seq * 100), name: "Stop \(seq)", lat: 0, lng: Double(seq) * 0.01, triggerRadiusM: 120, durationMs: 30_000) }
        let detail = StorageSavedDriveDetail(driveId: "00000000-0000-4000-8000-000000000001", label: "Fixture drive", polyline: [[0, 0], [0.01, 0], [0.02, 0]], clips: clips)
        let urls = Dictionary(uniqueKeysWithValues: [0, 1, 2].filter { !missing.contains($0) }.map { seq in
            (seq, remote.contains(seq) ? URL(string: "https://example.invalid/\(seq).m4a")! : URL(fileURLWithPath: "/fixture/\(seq).m4a"))
        })
        return StoragePlayback(detail: detail, urls: urls, expectedSeqs: [0, 1, 2])
    }
    func start(missing: Set<Int> = []) throws { try controller.load(playback(missing: missing), online: false); controller.start() }
    func fix(_ seq: Int) { controller.receiveFix(GpsFix(lat: 0, lng: Double(seq) * 0.01, speedMps: 10, headingDeg: 90, tSec: Double(seq * 100), alongM: Double(seq * 1112))) }
    func heard() { audio.snapshot.position = 1; controller.tick() }
}

@MainActor final class PlaybackLifecycleTests: XCTestCase {
    func testStopFiredReportsFirstHeardEdgeOnceAndRearmsForANewRun() throws {
        let rig = PlaybackRig(); defer { rig.controller.stop() }
        var events: [DriveHeardStop] = []
        rig.controller.onStopFired = { events.append($0) }
        try rig.start(); rig.fix(1)
        XCTAssertTrue(events.isEmpty, "A GPS trigger and a successful load are not heard audio")
        rig.audio.snapshot.position = 0.25; rig.controller.tick()
        XCTAssertTrue(events.isEmpty)
        rig.clock.advance(2); rig.audio.snapshot.position = 0.26; rig.controller.tick()
        XCTAssertEqual(events, [DriveHeardStop(seq: 1, stopIndex: 1, form: .story, durationMs: 30_000, elapsedSeconds: 2)])
        rig.audio.snapshot.position = 2; rig.controller.tick()
        rig.controller.pause(); rig.clock.advance(3); rig.controller.resume(); rig.controller.tick()
        XCTAssertEqual(events.count, 1)
        rig.audio.finish(); rig.controller.replayStop(1); rig.heard()
        XCTAssertEqual(events.count, 1, "A replay's new audio clock must not emit a second stop")
        rig.controller.stop(); rig.controller.start(); rig.fix(1); rig.heard()
        XCTAssertEqual(events.count, 2)
        XCTAssertEqual(events.last?.elapsedSeconds, 0)
    }

    func testStopFiredExcludesLoadFailureTimeoutMissingAudioAndReplayOfUnheardStop() throws {
        let rig = PlaybackRig(); defer { rig.controller.stop() }
        var events: [DriveHeardStop] = []
        rig.controller.onStopFired = { events.append($0) }
        try rig.start(missing: [2])
        rig.audio.failLoad = true; rig.fix(0)
        XCTAssertNil(rig.controller.activeSeq)
        rig.audio.failLoad = false
        rig.controller.replayStop(0); rig.heard(); rig.audio.finish()
        XCTAssertTrue(events.isEmpty, "Even the first audible replay must not count as a road stop")
        rig.fix(1); rig.clock.advance(3); rig.controller.tick()
        rig.fix(2)
        XCTAssertEqual(rig.controller.skippedSeqs, [0, 1, 2])
        XCTAssertTrue(events.isEmpty)
    }

    func testStopFiredClosesUnknownSavedFormsAndKeepsSeqDistinctFromOrdinal() throws {
        let rig = PlaybackRig(); defer { rig.controller.stop() }
        let saved = rig.playback()
        let detail = StorageSavedDriveDetail(driveId: saved.detail.driveId, label: saved.detail.label,
                                            polyline: saved.detail.polyline,
                                            clips: [StorageSavedDriveClip(seq: 42, form: "legacy-form", alongSec: 0, lat: 0, lng: 0)])
        try rig.controller.load(StoragePlayback(detail: detail, urls: [42: URL(fileURLWithPath: "/fixture/42.m4a")], expectedSeqs: [42]), online: false)
        var events: [DriveHeardStop] = []
        rig.controller.onStopFired = { events.append($0) }
        rig.controller.start(); rig.fix(0); rig.heard()
        XCTAssertEqual(events, [DriveHeardStop(seq: 42, stopIndex: 0, form: .other, durationMs: nil, elapsedSeconds: 0)])
    }

    func testForegroundStopsQueueDuringSystemInterruptionAndDrainAfterPermittedResume() throws {
        let rig = PlaybackRig(); defer { rig.controller.stop() }
        try rig.start(); rig.fix(0); rig.heard()
        rig.channel.send(.interruptionBegan)
        XCTAssertTrue(rig.location.running)
        XCTAssertTrue(rig.awake.awake)
        rig.location.onRawFix?(RawFix(coords: RawFixCoords(latitude: 0, longitude: 0.01, accuracy: 5, speed: 10, heading: 90), timestamp: 1000))
        XCTAssertEqual(rig.controller.firedSeqs, [0, 1])
        XCTAssertEqual(rig.controller.activeSeq, 0)
        XCTAssertEqual(rig.audio.loaded.count, 1)
        rig.channel.send(.interruptionEnded(shouldResume: true))
        rig.audio.finish()
        XCTAssertEqual(rig.controller.activeSeq, 1)
        XCTAssertTrue(rig.audio.snapshot.playing)
    }

    func testDisconnectedOutputHoldsAudioWhileForegroundRouteKeepsProgressing() throws {
        let rig = PlaybackRig(); defer { rig.controller.stop() }
        try rig.start(); rig.fix(0); rig.heard()
        rig.channel.send(.outputDisconnected)
        rig.fix(1)
        XCTAssertTrue(rig.controller.paused)
        XCTAssertTrue(rig.location.running)
        XCTAssertEqual(rig.controller.firedSeqs, [0, 1])
        XCTAssertGreaterThan(rig.controller.progress, 0)
        rig.controller.resume(); rig.audio.finish()
        XCTAssertEqual(rig.controller.activeSeq, 1)
    }

    func testFailedSystemReactivationRemainsPausedAndNeverStallSkipsQueuedAudio() throws {
        let rig = PlaybackRig(); defer { rig.controller.stop() }
        try rig.start(); rig.fix(0); rig.heard()
        rig.channel.send(.interruptionBegan)
        rig.audioSession.unavailable = true
        rig.channel.send(.interruptionEnded(shouldResume: true))
        XCTAssertTrue(rig.controller.paused)
        XCTAssertFalse(rig.controller.playing)
        XCTAssertNotNil(rig.controller.error)
        rig.fix(1); rig.clock.advance(30); rig.controller.tick()
        XCTAssertEqual(rig.controller.activeSeq, 0)
        XCTAssertTrue(rig.controller.skippedSeqs.isEmpty)
        rig.audioSession.unavailable = false
        rig.controller.resume(); rig.audio.finish()
        XCTAssertEqual(rig.controller.activeSeq, 1)
        XCTAssertFalse(rig.controller.paused)
    }

    func testAdjacentNarrationsRotateMusicOnlyOnTheNextQuietLeg() throws {
        let rig = PlaybackRig(); defer { rig.controller.stop() }
        try rig.start(); rig.fix(0); rig.fix(1)
        rig.heard(); rig.audio.finish()
        XCTAssertEqual(rig.music.legs, 0)
        XCTAssertFalse(rig.music.audible)
        rig.heard(); rig.audio.finish()
        XCTAssertEqual(rig.music.legs, 1)
        XCTAssertTrue(rig.music.audible)
    }

    func testSeekingBackAcrossCompletionKeepsTheCurrentNarration() throws {
        let rig = PlaybackRig(); defer { rig.controller.stop() }
        try rig.start(); rig.fix(0); rig.heard()
        rig.controller.setScrubbing(true)
        rig.audio.finish()
        XCTAssertEqual(rig.controller.activeSeq, 0)
        rig.controller.seek(to: 5)
        rig.controller.setScrubbing(false)
        rig.audio.snapshot.position = 5
        rig.controller.tick()
        XCTAssertEqual(rig.controller.activeSeq, 0)
        XCTAssertFalse(rig.controller.playedSeqs.contains(0))
        XCTAssertTrue(rig.audio.snapshot.playing)
    }

    func testFailedNewLoadCannotLeavePreviousDriveStartable() throws {
        let rig = PlaybackRig(); defer { rig.controller.stop() }
        try rig.start(); rig.controller.stop()
        XCTAssertThrowsError(try rig.controller.load(rig.playback(remote: [0, 1, 2]), online: false))
        rig.controller.start()
        XCTAssertEqual(rig.controller.phase, .empty)
        XCTAssertNil(rig.controller.detail)
        XCTAssertNil(rig.controller.activeSeq)
    }

    func testMediaResetPreservesQueueAndPositionButRequiresExplicitResume() throws {
        let rig = PlaybackRig(); defer { rig.controller.stop() }
        try rig.start(); rig.fix(0); rig.heard(); rig.fix(1)
        rig.audio.snapshot.position = 12; rig.controller.tick()
        rig.channel.send(.mediaServicesReset)
        XCTAssertTrue(rig.controller.paused)
        XCTAssertEqual(rig.controller.activeSeq, 0)
        XCTAssertEqual(rig.audio.seeks.last, 12)
        rig.controller.resume(); rig.audio.snapshot.position = 12; rig.controller.tick(); rig.audio.finish()
        XCTAssertEqual(rig.controller.activeSeq, 1)
    }

    func testQueueDrainsBeforeRouteCompletionAndDuplicateFixDoesNotReplay() throws {
        let rig = PlaybackRig(); defer { rig.controller.stop() }
        try rig.start(); rig.fix(0); rig.fix(0); rig.fix(1); rig.controller.routeEnded()
        XCTAssertEqual(rig.audio.loaded.count, 1)
        XCTAssertEqual(rig.controller.activeSeq, 0)
        XCTAssertEqual(rig.controller.phase, .driving)
        rig.heard(); rig.audio.finish()
        XCTAssertEqual(rig.controller.activeSeq, 1)
        rig.heard(); rig.audio.finish()
        XCTAssertEqual(rig.controller.phase, .done)
        XCTAssertEqual(rig.controller.playedSeqs, [0, 1])
        XCTAssertFalse(rig.awake.awake)
        XCTAssertFalse(rig.location.running)
        XCTAssertEqual(rig.audioSession.deactivations, 1)
    }

    func testRoadTriggerPreemptsReplayAndIgnoresOldCompletion() throws {
        let rig = PlaybackRig(); defer { rig.controller.stop() }
        try rig.start(); rig.fix(0); rig.heard(); rig.audio.finish()
        XCTAssertTrue(rig.controller.canReplay)
        rig.controller.replayLast()
        let staleCompletion = rig.audio.onFinish
        rig.fix(1)
        XCTAssertEqual(rig.controller.activeSeq, 1)
        staleCompletion?()
        XCTAssertEqual(rig.controller.activeSeq, 1)
        XCTAssertFalse(rig.controller.playedSeqs.contains(1))
        rig.controller.replayStop(0)
        XCTAssertEqual(rig.controller.activeSeq, 1)
    }

    func testPausedDriveIgnoresFixesAndResumesSameClipWithoutMusicRotation() throws {
        let rig = PlaybackRig(); defer { rig.controller.stop() }
        try rig.start(); rig.fix(0); rig.heard()
        let legs = rig.music.legs
        rig.controller.pause(); rig.fix(1); rig.clock.advance(60); rig.controller.tick()
        XCTAssertEqual(rig.controller.firedSeqs, [0])
        XCTAssertEqual(rig.controller.activeSeq, 0)
        XCTAssertFalse(rig.awake.awake)
        XCTAssertFalse(rig.location.running)
        rig.controller.resume()
        XCTAssertEqual(rig.controller.activeSeq, 0)
        XCTAssertEqual(rig.music.legs, legs)
        XCTAssertTrue(rig.awake.awake)
        XCTAssertTrue(rig.location.running)
    }

    func testInterruptionHoldsWatchdogAndResumesOnlyWhenAllowed() throws {
        let rig = PlaybackRig(); defer { rig.controller.stop() }
        try rig.start(); rig.fix(0); rig.heard()
        rig.channel.send(.interruptionBegan)
        rig.clock.advance(100); rig.controller.tick()
        XCTAssertEqual(rig.controller.activeSeq, 0)
        XCTAssertTrue(rig.controller.skippedSeqs.isEmpty)
        rig.channel.send(.interruptionEnded(shouldResume: false))
        XCTAssertTrue(rig.controller.paused)
        XCTAssertFalse(rig.audio.snapshot.playing)
        rig.controller.resume()
        rig.channel.send(.interruptionBegan)
        rig.channel.send(.interruptionEnded(shouldResume: true))
        XCTAssertFalse(rig.controller.paused)
        XCTAssertTrue(rig.audio.snapshot.playing)
    }

    func testUserPauseDuringInterruptionOverridesAutomaticResumeAndDisconnectPauses() throws {
        let rig = PlaybackRig(); defer { rig.controller.stop() }
        try rig.start(); rig.fix(0)
        rig.channel.send(.interruptionBegan); rig.controller.pause()
        rig.channel.send(.interruptionEnded(shouldResume: true))
        XCTAssertTrue(rig.controller.paused)
        rig.controller.resume(); rig.channel.send(.outputDisconnected)
        XCTAssertTrue(rig.controller.paused)
        XCTAssertTrue(rig.location.running)
        rig.controller.pause()
        XCTAssertFalse(rig.location.running)
    }

    func testStallRetriesOnceThenAdvancesQueuedStop() throws {
        let rig = PlaybackRig(); defer { rig.controller.stop() }
        try rig.start(); rig.fix(0); rig.heard(); rig.fix(1)
        let plays = rig.audio.plays
        rig.clock.advance(6.1); rig.controller.tick()
        XCTAssertEqual(rig.audio.plays, plays + 1)
        XCTAssertEqual(rig.controller.activeSeq, 0)
        rig.clock.advance(6.1); rig.controller.tick()
        XCTAssertEqual(rig.controller.activeSeq, 1)
        XCTAssertEqual(rig.controller.skippedSeqs, [0])
    }

    func testPrestartFailureDoesNotBecomeReplayLastAndMissingClipDoesNotBlockQueue() throws {
        let rig = PlaybackRig(); defer { rig.controller.stop() }
        try rig.start(missing: [1]); rig.fix(0)
        rig.clock.advance(2.6); rig.controller.tick()
        XCTAssertNil(rig.controller.lastCompletedSeq)
        rig.fix(1); rig.fix(2)
        XCTAssertEqual(rig.controller.activeSeq, 2)
        XCTAssertEqual(rig.controller.skippedSeqs, [0, 1])
        XCTAssertEqual(rig.controller.missingClipCount, 1)
    }

    func testOnlinePartialGateIsLatchedAndRejectsRemoteDownloadedURLs() throws {
        let rig = PlaybackRig(); defer { rig.controller.stop() }
        try rig.controller.load(rig.playback(remote: [1]), online: true)
        XCTAssertEqual(rig.controller.missingClipCount, 1)
        rig.controller.start()
        XCTAssertEqual(rig.controller.phase, .ready)
        XCTAssertEqual(rig.location.starts, 0)
        XCTAssertEqual(rig.audioSession.activations, 0)
        XCTAssertThrowsError(try rig.controller.load(rig.playback(remote: [0, 1, 2]), online: false))
    }

    func testStopReleasesSessionAndRestartReacquiresIt() throws {
        let rig = PlaybackRig(); defer { rig.controller.stop() }
        try rig.start(); rig.fix(0)
        let oldCompletion = rig.audio.onFinish
        rig.controller.stop()
        oldCompletion?(); rig.fix(1)
        XCTAssertNil(rig.controller.activeSeq)
        XCTAssertFalse(rig.music.audible)
        rig.controller.start(); rig.fix(0)
        XCTAssertEqual(rig.audioSession.activations, 2)
        XCTAssertEqual(rig.controller.activeSeq, 0)
    }

    func testRapidSeekTapsAccumulateAgainstPendingTarget() throws {
        let rig = PlaybackRig(); defer { rig.controller.stop() }
        try rig.start(); rig.fix(0); rig.heard()
        rig.audio.snapshot.duration = 120; rig.controller.tick()
        rig.controller.seekBy(15); rig.controller.seekBy(15)
        XCTAssertEqual(rig.audio.seeks, [16, 31])
        rig.controller.tick()
        XCTAssertEqual(rig.controller.position, 31)
        rig.audio.snapshot.position = 31; rig.controller.tick()
        rig.audio.snapshot.position = 40; rig.controller.tick(); rig.controller.seekBy(-15)
        XCTAssertEqual(rig.audio.seeks.last, 25)
    }

    func testNonAdminCannotSimulateOrExportAndSignoutRevokesActiveSimulation() throws {
        let rig = PlaybackRig(admin: false); defer { rig.controller.stop() }
        try rig.controller.load(rig.playback(), online: false)
        rig.controller.start(simulate: true)
        XCTAssertEqual(rig.controller.phase, .ready)
        XCTAssertNil(rig.controller.exportTrace())
        let admin = PlaybackRig(); defer { admin.controller.stop() }
        try admin.controller.load(admin.playback(), online: false)
        admin.controller.start(simulate: true)
        XCTAssertEqual(admin.controller.phase, .driving)
        admin.account = nil; admin.clock.advance(1); admin.controller.tick()
        XCTAssertEqual(admin.controller.phase, .ready)
        XCTAssertFalse(admin.music.audible)
    }

    func testSessionTakeoverCannotBeReleasedByOldOwner() throws {
        let session = PlaybackTestSession()
        let channel = AudioChannel(session: session, observeSystem: false)
        let first = UUID(); let second = UUID()
        var revoked = false
        try channel.acquire(owner: first, revoke: { revoked = true; channel.release(owner: first) }, event: { _ in })
        try channel.acquire(owner: second, revoke: {}, event: { _ in })
        XCTAssertTrue(revoked)
        channel.release(owner: first)
        XCTAssertEqual(session.deactivations, 0)
        channel.release(owner: second)
        XCTAssertEqual(session.deactivations, 1)
    }
}
