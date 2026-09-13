import XCTest
@testable import Skipper

@MainActor final class AudioPreviewLifecycleTests: XCTestCase {
    func testRemotePreviewUsesRemoteBudgetAndReportsCompletionOnceAcrossReplay() {
        let audio = PlaybackTestAudio(); let clock = PlaybackTestClock()
        let preview = AudioPreviewController(player: audio, channel: AudioChannel(session: PlaybackTestSession(), observeSystem: false), now: { clock.date })
        defer { preview.stop() }
        var events: [Bool] = []
        preview.onRoutePreview = { events.append($0) }
        preview.playRoutePreview(cardId: "expired", url: URL(string: "https://example.invalid/expired.m4a"))
        clock.advance(3); preview.tick()
        XCTAssertEqual(preview.activeID, "expired")
        clock.advance(9.1); preview.tick()
        XCTAssertEqual(preview.failedID, "expired")
        preview.playRoutePreview(cardId: "good", url: URL(string: "https://example.invalid/good.m4a"))
        audio.snapshot.position = 1; preview.tick(); audio.finish()
        preview.resume(); audio.finish()
        XCTAssertEqual(events, [false, false, true])
    }

    func testExplicitPauseDuringInitialBufferingSuspendsTheWatchdog() {
        let audio = PlaybackTestAudio(); let clock = PlaybackTestClock()
        let preview = AudioPreviewController(player: audio, channel: AudioChannel(session: PlaybackTestSession(), observeSystem: false), now: { clock.date })
        defer { preview.stop() }
        preview.playLocal(id: "clip", url: URL(fileURLWithPath: "/clip.m4a"))
        XCTAssertFalse(preview.playing)
        preview.pause(); clock.advance(30); preview.tick()
        XCTAssertEqual(preview.activeID, "clip")
        XCTAssertNil(preview.failedID)
        XCTAssertFalse(audio.snapshot.playing)
        preview.resume(); audio.snapshot.position = 1; preview.tick()
        XCTAssertTrue(preview.playing)
    }

    func testDriveTakesPreviewChannelAndOldPreviewStopCannotSilenceDrive() throws {
        let rig = PlaybackRig(); defer { rig.controller.stop() }
        let previewAudio = PlaybackTestAudio()
        let preview = AudioPreviewController(player: previewAudio, channel: rig.channel, now: { rig.clock.date })
        preview.playLocal(id: "first", url: URL(fileURLWithPath: "/first.m4a"))
        XCTAssertEqual(preview.activeID, "first")
        try rig.start()
        XCTAssertNil(preview.activeID)
        preview.stop()
        XCTAssertEqual(rig.audioSession.deactivations, 0)
        XCTAssertTrue(rig.music.audible)
    }
    func testSupersededPreviewCompletionAndTimerCannotFailNewClip() {
        let audio = PlaybackTestAudio(); let clock = PlaybackTestClock()
        let channel = AudioChannel(session: PlaybackTestSession(), observeSystem: false)
        let preview = AudioPreviewController(player: audio, channel: channel, now: { clock.date }); defer { preview.stop() }
        preview.playLocal(id: "first", url: URL(fileURLWithPath: "/first.m4a"))
        let oldEnd = audio.onFinish
        preview.playLocal(id: "second", url: URL(fileURLWithPath: "/second.m4a"))
        oldEnd?()
        XCTAssertFalse(preview.completed)
        audio.snapshot.position = 1; preview.tick()
        clock.advance(3); audio.snapshot.position = 2; preview.tick()
        XCTAssertEqual(preview.activeID, "second")
        XCTAssertNil(preview.failedID)
    }
    func testPreviewFailureAndCompletionGiveSessionBackAndReplayReactivates() {
        let audio = PlaybackTestAudio(); let clock = PlaybackTestClock(); let session = PlaybackTestSession()
        let channel = AudioChannel(session: session, observeSystem: false)
        let preview = AudioPreviewController(player: audio, channel: channel, now: { clock.date }); defer { preview.stop() }
        preview.playLocal(id: "bad", url: URL(fileURLWithPath: "/bad.m4a"))
        clock.advance(3); preview.tick()
        XCTAssertEqual(preview.failedID, "bad")
        XCTAssertEqual(session.deactivations, 1)
        preview.playLocal(id: "good", url: URL(fileURLWithPath: "/good.m4a"))
        audio.snapshot.position = 1; preview.tick(); audio.finish()
        XCTAssertTrue(preview.completed)
        XCTAssertEqual(session.deactivations, 2)
        preview.toggle()
        XCTAssertFalse(preview.completed)
        XCTAssertEqual(session.activations, 3)
        XCTAssertEqual(audio.seeks.last, 0)
        channel.send(.enteredBackground)
        XCTAssertNil(preview.activeID)
    }
    func testDownloadedPreviewRejectsRemoteURLBeforeTakingFocus() {
        let session = PlaybackTestSession()
        let preview = AudioPreviewController(player: PlaybackTestAudio(), channel: AudioChannel(session: session, observeSystem: false)); defer { preview.stop() }
        preview.playLocal(id: "remote", url: URL(string: "https://example.invalid/clip"))
        XCTAssertEqual(preview.failedID, "remote")
        XCTAssertNil(preview.activeID)
        XCTAssertEqual(session.activations, 0)
    }
}
