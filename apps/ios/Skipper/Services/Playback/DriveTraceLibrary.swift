import Foundation

struct DriveStoredTrace: Identifiable, Equatable {
    let name: String
    let sizeBytes: Int
    var id: String { name }
}

/// Local administrator diagnostics retain the installed Documents/traces format.
/// Every action checks the current server-derived account role, including reads and exports.
@MainActor
final class DriveTraceLibrary {
    private let directory: URL?
    private let session: () -> SessionSnapshot?
    private let now: () -> Date
    init(directory: URL?, session: @escaping () -> SessionSnapshot?, now: @escaping () -> Date = Date.init) {
        self.directory = directory; self.session = session; self.now = now
    }
    private func authorize() throws {
        guard let value = session(), value.user.isAdmin, value.isFresh(at: now()) else { throw PlaybackFailure.adminRequired }
    }
    private func url(_ name: String) throws -> URL {
        try authorize()
        guard let directory, name.hasPrefix("trace-"), name.hasSuffix(".json"),
              !name.contains("/"), !name.contains("\\"), !name.contains("..") else { throw PlaybackFailure.invalidTrace }
        let url = directory.appendingPathComponent(name)
        guard url.resolvingSymlinksInPath().deletingLastPathComponent() == directory.resolvingSymlinksInPath() else { throw PlaybackFailure.invalidTrace }
        return url
    }
    func list() throws -> [DriveStoredTrace] {
        try authorize()
        guard let directory, FileManager.default.fileExists(atPath: directory.path) else { return [] }
        return try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.fileSizeKey, .isRegularFileKey])
            .compactMap { candidate in
                guard let safe = try? url(candidate.lastPathComponent),
                      let values = try? safe.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey]), values.isRegularFile == true else { return nil }
                return DriveStoredTrace(name: candidate.lastPathComponent, sizeBytes: values.fileSize ?? 0)
            }.sorted { $0.name > $1.name }
    }
    func read(_ name: String) throws -> TraceEnvelope {
        let path = try url(name)
        let size = try path.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard size > 0, size <= 40_000_000 else { throw PlaybackFailure.invalidTrace }
        let trace = try JSONDecoder().decode(TraceEnvelope.self, from: Data(contentsOf: path))
        guard trace.version == TRACE_FORMAT_VERSION, !trace.fixes.isEmpty, trace.fixes.count <= MAX_TRACE_FIXES else { throw PlaybackFailure.invalidTrace }
        var previous = -Double.infinity
        for fix in trace.fixes {
            guard fix.timestamp.isFinite, fix.timestamp >= previous,
                  fix.coords.latitude.isFinite, fix.coords.longitude.isFinite,
                  (-90...90).contains(fix.coords.latitude), (-180...180).contains(fix.coords.longitude),
                  [fix.coords.accuracy, fix.coords.speed, fix.coords.heading].allSatisfy({ $0?.isFinite ?? true }) else { throw PlaybackFailure.invalidTrace }
            previous = fix.timestamp
        }
        return trace
    }
    func export(_ name: String) throws -> URL { _ = try read(name); return try url(name) }
    func delete(_ name: String) throws { try FileManager.default.removeItem(at: url(name)) }
}
