import Foundation

// MARK: - Core Enums & Identifiers

/// Subject kinds matching Narration Subject (INV-16): poi or cluster.
public enum StorageSubjectKind: String, Codable, Sendable, CaseIterable {
    case poi
    case cluster
}

/// Identifies one narration subject's audio in the shared clip store.
public struct StorageStoreKey: Equatable, Hashable, Sendable {
    public let subjectId: String
    public let subjectKind: StorageSubjectKind
    /// Milliseconds epoch string or "0" if unknown.
    public let rev: String

    public init(subjectId: String, subjectKind: StorageSubjectKind, rev: String) {
        self.subjectId = subjectId
        self.subjectKind = subjectKind
        self.rev = rev
    }
}

/// Reference to a stored clip file in a v5 manifest.
public struct StorageStoredClipRef: Codable, Equatable, Sendable {
    public let name: String
    public let contentType: String
    public let durationMs: Int?
    public let shared: Bool

    public enum CodingKeys: String, CodingKey {
        case name
        case contentType
        case durationMs
        case shared
    }

    public init(name: String, contentType: String, durationMs: Int?, shared: Bool = false) {
        self.name = name
        self.contentType = contentType
        self.durationMs = durationMs
        self.shared = shared
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        name = try container.decode(String.self, forKey: .name)
        contentType = try container.decode(String.self, forKey: .contentType)
        durationMs = try container.decodeIfPresent(Int.self, forKey: .durationMs)
        shared = (try? container.decode(Bool.self, forKey: .shared)) ?? false
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(name, forKey: .name)
        try container.encode(contentType, forKey: .contentType)
        try container.encodeIfPresent(durationMs, forKey: .durationMs)
        try container.encode(shared, forKey: .shared)
    }
}

// MARK: - Drive Detail & Clip Models

/// Frozen attribution snapshot.
public struct StorageAttribution: Codable, Equatable, Sendable {
    public let source: String?
    public let sourceId: String?
    public let title: String?
    public let url: String?
    public let license: String?
    public let retrievedAt: String?

    public init(
        source: String? = nil,
        sourceId: String? = nil,
        title: String? = nil,
        url: String? = nil,
        license: String? = nil,
        retrievedAt: String? = nil
    ) {
        self.source = source
        self.sourceId = sourceId
        self.title = title
        self.url = url
        self.license = license
        self.retrievedAt = retrievedAt
    }
}

/// One clip inside a drive detail.
public struct StorageSavedDriveClip: Codable, Equatable, Sendable {
    public let seq: Int
    public let form: String
    public let alongSec: Double
    public let poiId: String?
    public let subjectId: String?
    public let subjectKind: StorageSubjectKind?
    public let name: String?
    public let lat: Double?
    public let lng: Double?
    public let triggerRadiusM: Int?
    public let approachHeadingDeg: Int?
    public let durationMs: Int?
    public let contentType: String?
    public let attribution: [StorageAttribution]?
    public let revisedAt: String?
    public let url: String?

    public init(
        seq: Int,
        form: String = "story",
        alongSec: Double,
        poiId: String? = nil,
        subjectId: String? = nil,
        subjectKind: StorageSubjectKind? = nil,
        name: String? = nil,
        lat: Double? = nil,
        lng: Double? = nil,
        triggerRadiusM: Int? = nil,
        approachHeadingDeg: Int? = nil,
        durationMs: Int? = nil,
        contentType: String? = nil,
        attribution: [StorageAttribution]? = nil,
        revisedAt: String? = nil,
        url: String? = nil
    ) {
        self.seq = seq
        self.form = form
        self.alongSec = alongSec
        self.poiId = poiId
        self.subjectId = subjectId
        self.subjectKind = subjectKind
        self.name = name
        self.lat = lat
        self.lng = lng
        self.triggerRadiusM = triggerRadiusM
        self.approachHeadingDeg = approachHeadingDeg
        self.durationMs = durationMs
        self.contentType = contentType
        self.attribution = attribution
        self.revisedAt = revisedAt
        self.url = url
    }

    public enum CodingKeys: String, CodingKey {
        case seq
        case form
        case alongSec
        case poiId
        case subjectId
        case subjectKind
        case name
        case lat
        case lng
        case triggerRadiusM
        case approachHeadingDeg
        case durationMs
        case contentType
        case attribution
        case revisedAt
        case url
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        seq = try container.decode(Int.self, forKey: .seq)
        form = (try? container.decode(String.self, forKey: .form)) ?? "story"
        alongSec = try container.decode(Double.self, forKey: .alongSec)
        poiId = try container.decodeIfPresent(String.self, forKey: .poiId)
        subjectId = try container.decodeIfPresent(String.self, forKey: .subjectId)
        subjectKind = try container.decodeIfPresent(StorageSubjectKind.self, forKey: .subjectKind)
        name = try container.decodeIfPresent(String.self, forKey: .name)
        lat = try container.decodeIfPresent(Double.self, forKey: .lat)
        lng = try container.decodeIfPresent(Double.self, forKey: .lng)
        triggerRadiusM = try container.decodeIfPresent(Int.self, forKey: .triggerRadiusM)
        approachHeadingDeg = try container.decodeIfPresent(Int.self, forKey: .approachHeadingDeg)
        durationMs = try container.decodeIfPresent(Int.self, forKey: .durationMs)
        contentType = try container.decodeIfPresent(String.self, forKey: .contentType)
        attribution = try? container.decodeIfPresent([StorageAttribution].self, forKey: .attribution)
        revisedAt = try container.decodeIfPresent(String.self, forKey: .revisedAt)
        url = try container.decodeIfPresent(String.self, forKey: .url)
    }
}

/// The saved drive manifest representation stored in manifest.json.
public struct StorageSavedDriveDetail: Codable, Equatable, Sendable {
    public let driveId: String?
    public let label: String
    public let polyline: [[Double]]
    public let distanceMeters: Int?
    public let durationSeconds: Int?
    public let clips: [StorageSavedDriveClip]

    public init(
        driveId: String?,
        label: String,
        polyline: [[Double]],
        distanceMeters: Int? = nil,
        durationSeconds: Int? = nil,
        clips: [StorageSavedDriveClip]
    ) {
        self.driveId = driveId
        self.label = label
        self.polyline = polyline
        self.distanceMeters = distanceMeters
        self.durationSeconds = durationSeconds
        self.clips = clips
    }

    /// Returns a copy of detail with all clip presigned URLs stripped.
    public func strippingURLs() -> StorageSavedDriveDetail {
        let strippedClips = clips.map { clip in
            StorageSavedDriveClip(
                seq: clip.seq,
                form: clip.form,
                alongSec: clip.alongSec,
                poiId: clip.poiId,
                subjectId: clip.subjectId,
                subjectKind: clip.subjectKind,
                name: clip.name,
                lat: clip.lat,
                lng: clip.lng,
                triggerRadiusM: clip.triggerRadiusM,
                approachHeadingDeg: clip.approachHeadingDeg,
                durationMs: clip.durationMs,
                contentType: clip.contentType,
                attribution: clip.attribution,
                revisedAt: clip.revisedAt,
                url: nil
            )
        }
        return StorageSavedDriveDetail(
            driveId: driveId,
            label: label,
            polyline: polyline,
            distanceMeters: distanceMeters,
            durationSeconds: durationSeconds,
            clips: strippedClips
        )
    }
}

/// Top-level v5 manifest stored in Documents/drives/<driveId>/manifest.json.
public struct StorageOfflineManifest: Codable, Equatable, Sendable {
    public let driveId: String
    public let version: Int
    public let savedAt: String
    public let detail: StorageSavedDriveDetail
    public let audioSeqs: [Int]
    public let clips: [String: StorageStoredClipRef]

    public init(
        driveId: String,
        version: Int = 5,
        savedAt: String,
        detail: StorageSavedDriveDetail,
        audioSeqs: [Int],
        clips: [String: StorageStoredClipRef]
    ) {
        self.driveId = driveId
        self.version = version
        self.savedAt = savedAt
        self.detail = detail
        self.audioSeqs = audioSeqs
        self.clips = clips
    }
}

// MARK: - Operational & State Types

/// The gate decision that determines if a rider can start playback.
public enum StorageDriveGate: String, Equatable, Sendable {
    case play
    case needsDownload = "needs-download"
    case nothingSaved = "nothing-saved"
}

/// Offline status of a drive.
public struct StorageOfflineStatus: Equatable, Sendable {
    /// True when a playable copy exists on disk (at least one clip present).
    /// Matches shipped TS offline.ts:1088-1090 where a partial download plays what it has.
    public let downloaded: Bool
    /// Expected-but-missing clip seqs — empty means a complete download.
    public let missingSeqs: [Int]
    /// Total clips this drive should have audio for.
    public let expectedCount: Int

    /// True when all expected audio clips are present on disk.
    public var isComplete: Bool {
        missingSeqs.isEmpty && expectedCount > 0
    }

    public init(downloaded: Bool, missingSeqs: [Int], expectedCount: Int) {
        self.downloaded = downloaded
        self.missingSeqs = missingSeqs
        self.expectedCount = expectedCount
    }
}

/// Download progress for an active download.
public struct StorageDownloadProgress: Equatable, Sendable {
    public let done: Int
    public let total: Int

    public init(done: Int, total: Int) {
        self.done = done
        self.total = total
    }
}

/// Outcome of a download operation.
public struct StorageDownloadResult: Sendable {
    public let manifest: StorageOfflineManifest?
    public let downloaded: Int
    public let total: Int
    public let failedSeqs: [Int]

    public init(
        manifest: StorageOfflineManifest?,
        downloaded: Int,
        total: Int,
        failedSeqs: [Int]
    ) {
        self.manifest = manifest
        self.downloaded = downloaded
        self.total = total
        self.failedSeqs = failedSeqs
    }
}

/// State of an in-flight or recently canceled download.
public struct StorageActiveDownload: Sendable {
    public let id: UUID
    public let progress: StorageDownloadProgress
    public let isCanceled: Bool

    public init(id: UUID = UUID(), progress: StorageDownloadProgress, isCanceled: Bool) {
        self.id = id
        self.progress = progress
        self.isCanceled = isCanceled
    }
}

/// On-disk directory state for a drive.
public enum StorageDownloadDirState: String, Equatable, Sendable {
    case none
    case unreadable
    case ok
}

/// Snapshot of drive offline state for UI.
public struct StorageOfflineSnapshot: Equatable, Sendable {
    public let status: StorageOfflineStatus?
    public let isExpired: Bool
    public let dirState: StorageDownloadDirState

    public init(
        status: StorageOfflineStatus?,
        isExpired: Bool,
        dirState: StorageDownloadDirState
    ) {
        self.status = status
        self.isExpired = isExpired
        self.dirState = dirState
    }
}

/// Resolved local playback package for the player.
public struct StoragePlayback: Sendable {
    public let detail: StorageSavedDriveDetail
    public let urls: [Int: URL]
    public let expectedSeqs: [Int]

    public init(
        detail: StorageSavedDriveDetail,
        urls: [Int: URL],
        expectedSeqs: [Int]
    ) {
        self.detail = detail
        self.urls = urls
        self.expectedSeqs = expectedSeqs
    }
}

/// Summary item in the downloaded drives listing.
public struct StorageDriveSummary: Equatable, Sendable {
    public let driveId: String
    public let label: String
    public let distanceMeters: Int?
    public let durationSeconds: Int?
    public let clipCount: Int
    public let savedAt: String

    public init(
        driveId: String,
        label: String,
        distanceMeters: Int?,
        durationSeconds: Int?,
        clipCount: Int,
        savedAt: String
    ) {
        self.driveId = driveId
        self.label = label
        self.distanceMeters = distanceMeters
        self.durationSeconds = durationSeconds
        self.clipCount = clipCount
        self.savedAt = savedAt
    }
}

/// Cached GET /regions result (INV-13 compliant, no rider content).
public struct StorageCachedRegion: Codable, Equatable, Sendable {
    public let regionId: String
    public let displayName: String
    public let exampleAnchors: [String]
    public let rotation: Int

    public init(
        regionId: String,
        displayName: String,
        exampleAnchors: [String] = [],
        rotation: Int = 0
    ) {
        self.regionId = regionId
        self.displayName = displayName
        self.exampleAnchors = exampleAnchors
        self.rotation = rotation
    }

    public enum CodingKeys: String, CodingKey {
        case regionId
        case displayName
        case exampleAnchors
        case rotation
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        regionId = try container.decode(String.self, forKey: .regionId)
        displayName = try container.decode(String.self, forKey: .displayName)
        exampleAnchors = (try? container.decode([String].self, forKey: .exampleAnchors)) ?? []
        rotation = max(0, (try? container.decode(Int.self, forKey: .rotation)) ?? 0)
    }
}

/// Re-key step planned for v4 -> v5 migration.
public struct StorageV4RekeyStep: Equatable, Sendable {
    public let seq: Int
    public let fromName: String
    public let toName: String?
    public let contentType: String
    public let durationMs: Int?

    public init(
        seq: Int,
        fromName: String,
        toName: String?,
        contentType: String,
        durationMs: Int?
    ) {
        self.seq = seq
        self.fromName = fromName
        self.toName = toName
        self.contentType = contentType
        self.durationMs = durationMs
    }
}

// MARK: - Errors

public enum StorageError: Error, LocalizedError, Sendable {
    case insufficientStorage(message: String)
    case downloadCanceled
    case downloadFailed(name: String, underlying: String)
    case unreadableManifest(driveId: String)
    case unsafePath(name: String)
    case unsafeSubjectKey
    case corruptedClipTable
    case noPlayableAudio(driveId: String)
    case invalidManifestVersion(Int)

    public var errorDescription: String? {
        switch self {
        case .insufficientStorage(let msg):
            return msg
        case .downloadCanceled:
            return "Download canceled."
        case .downloadFailed(let name, let underlying):
            return "Download failed for \(name): \(underlying)"
        case .unreadableManifest(let driveId):
            return "Manifest for drive \(driveId) is unreadable or corrupted."
        case .unsafePath(let name):
            return "Refusing to address unsafe path: \(name)"
        case .unsafeSubjectKey:
            return "Refusing to build filename from unsafe subject key."
        case .corruptedClipTable:
            return "Clips table is corrupted or missing."
        case .noPlayableAudio(let driveId):
            return "No playable audio available for drive \(driveId)."
        case .invalidManifestVersion(let v):
            return "Unsupported manifest version: \(v)"
        }
    }
}
