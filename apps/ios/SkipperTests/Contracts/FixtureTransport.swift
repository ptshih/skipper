import Foundation
@testable import Skipper

/// Locking is limited to observation of synchronous HTTPTransport.open/cancel callbacks.
/// No URLSession is created; even unexpected requests stay inside this transport.
final class FixtureTransport: HTTPTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var storedRequests: [URLRequest] = []
    private var storedCancellations = 0
    private var storedDeltas: [String] = []
    let status: Int
    let contentType: String
    let chunks: [Data]
    let ending: String

    init(status: Int = 200, contentType: String = "text/event-stream", chunks: [Data], ending: String = "eof") {
        self.status = status; self.contentType = contentType; self.chunks = chunks; self.ending = ending
    }
    var requests: [URLRequest] { lock.withLock { storedRequests } }
    var cancellations: Int { lock.withLock { storedCancellations } }
    var deltas: [String] { lock.withLock { storedDeltas } }
    func recordDelta(_ value: String) { lock.withLock { storedDeltas.append(value) } }

    func open(_ request: URLRequest, timeouts: RequestTimeouts) -> HTTPStream {
        lock.withLock { storedRequests.append(request) }
        let (events, continuation) = AsyncThrowingStream<HTTPStreamEvent, Error>.makeStream()
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": contentType])!
        continuation.yield(.response(response))
        for chunk in chunks { continuation.yield(.bytes(chunk)) }
        switch ending {
        case "cancel": continuation.finish(throwing: CancellationError())
        case "transport_error": continuation.finish(throwing: URLError(.networkConnectionLost))
        case "idle_timeout": continuation.finish(throwing: TransportFailure.idle)
        case "first_byte_timeout": continuation.finish(throwing: TransportFailure.firstByte)
        case "total_timeout": continuation.finish(throwing: TransportFailure.total)
        case "suspended": break
        default: continuation.finish()
        }
        return HTTPStream(events: events, cancel: { [self] in
            lock.withLock { storedCancellations += 1 }
            continuation.finish(throwing: CancellationError())
        })
    }
}
struct FixtureNetwork: NetworkAvailability {
    let offline: Bool
    func isOffline() async -> Bool { offline }
}
struct EmptyFixtureCookies: SessionCookieProvider {
    func cookieHeader() async throws -> String? { nil }
    func receive(_ response: HTTPURLResponse) async throws {}
}
