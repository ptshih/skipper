import Foundation

public protocol StorageDriveDetailProvider: Sendable {
    func fetchDriveDetail(driveId: String) async throws -> StorageSavedDriveDetail
}

/// Actor orchestrating all offline download, manifest migration, playback resolution,
/// fail-closed GC, and purge operations.
/// Mirrors apps/mobile/src/lib/offline.ts.
public actor StorageService {
    public let clipStore: StorageClipStore
    public let regionCache: StorageRegionCache
    public let downloader: StorageFileDownloader
    public let driveProvider: StorageDriveDetailProvider?

    private final class StorageTransferEntry: @unchecked Sendable {
        let id: UUID
        let epoch: UInt64
        let fileName: String
        let stagingURL: URL
        let destURL: URL
        let task: Task<Void, Error>
        var consumersByDrive = [String: Int]()

        init(
            id: UUID,
            epoch: UInt64,
            fileName: String,
            stagingURL: URL,
            destURL: URL,
            task: Task<Void, Error>
        ) {
            self.id = id
            self.epoch = epoch
            self.fileName = fileName
            self.stagingURL = stagingURL
            self.destURL = destURL
            self.task = task
        }
    }

    private var inFlightDownloads = [String: (id: UUID, task: Task<StorageDownloadResult, Error>)]()
    private var activeDownloads = [String: StorageActiveDownload]()
    private var progressSubscribers = [String: [UUID: @Sendable (StorageDownloadProgress) -> Void]]()
    private var inFlightTopUps = [String: (id: UUID, task: Task<StorageOfflineStatus?, Error>)]()
    private var inFlightTransfers = [String: StorageTransferEntry]()
    private var busyStoreNames = Set<String>()
    private var storageEpoch: UInt64 = 1

    #if DEBUG
    enum ConcurrencyEvent: Sendable {
        case waitingForCancelledRun(String)
        case joinedRun(String)
        case transferConsumerRegistered(String)
    }
    // Observation only: tests can await actual registry boundaries without scheduler sleeps.
    private var concurrencyObserver: (@Sendable (ConcurrencyEvent) -> Void)?
    func observeConcurrency(_ observer: @escaping @Sendable (ConcurrencyEvent) -> Void) {
        concurrencyObserver = observer
    }
    #endif

    private static let maxConcurrentTransfers = 4
    public static let downloadTtlDays: Double = 30.0

    public init(
        rootURL: URL? = nil,
        downloader: StorageFileDownloader? = nil,
        driveProvider: StorageDriveDetailProvider? = nil
    ) {
        self.clipStore = StorageClipStore(rootURL: rootURL)
        self.regionCache = StorageRegionCache(rootURL: rootURL)
        self.downloader = downloader ?? StorageDefaultDownloader()
        self.driveProvider = driveProvider
    }

    // MARK: - Download Registry & Subscriptions

    public func activeDownload(driveId: String) -> StorageActiveDownload? {
        activeDownloads[driveId]
    }

    public func subscribeDownload(
        driveId: String,
        handler: @escaping @Sendable (StorageDownloadProgress) -> Void
    ) -> UUID {
        let id = UUID()
        var current = progressSubscribers[driveId] ?? [:]
        current[id] = handler
        progressSubscribers[driveId] = current
        if let active = activeDownloads[driveId] {
            handler(active.progress)
        }
        return id
    }

    public func unsubscribeDownload(driveId: String, token: UUID) {
        progressSubscribers[driveId]?[token] = nil
        if progressSubscribers[driveId]?.isEmpty ?? false {
            progressSubscribers.removeValue(forKey: driveId)
        }
    }

    private func notifyProgress(driveId: String, runId: UUID, done: Int, total: Int) {
        guard let active = activeDownloads[driveId], active.id == runId else {
            return
        }
        let progress = StorageDownloadProgress(done: done, total: total)
        activeDownloads[driveId] = StorageActiveDownload(id: runId, progress: progress, isCanceled: active.isCanceled)
        if let subscribers = progressSubscribers[driveId] {
            for handler in subscribers.values {
                handler(progress)
            }
        }
    }

    public func cancelDownload(driveId: String) {
        if let entry = inFlightDownloads[driveId] {
            entry.task.cancel()
        }
        if let topUp = inFlightTopUps[driveId] {
            topUp.task.cancel()
        }
        if let active = activeDownloads[driveId] {
            activeDownloads[driveId] = StorageActiveDownload(id: active.id, progress: active.progress, isCanceled: true)
        }

        // Clean up consumer registrations for this driveId, cancelling transfers with no remaining consumers
        for (fileName, entry) in inFlightTransfers {
            if entry.consumersByDrive[driveId] != nil {
                entry.consumersByDrive.removeValue(forKey: driveId)
                if entry.consumersByDrive.isEmpty {
                    inFlightTransfers.removeValue(forKey: fileName)
                    entry.task.cancel()
                    try? FileManager.default.removeItem(at: entry.stagingURL)
                }
            }
        }
    }

    // MARK: - Shared Clip Transfer Deduplication & Ownership (HIGH 1 / Purge Cancellation)

    private func fetchClip(
        driveId: String,
        fileName: String,
        destURL: URL,
        urlString: String?,
        isShared: Bool
    ) async throws {
        try Task.checkCancellation()
        if clipStore.hasBytes(at: destURL) { return }
        guard let urlString, let url = URL(string: urlString) else {
            throw StorageError.downloadFailed(name: fileName, underlying: "Missing clip url")
        }

        // Register local and shared transfers alike. The destination path separates same-named
        // drive-local clips while allowing shared clips to have multiple independent consumers.
        let transferKey = destURL.path
        let entry: StorageTransferEntry
        if let existing = inFlightTransfers[transferKey], existing.epoch == storageEpoch, !existing.task.isCancelled {
            entry = existing
        } else {
            let id = UUID()
            let staging = clipStore.stagingURL(transferId: id, name: fileName)
            let downloader = self.downloader
            let task = Task<Void, Error> {
                do {
                    try await downloader.downloadFile(from: url, to: staging, name: fileName, onProgress: nil)
                    try Task.checkCancellation()
                } catch {
                    try? FileManager.default.removeItem(at: staging)
                    throw error
                }
            }
            entry = StorageTransferEntry(id: id, epoch: storageEpoch, fileName: fileName,
                stagingURL: staging, destURL: destURL, task: task)
            inFlightTransfers[transferKey] = entry
        }
        entry.consumersByDrive[driveId, default: 0] += 1
        #if DEBUG
        concurrencyObserver?(.transferConsumerRegistered(driveId))
        #endif
        defer { removeConsumer(driveId: driveId, fileName: transferKey, transferId: entry.id) }
        try await withTaskCancellationHandler {
            try await entry.task.value
            try Task.checkCancellation()
            try completeTransfer(entry: entry)
        } onCancel: {
            Task { await self.removeConsumer(driveId: driveId, fileName: transferKey, transferId: entry.id) }
        }
    }

    private func completeTransfer(entry: StorageTransferEntry) throws {
        guard self.storageEpoch == entry.epoch, !entry.task.isCancelled, !entry.consumersByDrive.isEmpty else {
            try? FileManager.default.removeItem(at: entry.stagingURL)
            throw StorageError.downloadCanceled
        }
        try clipStore.promoteStagedClip(from: entry.stagingURL, to: entry.destURL)
        guard clipStore.hasBytes(at: entry.destURL) else {
            throw StorageError.downloadFailed(name: entry.fileName, underlying: "Transfer completed without bytes")
        }
    }

    private func removeConsumer(driveId: String, fileName: String, transferId: UUID) {
        guard let entry = inFlightTransfers[fileName], entry.id == transferId else { return }
        if let count = entry.consumersByDrive[driveId] {
            if count <= 1 {
                entry.consumersByDrive.removeValue(forKey: driveId)
            } else {
                entry.consumersByDrive[driveId] = count - 1
            }
        }
        if entry.consumersByDrive.isEmpty {
            inFlightTransfers.removeValue(forKey: fileName)
            entry.task.cancel()
            try? FileManager.default.removeItem(at: entry.stagingURL)
        }
    }

    // MARK: - Download Execution

    public func downloadDrive(
        driveId: String,
        detail: StorageSavedDriveDetail? = nil
    ) async throws -> StorageDownloadResult {
        guard StorageUtils.isSafeLocalName(driveId) else {
            throw StorageError.unsafePath(name: driveId)
        }

        try Task.checkCancellation()
        let epoch = storageEpoch
        while true {
            try checkEpoch(epoch)
            if let existing = inFlightDownloads[driveId] {
                if existing.task.isCancelled || activeDownloads[driveId]?.isCanceled == true {
                    #if DEBUG
                    concurrencyObserver?(.waitingForCancelledRun(driveId))
                    #endif
                    _ = try? await existing.task.value
                    finishDownload(driveId: driveId, runId: existing.id)
                    continue
                }
                #if DEBUG
                concurrencyObserver?(.joinedRun(driveId))
                #endif
                return try await awaitRun(existing.task)
            }
            // Only one manifest writer per drive. A full download waits for a top-up already
            // performing IO, then rechecks both registries after the actor resumes.
            if let topUp = inFlightTopUps[driveId] {
                _ = try? await topUp.task.value
                if inFlightTopUps[driveId]?.id == topUp.id { inFlightTopUps.removeValue(forKey: driveId) }
                continue
            }
            break
        }
        let runId = UUID()
        activeDownloads[driveId] = StorageActiveDownload(id: runId, progress: .init(done: 0, total: 0), isCanceled: false)
        let task = Task<StorageDownloadResult, Error> {
            defer { self.finishDownload(driveId: driveId, runId: runId) }
            return try await self.runDownload(driveId: driveId, runId: runId, epoch: epoch, providedDetail: detail)
        }
        inFlightDownloads[driveId] = (id: runId, task: task)
        return try await awaitRun(task)
    }

    private func checkEpoch(_ epoch: UInt64) throws {
        try Task.checkCancellation()
        guard storageEpoch == epoch else { throw StorageError.downloadCanceled }
    }

    private func finishDownload(driveId: String, runId: UUID) {
        guard inFlightDownloads[driveId]?.id == runId else { return }
        inFlightDownloads.removeValue(forKey: driveId)
        if activeDownloads[driveId]?.id == runId { activeDownloads.removeValue(forKey: driveId) }
        // Subscriptions are drive-scoped and survive an explicit retry; only unsubscribe/purge
        // releases them. An old run must not erase observers installed for its successor.
    }

    private func awaitRun<Value: Sendable>(_ task: Task<Value, Error>) async throws -> Value {
        // A screen owns its waiter, never the shared run. Only explicit Cancel or purge may
        // cancel that run and its transfers. Once it settles, a canceled waiter gets cancellation
        // without changing the result delivered to other callers or leaving a canceled registry.
        try Task.checkCancellation()
        let result = await task.result
        try Task.checkCancellation()
        return try result.get()
    }

    private func runDownload(
        driveId: String,
        runId: UUID,
        epoch: UInt64,
        providedDetail: StorageSavedDriveDetail?
    ) async throws -> StorageDownloadResult {
        try checkEpoch(epoch)
        let detail: StorageSavedDriveDetail
        if let providedDetail {
            detail = providedDetail
        } else if let driveProvider {
            detail = try await driveProvider.fetchDriveDetail(driveId: driveId)
        } else {
            throw StorageError.unreadableManifest(driveId: driveId)
        }

        try checkEpoch(epoch)

        clipStore.ensureClipStoreDir()
        clipStore.ensureDriveDir(driveId: driveId)

        // Free space pre-flight
        let durations = detail.clips.map { $0.durationMs }
        try StorageDefaultDownloader.assertFreeSpaceFor(durationsMs: durations)

        // Plan clips to store
        struct PlannedClip {
            let seq: Int
            let clip: StorageSavedDriveClip
            let storeKey: StorageStoreKey?
            let fileName: String
            let isShared: Bool
            let destURL: URL
        }

        var plannedClips = [PlannedClip]()
        for clip in detail.clips {
            guard StorageUtils.hasDownloadableAudio(contentType: clip.contentType) else {
                continue
            }
            let key = StorageUtils.storeKeyForClip(
                poiId: clip.poiId,
                subjectId: clip.subjectId,
                subjectKind: clip.subjectKind?.rawValue,
                revisedAt: clip.revisedAt
            )
            let contentType = clip.contentType ?? "audio/mp4"

            if let key {
                let fileName = try StorageUtils.storeFileName(key: key, contentType: contentType)
                let dest = clipStore.clipsDirectory.appendingPathComponent(fileName)
                plannedClips.append(PlannedClip(
                    seq: clip.seq,
                    clip: clip,
                    storeKey: key,
                    fileName: fileName,
                    isShared: true,
                    destURL: dest
                ))
            } else {
                // Fused clip fallback to drive-local
                let ext = StorageUtils.extForContentType(contentType)
                let fileName = "\(clip.seq).\(ext)"
                let dest = clipStore.driveDirectory(driveId: driveId).appendingPathComponent(fileName)
                plannedClips.append(PlannedClip(
                    seq: clip.seq,
                    clip: clip,
                    storeKey: nil,
                    fileName: fileName,
                    isShared: false,
                    destURL: dest
                ))
            }
        }

        let total = plannedClips.count
        var done = 0
        notifyProgress(driveId: driveId, runId: runId, done: done, total: total)

        // Hold busyStoreNames for the ENTIRE duration of runDownload through manifest commit! (HIGH 3)
        for item in plannedClips where item.isShared {
            busyStoreNames.insert(item.fileName)
        }
        defer {
            for item in plannedClips where item.isShared {
                busyStoreNames.remove(item.fileName)
            }
        }

        var firstFailure: String?

        // Download missing files in bounded concurrency chunks
        for chunk in plannedClips.chunked(into: Self.maxConcurrentTransfers) {
            try checkEpoch(epoch)

            for item in chunk {
                try checkEpoch(epoch)
                let alreadyPresent: Bool
                if item.isShared {
                    alreadyPresent = clipStore.hasStoredClip(name: item.fileName)
                } else {
                    alreadyPresent = clipStore.hasBytes(at: item.destURL)
                }

                if !alreadyPresent {
                    do {
                        try await fetchClip(
                            driveId: driveId,
                            fileName: item.fileName,
                            destURL: item.destURL,
                            urlString: item.clip.url,
                            isShared: item.isShared
                        )
                    } catch {
                        if Task.isCancelled {
                            if storageEpoch == epoch, inFlightDownloads[driveId]?.id == runId {
                                dropUncommittedDriveDir(driveId: driveId)
                            }
                            throw StorageError.downloadCanceled
                        }
                        if firstFailure == nil {
                            firstFailure = error.localizedDescription
                        }
                    }
                }

                done += 1
                notifyProgress(driveId: driveId, runId: runId, done: done, total: total)
            }
        }

        try checkEpoch(epoch)

        // Resolve each seq with existing manifest fallback! (HIGH 2)
        let existingManifest = loadManifest(driveId: driveId)
        let existingClips = existingManifest?.clips

        var storedClipRefs = [String: StorageStoredClipRef]()
        var missingSeqs = [Int]()

        for item in plannedClips {
            let plannedRef = StorageStoredClipRef(
                name: item.fileName,
                contentType: item.clip.contentType ?? "audio/mp4",
                durationMs: item.clip.durationMs,
                shared: item.isShared
            )
            let plannedPresent = item.isShared
                ? clipStore.hasStoredClip(name: item.fileName)
                : clipStore.hasBytes(at: item.destURL)

            let prior = existingClips?[String(item.seq)]
            let priorPresent: Bool
            if let prior {
                if prior.shared {
                    priorPresent = clipStore.hasStoredClip(name: prior.name)
                } else {
                    let localURL = clipStore.driveDirectory(driveId: driveId).appendingPathComponent(prior.name)
                    priorPresent = clipStore.hasBytes(at: localURL)
                }
            } else {
                priorPresent = false
            }

            let (resolvedRef, missing) = StorageUtils.resolveClipRef(
                planned: plannedRef,
                plannedPresent: plannedPresent,
                saved: prior,
                savedPresent: priorPresent
            )

            if let resolvedRef {
                storedClipRefs[String(item.seq)] = resolvedRef
            }
            if missing {
                missingSeqs.append(item.seq)
            }
        }

        if storedClipRefs.isEmpty {
            // Nothing salvageable on disk! Throw preserving original manifest. (HIGH 2)
            if storageEpoch == epoch, inFlightDownloads[driveId]?.id == runId {
                                dropUncommittedDriveDir(driveId: driveId)
                            }
            throw StorageError.downloadFailed(
                name: driveId,
                underlying: firstFailure ?? "Download failed — no clips could be saved."
            )
        }

        // Commit manifest with presigned URLs stripped! (MEDIUM 4)
        let strippedDetail = detail.strippingURLs()
        let expectedSeqs = StorageUtils.expectedAudioSeqs(detail.clips)
        let savedAt: String
        let landedNewClips = plannedClips.contains { p in
            if p.isShared {
                return clipStore.hasStoredClip(name: p.fileName) && existingClips?[String(p.seq)]?.name != p.fileName
            } else {
                return clipStore.hasBytes(at: p.destURL)
            }
        }
        if landedNewClips || existingManifest == nil {
            savedAt = ISO8601DateFormatter().string(from: Date())
        } else {
            savedAt = existingManifest!.savedAt
        }

        let manifest = StorageOfflineManifest(
            driveId: driveId,
            version: 5,
            savedAt: savedAt,
            detail: strippedDetail,
            audioSeqs: expectedSeqs,
            clips: storedClipRefs
        )
        try saveManifestAtomically(manifest: manifest, driveId: driveId)

        return StorageDownloadResult(
            manifest: manifest,
            downloaded: storedClipRefs.count,
            total: total,
            failedSeqs: missingSeqs
        )
    }

    private func dropUncommittedDriveDir(driveId: String) {
        let manifestURL = clipStore.manifestURL(driveId: driveId)
        if FileManager.default.fileExists(atPath: manifestURL.path) {
            return // Guarded on manifest's absence! Never drop committed manifest!
        }
        let dir = clipStore.driveDirectory(driveId: driveId)
        clipStore.deleteQuietly(at: dir)
    }

    // MARK: - Top-Up & Repair

    public func topUpDrive(
        driveId: String,
        fresh: StorageSavedDriveDetail
    ) async throws -> StorageOfflineStatus? {
        guard StorageUtils.isSafeLocalName(driveId) else { return nil }

        let epoch = storageEpoch
        while true {
            try checkEpoch(epoch)
            if inFlightDownloads[driveId] != nil { return nil }
            if let existing = inFlightTopUps[driveId] {
                if existing.task.isCancelled {
                    _ = try? await existing.task.value
                    if inFlightTopUps[driveId]?.id == existing.id { inFlightTopUps.removeValue(forKey: driveId) }
                    continue
                }
                #if DEBUG
                concurrencyObserver?(.joinedRun(driveId))
                #endif
                return try await awaitRun(existing.task)
            }
            break
        }
        let topUpId = UUID()
        let task = Task<StorageOfflineStatus?, Error> {
            defer {
                if self.inFlightTopUps[driveId]?.id == topUpId { self.inFlightTopUps.removeValue(forKey: driveId) }
            }
            return try await self.runTopUp(driveId: driveId, epoch: epoch, fresh: fresh)
        }
        inFlightTopUps[driveId] = (id: topUpId, task: task)
        return try await awaitRun(task)
    }

    private func runTopUp(
        driveId: String,
        epoch: UInt64,
        fresh: StorageSavedDriveDetail
    ) async throws -> StorageOfflineStatus? {
        try checkEpoch(epoch)
        guard let saved = loadManifest(driveId: driveId) else {
            return nil // Never convert a non-download into a download
        }

        let audioSeqs = StorageUtils.expectedAudioSeqs(fresh.clips)
        if audioSeqs.isEmpty {
            return offlineStatus(driveId: driveId)
        }

        // Plan clips from fresh
        var planned = [StorageSavedDriveClip]()
        var plannedFileNames = [String]()
        for clip in fresh.clips {
            guard StorageUtils.hasDownloadableAudio(contentType: clip.contentType) else { continue }
            planned.append(clip)
            let contentType = clip.contentType ?? "audio/mp4"
            let key = StorageUtils.storeKeyForClip(
                poiId: clip.poiId,
                subjectId: clip.subjectId,
                subjectKind: clip.subjectKind?.rawValue,
                revisedAt: clip.revisedAt
            )
            if let key, let fileName = try? StorageUtils.storeFileName(key: key, contentType: contentType) {
                plannedFileNames.append(fileName)
            }
        }

        // Register busyStoreNames for the WHOLE top-up duration through commit! (HIGH 3)
        for name in plannedFileNames {
            busyStoreNames.insert(name)
        }
        defer {
            for name in plannedFileNames {
                busyStoreNames.remove(name)
            }
        }

        var landed = 0
        for clip in planned {
            try checkEpoch(epoch)
            let contentType = clip.contentType ?? "audio/mp4"
            let key = StorageUtils.storeKeyForClip(
                poiId: clip.poiId,
                subjectId: clip.subjectId,
                subjectKind: clip.subjectKind?.rawValue,
                revisedAt: clip.revisedAt
            )
            guard let key, let fileName = try? StorageUtils.storeFileName(key: key, contentType: contentType) else {
                continue
            }

            if !clipStore.hasStoredClip(name: fileName) {
                if let urlStr = clip.url {
                    let dest = clipStore.clipsDirectory.appendingPathComponent(fileName)
                    do {
                        try await fetchClip(
                            driveId: driveId,
                            fileName: fileName,
                            destURL: dest,
                            urlString: urlStr,
                            isShared: true
                        )
                        if clipStore.hasStoredClip(name: fileName) {
                            landed += 1
                        }
                    } catch {
                        try checkEpoch(epoch)
                        // Other clip failures retain saved references below.
                    }
                }
            }
        }

        try checkEpoch(epoch)

        // Build clip refs with saved.clips fallback! (HIGH 2)
        var nextClips = [String: StorageStoredClipRef]()
        for clip in planned {
            let contentType = clip.contentType ?? "audio/mp4"
            let key = StorageUtils.storeKeyForClip(
                poiId: clip.poiId,
                subjectId: clip.subjectId,
                subjectKind: clip.subjectKind?.rawValue,
                revisedAt: clip.revisedAt
            )
            let fileName = (try? key.map { try StorageUtils.storeFileName(key: $0, contentType: contentType) }) ?? nil
            let plannedRef = StorageStoredClipRef(
                name: fileName ?? "\(clip.seq).\(StorageUtils.extForContentType(contentType))",
                contentType: contentType,
                durationMs: clip.durationMs,
                shared: fileName != nil
            )
            let plannedPresent = fileName != nil ? clipStore.hasStoredClip(name: fileName!) : false
            let prior = saved.clips[String(clip.seq)]
            let priorPresent: Bool
            if let prior {
                if prior.shared {
                    priorPresent = clipStore.hasStoredClip(name: prior.name)
                } else {
                    let localURL = clipStore.driveDirectory(driveId: driveId).appendingPathComponent(prior.name)
                    priorPresent = clipStore.hasBytes(at: localURL)
                }
            } else {
                priorPresent = false
            }

            let (ref, _) = StorageUtils.resolveClipRef(
                planned: plannedRef,
                plannedPresent: plannedPresent,
                saved: prior,
                savedPresent: priorPresent
            )
            if let ref {
                nextClips[String(clip.seq)] = ref
            }
        }

        if nextClips.isEmpty {
            return offlineStatus(driveId: driveId)
        }

        // Strip URLs from fresh! (MEDIUM 4)
        let strippedDetail = fresh.strippingURLs()

        let unchanged = landed == 0 &&
            StorageUtils.contentSignature(detailClips: saved.detail.clips.map { ["seq": $0.seq, "revisedAt": $0.revisedAt ?? ""] }) ==
            StorageUtils.contentSignature(detailClips: fresh.clips.map { ["seq": $0.seq, "revisedAt": $0.revisedAt ?? ""] }) &&
            saved.clips == nextClips

        if unchanged {
            return offlineStatus(driveId: driveId)
        }

        let savedAt = landed > 0 ? ISO8601DateFormatter().string(from: Date()) : saved.savedAt
        let updatedManifest = StorageOfflineManifest(
            driveId: driveId,
            version: 5,
            savedAt: savedAt,
            detail: strippedDetail,
            audioSeqs: audioSeqs,
            clips: nextClips
        )
        try checkEpoch(epoch)
        try saveManifestAtomically(manifest: updatedManifest, driveId: driveId)

        return offlineStatus(driveId: driveId)
    }

    public func repairDownload(
        driveId: String,
        fresh: StorageSavedDriveDetail
    ) async throws -> StorageOfflineStatus? {
        guard StorageUtils.isSafeLocalName(driveId) else { return nil }
        let dir = clipStore.driveDirectory(driveId: driveId)
        guard FileManager.default.fileExists(atPath: dir.path) else { return nil }

        let existingManifest = loadManifest(driveId: driveId)
        let existingClips = existingManifest?.clips

        let audioSeqs = StorageUtils.expectedAudioSeqs(fresh.clips)
        var storedClips = [String: StorageStoredClipRef]()
        var oldestTimestamp: Date?

        for clip in fresh.clips {
            guard StorageUtils.hasDownloadableAudio(contentType: clip.contentType) else { continue }
            let contentType = clip.contentType ?? "audio/mp4"
            let key = StorageUtils.storeKeyForClip(
                poiId: clip.poiId,
                subjectId: clip.subjectId,
                subjectKind: clip.subjectKind?.rawValue,
                revisedAt: clip.revisedAt
            )
            let fileName = (try? key.map { try StorageUtils.storeFileName(key: $0, contentType: contentType) }) ?? nil
            let plannedRef = StorageStoredClipRef(
                name: fileName ?? "\(clip.seq).\(StorageUtils.extForContentType(contentType))",
                contentType: contentType,
                durationMs: clip.durationMs,
                shared: fileName != nil
            )
            let plannedPresent = fileName != nil ? clipStore.hasStoredClip(name: fileName!) : false
            let prior = existingClips?[String(clip.seq)]
            let priorPresent: Bool
            if let prior {
                if prior.shared {
                    priorPresent = clipStore.hasStoredClip(name: prior.name)
                } else {
                    let localURL = clipStore.driveDirectory(driveId: driveId).appendingPathComponent(prior.name)
                    priorPresent = clipStore.hasBytes(at: localURL)
                }
            } else {
                priorPresent = false
            }

            let (ref, _) = StorageUtils.resolveClipRef(
                planned: plannedRef,
                plannedPresent: plannedPresent,
                saved: prior,
                savedPresent: priorPresent
            )
            if let ref {
                storedClips[String(clip.seq)] = ref
                let fileURL = ref.shared
                    ? clipStore.clipsDirectory.appendingPathComponent(ref.name)
                    : clipStore.driveDirectory(driveId: driveId).appendingPathComponent(ref.name)
                if let attrs = try? FileManager.default.attributesOfItem(atPath: fileURL.path),
                   let modDate = attrs[.modificationDate] as? Date {
                    if oldestTimestamp == nil || modDate < oldestTimestamp! {
                        oldestTimestamp = modDate
                    }
                }
            }
        }

        // If nothing salvageable on disk, return nil WITHOUT overwriting manifest! (HIGH 2)
        if storedClips.isEmpty {
            return nil
        }

        if oldestTimestamp == nil {
            if let attrs = try? FileManager.default.attributesOfItem(atPath: dir.path),
               let modDate = attrs[.modificationDate] as? Date {
                oldestTimestamp = modDate
            }
        }

        let savedAtDate = oldestTimestamp ?? Date()
        let savedAt = ISO8601DateFormatter().string(from: savedAtDate)
        let manifest = StorageOfflineManifest(
            driveId: driveId,
            version: 5,
            savedAt: savedAt,
            detail: fresh.strippingURLs(), // MEDIUM 4: stripped URLs
            audioSeqs: audioSeqs,
            clips: storedClips
        )
        try saveManifestAtomically(manifest: manifest, driveId: driveId)

        return offlineStatus(driveId: driveId)
    }

    // MARK: - Manifest Reading & Atomic Persistence

    public func loadManifest(driveId: String) -> StorageOfflineManifest? {
        guard StorageUtils.isSafeLocalName(driveId) else { return nil }
        let manifestFile = clipStore.manifestURL(driveId: driveId)
        guard FileManager.default.fileExists(atPath: manifestFile.path) else { return nil }

        guard let data = try? Data(contentsOf: manifestFile),
              let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let version = json["version"] as? Int else {
            return nil
        }

        if version == 5 {
            // Decode strongly-typed manifest
            guard let manifest = try? JSONDecoder().decode(StorageOfflineManifest.self, from: data) else {
                return nil
            }
            // Validate all clip paths are safe
            for (_, clip) in manifest.clips {
                guard StorageUtils.isSafeLocalName(clip.name) else {
                    return nil
                }
            }
            return manifest
        }

        if version == 4 {
            // Lazy synchronous migration
            guard let migrated = clipStore.migrateDriveV4(driveId: driveId, raw: json),
                  let migratedData = try? JSONSerialization.data(withJSONObject: migrated, options: [.prettyPrinted, .sortedKeys]),
                  let manifest = try? JSONDecoder().decode(StorageOfflineManifest.self, from: migratedData) else {
                // Decode or migration failed: leave on-disk file byte-identical and return nil!
                return nil
            }
            for (_, clip) in manifest.clips {
                guard StorageUtils.isSafeLocalName(clip.name) else {
                    return nil
                }
            }
            // Validated typed v5 decode BEFORE writing! Now persist atomically.
            try? migratedData.write(to: manifestFile, options: .atomic)
            return manifest
        }

        return nil
    }

    private func saveManifestAtomically(manifest: StorageOfflineManifest, driveId: String) throws {
        let manifestFile = clipStore.manifestURL(driveId: driveId)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(manifest)
        try data.write(to: manifestFile, options: .atomic)
    }

    // MARK: - State Inspection

    public func downloadDirState(driveId: String) -> StorageDownloadDirState {
        guard StorageUtils.isSafeLocalName(driveId) else { return .none }
        let dir = clipStore.driveDirectory(driveId: driveId)
        guard FileManager.default.fileExists(atPath: dir.path) else { return .none }
        return loadManifest(driveId: driveId) != nil ? .ok : .unreadable
    }

    public func offlineStatus(driveId: String) -> StorageOfflineStatus? {
        guard let manifest = loadManifest(driveId: driveId) else { return nil }
        var present = [Int]()

        for seq in manifest.audioSeqs {
            guard let clip = manifest.clips[String(seq)], StorageUtils.isSafeLocalName(clip.name) else {
                continue
            }
            let isPresent: Bool
            if clip.shared {
                isPresent = clipStore.hasStoredClip(name: clip.name)
            } else {
                let fileURL = clipStore.driveDirectory(driveId: driveId).appendingPathComponent(clip.name)
                isPresent = clipStore.hasBytes(at: fileURL)
            }
            if isPresent {
                present.append(seq)
            }
        }

        // Shipped offline.ts:1106-1110: null when nothing playable is on disk
        if present.isEmpty {
            return nil
        }

        let missing = StorageUtils.missingAudioSeqs(expectedSeqs: manifest.audioSeqs, savedSeqs: present)
        return StorageOfflineStatus(
            downloaded: true,
            missingSeqs: missing,
            expectedCount: manifest.audioSeqs.count
        )
    }

    public func hasPlayableDrive(driveId: String) -> Bool {
        offlineStatus(driveId: driveId)?.downloaded == true
    }

    public func hasCompleteDrive(driveId: String) -> Bool {
        offlineStatus(driveId: driveId)?.isComplete == true
    }

    public func isDownloadStale(driveId: String, fresh: StorageSavedDriveDetail) -> Bool {
        guard let manifest = loadManifest(driveId: driveId) else { return false }
        let existingSig = StorageUtils.contentSignature(detailClips: manifest.detail.clips.map { [
            "seq": $0.seq,
            "revisedAt": $0.revisedAt ?? ""
        ] })
        let freshSig = StorageUtils.contentSignature(detailClips: fresh.clips.map { [
            "seq": $0.seq,
            "revisedAt": $0.revisedAt ?? ""
        ] })
        return existingSig != freshSig
    }

    public func isDownloadExpired(driveId: String) -> Bool {
        guard let manifest = loadManifest(driveId: driveId) else { return false }
        return StorageUtils.isPastTtl(manifest.savedAt, ttlDays: Self.downloadTtlDays)
    }

    public func offlineSnapshot(driveId: String) -> StorageOfflineSnapshot {
        let state = downloadDirState(driveId: driveId)
        let status = offlineStatus(driveId: driveId)
        let expired = isDownloadExpired(driveId: driveId)
        return StorageOfflineSnapshot(
            status: status,
            isExpired: expired,
            dirState: state
        )
    }

    public func listDownloadedDrives() -> [StorageDriveSummary] {
        guard FileManager.default.fileExists(atPath: clipStore.drivesDirectory.path) else {
            return []
        }
        guard let entries = try? FileManager.default.contentsOfDirectory(atPath: clipStore.drivesDirectory.path) else {
            return []
        }

        var summaries = [StorageDriveSummary]()
        for driveId in entries {
            guard StorageUtils.isSafeLocalName(driveId) else { continue }
            // Shipped offline.ts:1224 requires at least one present clip on disk
            guard offlineStatus(driveId: driveId) != nil,
                  let manifest = loadManifest(driveId: driveId) else {
                continue
            }
            summaries.append(StorageDriveSummary(
                driveId: manifest.driveId,
                label: manifest.detail.label,
                distanceMeters: manifest.detail.distanceMeters,
                durationSeconds: manifest.detail.durationSeconds,
                clipCount: manifest.audioSeqs.count,
                savedAt: manifest.savedAt
            ))
        }
        return summaries
    }

    // MARK: - Playback Resolution

    public func loadPlayback(driveId: String) throws -> StoragePlayback {
        guard let manifest = loadManifest(driveId: driveId) else {
            throw StorageError.unreadableManifest(driveId: driveId)
        }

        var urls = [Int: URL]()
        for seq in manifest.audioSeqs {
            guard let clip = manifest.clips[String(seq)], StorageUtils.isSafeLocalName(clip.name) else {
                continue
            }
            if clip.shared {
                if clipStore.hasStoredClip(name: clip.name), let url = try? clipStore.storedClipURL(name: clip.name) {
                    urls[seq] = url
                }
            } else {
                let localURL = clipStore.driveDirectory(driveId: driveId).appendingPathComponent(clip.name)
                if clipStore.hasBytes(at: localURL) {
                    urls[seq] = localURL
                }
            }
        }

        if urls.isEmpty && !manifest.audioSeqs.isEmpty {
            throw StorageError.noPlayableAudio(driveId: driveId)
        }

        return StoragePlayback(
            detail: manifest.detail,
            urls: urls,
            expectedSeqs: manifest.audioSeqs
        )
    }

    // MARK: - Deletion & GC Sweep

    public func deleteDriveDownload(driveId: String) {
        cancelDownload(driveId: driveId)
        guard StorageUtils.isSafeLocalName(driveId) else { return }
        let dir = clipStore.driveDirectory(driveId: driveId)
        clipStore.deleteQuietly(at: dir)
        _ = sweepOrphanClips()
    }

    public func sweepOrphanClips() -> Int {
        guard FileManager.default.fileExists(atPath: clipStore.drivesDirectory.path) else {
            return 0
        }
        if !inFlightDownloads.isEmpty || !inFlightTopUps.isEmpty || !inFlightTransfers.isEmpty {
            return 0
        }
        let driveIds = (try? FileManager.default.contentsOfDirectory(atPath: clipStore.drivesDirectory.path)) ?? []

        var manifests = [[String: Any]]()
        for driveId in driveIds {
            let manifestURL = clipStore.manifestURL(driveId: driveId)
            let hasManifestFile: Bool
            do {
                hasManifestFile = try manifestURL.checkResourceIsReachable()
            } catch {
                let nsError = error as NSError
                if nsError.domain == NSCocoaErrorDomain && (nsError.code == NSFileReadNoSuchFileError || nsError.code == NSFileNoSuchFileError) {
                    hasManifestFile = false
                } else {
                    return 0
                }
            }
            guard let manifest = loadManifest(driveId: driveId) else {
                if !hasManifestFile {
                    continue
                }
                return 0
            }
            guard let data = try? JSONEncoder().encode(manifest),
                  let dict = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
                return 0
            }
            manifests.append(dict)
        }

        let input = StorageClipStore.StoreSweepInput(
            driveIds: driveIds,
            readManifest: nil,
            downloadsInFlight: false,
            busy: busyStoreNames,
            hasManifest: nil,
            manifests: manifests
        )
        return clipStore.sweepOrphanClips(input: input)
    }

    public func deleteAllDriveDownloads() -> Int {
        // 1. Advance storage epoch immediately to invalidate any in-flight promotion
        storageEpoch &+= 1

        // 2. Cancel in-flight drive downloads and top-ups
        for driveId in inFlightDownloads.keys {
            inFlightDownloads[driveId]?.task.cancel()
        }
        inFlightDownloads.removeAll()

        for driveId in inFlightTopUps.keys {
            inFlightTopUps[driveId]?.task.cancel()
        }
        inFlightTopUps.removeAll()
        activeDownloads.removeAll()
        progressSubscribers.removeAll()

        // 3. Cancel all in-flight shared transfers and clean their staged files
        for (_, entry) in inFlightTransfers {
            entry.task.cancel()
            try? FileManager.default.removeItem(at: entry.stagingURL)
        }
        inFlightTransfers.removeAll()
        busyStoreNames.removeAll()

        // 4. Wipe drives directory
        if FileManager.default.fileExists(atPath: clipStore.drivesDirectory.path) {
            try? FileManager.default.removeItem(at: clipStore.drivesDirectory)
        }

        // 5. Clean staging directory
        clipStore.cleanStaging()

        // 6. Delete all clips in clips/
        return clipStore.deleteAllStoredClips()
    }

    // MARK: - Region Cache

    public func readCachedRegion() -> StorageCachedRegion? {
        regionCache.readCachedRegion()
    }

    public func writeCachedRegion(_ region: StorageCachedRegion) {
        regionCache.writeCachedRegion(region)
    }
}

private extension Array {
    func chunked(into size: Int) -> [[Element]] {
        stride(from: 0, to: count, by: size).map {
            Array(self[$0 ..< Swift.min($0 + size, count)])
        }
    }
}
