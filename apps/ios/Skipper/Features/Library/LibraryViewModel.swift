import Foundation
import Observation

struct RegionFacet: Identifiable, Equatable, Sendable {
    let id: String
    let displayName: String
    let count: Int

    init(id: String, displayName: String, count: Int) {
        self.id = id
        self.displayName = displayName
        self.count = count
    }
}

enum LibraryDownloadState: Equatable, Sendable {
    case notDownloaded
    case complete
    case partial(downloaded: Int, total: Int)
}

struct DriveItemDisplay: Identifiable, Equatable, Sendable {
    let id: String
    let driveId: String
    let title: String
    let subtitle: String?
    let regionId: String?
    let createdAt: String?
    let stopCount: Int
    let estMinutes: Int?
    let downloadState: LibraryDownloadState

    var isDownloaded: Bool {
        downloadState != .notDownloaded
    }

    init(
        id: String,
        driveId: String,
        title: String,
        subtitle: String?,
        regionId: String?,
        createdAt: String?,
        stopCount: Int,
        estMinutes: Int?,
        downloadState: LibraryDownloadState
    ) {
        self.id = id
        self.driveId = driveId
        self.title = title
        self.subtitle = subtitle
        self.regionId = regionId
        self.createdAt = createdAt
        self.stopCount = stopCount
        self.estMinutes = estMinutes
        self.downloadState = downloadState
    }
}

@MainActor @Observable
final class LibraryViewModel {
    private(set) var drives: [DriveItemDisplay] = []
    private(set) var selectedRegion: String? = nil
    private(set) var isOfflineFallback: Bool = false
    private(set) var isLoading: Bool = false
    private(set) var errorMessage: String? = nil
    private(set) var credits: DriveCredits? = nil

    private var rawSummaries: [DriveSummary] = []
    // Only suppress replies already in flight when deletion succeeds. A later request may
    // legitimately return a recreated drive with the same server id.
    private var deletedDuringLoad = Set<String>()
    private var ownerID: String?
    private var loadGeneration = 0
    private var currentOwnerID: String? { session.isSignedIn ? session.user?.id : nil }

    let api: any SkipperAPI
    let storage: StorageService?
    let session: SessionStore
    let analytics: AnalyticsTracker?

    init(
        api: any SkipperAPI,
        session: SessionStore,
        storage: StorageService? = nil,
        analytics: AnalyticsTracker? = nil
    ) {
        self.api = api
        self.session = session
        self.storage = storage
        self.analytics = analytics
        self.ownerID = session.isSignedIn ? session.user?.id : nil
    }

    var facets: [RegionFacet] {
        var result: [RegionFacet] = []
        var seen = Set<String>()
        var counts: [String: Int] = [:]

        for drive in rawSummaries {
            if let region = drive.region {
                counts[region.id, default: 0] += 1
            }
        }

        for drive in rawSummaries {
            if let region = drive.region, !seen.contains(region.id) {
                seen.insert(region.id)
                result.append(RegionFacet(
                    id: region.id,
                    displayName: region.displayName,
                    count: counts[region.id] ?? 1
                ))
            }
        }
        return result
    }

    var shouldOfferRegionFilter: Bool {
        facets.count > 1
    }

    var filteredDrives: [DriveItemDisplay] {
        guard let region = selectedRegion else { return drives }
        return drives.filter { $0.regionId == region }
    }

    func selectRegion(_ region: String?) {
        selectedRegion = shouldOfferRegionFilter && facets.contains(where: { $0.id == region }) ? region : nil
    }

    func reconcileRegionFilter() {
        if let current = selectedRegion {
            if !shouldOfferRegionFilter || !facets.contains(where: { $0.id == current }) {
                selectedRegion = nil
            }
        }
    }

    func removeDriveLocally(driveId: String) {
        let canonicalID = driveId.lowercased()
        if isLoading { deletedDuringLoad.insert(canonicalID) }
        drives.removeAll { $0.driveId == canonicalID }
        rawSummaries.removeAll { $0.driveId == canonicalID }
        reconcileRegionFilter()
    }

    /// MainTab retains this model across account sheets. Never retain another account's snapshot.
    func reconcileSession() {
        guard ownerID != currentOwnerID else { return }
        ownerID = currentOwnerID
        loadGeneration += 1
        isLoading = false
        drives = []; rawSummaries = []; selectedRegion = nil; credits = nil
        errorMessage = nil; isOfflineFallback = false; deletedDuringLoad.removeAll()
    }

    private func acceptsResponse(generation: Int) -> Bool {
        reconcileSession()
        return loadGeneration == generation
    }

    func loadDrives() async {
        reconcileSession()
        guard !isLoading, !Task.isCancelled else { return }
        isLoading = true
        let generation = loadGeneration
        defer {
            if generation == loadGeneration {
                isLoading = false
                deletedDuringLoad.removeAll()
            }
        }

        do {
            let driveList = try await api.listDrives()
            try Task.checkCancellation()

            var displays: [DriveItemDisplay] = []
            for drive in driveList.drives {
                let minutes = drive.durationSeconds.map { $0 / 60 }
                var state: LibraryDownloadState = .notDownloaded

                if let storage {
                    let canAccess = await session.canAccessLocalDrive(drive.driveId)
                    if canAccess {
                        let status = await storage.offlineStatus(driveId: drive.driveId)
                        if let status, status.downloaded {
                            if status.isComplete {
                                state = .complete
                            } else {
                                let downloaded = max(0, status.expectedCount - status.missingSeqs.count)
                                state = .partial(downloaded: downloaded, total: status.expectedCount)
                            }
                        }
                    }
                }

                displays.append(DriveItemDisplay(
                    id: drive.driveId,
                    driveId: drive.driveId,
                    title: drive.label,
                    subtitle: drive.startName != nil && drive.endName != nil ? "\(drive.startName!) to \(drive.endName!)" : "\(drive.clipCount) clips",
                    regionId: drive.region?.id,
                    createdAt: drive.createdAt.description,
                    stopCount: drive.clipCount,
                    estMinutes: minutes,
                    downloadState: state
                ))
            }

            try Task.checkCancellation()
            guard acceptsResponse(generation: generation) else { return }
            self.rawSummaries = driveList.drives.filter { !deletedDuringLoad.contains($0.driveId) }
            self.drives = displays.filter { !deletedDuringLoad.contains($0.driveId) }
            self.credits = driveList.credits
            self.isOfflineFallback = false
            self.errorMessage = nil
            reconcileRegionFilter()
        } catch {
            // A disappearing screen is not a network failure. In particular, never replace a
            // coherent online snapshot with offline rows because its refresh was cancelled.
            guard !Task.isCancelled, !(error is CancellationError),
                  (error as? URLError)?.code != .cancelled else { return }
            guard acceptsResponse(generation: generation) else { return }
            let message = userMessage(for: error, fallback: "Could not load drives. Please check your connection.")
            // Offline fallback: load from local storage only items verified for this account
            if let storage {
                let localDrives = await storage.listDownloadedDrives()
                var verifiedDisplays: [DriveItemDisplay] = []
                for item in localDrives {
                    if await session.canAccessLocalDrive(item.driveId) {
                        let status = await storage.offlineStatus(driveId: item.driveId)
                        let state: LibraryDownloadState
                        if let status, status.downloaded {
                            if status.isComplete {
                                state = .complete
                            } else {
                                let downloaded = max(0, status.expectedCount - status.missingSeqs.count)
                                state = .partial(downloaded: downloaded, total: status.expectedCount)
                            }
                        } else {
                            state = .notDownloaded
                        }

                        verifiedDisplays.append(DriveItemDisplay(
                            id: item.driveId,
                            driveId: item.driveId,
                            title: item.label,
                            subtitle: "\(item.clipCount) stops · Saved offline",
                            regionId: nil,
                            createdAt: item.savedAt,
                            stopCount: item.clipCount,
                            estMinutes: item.durationSeconds.map { $0 / 60 },
                            downloadState: state
                        ))
                    }
                }

                guard !Task.isCancelled, acceptsResponse(generation: generation) else { return }
                verifiedDisplays.removeAll { deletedDuringLoad.contains($0.driveId) }
                // Confirmed offline + an empty verified local list is a valid offline state,
                // not evidence that the rider's cloud library is empty.
                if !verifiedDisplays.isEmpty || error is OfflineError {
                    self.rawSummaries = []
                    self.credits = nil
                    self.drives = verifiedDisplays
                    self.isOfflineFallback = true
                    reconcileRegionFilter()
                }
            }
            guard !Task.isCancelled, acceptsResponse(generation: generation) else { return }
            // With no usable local replacement, keep rows, facets, and selection together.
            // A confirmed offline fallback already explains its state in the banner/list.
            // Other failures still need their guidance, even when saved rows are available.
            self.errorMessage = error is OfflineError && isOfflineFallback ? nil : message
        }
    }
}
