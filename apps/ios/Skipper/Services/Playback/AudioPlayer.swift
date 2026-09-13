import AVFoundation

struct AudioSnapshot: Equatable {
    var position: Double = 0
    var duration: Double = 0
    var playing = false
    var ready = false
    var failed = false
}

@MainActor
protocol NarrationPlaying: AnyObject {
    var snapshot: AudioSnapshot { get }
    var onFinish: (() -> Void)? { get set }
    func load(url: URL) throws
    func play()
    func pause()
    func seek(to seconds: Double)
    func stop()
}

/// One item per narration; item-identity checks reject completions from replaced clips.
@MainActor
final class NativeNarrationPlayer: NarrationPlaying {
    private var player = AVPlayer()
    private var endObserver: NSObjectProtocol?
    var onFinish: (() -> Void)?
    var snapshot: AudioSnapshot {
        guard let item = player.currentItem else { return AudioSnapshot() }
        let position = player.currentTime().seconds
        let duration = item.duration.seconds
        return AudioSnapshot(position: position.isFinite ? max(0, position) : 0,
                             duration: duration.isFinite ? max(0, duration) : 0,
                             playing: player.timeControlStatus == .playing,
                             ready: item.status == .readyToPlay, failed: item.status == .failed)
    }
    func load(url: URL) throws {
        stop()
        player = AVPlayer()
        let item = AVPlayerItem(url: url)
        player.replaceCurrentItem(with: item)
        endObserver = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self, weak item] _ in
            MainActor.assumeIsolated {
                guard let self, let item, self.player.currentItem === item else { return }
                self.onFinish?()
            }
        }
    }
    func play() { player.play() }
    func pause() { player.pause() }
    func seek(to seconds: Double) {
        player.seek(to: CMTime(seconds: seconds, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
    }
    func stop() {
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        endObserver = nil
        player.pause(); player.replaceCurrentItem(with: nil)
    }
    isolated deinit { if let endObserver { NotificationCenter.default.removeObserver(endObserver) } }
}

@MainActor
protocol DriveMusicPlaying: AnyObject {
    func setAudible(_ audible: Bool, newLeg: Bool)
    func stop()
}

/// Native queue keeps a full shuffled rotation ahead of the current leg.
@MainActor
final class NativeDriveMusic: DriveMusicPlaying {
    static let trackNames = ["drive_loop", "acoustic_road_trip", "travel_in_light", "golden_twilight", "acoustic_folk_guitar", "small_town", "strummin_robin_smith", "homeward", "simplicity", "wanderlust", "journeys", "felicity", "ice_cream", "green_leaves", "redwood_trail", "paper_wings", "landras_dream"]
    private let urls: [URL]
    private var player = AVQueuePlayer()
    private var cursor = 0
    private var started = false
    private var running = false
    private var queuedItems: [ObjectIdentifier: AVPlayerItem] = [:]
    private var ramp: Task<Void, Never>?
    private var observer: NSObjectProtocol?

    init(urls: [URL]? = nil) {
        self.urls = (urls ?? Self.trackNames.compactMap { Bundle.main.url(forResource: $0, withExtension: "mp3") }).shuffled()
        player.volume = 0
        observer = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: nil, queue: .main) { [weak self] note in
            guard let item = note.object as? AVPlayerItem else { return }
            MainActor.assumeIsolated {
                guard let self, self.queuedItems.removeValue(forKey: ObjectIdentifier(item)) != nil else { return }
                // Refill on the next actor turn, after AVQueuePlayer advances its finished item.
                Task { @MainActor [weak self] in self?.refill() }
            }
        }
    }
    private func refill() {
        guard running, !urls.isEmpty else { return }
        while player.items().count < 3 {
            let item = AVPlayerItem(url: urls[cursor % urls.count]); cursor += 1
            queuedItems[ObjectIdentifier(item)] = item
            player.insert(item, after: nil)
        }
    }
    func setAudible(_ audible: Bool, newLeg: Bool) {
        ramp?.cancel()
        running = true
        refill()
        if newLeg && started {
            player.volume = 0
            if let item = player.currentItem { queuedItems.removeValue(forKey: ObjectIdentifier(item)) }
            player.advanceToNextItem(); refill()
        }
        if audible { started = true; player.play() }
        let target: Float = audible ? 0.95 : 0
        ramp = Task { [weak self] in
            for _ in 0..<12 {
                guard !Task.isCancelled, let self else { return }
                let delta: Float = 0.95 / 12
                self.player.volume += self.player.volume < target ? min(delta, target - self.player.volume) : -min(delta, self.player.volume - target)
                try? await Task.sleep(for: .milliseconds(100))
            }
            guard !Task.isCancelled, let self else { return }
            self.player.volume = target
            if !audible { self.player.pause() }
        }
    }
    func stop() { running = false; queuedItems = [:]; ramp?.cancel(); ramp = nil; player.pause(); player.removeAllItems(); player = AVQueuePlayer(); player.volume = 0; started = false }
    isolated deinit { ramp?.cancel(); if let observer { NotificationCenter.default.removeObserver(observer) } }
}
