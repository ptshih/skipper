import Foundation

enum DriveClipForm: String, Codable, Sendable { case story, scenic, `break` }
enum SubjectKind: String, Codable, Sendable { case poi, cluster }

struct Attribution: Codable, Sendable, Equatable {
    enum Source: String, Codable, Sendable { case wikipedia, wikidata, macrostrat, google_places }
    let source: Source
    let sourceId: String
    let title: String?
    let url: String?
    let license: String?
    let retrievedAt: String?
    enum CodingKeys: String, CodingKey { case source, sourceId, title, url, license, retrievedAt }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        source = try c.decode(Source.self, forKey: .source)
        sourceId = try c.decode(String.self, forKey: .sourceId)
        title = try c.optional(String.self, forKey: .title)
        url = c.contains(.url) ? try c.url(.url) : nil
        license = try c.optional(String.self, forKey: .license)
        retrievedAt = c.contains(.retrievedAt) ? try c.timestamp(.retrievedAt) : nil
    }
}

struct ResolvedEndpoint: Codable, Sendable, Equatable {
    let name: String
    let lat: Double
    let lng: Double
    enum CodingKeys: String, CodingKey { case name, lat, lng }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = try c.decode(String.self, forKey: .name)
        lat = try c.decode(Double.self, forKey: .lat)
        lng = try c.decode(Double.self, forKey: .lng)
        guard (1...200).contains(name.utf16.count), (-90...90).contains(lat), (-180...180).contains(lng) else { throw c.invalid(.name) }
    }
}

struct DrivePreviewClip: Codable, Sendable, Equatable {
    let name: String
    let url: String
    let contentType: String
    let durationMs: Int?
    let attribution: [Attribution]?
    enum CodingKeys: String, CodingKey { case name, url, contentType, durationMs, attribution }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = try c.decode(String.self, forKey: .name)
        url = try c.url(.url)!
        contentType = try c.decode(String.self, forKey: .contentType)
        durationMs = try c.integer(.durationMs, nullish: true)
        attribution = c.contains(.attribution) ? ((try? c.decode([Attribution].self, forKey: .attribution)) ?? []) : nil
    }
}

struct DriveProposal: Codable, Sendable, Equatable {
    let start: ResolvedEndpoint
    let end: ResolvedEndpoint
    let startId: String
    let endId: String
    let via: [String]?
    let viaResolved: [ResolvedEndpoint]?
    let polyline: [Coordinate]
    let distanceMeters: Int
    let durationSeconds: Int
    let routeSig: String
    let estStopCount: Int?
    let previewClip: DrivePreviewClip?
    enum CodingKeys: String, CodingKey { case start, end, startId, endId, via, viaResolved, polyline, distanceMeters, durationSeconds, routeSig, estStopCount, previewClip }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        start = try c.decode(ResolvedEndpoint.self, forKey: .start)
        end = try c.decode(ResolvedEndpoint.self, forKey: .end)
        startId = try c.uuid(.startId)!
        endId = try c.uuid(.endId)!
        via = try c.optional([String].self, forKey: .via)
        viaResolved = try c.optional([ResolvedEndpoint].self, forKey: .viaResolved)
        polyline = try c.decode([Coordinate].self, forKey: .polyline)
        distanceMeters = try c.integer(.distanceMeters)!
        durationSeconds = try c.integer(.durationSeconds)!
        routeSig = try c.decode(String.self, forKey: .routeSig)
        estStopCount = try c.integer(.estStopCount, nullish: true)
        previewClip = try c.decodeIfPresent(DrivePreviewClip.self, forKey: .previewClip)
        if let via { guard via.count <= 8, via.allSatisfy({ isWireUUID($0) }) else { throw c.invalid(.via) } }
        if let viaResolved, viaResolved.count > 8 { throw c.invalid(.viaResolved) }
    }
}

struct DriveClip: Codable, Sendable, Equatable {
    let seq: Int
    let form: DriveClipForm
    let poiId: String?
    let subjectId: String?
    let subjectKind: SubjectKind?
    let name: String?
    let lat: Double?
    let lng: Double?
    let triggerRadiusM: Int?
    let approachHeadingDeg: Int?
    let alongSec: Double
    let durationMs: Int?
    let url: String?
    let contentType: String?
    let attribution: [Attribution]?
    let revisedAt: String?
    enum CodingKeys: String, CodingKey { case seq, form, poiId, subjectId, subjectKind, name, lat, lng, triggerRadiusM, approachHeadingDeg, alongSec, durationMs, url, contentType, attribution, revisedAt }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        seq = try c.integer(.seq)!
        form = try c.decode(DriveClipForm.self, forKey: .form)
        poiId = try c.uuid(.poiId, nullish: true)
        subjectId = try c.uuid(.subjectId, nullish: true)
        subjectKind = try c.decodeIfPresent(SubjectKind.self, forKey: .subjectKind)
        name = try c.decodeIfPresent(String.self, forKey: .name)
        lat = try c.decodeIfPresent(Double.self, forKey: .lat)
        lng = try c.decodeIfPresent(Double.self, forKey: .lng)
        triggerRadiusM = try c.integer(.triggerRadiusM, nullish: true)
        approachHeadingDeg = try c.integer(.approachHeadingDeg, nullish: true)
        alongSec = try c.decode(Double.self, forKey: .alongSec)
        durationMs = try c.integer(.durationMs, nullish: true)
        url = try c.url(.url, nullish: true)
        contentType = try c.decodeIfPresent(String.self, forKey: .contentType)
        attribution = c.contains(.attribution) ? ((try? c.decode([Attribution].self, forKey: .attribution)) ?? []) : nil
        revisedAt = try c.timestamp(.revisedAt, nullish: true)
    }
}

struct DriveManifest: Codable, Sendable, Equatable {
    let driveId: String?
    let label: String
    let polyline: [Coordinate]
    let distanceMeters: Int?
    let durationSeconds: Int?
    let clips: [DriveClip]
    enum CodingKeys: String, CodingKey { case driveId, label, polyline, distanceMeters, durationSeconds, clips }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        driveId = try c.decodeNil(forKey: .driveId) ? nil : c.uuid(.driveId)
        label = try c.decode(String.self, forKey: .label)
        polyline = try c.decode([Coordinate].self, forKey: .polyline)
        distanceMeters = try c.integer(.distanceMeters, nullish: true)
        durationSeconds = try c.integer(.durationSeconds, nullish: true)
        clips = try c.decode([DriveClip].self, forKey: .clips)
    }
}

struct DriveRegion: Codable, Sendable, Equatable {
    let id: String
    let slug: String
    let displayName: String
    enum CodingKeys: String, CodingKey { case id, slug, displayName }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.uuid(.id)!
        slug = try c.decode(String.self, forKey: .slug)
        displayName = try c.decode(String.self, forKey: .displayName)
    }
}

struct DriveSummary: Codable, Sendable, Equatable, Identifiable {
    let driveId: String
    let label: String
    let startName: String?
    let endName: String?
    let distanceMeters: Int?
    let durationSeconds: Int?
    let clipCount: Int
    let createdAt: String
    let region: DriveRegion?
    var id: String { driveId }
    enum CodingKeys: String, CodingKey { case driveId, label, startName, endName, distanceMeters, durationSeconds, clipCount, createdAt, region }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        driveId = try c.uuid(.driveId)!
        label = try c.decode(String.self, forKey: .label)
        startName = try c.decodeIfPresent(String.self, forKey: .startName)
        endName = try c.decodeIfPresent(String.self, forKey: .endName)
        distanceMeters = try c.integer(.distanceMeters, nullish: true)
        durationSeconds = try c.integer(.durationSeconds, nullish: true)
        clipCount = try c.integer(.clipCount)!
        createdAt = try c.timestamp(.createdAt)!
        region = try c.decodeIfPresent(DriveRegion.self, forKey: .region)
    }
}

struct DriveCredits: Codable, Sendable, Equatable {
    let remaining: Int
    let cap: Int
    enum CodingKeys: String, CodingKey { case remaining, cap }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        remaining = try c.integer(.remaining)!; cap = try c.integer(.cap)!
    }
}
struct DriveList: Codable, Sendable, Equatable { let drives: [DriveSummary]; let credits: DriveCredits? }
