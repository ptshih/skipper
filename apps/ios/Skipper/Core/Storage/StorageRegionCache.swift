import Foundation

/// Caches the last good GET /regions response to disk so offline and outage states can
/// name real places instead of only apologizing.
/// Mirrors apps/mobile/src/lib/region-cache.ts.
///
/// INV-13: Stores NO rider content — only regionId, displayName, and public exampleAnchors.
public final class StorageRegionCache: Sendable {
    public let cacheFileURL: URL
    private var fileManager: FileManager { FileManager.default }

    public init(rootURL: URL? = nil) {
        if let rootURL {
            self.cacheFileURL = rootURL.appendingPathComponent("region-cache.json")
        } else {
            let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
            self.cacheFileURL = docs.appendingPathComponent("region-cache.json")
        }
    }

    /// The last successfully-fetched region, or nil if never cached or corrupted. Never throws.
    public func readCachedRegion() -> StorageCachedRegion? {
        guard fileManager.fileExists(atPath: cacheFileURL.path) else {
            return nil
        }
        do {
            let data = try Data(contentsOf: cacheFileURL)
            let decoder = JSONDecoder()
            return try decoder.decode(StorageCachedRegion.self, from: data)
        } catch {
            return nil
        }
    }

    /// Atomically persists the cached region to disk. Best effort, never throws.
    public func writeCachedRegion(_ region: StorageCachedRegion) {
        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            let data = try encoder.encode(region)
            try data.write(to: cacheFileURL, options: .atomic)
        } catch {
            // Best effort write
        }
    }
}
