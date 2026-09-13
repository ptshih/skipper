import XCTest
@testable import Skipper

final class StorageUtilsTests: XCTestCase {

    // MARK: - Extension Mapping

    func testExtForContentType() {
        XCTAssertEqual(StorageUtils.extForContentType("audio/mpeg"), "mp3")
        XCTAssertEqual(StorageUtils.extForContentType("audio/mp3"), "mp3")
        XCTAssertEqual(StorageUtils.extForContentType("audio/wav"), "wav")
        XCTAssertEqual(StorageUtils.extForContentType("audio/x-wav"), "wav")
        XCTAssertEqual(StorageUtils.extForContentType("audio/aac"), "aac")
        XCTAssertEqual(StorageUtils.extForContentType("audio/mp4"), "m4a")
        XCTAssertEqual(StorageUtils.extForContentType("audio/x-m4a"), "m4a")
        XCTAssertEqual(StorageUtils.extForContentType("audio/ogg"), "ogg")
        XCTAssertEqual(StorageUtils.extForContentType("application/ogg"), "ogg")
        XCTAssertEqual(StorageUtils.extForContentType("AUDIO/MPEG"), "mp3")
        XCTAssertEqual(StorageUtils.extForContentType("application/octet-stream"), "mp3")
        XCTAssertEqual(StorageUtils.extForContentType(nil), "mp3")
    }

    // MARK: - Safe Local Names & Subject IDs

    func testIsSafeSubjectId() {
        XCTAssertTrue(StorageUtils.isSafeSubjectId("00000004-0000-4000-8000-000000000001"))
        XCTAssertTrue(StorageUtils.isSafeSubjectId("c80a068a-6b80-4ce0-a29d-47be0a775a22"))
        XCTAssertFalse(StorageUtils.isSafeSubjectId("../evil"))
        XCTAssertFalse(StorageUtils.isSafeSubjectId("not-a-uuid"))
        XCTAssertFalse(StorageUtils.isSafeSubjectId(""))
        XCTAssertFalse(StorageUtils.isSafeSubjectId(nil))
    }

    func testIsSafeLocalName() {
        XCTAssertTrue(StorageUtils.isSafeLocalName("0.m4a"))
        XCTAssertTrue(StorageUtils.isSafeLocalName("poi-123.100.m4a"))
        XCTAssertFalse(StorageUtils.isSafeLocalName("../outside.m4a"))
        XCTAssertFalse(StorageUtils.isSafeLocalName("/etc/passwd"))
        XCTAssertFalse(StorageUtils.isSafeLocalName("sub/dir.m4a"))
        XCTAssertFalse(StorageUtils.isSafeLocalName("sub\\dir.m4a"))
        XCTAssertFalse(StorageUtils.isSafeLocalName("."))
        XCTAssertFalse(StorageUtils.isSafeLocalName(".."))
        XCTAssertFalse(StorageUtils.isSafeLocalName(""))
        XCTAssertFalse(StorageUtils.isSafeLocalName(nil))
    }

    // MARK: - Revision Token & Filename Builders

    func testRevisionToken() {
        XCTAssertEqual(StorageUtils.revisionToken("2026-09-12T12:00:00.000Z"), "1789214400000")
        XCTAssertEqual(StorageUtils.revisionToken("2026-09-12T10:00:00.123Z"), "1789207200123")
        XCTAssertEqual(StorageUtils.revisionToken("2026-09-12T10:00:00.123456Z"), "1789207200123")
        XCTAssertEqual(StorageUtils.revisionToken("2026-09-12T10:00:00.12Z"), "1789207200120")
        XCTAssertEqual(StorageUtils.revisionToken("2026-09-12T10:00:00.1Z"), "1789207200100")
        XCTAssertEqual(StorageUtils.revisionToken("2026-09-12T10:00:00.9999Z"), "1789207200999")
        XCTAssertEqual(StorageUtils.revisionToken("1969-01-01T00:00:00.000Z"), StorageUtils.unknownRev)
        XCTAssertEqual(StorageUtils.revisionToken("invalid-date"), StorageUtils.unknownRev)
        XCTAssertEqual(StorageUtils.revisionToken(nil), StorageUtils.unknownRev)
        XCTAssertEqual(StorageUtils.revisionToken(""), StorageUtils.unknownRev)
    }

    func testStoreFileNameAndParse() throws {
        let key = StorageStoreKey(
            subjectId: "00000004-0000-4000-8000-000000000001",
            subjectKind: .poi,
            rev: "1789214400000"
        )
        let name = try StorageUtils.storeFileName(key: key, contentType: "audio/mp4")
        XCTAssertEqual(name, "poi-00000004-0000-4000-8000-000000000001.1789214400000.m4a")

        let parsed = StorageUtils.parseStoreFileName(name)
        XCTAssertEqual(parsed, key)

        // Refuses unsafe subject id
        let unsafeKey = StorageStoreKey(subjectId: "../evil", subjectKind: .poi, rev: "100")
        XCTAssertThrowsError(try StorageUtils.storeFileName(key: unsafeKey, contentType: "audio/mp4"))

        // Unparseable filename returns nil
        XCTAssertNil(StorageUtils.parseStoreFileName("random-file.bin"))
        XCTAssertNil(StorageUtils.parseStoreFileName("future-format.bin"))
        XCTAssertNil(StorageUtils.parseStoreFileName("poi-invalid.rev.m4a"))
    }

    func testStoreKeyForClip() {
        // Safe subjectId + kind
        let k1 = StorageUtils.storeKeyForClip(
            poiId: nil,
            subjectId: "00000004-0000-4000-8000-000000000001",
            subjectKind: "cluster",
            revisedAt: "2026-09-12T12:00:00.000Z"
        )
        XCTAssertEqual(k1?.subjectKind, .cluster)
        XCTAssertEqual(k1?.subjectId, "00000004-0000-4000-8000-000000000001")

        // Safe poiId fallback when no subjectId
        let k2 = StorageUtils.storeKeyForClip(
            poiId: "00000004-0000-4000-8000-000000000002",
            subjectId: nil,
            subjectKind: nil,
            revisedAt: "2026-09-12T12:00:00.000Z"
        )
        XCTAssertEqual(k2?.subjectKind, .poi)
        XCTAssertEqual(k2?.subjectId, "00000004-0000-4000-8000-000000000002")

        // Unsafe subjectId never falls back to poiId
        let k3 = StorageUtils.storeKeyForClip(
            poiId: "00000004-0000-4000-8000-000000000002",
            subjectId: "../evil",
            subjectKind: nil,
            revisedAt: nil
        )
        XCTAssertNil(k3)

        // Fused clip with no subjectId returns nil
        let k4 = StorageUtils.storeKeyForClip(
            poiId: nil,
            subjectId: nil,
            subjectKind: "cluster",
            revisedAt: nil
        )
        XCTAssertNil(k4)
    }

    // MARK: - Drive Gate & Freshness

    func testDecideDriveGate() {
        // Complete download plays online or offline
        XCTAssertEqual(StorageUtils.decideDriveGate(online: true, hasAnyLocal: true, missingCount: 0), .play)
        XCTAssertEqual(StorageUtils.decideDriveGate(online: false, hasAnyLocal: true, missingCount: 0), .play)

        // Partial download: online needs-download, offline plays (escape hatch)
        XCTAssertEqual(StorageUtils.decideDriveGate(online: true, hasAnyLocal: true, missingCount: 1), .needsDownload)
        XCTAssertEqual(StorageUtils.decideDriveGate(online: false, hasAnyLocal: true, missingCount: 1), .play)

        // Nothing saved: online needs-download, offline nothing-saved
        XCTAssertEqual(StorageUtils.decideDriveGate(online: true, hasAnyLocal: false, missingCount: 0), .needsDownload)
        XCTAssertEqual(StorageUtils.decideDriveGate(online: false, hasAnyLocal: false, missingCount: 0), .nothingSaved)
    }

    func testTtlAndAge() {
        let now = Date(timeIntervalSince1970: 1789214400) // 2026-09-12T12:00:00Z
        let thirtyOneDaysAgo = Date(timeIntervalSince1970: 1789214400 - 31 * 86400)
        let twentyNineDaysAgo = Date(timeIntervalSince1970: 1789214400 - 29 * 86400)

        let fmt = ISO8601DateFormatter()
        let iso31 = fmt.string(from: thirtyOneDaysAgo)
        let iso29 = fmt.string(from: twentyNineDaysAgo)

        XCTAssertTrue(StorageUtils.isPastTtl(iso31, now: now, ttlDays: 30))
        XCTAssertFalse(StorageUtils.isPastTtl(iso29, now: now, ttlDays: 30))
        XCTAssertFalse(StorageUtils.isPastTtl("invalid-date", now: now, ttlDays: 30))
    }

    // MARK: - Sweep Math

    func testDriveIdsToSweep() {
        let swept = StorageUtils.driveIdsToSweep(
            onDisk: ["a", "b", "c"],
            keep: ["a", "c"],
            busy: []
        )
        XCTAssertEqual(swept, ["b"])

        let busySwept = StorageUtils.driveIdsToSweep(
            onDisk: ["a", "b"],
            keep: [],
            busy: ["b"]
        )
        XCTAssertEqual(busySwept, ["a"])
    }

    func testOrphanStoreNames() {
        let keep: Set<String> = ["poi-00000004-0000-4000-8000-000000000001.1789214400000.m4a"]
        let onDisk = [
            "poi-00000004-0000-4000-8000-000000000001.1789214400000.m4a",
            "cluster-00000005-0000-4000-8000-000000000001.1789214400000.m4a",
            "future-format.bin"
        ]
        let orphans = StorageUtils.orphanStoreNames(onDisk: onDisk, keep: keep, busy: [])

        // Known orphan is returned, unknown file is preserved
        XCTAssertEqual(orphans, ["cluster-00000005-0000-4000-8000-000000000001.1789214400000.m4a"])
    }

    func testResolveClipRef() {
        let planned = StorageStoredClipRef(name: "new.m4a", contentType: "audio/mp4", durationMs: 1000, shared: true)
        let saved = StorageStoredClipRef(name: "old.m4a", contentType: "audio/mp4", durationMs: 1000, shared: true)

        let r1 = StorageUtils.resolveClipRef(planned: planned, plannedPresent: true, saved: saved, savedPresent: true)
        XCTAssertEqual(r1.ref?.name, "new.m4a")
        XCTAssertFalse(r1.missing)

        let r2 = StorageUtils.resolveClipRef(planned: planned, plannedPresent: false, saved: saved, savedPresent: true)
        XCTAssertEqual(r2.ref?.name, "old.m4a")
        XCTAssertTrue(r2.missing)

        let r3 = StorageUtils.resolveClipRef(planned: planned, plannedPresent: false, saved: saved, savedPresent: false)
        XCTAssertNil(r3.ref)
        XCTAssertTrue(r3.missing)
    }

    func testEstimateDownloadBytes() {
        let bytes = StorageUtils.estimateDownloadBytes(durationsMs: [1000, 2000, nil, 3000])
        // 6 seconds * 8000 bytes/sec = 48000 bytes
        XCTAssertEqual(bytes, 48000)
    }
}
