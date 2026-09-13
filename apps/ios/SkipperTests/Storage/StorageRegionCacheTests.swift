import XCTest
@testable import Skipper

final class StorageRegionCacheTests: XCTestCase {

    func testRegionCachePersistenceAndSafety() throws {
        let fm = FileManager.default
        let tempDir = fm.temporaryDirectory.appendingPathComponent("RegionCacheTest-\(UUID().uuidString)")
        try fm.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: tempDir) }

        let cache = StorageRegionCache(rootURL: tempDir)

        // 1. Initial empty state
        XCTAssertNil(cache.readCachedRegion())

        // 2. Write valid region
        let region = StorageCachedRegion(
            regionId: "marin",
            displayName: "Marin County",
            exampleAnchors: ["Point Reyes", "Mount Tamalpais"],
            rotation: 2
        )
        cache.writeCachedRegion(region)

        // 3. Read back and verify
        let cached = cache.readCachedRegion()
        XCTAssertNotNil(cached)
        XCTAssertEqual(cached?.regionId, "marin")
        XCTAssertEqual(cached?.displayName, "Marin County")
        XCTAssertEqual(cached?.exampleAnchors, ["Point Reyes", "Mount Tamalpais"])
        XCTAssertEqual(cached?.rotation, 2)

        // 4. Overwrite with corrupted JSON
        try Data("corrupted { json".utf8).write(to: cache.cacheFileURL)
        XCTAssertNil(cache.readCachedRegion(), "Corrupted cache file must degrade safely to nil")
    }
}
