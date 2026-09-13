#if DEBUG
import Foundation

@MainActor
enum DebugPlaybackServices {
    static func make(scenario: String? = nil, session: SessionStore, date: Date, root: URL, polyline: [LngLat] = []) -> DrivePlaybackController {
        let isLive = scenario == "driving-qa-live"
        let isDrivingQA = scenario == "driving-qa-two-stops" || isLive
        let player: any NarrationPlaying = isDrivingQA ? NativeNarrationPlayer() : DebugSilentNarration()
        let start = Date()
        let nowClosure: () -> Date = isDrivingQA ? { date.addingTimeInterval(Date().timeIntervalSince(start)) } : { date }
        let location: any DriveLocationSourcing = isLive ? DebugScriptedLocation(polyline: polyline) : DebugLocation()
        return DrivePlaybackController(player: player, music: DebugSilentMusic(),
            location: location, awake: DebugScreenAwake(),
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

@MainActor final class DebugScriptedLocation: DriveLocationSourcing {
    var permission: DriveLocationPermission { .precise }
    var onPermission: ((DriveLocationPermission) -> Void)?
    var onRawFix: ((RawFix) -> Void)?
    var onError: (() -> Void)?
    var onForeground: (() -> Void)?

    private var fixes: [GpsFix]
    private var currentIndex: Int = 0
    private var task: Task<Void, Never>?
    private let initialHoldSeconds: Double = 3.0
    private let tickHz: Double = 4.0

    init(polyline: [LngLat]) {
        self.fixes = generateDrive(polyline: polyline, opts: DriveOptions(mph: 60, tickHz: 4))
    }

    func requestPermission() {
        onPermission?(.precise)
    }

    func start() {
        task?.cancel()
        task = Task { @MainActor [weak self] in
            guard let self else { return }
            try? await Task.sleep(for: .milliseconds(Int(self.initialHoldSeconds * 1000)))
            guard !Task.isCancelled else { return }
            await self.runLoop()
        }
    }

    func pause() {
        task?.cancel()
        task = nil
    }

    func resume() {
        task?.cancel()
        task = Task { @MainActor [weak self] in
            guard let self else { return }
            await self.runLoop()
        }
    }

    func stop() {
        task?.cancel()
        task = nil
        currentIndex = 0
    }

    private func runLoop() async {
        let intervalMs = Int(1000.0 / tickHz)
        while !Task.isCancelled && currentIndex < fixes.count {
            let fix = fixes[currentIndex]
            let raw = RawFix(
                coords: RawFixCoords(
                    latitude: fix.lat,
                    longitude: fix.lng,
                    accuracy: 5.0,
                    speed: fix.speedMps,
                    heading: fix.headingDeg
                ),
                timestamp: Date().timeIntervalSince1970 * 1000
            )
            onRawFix?(raw)
            currentIndex += 1
            try? await Task.sleep(for: .milliseconds(intervalMs))
        }
    }
}
#endif
