import Foundation

/// Encoding and atomic writes run on a serial utility queue, never on the GPS/UI actor.
/// The exit flush is deliberate: sign-out must not purge a directory ahead of a queued
/// write and then have that write recreate the rider's trace afterward.
final class TraceFileWriter: Sendable {
    static let shared = TraceFileWriter()
    private let queue = DispatchQueue(label: "fm.skipper.trace-writer", qos: .utility)

    func save(_ envelope: TraceEnvelope, directory: URL) -> URL? {
        let name = traceFileName(env: envelope)
        guard StorageUtils.isSafeLocalName(name) else { return nil }
        let url = directory.appendingPathComponent(name)
        queue.async {
            do {
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                try JSONEncoder().encode(envelope).write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            } catch { /* Best effort: storage pressure must not interrupt the drive. */ }
        }
        return url
    }

    func flush() { queue.sync {} }
}
