import Foundation
import Observation

enum DrivePlaybackPhase: Equatable { case empty, ready, locationPrime, locationDenied, locationReduced, driving, done, failed }
enum DriveSkipReason: String { case offRoute, missingAudio, failedAudio, stalledBeforeStart, stalledMidClip }

struct DriveHeardStop: Equatable, Sendable {
    enum Form: String, Sendable { case story, scenic, `break`, other }
    let seq: Int
    let stopIndex: Int
    let form: Form
    let durationMs: Int?
    let elapsedSeconds: Double
}

@MainActor @Observable
final class DrivePlaybackController {
    private(set) var phase: DrivePlaybackPhase = .empty
    private(set) var detail: StorageSavedDriveDetail?
    private(set) var paused = false
    private(set) var interrupted = false
    private(set) var activeSeq: Int?
    private(set) var firedSeqs: Set<Int> = []
    /// Matches the installed itinerary: completed and silently passed stops both get a check.
    private(set) var playedSeqs: Set<Int> = []
    private(set) var skippedSeqs: Set<Int> = []
    private(set) var lastCompletedSeq: Int?
    private(set) var position: Double = 0
    private(set) var duration: Double = 0
    private(set) var canSeek = false
    private(set) var playing = false
    private(set) var buffering = false
    private(set) var progress: Double = 0
    private(set) var fix: GpsFix?
    private(set) var gpsSearching = false
    private(set) var missingClipCount = 0
    private(set) var needsDownload = false
    private(set) var error: String?
    private(set) var stallNote: String?
    private(set) var simulation = false
    var fastSimulation = false
    private(set) var traceURL: URL?

    @ObservationIgnored private let player: any NarrationPlaying
    @ObservationIgnored private let music: any DriveMusicPlaying
    @ObservationIgnored private let location: any DriveLocationSourcing
    @ObservationIgnored private let awake: any ScreenAwakeControlling
    @ObservationIgnored private let channel: AudioChannel
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private let session: () -> SessionSnapshot?
    @ObservationIgnored private let controls: NowPlayingControls?
    @ObservationIgnored private let traceDirectory: URL?
    @ObservationIgnored private let traceLibrary: DriveTraceLibrary
    @ObservationIgnored private let owner = UUID()
    @ObservationIgnored private var urls: [Int: URL] = [:]
    @ObservationIgnored private var route: [LngLat] = []
    @ObservationIgnored private var totalMeters: Double = 0
    @ObservationIgnored private var engine: TriggerEngine?
    @ObservationIgnored private var mapper: FixMapper?
    @ObservationIgnored private var queue: [Int] = []
    @ObservationIgnored private var reachedEnd = false
    @ObservationIgnored private var replaying = false
    @ObservationIgnored private var pendingMusicLeg = false
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var permissionRequested = false
    @ObservationIgnored private var timer: Task<Void, Never>?
    @ObservationIgnored private var loadedAt = Date.distantPast
    @ObservationIgnored private var lastProgressAt = Date.distantPast
    @ObservationIgnored private var lastFixAt = Date.distantPast
    @ObservationIgnored private var lastPosition: Double = 0
    @ObservationIgnored private var heard = false
    @ObservationIgnored private var heardSeqs: Set<Int> = []
    @ObservationIgnored private var startedAt: Date?
    @ObservationIgnored private var resumeTried = false
    @ObservationIgnored private var resumeAfterInterruption = false
    @ObservationIgnored private var riderPaused = false
    @ObservationIgnored private var appForeground = true
    @ObservationIgnored private var scrubbing = false
    @ObservationIgnored private var finishedWhileScrubbing = false
    @ObservationIgnored private var seekTarget: Double?
    @ObservationIgnored private var simFixes: [GpsFix] = []
    @ObservationIgnored private var traceFixes: [RawFix] = []
    @ObservationIgnored private var simIndex = 0
    @ObservationIgnored private var simTime: Double = 0
    @ObservationIgnored private var lastTick = Date.distantPast
    @ObservationIgnored private var recorder: TraceRecorder?
    @ObservationIgnored private var traceMeta: TraceMeta?
    @ObservationIgnored private var lastTraceSave = Date.distantPast
    /// Only bounded enums/counts can cross the analytics seam. Never coordinates or names.
    @ObservationIgnored var onStarted: ((Bool) -> Void)?
    @ObservationIgnored var onCompleted: ((Bool, Int, Int, Int) -> Void)?
    @ObservationIgnored var onSkipped: ((Int, DriveSkipReason) -> Void)?
    /// Emitted only after real playback progress, never merely because GPS reached a stop.
    /// Seq and clip duration are internal metadata; AnalyticsContract permits index/form/elapsed.
    @ObservationIgnored var onStopFired: ((DriveHeardStop) -> Void)?

    init(player: (any NarrationPlaying)? = nil, music: (any DriveMusicPlaying)? = nil,
         location: (any DriveLocationSourcing)? = nil, awake: (any ScreenAwakeControlling)? = nil,
         channel: AudioChannel? = nil, systemControls: Bool = true,
         now: @escaping () -> Date = Date.init, session: @escaping () -> SessionSnapshot? = { nil },
         traceDirectory: URL? = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first?.appendingPathComponent("traces")) {
        self.player = player ?? NativeNarrationPlayer(); self.music = music ?? NativeDriveMusic()
        self.location = location ?? DriveLocationSource(); self.awake = awake ?? DriveScreenAwake()
        self.channel = channel ?? .shared; self.now = now; self.session = session
        self.traceDirectory = traceDirectory
        traceLibrary = DriveTraceLibrary(directory: traceDirectory, session: session, now: now)
        controls = systemControls ? NowPlayingControls() : nil
        self.location.onRawFix = { [weak self] in self?.receiveRawFix($0) }
        self.location.onPermission = { [weak self] in self?.permissionChanged($0) }
        self.location.onError = { [weak self] in self?.gpsSearching = true }
        self.location.onForeground = { [weak self] in
            guard let self, self.phase == .driving else { return }
            self.appForeground = true
            self.lastFixAt = self.now(); self.gpsSearching = true
            if !self.riderPaused {
                if !self.simulation { self.location.resume() }
                self.awake.setAwake(true)
            }
            self.updateNowPlaying(force: true)
        }
    }

    var stops: [StorageSavedDriveClip] { detail?.clips.filter { $0.lat != nil && $0.lng != nil } ?? [] }
    var nextSeq: Int? { stops.first { !firedSeqs.contains($0.seq) }?.seq }
    var activeStop: StorageSavedDriveClip? { stops.first { $0.seq == activeSeq } }
    var coordinates: [Coordinate] { route.map { Coordinate(longitude: $0.longitude, latitude: $0.latitude) } }
    var canAdmin: Bool { guard let value = session() else { return false }; return value.user.isAdmin && value.isFresh(at: now()) }
    var canReplay: Bool { lastCompletedSeq.map(isReplayable) ?? false }

    func load(_ playback: StoragePlayback, online: Bool) throws {
        stop()
        detail = nil; urls = [:]; route = []; totalMeters = 0; phase = .empty
        missingClipCount = 0; needsDownload = false
        let points = playback.detail.polyline
        guard points.count >= 2, points.allSatisfy({ $0.count == 2 && $0[0].isFinite && $0[1].isFinite && (-180...180).contains($0[0]) && (-90...90).contains($0[1]) }) else { throw PlaybackFailure.invalidRoute }
        // Only this drive's saved expected seqs are authoritative, including partial copies.
        let expected = Set(playback.expectedSeqs)
        let local = playback.urls.filter { expected.contains($0.key) && $0.value.isFileURL }
        guard !local.isEmpty else { throw PlaybackFailure.noPlayableAudio }
        detail = playback.detail; urls = local
        route = points.map { LngLat(longitude: $0[0], latitude: $0[1]) }
        totalMeters = cumulativeMeters(route).last ?? 0
        missingClipCount = expected.subtracting(local.keys).count
        needsDownload = StorageUtils.decideDriveGate(online: online, hasAnyLocal: !local.isEmpty, missingCount: missingClipCount) != .play
        error = nil; resetRun(); phase = .ready
    }

    func start(simulate: Bool = false) {
        guard phase != .driving, detail != nil else { return }
        guard !needsDownload else { error = "Finish saving this drive before setting off."; return }
        guard let value = session(), value.user.isAccount, value.isFresh(at: now()) else {
            error = "Sign in to start your saved drive."; return
        }
        if simulate {
            guard canAdmin else { error = "Simulation is available to administrators."; return }
            simulation = true; begin(); return
        }
        simulation = false
        switch location.permission {
        case .undetermined: phase = .locationPrime
        case .denied: phase = .locationDenied
        case .reduced: phase = .locationReduced
        case .precise: begin()
        }
    }
    func confirmLocationPermission() {
        guard phase == .locationPrime, !permissionRequested else { return }
        permissionRequested = true
        location.requestPermission()
    }
    private func permissionChanged(_ permission: DriveLocationPermission) {
        if permission != .undetermined { permissionRequested = false }
        if phase == .driving && !simulation && permission != .precise {
            pause(); error = "Precise Location is needed to follow this drive. Check Skipper in Settings."
        }
        guard [.locationPrime, .locationDenied, .locationReduced].contains(phase) else { return }
        switch permission {
        case .precise: start()
        case .denied: phase = .locationDenied
        case .reduced: phase = .locationReduced
        case .undetermined: phase = .locationPrime
        }
    }

    private func begin() {
        appForeground = true
        resetRun()
        let snapped = snapStopsToRoute(polyline: route, stops: stops.compactMap { clip in
            guard let lat = clip.lat, let lng = clip.lng else { return nil }
            return DriveStopRef(seq: clip.seq, lat: lat, lng: lng, triggerRadiusM: Double(clip.triggerRadiusM ?? 120), durationMs: clip.durationMs.map(Double.init))
        })
        for stop in snapped where stop.offRouteM > OFF_ROUTE_MAX_M { skip(stop.seq, reason: .offRoute) }
        engine = TriggerEngine(stops: snapped.filter { $0.offRouteM <= OFF_ROUTE_MAX_M }.map {
            DriveStopRef(seq: $0.seq, lat: $0.lat, lng: $0.lng, triggerRadiusM: $0.triggerRadiusM, durationMs: $0.durationMs)
        })
        mapper = FixMapper(polyline: route, opts: FixMapperOptions(onFix: { [weak self] fix in
            MainActor.assumeIsolated { self?.receiveFix(fix) }
        }, onEnd: { [weak self] in MainActor.assumeIsolated { self?.routeEnded() } }))
        do {
            try channel.acquire(owner: owner, revoke: { [weak self] in self?.stop() }, event: { [weak self] in self?.handle($0) })
        } catch { phase = .failed; self.error = "The audio system couldn't start. Try again."; return }
        startedAt = now()
        phase = .driving; error = nil; awake.setAwake(true)
        lastFixAt = now(); lastTick = now(); gpsSearching = !simulation
        controls?.install(play: { [weak self] in self?.resume() }, pause: { [weak self] in self?.pause() },
                          toggle: { [weak self] in self?.togglePause() }, seek: { [weak self] in self?.seek(to: $0) },
                          skip: { [weak self] in self?.seekBy($0) }, stop: { [weak self] in self?.stop() })
        if simulation {
            simFixes = generateDrive(polyline: route, opts: DriveOptions(mph: 60, tickHz: 4))
        } else {
            if canAdmin, let id = detail?.driveId {
                recorder = TraceRecorder()
                traceMeta = TraceMeta(driveId: id, label: detail?.label, recordedAt: ISO8601DateFormatter().string(from: now()), appVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String, polyline: route)
            }
            location.start()
        }
        music.setAudible(true, newLeg: false)
        onStarted?(simulation)
        timer = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(200))
                guard !Task.isCancelled, let self else { return }
                self.tick()
            }
        }
    }

    func receiveRawFix(_ raw: RawFix) {
        guard phase == .driving, !riderPaused, appForeground, !simulation else { return }
        if canAdmin { recorder?.record(raw: raw) } else { recorder = nil; traceMeta = nil }
        _ = mapper?.accept(raw)
    }
    func receiveFix(_ fix: GpsFix) {
        guard phase == .driving, !riderPaused, appForeground else { return }
        self.fix = fix; lastFixAt = now(); gpsSearching = false
        progress = totalMeters > 0 ? min(1, max(0, fix.alongM / totalMeters)) : 0
        let events = engine?.update(fix: fix) ?? []
        guard !events.isEmpty else { return }
        if replaying { unloadClip(); replaying = false }
        for event in events { firedSeqs.insert(event.seq); queue.append(event.seq) }
        pump()
    }
    func routeEnded() { guard phase == .driving else { return }; reachedEnd = true; pump() }

    private func pump() {
        guard phase == .driving, !paused, !interrupted else { return }
        // Iterative drain makes a damaged partial download cost a stop, never recursion depth.
        while activeSeq == nil {
            switch decidePump(clipBusy: false, queue: queue, reachedEnd: reachedEnd) {
            case .play(let seq):
                queue.removeFirst()
                guard let url = urls[seq], url.isFileURL else { skip(seq, reason: .missingAudio); playedSeqs.insert(seq); continue }
                loadClip(seq, url: url)
            case .finish: finish(); return
            case .idle: music.setAudible(true, newLeg: pendingMusicLeg); pendingMusicLeg = false; return
            case .wait: return
            }
        }
    }
    private func loadClip(_ seq: Int, url: URL) {
        activeSeq = seq; position = 0; duration = 0; heard = false; lastPosition = 0
        seekTarget = nil; loadedAt = now(); lastProgressAt = now(); resumeTried = false
        scrubbing = false; finishedWhileScrubbing = false; buffering = true
        let current = UUID(); generation = current
        player.onFinish = { [weak self] in
            guard let self, self.generation == current, self.activeSeq == seq else { return }
            if self.scrubbing || self.seekTarget != nil { self.finishedWhileScrubbing = true; return }
            self.clipFinished()
        }
        music.setAudible(false, newLeg: false)
        do { try player.load(url: url); player.play() }
        catch { skip(seq, reason: .failedAudio); playedSeqs.insert(seq); unloadClip() }
    }
    private func unloadClip() {
        generation = UUID(); player.onFinish = nil; player.stop(); activeSeq = nil
        playing = false; buffering = false; canSeek = false; position = 0; duration = 0; seekTarget = nil
    }
    private func clipFinished(reason: DriveSkipReason? = nil) {
        guard let seq = activeSeq else { return }
        if let reason { skip(seq, reason: reason); stallNote = "That recording hit a bump. I'll catch you at the next stop." }
        if heard { lastCompletedSeq = seq }
        playedSeqs.insert(seq); unloadClip(); replaying = false
        pendingMusicLeg = true
        pump()
    }
    private func skip(_ seq: Int, reason: DriveSkipReason) {
        if skippedSeqs.insert(seq).inserted { onSkipped?(stops.firstIndex { $0.seq == seq } ?? -1, reason) }
    }

    func isReplayable(_ seq: Int) -> Bool {
        phase == .driving && !paused && !interrupted && activeSeq == nil && queue.isEmpty && firedSeqs.contains(seq) && urls[seq]?.isFileURL == true
    }
    func replayStop(_ seq: Int) { guard isReplayable(seq) else { return }; replaying = true; queue.append(seq); pump() }
    func replayLast() { if let lastCompletedSeq { replayStop(lastCompletedSeq) } }
    func togglePause() { if paused { resume() } else { pause() } }
    func pause() {
        guard phase == .driving else { return }
        riderPaused = true
        holdAudio()
        location.pause(); awake.setAwake(false)
        updateNowPlaying()
    }
    func resume() {
        guard phase == .driving, !interrupted else { return }
        if !simulation && location.permission != .precise {
            error = "Turn on Precise Location for Skipper in Settings, then resume."; return
        }
        do { try channel.reactivate(owner: owner) }
        catch { holdAudio(); self.error = "The audio system couldn't resume. Try again."; updateNowPlaying(); return }
        paused = false; riderPaused = false; error = nil; lastProgressAt = now(); loadedAt = now(); lastTick = now(); resumeTried = false
        if activeSeq != nil { player.play() }
        else { music.setAudible(true, newLeg: false) }
        if !simulation && appForeground { lastFixAt = now(); gpsSearching = true; location.resume() }
        awake.setAwake(appForeground); pump(); updateNowPlaying()
    }
    func seek(to seconds: Double) {
        guard canSeek, seconds.isFinite else { return }
        let target = min(duration, max(0, seconds))
        seekTarget = target; position = target; player.seek(to: target)
        if !paused && !interrupted { player.play() }
        lastProgressAt = now(); loadedAt = now(); resumeTried = false
        if target < duration - CLIP_END_GRACE_SEC { finishedWhileScrubbing = false }
        updateNowPlaying(force: true)
    }
    func seekBy(_ seconds: Double) { seek(to: (seekTarget ?? position) + seconds) }
    func setScrubbing(_ value: Bool) {
        scrubbing = value
        if !value && finishedWhileScrubbing && seekTarget == nil { finishedWhileScrubbing = false; clipFinished() }
    }

    func tick() {
        guard phase == .driving else { return }
        let currentTime = now()
        let elapsed = min(1, max(0, currentTime.timeIntervalSince(lastTick))); lastTick = currentTime
        if simulation && !canAdmin { stop(); error = "Administrator session ended."; return }
        if !riderPaused && appForeground {
            if simulation {
                simTime += elapsed * (fastSimulation && activeSeq == nil ? 8 : 1)
                if !traceFixes.isEmpty {
                    let start = traceFixes[0].timestamp
                    while simIndex < traceFixes.count && (traceFixes[simIndex].timestamp - start) / 1000 <= simTime {
                        _ = mapper?.accept(traceFixes[simIndex]); simIndex += 1
                    }
                    if simIndex >= traceFixes.count { routeEnded() }
                } else {
                    while simIndex < simFixes.count && simFixes[simIndex].tSec <= simTime {
                        receiveFix(simFixes[simIndex]); simIndex += 1
                    }
                    if simIndex >= simFixes.count { routeEnded() }
                }
            } else { gpsSearching = currentTime.timeIntervalSince(lastFixAt) >= 8 }
        }
        if currentTime.timeIntervalSince(lastTraceSave) >= 10 { saveTrace(); lastTraceSave = currentTime }
        guard activeSeq != nil else { updateNowPlaying(); return }
        let status = player.snapshot
        duration = status.duration; canSeek = status.ready && duration > 0
        playing = status.playing && !paused && !interrupted
        buffering = !paused && !interrupted && (!status.ready || (!heard && !status.playing))
        if let target = seekTarget {
            if seekTargetReached(currentTime: status.position, target: target) { seekTarget = nil; lastPosition = status.position }
            else if currentTime.timeIntervalSince(lastProgressAt) > 2 { seekTarget = nil }
        }
        if seekTarget == nil { position = status.position }
        updateNowPlaying()
        guard !paused && !interrupted && !scrubbing && seekTarget == nil else { return }
        if status.failed { clipFinished(reason: .failedAudio); return }
        if finishedWhileScrubbing {
            finishedWhileScrubbing = false
            if status.duration > 0 && status.position >= status.duration - CLIP_END_GRACE_SEC { clipFinished(); return }
        }
        if !heard && status.playing && status.position > 0.25 {
            heard = true
            // Replay has its own fresh player clock but must not count as a new stop heard,
            // including a replay of a stop whose original load never produced audio.
            if !replaying, let seq = activeSeq, heardSeqs.insert(seq).inserted,
               let index = stops.firstIndex(where: { $0.seq == seq }), let startedAt {
                let stop = stops[index]
                onStopFired?(DriveHeardStop(seq: seq, stopIndex: index,
                                          form: DriveHeardStop.Form(rawValue: stop.form) ?? .other,
                                          durationMs: stop.durationMs,
                                          elapsedSeconds: max(0, currentTime.timeIntervalSince(startedAt))))
            }
        }
        if status.position > lastPosition + 0.01 {
            lastPosition = status.position; lastProgressAt = currentTime; resumeTried = false
        }
        if !heard {
            if currentTime.timeIntervalSince(loadedAt) * 1000 >= LOCAL_CLIP_STALL_MS { clipFinished(reason: .stalledBeforeStart) }
            return
        }
        switch decideStall(now: currentTime.timeIntervalSince1970 * 1000,
                           lastProgressAt: lastProgressAt.timeIntervalSince1970 * 1000,
                           lastProgressTime: status.position, duration: status.duration, resumeTried: resumeTried) {
        case .wait: break
        case .completeAtEnd: clipFinished()
        case .resume: player.play(); resumeTried = true; lastProgressAt = currentTime
        case .giveUp: clipFinished(reason: .stalledMidClip)
        }
    }

    /// A system audio hold is distinct from the rider pulling over: the foreground road
    /// continues, and every passed stop stays queued until an output can safely resume.
    private func holdAudio() {
        paused = true; resumeAfterInterruption = false; player.pause(); playing = false; buffering = false
        music.setAudible(false, newLeg: false)
    }
    private func handle(_ event: AudioChannelEvent) {
        guard phase == .driving else { return }
        switch event {
        case .enteredBackground:
            appForeground = false
            location.pause(); awake.setAwake(false) // Audio continues; GPS never runs in the background.
        case .interruptionBegan:
            resumeAfterInterruption = !paused; interrupted = true
            player.pause(); music.setAudible(false, newLeg: false); playing = false; buffering = false
        case .interruptionEnded(let shouldResume):
            interrupted = false
            if shouldResume && resumeAfterInterruption { resume() } else { holdAudio() }
            resumeAfterInterruption = false
        case .outputDisconnected:
            interrupted = false; holdAudio()
        case .mediaServicesReset:
            // Apple's reset invalidates players. Recreate the current item at its saved clock,
            // but wait for the rider before audio can move to an unexpected output.
            let seq = activeSeq; let savedPosition = position
            music.stop(); player.stop(); interrupted = false; holdAudio()
            if let seq, let url = urls[seq] { try? player.load(url: url); player.seek(to: savedPosition) }
            error = "The audio connection changed. Resume when you're ready."
        }
        updateNowPlaying()
    }
    private func updateNowPlaying(force: Bool = false) {
        guard phase == .driving else { return }
        controls?.update(title: activeStop?.name ?? "On the road", album: detail?.label ?? "Skipper",
                         position: position, duration: duration, playing: !paused && !interrupted && (activeSeq == nil || playing), canSeek: canSeek, force: force)
    }
    private func resetRun() {
        firedSeqs = []; playedSeqs = []; skippedSeqs = []; lastCompletedSeq = nil; queue = []
        heardSeqs = []; startedAt = nil
        reachedEnd = false; replaying = false; pendingMusicLeg = false; paused = false; riderPaused = false; interrupted = false; progress = 0; fix = nil
        stallNote = nil; traceURL = nil; simIndex = 0; simTime = 0; simFixes = []; traceFixes = []
    }
    private func finish() {
        let played = playedSeqs.subtracting(skippedSeqs).count
        onCompleted?(simulation, stops.count, played, skippedSeqs.count)
        teardown(); phase = .done; progress = 1
    }
    func stop() { teardown(); phase = detail == nil ? .empty : .ready }
    private func teardown() {
        timer?.cancel(); timer = nil; permissionRequested = false; location.stop(); awake.setAwake(false)
        recorder?.stop(); saveTrace(); TraceFileWriter.shared.flush(); recorder = nil; traceMeta = nil
        unloadClip(); music.stop(); controls?.clear(); channel.release(owner: owner)
        engine = nil; mapper = nil; queue = []; simFixes = []; traceFixes = []; paused = false; interrupted = false; gpsSearching = false
    }
    private func saveTrace() {
        guard canAdmin, let recorder, recorder.count > 0, let traceMeta, let traceDirectory else { return }
        traceURL = TraceFileWriter.shared.save(recorder.envelope(meta: traceMeta), directory: traceDirectory)
    }

    func storedTraces() throws -> [DriveStoredTrace] { try traceLibrary.list() }
    func exportTrace(named name: String) throws -> URL { try traceLibrary.export(name) }
    func deleteTrace(named name: String) throws { try traceLibrary.delete(name) }
    func replayTrace(named name: String) throws {
        guard canAdmin else { throw PlaybackFailure.adminRequired }
        guard phase != .driving, !needsDownload, detail != nil else { throw PlaybackFailure.invalidTrace }
        let trace = try traceLibrary.read(name)
        guard trace.driveId == detail?.driveId, traceMatchesRoute(env: trace, polyline: route).ok else { throw PlaybackFailure.invalidTrace }
        simulation = true; begin()
        guard phase == .driving else { return }
        simFixes = []; traceFixes = trace.fixes; simIndex = 0; simTime = 0
    }
    func exportTrace() -> URL? {
        guard canAdmin else { return nil }
        saveTrace(); TraceFileWriter.shared.flush()
        guard let traceURL else { return nil }
        return try? traceLibrary.export(traceURL.lastPathComponent)
    }
    isolated deinit {
        timer?.cancel(); location.stop(); awake.setAwake(false); TraceFileWriter.shared.flush()
        player.stop(); music.stop(); controls?.clear(); channel.release(owner: owner)
    }
}
