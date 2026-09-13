import AVFoundation
import MediaPlayer
import UIKit

enum AudioChannelEvent: Sendable { case interruptionBegan, interruptionEnded(shouldResume: Bool), outputDisconnected, mediaServicesReset, enteredBackground }

@MainActor
protocol AudioSessionDriving: AnyObject {
    func activate() throws
    func deactivate()
}

@MainActor
final class SystemAudioSession: AudioSessionDriving {
    func activate() throws {
        let session = AVAudioSession.sharedInstance()
        // The drive IS the audio. Empty options deliberately exclude mixing and ducking.
        try session.setCategory(.playback, mode: .default, options: [])
        try session.setActive(true)
    }
    func deactivate() {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}

/// Process-wide ownership prevents a dismissed preview from deactivating a newer drive.
@MainActor
final class AudioChannel {
    static let shared = AudioChannel()
    private let session: any AudioSessionDriving
    private var owner: UUID?
    private var revoke: (() -> Void)?
    private var event: ((AudioChannelEvent) -> Void)?
    private var observers: [NSObjectProtocol] = []

    init(session: (any AudioSessionDriving)? = nil, observeSystem: Bool = true) {
        self.session = session ?? SystemAudioSession()
        guard observeSystem else { return }
        observe(AVAudioSession.interruptionNotification) { note in
            guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  let type = AVAudioSession.InterruptionType(rawValue: raw) else { return nil }
            if type == .began { return .interruptionBegan }
            let options = AVAudioSession.InterruptionOptions(rawValue: note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0)
            return .interruptionEnded(shouldResume: options.contains(.shouldResume))
        }
        observe(AVAudioSession.routeChangeNotification) { note in
            note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue ? .outputDisconnected : nil
        }
        observe(AVAudioSession.mediaServicesWereResetNotification) { _ in .mediaServicesReset }
        observe(UIApplication.didEnterBackgroundNotification) { _ in .enteredBackground }
    }

    private func observe(_ name: Notification.Name, _ map: @escaping @Sendable (Notification) -> AudioChannelEvent?) {
        observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] note in
            // Parse Foundation's untyped notification before crossing into actor-isolated state.
            guard let event = map(note) else { return }
            MainActor.assumeIsolated { self?.send(event) }
        })
    }

    func acquire(owner newOwner: UUID, revoke: @escaping () -> Void, event: @escaping (AudioChannelEvent) -> Void) throws {
        if owner != newOwner {
            let oldRevoke = self.revoke
            owner = nil; self.revoke = nil; self.event = nil
            oldRevoke?()
        }
        do { try session.activate() }
        catch {
            // A failed takeover must still give the previous audio application its session back.
            session.deactivate()
            throw error
        }
        owner = newOwner; self.revoke = revoke; self.event = event
    }

    func reactivate(owner: UUID) throws {
        guard self.owner == owner else { throw PlaybackFailure.channelLost }
        try session.activate()
    }

    func release(owner: UUID) {
        guard self.owner == owner else { return }
        self.owner = nil; revoke = nil; event = nil
        session.deactivate()
    }

    func send(_ event: AudioChannelEvent) { self.event?(event) }

    /// App/auth cleanup calls this before deleting any local bytes.
    func stopAll() {
        let oldRevoke = revoke
        owner = nil; revoke = nil; event = nil
        oldRevoke?()
        session.deactivate()
    }

    isolated deinit { for observer in observers { NotificationCenter.default.removeObserver(observer) } }
}

enum PlaybackFailure: Error { case channelLost, localAudioRequired, invalidRoute, noPlayableAudio, downloadRequired, adminRequired, invalidTrace }

@MainActor
final class NowPlayingControls {
    private struct State: Equatable {
        let title: String
        let album: String
        let duration: Double
        let playing: Bool
        let canSeek: Bool
    }
    private var targets: [(MPRemoteCommand, Any)] = []
    private let center = MPRemoteCommandCenter.shared()
    private var lastState: State?
    private let artwork: MPMediaItemArtwork? = UIImage(named: "badge").map { image in
        MPMediaItemArtwork(boundsSize: image.size) { _ in image }
    }

    func install(play: @escaping () -> Void, pause: @escaping () -> Void, toggle: @escaping () -> Void,
                 seek: @escaping (Double) -> Void, skip: @escaping (Double) -> Void, stop: @escaping () -> Void) {
        clear()
        bind(center.playCommand, play)
        bind(center.pauseCommand, pause)
        bind(center.togglePlayPauseCommand, toggle)
        bind(center.stopCommand, stop)
        center.skipBackwardCommand.preferredIntervals = [15]
        center.skipForwardCommand.preferredIntervals = [15]
        bind(center.skipBackwardCommand) { skip(-15) }
        bind(center.skipForwardCommand) { skip(15) }
        let target = center.changePlaybackPositionCommand.addTarget { event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            let position = event.positionTime
            Task { @MainActor in seek(position) }
            return .success
        }
        targets.append((center.changePlaybackPositionCommand, target))
    }

    private func bind(_ command: MPRemoteCommand, _ action: @escaping @MainActor () -> Void) {
        command.isEnabled = true
        let target = command.addTarget { _ in
            Task { @MainActor in action() }
            return .success
        }
        targets.append((command, target))
    }

    func update(title: String, album: String, position: Double, duration: Double, playing: Bool, canSeek: Bool, force: Bool = false) {
        let state = State(title: title, album: album, duration: duration, playing: playing, canSeek: canSeek)
        guard state != lastState || force else { return }
        lastState = state
        // iOS extrapolates elapsed time from the playback rate; clock ticks are not metadata changes.
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: title, MPMediaItemPropertyArtist: "Skipper",
            MPMediaItemPropertyAlbumTitle: album, MPMediaItemPropertyPlaybackDuration: duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: position,
            MPNowPlayingInfoPropertyPlaybackRate: playing ? 1.0 : 0.0,
            MPNowPlayingInfoPropertyDefaultPlaybackRate: 1.0
        ]
        if let artwork { info[MPMediaItemPropertyArtwork] = artwork }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        center.changePlaybackPositionCommand.isEnabled = canSeek
        center.skipForwardCommand.isEnabled = canSeek
        center.skipBackwardCommand.isEnabled = canSeek
    }

    func clear() {
        for (command, target) in targets { command.removeTarget(target); command.isEnabled = false }
        if !targets.isEmpty { MPNowPlayingInfoCenter.default().nowPlayingInfo = nil }
        targets.removeAll()
        lastState = nil
    }
}
