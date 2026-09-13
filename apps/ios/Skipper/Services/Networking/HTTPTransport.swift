import Foundation

struct HTTPResult: Sendable {
    let data: Data
    let response: HTTPURLResponse
}
enum HTTPStreamEvent: Sendable {
    case response(HTTPURLResponse)
    case bytes(Data)
}
struct RequestTimeouts: Sendable {
    let firstByte: TimeInterval
    let idle: TimeInterval
    let total: TimeInterval
    static let standard = RequestTimeouts(firstByte: 15, idle: 15, total: 15)
    static let planner = RequestTimeouts(firstByte: 20, idle: 60, total: 120)
}
enum TransportFailure: Error, Sendable, Equatable { case firstByte, idle, total, invalidResponse }

struct HTTPStream: Sendable {
    let events: AsyncThrowingStream<HTTPStreamEvent, Error>
    let cancel: @Sendable () -> Void
}
protocol HTTPTransport: Sendable {
    func open(_ request: URLRequest, timeouts: RequestTimeouts) -> HTTPStream
}
extension HTTPTransport {
    func send(_ request: URLRequest) async throws -> HTTPResult {
        try Task.checkCancellation()
        var response: HTTPURLResponse?
        var data = Data()
        let transfer = open(request, timeouts: .standard)
        defer { transfer.cancel() }
        for try await event in transfer.events {
            try Task.checkCancellation()
            switch event {
            case .response(let value): response = value
            case .bytes(let bytes): data.append(bytes)
            }
        }
        guard let response else { throw TransportFailure.invalidResponse }
        return HTTPResult(data: data, response: response)
    }
}

/// A separate ephemeral session per request prevents system cookies, caches, and credentials from
/// linking planner prose to the signed-in session. The explicit cookie provider is the only auth source.
struct URLSessionTransport: HTTPTransport {
    func open(_ request: URLRequest, timeouts: RequestTimeouts) -> HTTPStream {
        let (events, continuation) = AsyncThrowingStream<HTTPStreamEvent, Error>.makeStream()
        let transfer = StreamingTransfer(continuation: continuation, timeouts: timeouts)
        continuation.onTermination = { @Sendable [weak transfer] _ in transfer?.cancel() }
        transfer.start(request)
        return HTTPStream(events: events, cancel: { transfer.cancel() })
    }
}

/// Delegate callbacks and deadline work share a serial queue. The lock also protects caller cancellation.
private final class StreamingTransfer: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private let lock = NSRecursiveLock()
    private let continuation: AsyncThrowingStream<HTTPStreamEvent, Error>.Continuation
    private let timeouts: RequestTimeouts
    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var firstByte: DispatchWorkItem?
    private var idle: DispatchWorkItem?
    private var total: DispatchWorkItem?
    private var finished = false
    private var deadlines = DeadlineGeneration()

    init(continuation: AsyncThrowingStream<HTTPStreamEvent, Error>.Continuation, timeouts: RequestTimeouts) {
        self.continuation = continuation; self.timeouts = timeouts
    }
    func start(_ request: URLRequest) {
        lock.lock(); defer { lock.unlock() }
        guard !finished else { return }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCredentialStorage = nil
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.waitsForConnectivity = false
        // Explicit timers below distinguish handshake, byte liveness, and the absolute deadline.
        configuration.timeoutIntervalForRequest = timeouts.total + 1
        configuration.timeoutIntervalForResource = timeouts.total + 1
        let queue = OperationQueue(); queue.maxConcurrentOperationCount = 1
        session = URLSession(configuration: configuration, delegate: self, delegateQueue: queue)
        task = session?.dataTask(with: request)
        firstByte = deadline(after: timeouts.firstByte, kind: .firstByte, error: .firstByte)
        total = deadline(after: timeouts.total, kind: .total, error: .total)
        task?.resume()
    }
    private func deadline(after seconds: TimeInterval, kind: DeadlineGeneration.Kind, error: TransportFailure) -> DispatchWorkItem {
        let token = deadlines.arm(kind)
        let work = DispatchWorkItem { [weak self] in self?.deadlineFired(token, error: error) }
        DispatchQueue.global().asyncAfter(deadline: .now() + seconds, execute: work)
        return work
    }
    private func deadlineFired(_ token: DeadlineGeneration.Token, error: TransportFailure) {
        lock.lock(); defer { lock.unlock() }
        // cancel() alone cannot stop work already dequeued and blocked on this lock. Recheck
        // identity here so an old byte-gap deadline never kills a stream that made progress.
        guard !finished, deadlines.isCurrent(token) else { return }
        finish(error)
    }
    private func bumpIdle() {
        idle?.cancel()
        idle = deadline(after: timeouts.idle, kind: .idle, error: .idle)
    }
    func cancel() { finish(CancellationError()) }
    private func finish(_ error: Error?) {
        lock.lock(); defer { lock.unlock() }
        guard !finished else { return }; finished = true
        firstByte?.cancel(); idle?.cancel(); total?.cancel()
        task?.cancel(); session?.invalidateAndCancel(); task = nil; session = nil
        if let error { continuation.finish(throwing: error) } else { continuation.finish() }
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping @Sendable (URLSession.ResponseDisposition) -> Void) {
        lock.lock(); defer { lock.unlock() }
        guard !finished, let response = response as? HTTPURLResponse else {
            completionHandler(.cancel); finish(TransportFailure.invalidResponse); return
        }
        firstByte?.cancel(); firstByte = nil; deadlines.invalidate(.firstByte); bumpIdle()
        continuation.yield(.response(response)); completionHandler(.allow)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock(); defer { lock.unlock() }
        guard !finished else { return }; bumpIdle(); continuation.yield(.bytes(data))
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) { finish(error) }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        // Redirect replay could repeat a paid POST or send an explicit Cookie to a different origin.
        completionHandler(nil)
    }
}

/// The small pure gate makes the dequeued-before-cancel race deterministic to test.
struct DeadlineGeneration {
    enum Kind: Hashable, Sendable { case firstByte, idle, total }
    struct Token: Sendable { let kind: Kind; let generation: Int }
    private var generations: [Kind: Int] = [:]
    mutating func arm(_ kind: Kind) -> Token {
        invalidate(kind)
        return Token(kind: kind, generation: generations[kind]!)
    }
    mutating func invalidate(_ kind: Kind) { generations[kind, default: 0] += 1 }
    func isCurrent(_ token: Token) -> Bool { generations[token.kind] == token.generation }
}
