import Foundation
import Observation

@MainActor @Observable
final class AppModel {
    enum Destination: Hashable { case drive(String), settings }
    enum Readiness { case awaitingMigration, ready, unavailable }
    var path: [Destination] = []
    var selectedTab: MainTab = .planner
    var incomingDriveId: String?
    private var deferredDriveId: String?
    var theme: ThemeMode = .system
    var simMode = false
    var activePlayback: DrivePlaybackController?
    var playbackPresented = false
    var playbackError: String?
    var blocksForUpdate: Bool { versionPolicy?.gate == .force }
    var presentsDriving: Bool { !blocksForUpdate && playbackPresented }

    func versionGateDidChange() {
        guard blocksForUpdate else { return }
        stopDrive()
        dependencies?.preview?.stop()
    }
    private var didStart = false
    private var versionCheckTask: AppVersionCheckTask?
    private var reportedStarts: Set<String> = []
    private(set) var readiness: Readiness = .awaitingMigration
    let dependencies: AppDependencies?
    let versionPolicy: VersionPolicyController?

    init(dependencies: AppDependencies?, versionPolicy: VersionPolicyController? = nil) {
        self.dependencies = dependencies
        self.versionPolicy = versionPolicy ?? dependencies.map { VersionPolicyController(api: $0.api, defaults: $0.defaults) }
        if case .uiTest(let scenario, _, _) = dependencies?.launch.mode,
           ["offline-library", "offline-empty", "signed-out", "offline-no-playable-clips", "corrupt-credentials-recovery"].contains(scenario) { selectedTab = .library }
        if let initial = dependencies?.initialTab { selectedTab = initial }
        if let coldURL = dependencies?.coldOpenURL {
            open(coldURL)
        }
    }

    func start() async {
        guard !didStart else { return }
        didStart = true
        guard let dependencies else { readiness = .unavailable; return }
        if dependencies.launch.allowsLiveServices {
            try? PreferenceMigration(keychain: SystemKeychainStore(), defaults: dependencies.defaults).run()
            theme = ThemeMode(rawValue: dependencies.defaults.string(forKey: "skipper.themeMode") ?? "system") ?? .system
        }
        simMode = dependencies.defaults.string(forKey: "skipper.simMode") == "1"
        // Policy may arrive late; a stalled public request must not delay local account/library access.
        versionCheckTask = AppVersionCheckTask(Task { [versionPolicy] in await versionPolicy?.checkOnce() })
        await dependencies.session.start()
        readiness = .ready
    }

    func persistPreferences() {
        guard let defaults = dependencies?.defaults else { return }
        defaults.set(theme.rawValue, forKey: "skipper.themeMode")
        defaults.set(simMode ? "1" : "0", forKey: "skipper.simMode")
    }

    func startDrive(_ id: String) async {
        guard !blocksForUpdate, let dependencies, !playbackPresented, await dependencies.session.canAccessLocalDrive(id) else { return }
        playbackError = nil
        do {
            let saved = try await dependencies.storage.loadPlayback(driveId: id)
            let online = !(await dependencies.network.isOffline())
            // Identity may change while storage IO is in flight. Never expose a previous account's bytes.
            guard await dependencies.session.canAccessLocalDrive(id), !blocksForUpdate else { return }
            let controller = dependencies.makePlayback()
            wireAnalytics(controller, driveId: id)
            try controller.load(saved, online: online)
            activePlayback?.stop()
            activePlayback = controller
            playbackPresented = true
        } catch {
            playbackError = "This drive could not be opened. Check its downloaded audio and try again."
        }
    }

    private func wireAnalytics(_ controller: DrivePlaybackController, driveId: String) {
        guard let analytics = dependencies?.analytics else { return }
        var startedAt: Date?
        controller.onStarted = { [weak self] simulated in
            startedAt = Date()
            let mode = simulated ? "sim" : "live"
            if self?.reportedStarts.insert(driveId + ":" + mode).inserted == true {
                analytics("drive_started", ["mode": mode])
            }
        }
        controller.onStopFired = { [weak controller] event in
            guard let controller else { return }
            analytics("stop_fired", ["stop_index": event.stopIndex,
                "stop_form": event.form.rawValue, "elapsed_sec": event.elapsedSeconds,
                "mode": controller.simulation ? "sim" : "live"])
        }
        controller.onCompleted = { simulated, total, played, skipped in
            analytics("drive_completed", ["mode": simulated ? "sim" : "live",
                "elapsed_sec": max(0, Date().timeIntervalSince(startedAt ?? Date())),
                "stops_total": total, "stops_played": played, "stops_skipped": skipped])
        }
        controller.onSkipped = { [weak controller] index, reason in
            guard let controller, controller.stops.indices.contains(index) else { return }
            let rawForm = controller.stops[index].form
            let form = ["story", "scenic", "break"].contains(rawForm) ? rawForm : "other"
            let label: String
            switch reason {
            case .offRoute: label = "off_route"
            case .missingAudio: label = "no_audio"
            case .failedAudio, .stalledBeforeStart: label = "load_timeout"
            case .stalledMidClip: label = "stalled_mid_clip"
            }
            analytics("stop_skipped", ["mode": controller.simulation ? "sim" : "live",
                "elapsed_sec": max(0, Date().timeIntervalSince(startedAt ?? Date())),
                "stop_index": index, "stop_form": form, "reason": label])
        }
    }

    func stopDrive() {
        activePlayback?.stop(); activePlayback = nil; playbackPresented = false
        guard let id = deferredDriveId else { return }
        deferredDriveId = nil
        if !blocksForUpdate {
            presentDrive(id)
        }
    }

    private func presentDrive(_ id: String) {
        path = [.drive(id)]; incomingDriveId = id; selectedTab = .library
    }

    /// A received deep link selects a destination; it never starts a drive, spends a credit, or mints auth.
    func open(_ url: URL) {
        guard url.scheme?.lowercased() == "skipper" else { return }
        let parts = ([url.host].compactMap { $0 } + url.pathComponents.filter { $0 != "/" })
        if parts.count == 2, parts[0] == "drives", UUID(uuidString: parts[1]) != nil {
            let id = parts[1].lowercased()
            if activePlayback != nil || playbackPresented {
                deferredDriveId = id
            } else {
                presentDrive(id)
            }
        } else if parts == ["settings"] { path = [.settings]; selectedTab = .settings }
    }
}

/// The task captures the controller, not the App model. Releasing its owner cancels an
/// outstanding policy request without accessing MainActor state from deinit.
private final class AppVersionCheckTask {
    let task: Task<Void, Never>
    init(_ task: Task<Void, Never>) { self.task = task }
    deinit { task.cancel() }
}
