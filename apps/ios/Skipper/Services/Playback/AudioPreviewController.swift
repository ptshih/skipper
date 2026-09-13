import Foundation
import Observation

/// One preview player shared by all cards/rows on its surface. A route preview is the
/// sole streaming exception; downloaded stop previews accept file URLs only.
@MainActor @Observable
final class AudioPreviewController {
    private(set) var activeID: String?
    private(set) var failedID: String?
    private(set) var playing = false
    private(set) var position: Double = 0
    private(set) var duration: Double = 0
    private(set) var canSeek = false
    private(set) var completed = false
    @ObservationIgnored private let player: any NarrationPlaying
    @ObservationIgnored private let channel: AudioChannel
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private let owner = UUID()
    @ObservationIgnored private var timer: Task<Void, Never>?
    @ObservationIgnored private var loadedAt: Date = .distantPast
    @ObservationIgnored private var lastProgressAt: Date = .distantPast
    @ObservationIgnored private var lastPosition: Double = 0
    @ObservationIgnored private var remote = false
    @ObservationIgnored private var heard = false
    @ObservationIgnored private var resumeTried = false
    @ObservationIgnored private var paused = false
    @ObservationIgnored private var interrupted = false
    @ObservationIgnored private var resumeAfterInterruption = false
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var loadedURL: URL?
    @ObservationIgnored private var seekTarget: Double?
    @ObservationIgnored private var completedReported = false
    /// Privacy-closed route-preview metric; no URL, title, transcript, or identifier payload.
    @ObservationIgnored var onRoutePreview: ((Bool) -> Void)?

    init(player: (any NarrationPlaying)? = nil, channel: AudioChannel? = nil,
         now: @escaping () -> Date = Date.init) {
        self.player = player ?? NativeNarrationPlayer()
        self.channel = channel ?? .shared
        self.now = now
    }

    func playLocal(id: String, url: URL?, title: String = "Skipper") {
        guard let url, url.isFileURL else { stop(); failedID = id; return }
        play(id: id, url: url, remote: false)
    }
    func playRoutePreview(cardId: String, clip: DrivePreviewClip) {
        playRoutePreview(cardId: cardId, url: URL(string: clip.url))
    }
    func playRoutePreview(cardId: String, url: URL?) {
        guard let url, url.scheme?.lowercased() == "https" else {
            stop(); failedID = cardId; return
        }
        play(id: cardId, url: url, remote: true)
    }

    private func play(id: String, url: URL, remote: Bool) {
        if id == activeID && url == loadedURL { toggle(); return }
        stop()
        activeID = id; loadedURL = url; self.remote = remote
        if failedID == id { failedID = nil }
        completed = false; completedReported = false; paused = false; heard = false
        resumeTried = false; lastPosition = 0; loadedAt = now(); lastProgressAt = now()
        let current = UUID(); generation = current
        player.onFinish = { [weak self] in
            guard let self, self.generation == current else { return }
            self.finish()
        }
        do {
            try acquire()
            try player.load(url: url)
            player.play()
            if remote { onRoutePreview?(false) }
            startTimer()
        } catch { fail() }
    }

    private func acquire() throws {
        try channel.acquire(owner: owner, revoke: { [weak self] in self?.stop() }, event: { [weak self] in self?.handle($0) })
    }
    func toggle() {
        guard activeID != nil else { return }
        if !paused && !completed { pause() } else { resume() }
    }
    func resume() {
        guard activeID != nil, !interrupted else { return }
        do {
            try acquire()
            if completed { player.seek(to: 0); position = 0; lastPosition = 0; seekTarget = 0; completed = false; heard = false }
            paused = false; resumeAfterInterruption = false
            loadedAt = now(); lastProgressAt = now(); resumeTried = false
            player.play(); startTimer()
        } catch { fail() }
    }
    func pause() {
        paused = true; resumeAfterInterruption = false; player.pause(); playing = false
    }

    func seek(to seconds: Double) {
        guard canSeek, seconds.isFinite else { return }
        let target = min(duration, max(0, seconds))
        player.seek(to: target); seekTarget = target; position = target; lastPosition = target
        lastProgressAt = now(); loadedAt = now(); resumeTried = false
        if target < duration { completed = false }
    }
    func seekBy(_ seconds: Double) { seek(to: (seekTarget ?? position) + seconds) }
    func stop() {
        generation = UUID(); timer?.cancel(); timer = nil
        player.onFinish = nil; player.stop(); channel.release(owner: owner)
        activeID = nil; loadedURL = nil; playing = false; canSeek = false
        position = 0; duration = 0; seekTarget = nil; completed = false; interrupted = false; paused = false
    }
    private func finish() {
        guard activeID != nil, !completed else { return }
        completed = true; playing = false; paused = true
        position = max(position, player.snapshot.duration)
        player.pause(); timer?.cancel(); timer = nil; channel.release(owner: owner)
        if remote && !completedReported { completedReported = true; onRoutePreview?(true) }
    }
    private func fail() {
        let id = activeID
        stop()
        failedID = id
    }
    private func startTimer() {
        timer?.cancel()
        timer = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(200))
                guard !Task.isCancelled, let self else { return }
                self.tick()
            }
        }
    }
    func tick() {
        guard activeID != nil else { return }
        let status = player.snapshot
        if let target = seekTarget {
            if seekTargetReached(currentTime: status.position, target: target) || now().timeIntervalSince(lastProgressAt) > 2 { seekTarget = nil }
        }
        if seekTarget == nil { position = status.position }
        duration = status.duration
        canSeek = status.ready && duration > 0
        playing = status.playing && !paused && !interrupted
        guard !paused && !interrupted && !completed && seekTarget == nil else { return }
        if status.failed { fail(); return }
        if status.playing && position > 0.25 { heard = true }
        if position > lastPosition + 0.01 {
            lastPosition = position; lastProgressAt = now(); resumeTried = false
        }
        if !heard {
            if now().timeIntervalSince(loadedAt) * 1000 >= (remote ? PRE_START_STALL_MS : LOCAL_CLIP_STALL_MS) { fail() }
            return
        }
        switch decideStall(now: now().timeIntervalSince1970 * 1000,
                           lastProgressAt: lastProgressAt.timeIntervalSince1970 * 1000,
                           lastProgressTime: position, duration: duration, resumeTried: resumeTried) {
        case .wait: break
        case .completeAtEnd: finish()
        case .resume: player.play(); resumeTried = true; lastProgressAt = now()
        case .giveUp: fail()
        }
    }
    private func handle(_ event: AudioChannelEvent) {
        switch event {
        case .enteredBackground: stop()
        case .interruptionBegan:
            resumeAfterInterruption = !paused && !completed
            interrupted = true; player.pause(); playing = false
        case .interruptionEnded(let shouldResume):
            interrupted = false
            if shouldResume && resumeAfterInterruption {
                paused = true; toggle()
            } else { pause() }
        case .outputDisconnected: interrupted = false; pause()
        case .mediaServicesReset:
            // Reconstruct invalidated AV objects only on a fresh explicit play.
            fail()
        }
    }
    isolated deinit { timer?.cancel(); player.stop(); channel.release(owner: owner) }
}
