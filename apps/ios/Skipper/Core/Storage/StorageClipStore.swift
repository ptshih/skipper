import Foundation

/// Filesystem primitives and management for the subject-keyed clip store and drive directories.
/// Mirrors apps/mobile/src/lib/clip-store.ts.
public final class StorageClipStore: Sendable {
    public let rootURL: URL
    private var fileManager: FileManager { FileManager.default }

    public var clipsDirectory: URL {
        rootURL.appendingPathComponent("clips", isDirectory: true)
    }

    public var drivesDirectory: URL {
        rootURL.appendingPathComponent("drives", isDirectory: true)
    }

    public init(rootURL: URL? = nil) {
        if let rootURL {
            self.rootURL = rootURL
        } else {
            let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
            self.rootURL = docs
        }
    }

    // MARK: - Directory Management

    public func driveDirectory(driveId: String) -> URL {
        drivesDirectory.appendingPathComponent(driveId, isDirectory: true)
    }

    public func manifestURL(driveId: String) -> URL {
        driveDirectory(driveId: driveId).appendingPathComponent("manifest.json")
    }

    @discardableResult
    public func ensureClipStoreDir() -> Bool {
        let dir = clipsDirectory
        if !fileManager.fileExists(atPath: dir.path) {
            do {
                try fileManager.createDirectory(at: dir, withIntermediateDirectories: true)
                return true
            } catch {
                return false
            }
        }
        return true
    }

    @discardableResult
    public func ensureDriveDir(driveId: String) -> Bool {
        guard StorageUtils.isSafeLocalName(driveId) else { return false }
        let dir = driveDirectory(driveId: driveId)
        if !fileManager.fileExists(atPath: dir.path) {
            do {
                try fileManager.createDirectory(at: dir, withIntermediateDirectories: true)
                return true
            } catch {
                return false
            }
        }
        return true
    }

    public var stagingDirectory: URL {
        rootURL.appendingPathComponent(".staging", isDirectory: true)
    }

    public func stagingURL(transferId: UUID, name: String) -> URL {
        stagingDirectory.appendingPathComponent("\(transferId.uuidString)-\(name)")
    }

    public func promoteStagedClip(from stagingURL: URL, to destURL: URL) throws {
        guard fileManager.fileExists(atPath: stagingURL.path) else { return }
        let parentDir = destURL.deletingLastPathComponent()
        if !fileManager.fileExists(atPath: parentDir.path) {
            try fileManager.createDirectory(at: parentDir, withIntermediateDirectories: true)
        }
        if let existingAttrs = try? fileManager.attributesOfItem(atPath: destURL.path),
           let existingSize = existingAttrs[.size] as? Int64, existingSize > 0,
           (existingAttrs[.type] as? FileAttributeType) == .typeRegular {
            try? fileManager.removeItem(at: stagingURL)
            return
        }
        do {
            try fileManager.moveItem(at: stagingURL, to: destURL)
        } catch {
            if let existingAttrs = try? fileManager.attributesOfItem(atPath: destURL.path),
               let existingSize = existingAttrs[.size] as? Int64, existingSize > 0,
               (existingAttrs[.type] as? FileAttributeType) == .typeRegular {
                try? fileManager.removeItem(at: stagingURL)
                return
            }
            try? fileManager.removeItem(at: stagingURL)
            throw error
        }
    }

    public func cleanStaging() {
        if fileManager.fileExists(atPath: stagingDirectory.path) {
            try? fileManager.removeItem(at: stagingDirectory)
        }
    }

    // MARK: - File Inspection & Resolution

    /// Exists && size > 0 && !isDirectory, never throwing.
    public func hasBytes(at url: URL) -> Bool {
        do {
            let attrs = try fileManager.attributesOfItem(atPath: url.path)
            guard (attrs[.type] as? FileAttributeType) == .typeRegular else {
                return false
            }
            let size = attrs[.size] as? Int64 ?? 0
            return size > 0
        } catch {
            return false
        }
    }

    /// Is this store filename present and non-empty?
    public func hasStoredClip(name: String) -> Bool {
        guard StorageUtils.isSafeLocalName(name) else { return false }
        let fileURL = clipsDirectory.appendingPathComponent(name)
        return hasBytes(at: fileURL)
    }

    /// Resolves local file URL for a stored clip. Throws if name is unsafe.
    public func storedClipURL(name: String) throws -> URL {
        guard StorageUtils.isSafeLocalName(name) else {
            throw StorageError.unsafePath(name: name)
        }
        return clipsDirectory.appendingPathComponent(name)
    }

    public func deleteQuietly(at url: URL) {
        if fileManager.fileExists(atPath: url.path) {
            try? fileManager.removeItem(at: url)
        }
    }

    // MARK: - Safe V4 Migration Moves

    /// Moves one clip's bytes from a drive dir into the shared store.
    /// Collision is resolved by deleting the source. Never the destination.
    public func placeOne(driveDir: URL, fromName: String, toName: String) -> Bool {
        ensureClipStoreDir()
        let src = driveDir.appendingPathComponent(fromName)
        let dest = clipsDirectory.appendingPathComponent(toName)

        if !hasStoredClip(name: toName) {
            if hasBytes(at: src) {
                try? fileManager.moveItem(at: src, to: dest)
            }
        }

        let landed = hasStoredClip(name: toName)
        if landed {
            deleteQuietly(at: src)
        }
        return landed
    }

    /// Carries one drive's saved download from manifest v4 to v5, moving its bytes into the shared store on the way.
    public func migrateDriveV4(driveId: String, raw: [String: Any]) -> [String: Any]? {
        var placed = Set<String>()
        if StorageUtils.isSafeLocalName(driveId) {
            let dir = driveDirectory(driveId: driveId)
            let steps = StorageUtils.planV4Rekey(raw: raw)
            for step in steps {
                guard let toName = step.toName else { continue }
                guard StorageUtils.isSafeLocalName(step.fromName) else { continue }
                if placeOne(driveDir: dir, fromName: step.fromName, toName: toName) {
                    placed.insert(toName)
                }
            }
        }
        return StorageUtils.migrateV4ToV5(raw: raw, placed: placed)
    }

    // MARK: - Sweep & Purge

    public struct StoreSweepInput: @unchecked Sendable {
        public let driveIds: [String]
        public let readManifest: (@Sendable (String) -> [String: Any]?)?
        public let downloadsInFlight: Bool
        public let busy: Set<String>
        public let hasManifest: (@Sendable (String) -> Bool)?
        public let manifests: [[String: Any]]?

        public init(
            driveIds: [String],
            readManifest: (@Sendable (String) -> [String: Any]?)? = nil,
            downloadsInFlight: Bool,
            busy: Set<String> = [],
            hasManifest: (@Sendable (String) -> Bool)? = nil,
            manifests: [[String: Any]]? = nil
        ) {
            self.driveIds = driveIds
            self.readManifest = readManifest
            self.downloadsInFlight = downloadsInFlight
            self.busy = busy
            self.hasManifest = hasManifest
            self.manifests = manifests
        }
    }

    /// Deletes store files no drive manifest accounts for. Fail-closed.
    public func sweepOrphanClips(input: StoreSweepInput) -> Int {
        if input.downloadsInFlight {
            return 0
        }

        var manifests = input.manifests ?? [[String: Any]]()
        if input.manifests == nil {
            for driveId in input.driveIds {
                let m = input.readManifest?(driveId)
                if m == nil {
                    if let check = input.hasManifest, !check(driveId) {
                        // No index at all: skipped safely
                        continue
                    }
                    // Manifest exists but unreadable/corrupted/unsupported -> fail closed
                    return 0
                }
                manifests.append(m!)
            }
        }

        let keep = StorageUtils.storeKeepSet(manifests: manifests)
        if keep.isEmpty {
            return 0
        }

        guard fileManager.fileExists(atPath: clipsDirectory.path) else {
            return 0
        }

        let onDisk: [String]
        do {
            onDisk = try fileManager.contentsOfDirectory(atPath: clipsDirectory.path)
        } catch {
            return 0
        }

        let orphans = StorageUtils.orphanStoreNames(onDisk: onDisk, keep: keep, busy: input.busy)
        var reclaimed = 0
        for name in orphans {
            let fileURL = clipsDirectory.appendingPathComponent(name)
            if fileManager.fileExists(atPath: fileURL.path) {
                do {
                    try fileManager.removeItem(at: fileURL)
                    reclaimed += 1
                } catch {
                    // Best-effort
                }
            }
        }
        return reclaimed
    }

    /// Unconditionally deletes the entire shared clips directory. For account deletion/signout purge only.
    public func deleteAllStoredClips() -> Int {
        guard fileManager.fileExists(atPath: clipsDirectory.path) else {
            return 0
        }
        let count: Int
        do {
            let items = try fileManager.contentsOfDirectory(atPath: clipsDirectory.path)
            count = items.count
        } catch {
            count = 0
        }
        try? fileManager.removeItem(at: clipsDirectory)
        return count
    }
}
