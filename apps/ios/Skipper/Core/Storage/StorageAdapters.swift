import Foundation

// MARK: - Generalist DTO Adapters

extension StorageCachedRegion {
    /// Adapter for creating a StorageCachedRegion from Generalist's Region model.
    static func from(region: Region, rotation: Int = 0) -> StorageCachedRegion {
        StorageCachedRegion(
            regionId: region.id,
            displayName: region.displayName,
            exampleAnchors: region.exampleAnchors,
            rotation: rotation
        )
    }
}

// MARK: - Raw JSON Data Adapters

public extension StorageOfflineManifest {
    /// Decodes a StorageOfflineManifest directly from raw UTF-8 JSON data.
    static func from(jsonData: Data) throws -> StorageOfflineManifest {
        let decoder = JSONDecoder()
        return try decoder.decode(StorageOfflineManifest.self, from: jsonData)
    }

    /// Serializes to formatted JSON data.
    func toData() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try encoder.encode(self)
    }
}

public extension StorageSavedDriveDetail {
    /// Decodes a StorageSavedDriveDetail directly from raw UTF-8 JSON data.
    static func from(jsonData: Data) throws -> StorageSavedDriveDetail {
        let decoder = JSONDecoder()
        return try decoder.decode(StorageSavedDriveDetail.self, from: jsonData)
    }

    /// Serializes to formatted JSON data.
    func toData() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try encoder.encode(self)
    }
}
