import Foundation
import Observation

enum DriveDetailTab: String, CaseIterable, Sendable {
    case list = "List"
    case map = "Map"
}

@MainActor @Observable
final class DriveDetailViewModel {
    let driveId: String
    private(set) var manifest: DriveManifest?
    private(set) var selectedTab: DriveDetailTab = .list
    private(set) var gate: StorageDriveGate = .nothingSaved
    private(set) var isDownloading = false
    private(set) var isRepairing = false
    private(set) var downloadDone = 0
    private(set) var downloadTotal = 0
    private(set) var auditionStopSeq: Int?
    private(set) var isLoading = false
    private(set) var errorMessage: String?
    private(set) var downloadError: String?
    private(set) var localAudioURLs: [Int: URL] = [:]
    private(set) var isOffline = false
    private(set) var missingCount = 0
    private(set) var expectedCount = 0
    private(set) var isExpired = false
    private(set) var isUpdatable = false
    private(set) var directoryState: StorageDownloadDirState = .none
    private(set) var needsAccount = false

    @ObservationIgnored private var downloadSubToken: UUID?
    @ObservationIgnored private(set) var topUpTask: Task<Void, Never>?
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var previewGeneration = UUID()
    @ObservationIgnored private var wallSources: Set<String> = []
    @ObservationIgnored private var downloadRequested = false
    @ObservationIgnored private var downloadGeneration = UUID()
    @ObservationIgnored private var freshDetail: StorageSavedDriveDetail?

    let api: any SkipperAPI
    let storage: StorageService?
    let session: SessionStore?
    let audio: (any AudioPreviewControlling)?
    let analytics: AnalyticsTracker?
    let network: any NetworkAvailability

    init(driveId: String, api: any SkipperAPI, storage: StorageService? = nil,
         session: SessionStore? = nil, audio: (any AudioPreviewControlling)? = nil,
         analytics: AnalyticsTracker? = nil, network: any NetworkAvailability = UnknownNetworkAvailability()) {
        self.driveId = driveId; self.api = api; self.storage = storage
        self.session = session; self.audio = audio; self.analytics = analytics; self.network = network
    }

    deinit {
        topUpTask?.cancel()
        if let storage, let downloadSubToken {
            let id = driveId
            Task { await storage.unsubscribeDownload(driveId: id, token: downloadSubToken) }
        }
    }

    var previewPlaying: Bool { ownsPreview && audio?.isPlaying == true }
    var previewPosition: Double { ownsPreview ? max(0, audio?.currentTimeSec ?? 0) : 0 }
    var previewDuration: Double { ownsPreview ? max(0, audio?.durationSec ?? 0) : 0 }
    var canSeekPreview: Bool { ownsPreview && previewDuration.isFinite && previewDuration > 0 }
    var hasLocalAudio: Bool { !localAudioURLs.isEmpty }
    private var ownsPreview: Bool {
        guard let auditionStopSeq else { return false }
        return audio?.currentItemKey == previewKey(auditionStopSeq)
    }

    func selectTab(_ tab: DriveDetailTab) { selectedTab = tab }
    func isStopAuditionable(seq: Int) -> Bool { localAudioURLs[seq]?.isFileURL == true }

    func load() async {
        guard !isLoading else { return }
        let current = generation, account = session?.user?.id
        isLoading = true
        defer { if current == generation { isLoading = false } }
        errorMessage = nil; needsAccount = false; freshDetail = nil; isUpdatable = false
        topUpTask?.cancel()
        do {
            let loaded = try await api.drive(id: driveId)
            guard current == generation, !Task.isCancelled, account == session?.user?.id else { return }
            manifest = loaded
            freshDetail = try StorageSavedDriveDetail.from(jsonData: JSONEncoder().encode(loaded))
        } catch {
            guard current == generation, !Task.isCancelled, account == session?.user?.id else { return }
            if let error = error as? APIError, error.needsAccount {
                showWall(source: "drive_detail"); manifest = nil; return
            }
            if let error = error as? APIError, error.status == 403 || error.status == 404 {
                manifest = nil; clearLocalAccess()
                errorMessage = "This drive is no longer available."
                return
            }
            if await canAccessLocal(), let storage, let saved = await storage.loadManifest(driveId: driveId),
               let reconstructed = try? JSONDecoder().decode(DriveManifest.self, from: saved.detail.toData()),
               await canAccessLocal(), current == generation, account == session?.user?.id {
                manifest = reconstructed
            } else {
                manifest = nil; clearLocalAccess()
                errorMessage = "Could not load drive details."
            }
        }
        await refreshOfflineState()
        guard current == generation, !Task.isCancelled else { return }
        await subscribeToDownload()
        // Storage alone decides whether a saved drive qualifies. An unsaved detail never starts
        // a surprise download; failed top-ups keep the prior playable references intact.
        if !isOffline, let freshDetail, let storage, await canAccessLocal() {
            topUpTask = Task { [weak self, driveId] in
                _ = try? await storage.topUpDrive(driveId: driveId, fresh: freshDetail)
                guard !Task.isCancelled, let self, self.generation == current else { return }
                await self.refreshOfflineState()
            }
        }
    }

    /// HTTP failure is independent of connectivity: a 500 must not unlock partial online play.
    func refreshOfflineState() async {
        let current = generation, account = session?.user?.id
        let offline = await network.isOffline()
        guard await canAccessLocal() else { clearLocalAccess(); return }
        guard current == generation, account == session?.user?.id else { return }
        let playback = try? await storage?.loadPlayback(driveId: driveId)
        let snapshot = await storage?.offlineSnapshot(driveId: driveId)
        let active = await storage?.activeDownload(driveId: driveId)
        let updatable: Bool
        if let freshDetail, let storage, !offline {
            updatable = await storage.isDownloadStale(driveId: driveId, fresh: freshDetail)
        } else { updatable = false }
        guard await canAccessLocal() else { clearLocalAccess(); return }
        guard current == generation, account == session?.user?.id else { return }
        isOffline = offline
        localAudioURLs = (playback?.urls ?? [:]).filter { $0.value.isFileURL }
        let expected: [Int]
        if let playback { expected = playback.expectedSeqs }
        else if let manifest, let detail = try? StorageSavedDriveDetail.from(jsonData: JSONEncoder().encode(manifest)) {
            expected = StorageUtils.expectedAudioSeqs(detail.clips)
        } else { expected = [] }
        expectedCount = expected.count
        missingCount = expected.filter { localAudioURLs[$0] == nil }.count
        gate = StorageUtils.decideDriveGate(online: !offline, hasAnyLocal: hasLocalAudio, missingCount: missingCount)
        directoryState = snapshot?.dirState ?? .none
        isExpired = snapshot?.isExpired ?? false
        // A top-up may publish fresh metadata while retaining an older clip as fallback. Keep
        // the reopen's update notice until an explicit refresh/repair, like the shipped detail.
        isUpdatable = (updatable || isUpdatable) && hasLocalAudio && !offline
        isDownloading = downloadRequested || (active != nil && active?.isCanceled == false)
        if let active { downloadDone = active.progress.done; downloadTotal = active.progress.total }
    }

    /// Observe external downloads and path changes only while visible. The small network seam
    /// deliberately exposes a query, so foreground refresh and Start use the same current verdict.
    func observeWhileVisible() async {
        while !Task.isCancelled {
            do { try await Task.sleep(for: .milliseconds(500)) } catch { break }
            let offline = await network.isOffline()
            let active = await storage?.activeDownload(driveId: driveId)
            let running = active != nil && active?.isCanceled == false
            let authorized = await canAccessLocal()
            if offline != isOffline || running != isDownloading || !authorized {
                await refreshOfflineState()
            }
        }
        await unsubscribeDownload()
    }

    func prepareToStart() async -> DriveManifest? {
        guard await canAccessLocal() else { showWall(source: "drive_play"); return nil }
        topUpTask?.cancel()
        await topUpTask?.value
        await refreshOfflineState()
        guard await canAccessLocal() else { showWall(source: "drive_play"); return nil }
        guard gate == .play else { return nil }
        stopAudition(); topUpTask?.cancel()
        return manifest
    }

    func startDownload() async {
        guard !downloadRequested, !isRepairing, let storage else { return }
        // Claim before the first await so simultaneous taps cannot launch competing URL fetches.
        downloadRequested = true; isDownloading = true; downloadError = nil
        let operation = UUID(); downloadGeneration = operation
        let account = session?.user?.id
        defer {
            if downloadGeneration == operation { downloadRequested = false; isDownloading = false }
        }
        guard await canAccessLocal() else { showWall(source: "drive_detail"); return }
        guard !(await network.isOffline()) else { downloadError = "Connect to download the remaining audio."; return }
        guard downloadGeneration == operation, account == session?.user?.id else { return }
        await subscribeToDownload()
        topUpTask?.cancel()
        do {
            // Saved manifests strip signed URLs. A retry/refresh fetches a fresh owner-scoped
            // manifest, then rechecks ownership before handing it to Storage.
            let fresh = try await api.drive(id: driveId)
            guard downloadGeneration == operation, account == session?.user?.id else { return }
            guard await canAccessLocal() else { showWall(source: "drive_detail"); return }
            guard downloadGeneration == operation, account == session?.user?.id else { return }
            let detail = try StorageSavedDriveDetail.from(jsonData: JSONEncoder().encode(fresh))
            manifest = fresh; freshDetail = detail
            let result = try await storage.downloadDrive(driveId: driveId, detail: detail)
            guard downloadGeneration == operation else { return }
            if !result.failedSeqs.isEmpty { downloadError = "Some audio could not be saved. Try downloading again." }
            else { isUpdatable = false }
        } catch {
            guard downloadGeneration == operation else { return }
            if let error = error as? APIError, error.needsAccount { showWall(source: "drive_detail") }
            else if error is CancellationError {} // An explicit Cancel is not a failed download.
            else if case StorageError.downloadCanceled = error {}
            else { downloadError = "Audio could not be saved. Please try again." }
        }
        downloadRequested = false
        await refreshOfflineState()
    }

    func repairDownload() async {
        guard !isRepairing, !isDownloading, let storage else { return }
        isRepairing = true; downloadError = nil
        defer { isRepairing = false }
        let account = session?.user?.id, current = generation
        guard await canAccessLocal() else { showWall(source: "drive_detail"); return }
        guard !(await network.isOffline()) else { downloadError = "Connect to repair this download."; return }
        topUpTask?.cancel()
        await topUpTask?.value
        do {
            let fresh = try await api.drive(id: driveId)
            guard await canAccessLocal() else { showWall(source: "drive_detail"); return }
            guard current == generation, account == session?.user?.id else { return }
            let detail = try StorageSavedDriveDetail.from(jsonData: JSONEncoder().encode(fresh))
            let status = try await storage.repairDownload(driveId: driveId, fresh: detail)
            manifest = fresh; freshDetail = detail
            if status == nil { downloadError = "No saved audio could be recovered. Download the drive again." }
            else { isUpdatable = false }
        } catch {
            if let error = error as? APIError, error.needsAccount { showWall(source: "drive_detail") }
            else { downloadError = "The download could not be repaired. Please try again." }
        }
        await refreshOfflineState()
    }

    func cancelDownload() async {
        downloadGeneration = UUID()
        topUpTask?.cancel()
        await storage?.cancelDownload(driveId: driveId)
        downloadRequested = false
        await refreshOfflineState()
    }

    func purgeDownload() async {
        downloadGeneration = UUID(); downloadRequested = false
        stopAudition(); topUpTask?.cancel()
        await storage?.deleteDriveDownload(driveId: driveId)
        await refreshOfflineState()
    }

    func auditionStop(seq: Int) async {
        let token = UUID(); previewGeneration = token
        guard await canAccessLocal() else { clearLocalAccess(); return }
        await refreshOfflineState()
        guard token == previewGeneration, let audio, let url = localAudioURLs[seq], url.isFileURL,
              await canAccessLocal(), token == previewGeneration else { return }
        if auditionStopSeq == seq && ownsPreview {
            if audio.isPlaying { audio.pause() } else { audio.resume() }
            return
        }
        do {
            auditionStopSeq = seq
            try await audio.play(url: url, itemKey: previewKey(seq))
        } catch { if token == previewGeneration { auditionStopSeq = nil } }
    }

    func seekPreview(to seconds: Double) {
        guard canSeekPreview, seconds.isFinite else { return }
        audio?.seek(to: min(previewDuration, max(0, seconds)))
    }
    func seekPreview(by seconds: Double) { seekPreview(to: previewPosition + seconds) }
    func stopAudition() {
        previewGeneration = UUID()
        if ownsPreview { audio?.stop() }
        auditionStopSeq = nil
    }
    func endPresentation() {
        generation = UUID()
        isLoading = false
        stopAudition(); topUpTask?.cancel()
        // Deliberate downloads belong to Storage and survive leaving this screen.
    }

    func accountDidChange() {
        endPresentation()
        downloadGeneration = UUID(); downloadRequested = false
        manifest = nil; freshDetail = nil; clearLocalAccess()
    }

    func deleteDrive(onDeleted: @escaping @MainActor (String) -> Void) async {
        do { try await api.deleteDrive(id: driveId) }
        catch {
            if let error = error as? APIError, error.needsAccount { showWall(source: "drive_detail"); return }
            guard (error as? APIError)?.status == 404 else { errorMessage = "Failed to delete drive."; return }
        }
        stopAudition(); topUpTask?.cancel()
        await storage?.deleteDriveDownload(driveId: driveId)
        onDeleted(driveId)
    }

    private func canAccessLocal() async -> Bool {
        guard let session else { return true }
        return await session.canAccessLocalDrive(driveId)
    }
    private func clearLocalAccess() {
        stopAudition(); localAudioURLs = [:]; gate = .nothingSaved
        missingCount = 0; expectedCount = 0; isExpired = false; isUpdatable = false; directoryState = .none
    }
    private func showWall(source: String) {
        needsAccount = true; clearLocalAccess()
        if wallSources.insert(source).inserted { AnalyticsEvents.wallShown(source: source, track: analytics) }
    }
    private func previewKey(_ seq: Int) -> String { "drive-\(driveId)-stop-\(seq)" }
    private func subscribeToDownload() async {
        guard downloadSubToken == nil, let storage else { return }
        let token = await storage.subscribeDownload(driveId: driveId) { [weak self] progress in
            Task { @MainActor in
                self?.downloadDone = progress.done; self?.downloadTotal = progress.total
                self?.isDownloading = true
            }
        }
        if downloadSubToken == nil { downloadSubToken = token }
        else { await storage.unsubscribeDownload(driveId: driveId, token: token) }
    }
    private func unsubscribeDownload() async {
        guard let token = downloadSubToken else { return }
        downloadSubToken = nil
        await storage?.unsubscribeDownload(driveId: driveId, token: token)
    }
}
