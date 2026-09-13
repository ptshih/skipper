#if DEBUG
import Foundation

@MainActor
enum DebugPlaybackServices {
    static func make(scenario: String? = nil, session: SessionStore, date: Date, root: URL) -> DrivePlaybackController {
        let isDrivingQA = scenario == "driving-qa-two-stops"
        let player: any NarrationPlaying = isDrivingQA ? NativeNarrationPlayer() : DebugSilentNarration()
        let start = Date()
        let nowClosure: () -> Date = isDrivingQA ? { date.addingTimeInterval(Date().timeIntervalSince(start)) } : { date }
        return DrivePlaybackController(player: player, music: DebugSilentMusic(),
            location: DebugLocation(), awake: DebugScreenAwake(),
            channel: AudioChannel(session: DebugAudioSession(), observeSystem: false), systemControls: false,
            now: nowClosure, session: { session.session }, traceDirectory: root.appendingPathComponent("traces"))
    }
}
@MainActor private final class DebugSilentNarration: NarrationPlaying {
    var snapshot = AudioSnapshot()
    var onFinish: (() -> Void)?
    func load(url: URL) throws { throw PlaybackFailure.localAudioRequired }
    func play() {}
    func pause() {}
    func seek(to seconds: Double) {}
    func stop() { snapshot = AudioSnapshot() }
}
@MainActor private final class DebugSilentMusic: DriveMusicPlaying {
    func setAudible(_ audible: Bool, newLeg: Bool) {}
    func stop() {}
}
@MainActor private final class DebugAudioSession: AudioSessionDriving {
    func activate() throws {}
    func deactivate() {}
}
@MainActor private final class DebugScreenAwake: ScreenAwakeControlling { func setAwake(_ awake: Bool) {} }
@MainActor private final class DebugLocation: DriveLocationSourcing {
    var permission: DriveLocationPermission { .denied }
    var onPermission: ((DriveLocationPermission) -> Void)?
    var onRawFix: ((RawFix) -> Void)?
    var onError: (() -> Void)?
    var onForeground: (() -> Void)?
    func requestPermission() { onPermission?(.denied) }
    func start() {}
    func pause() {}
    func resume() {}
    func stop() {}
}
#endif
