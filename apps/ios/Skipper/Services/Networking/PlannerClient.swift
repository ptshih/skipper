import Foundation

enum PlanStreamFailure: String, Error, Sendable { case firstByte, idle, total, noTerminal, transport }
protocol PlannerService: Sendable {
    func turn(_ request: DrivePlanRequest, onDelta: @escaping @Sendable (String) -> Void) async throws -> DrivePlanResponse
}

/// No cookie provider, persistence, logs, analytics identifiers, or automatic retries exist on this path.
struct PlannerClient: PlannerService {
    let baseURL: URL
    let transport: any HTTPTransport
    var network: any NetworkAvailability = UnknownNetworkAvailability()

    func turn(_ value: DrivePlanRequest, onDelta: @escaping @Sendable (String) -> Void = { _ in }) async throws -> DrivePlanResponse {
        guard (1...100).contains(value.turns.count), isWireUUID(value.regionId), (value.drawn?.count ?? 0) <= 8 else { throw ContractError() }
        if await network.isOffline() { throw OfflineError() }
        var request = try makeAPIRequest(baseURL: baseURL, path: "/drives/plan", method: "POST", body: JSONEncoder().encode(value))
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        var parser = SSEParser()
        var response: HTTPURLResponse?
        var buffered = Data()
        var isSSE = false
        try Task.checkCancellation()
        let transfer = transport.open(request, timeouts: .planner)
        defer { transfer.cancel() }
        do {
            for try await event in transfer.events {
                try Task.checkCancellation()
                switch event {
                case .response(let headers):
                    response = headers
                    isSSE = (200...299).contains(headers.statusCode) && (headers.value(forHTTPHeaderField: "Content-Type") ?? "").contains("text/event-stream")
                case .bytes(let bytes):
                    if isSSE {
                        if let terminal = try consume(parser.push(bytes), onDelta: onDelta) { return terminal }
                    } else { buffered.append(bytes) }
                }
            }
            guard let response else { throw PlanStreamFailure.transport }
            if !isSSE {
                try requireSuccess(HTTPResult(data: buffered, response: response))
                return try decodeContract(DrivePlanResponse.self, from: buffered)
            }
            if let terminal = try consume(parser.end(), onDelta: onDelta) { return terminal }
            throw PlanStreamFailure.noTerminal
        } catch {
            if Task.isCancelled { throw CancellationError() }
            switch error {
            case let failure as TransportFailure:
                switch failure {
                case .firstByte: throw PlanStreamFailure.firstByte
                case .idle: throw PlanStreamFailure.idle
                case .total: throw PlanStreamFailure.total
                case .invalidResponse: throw PlanStreamFailure.transport
                }
            case is ContractError, is APIError, is PlanStreamFailure, is CancellationError: throw error
            default: throw PlanStreamFailure.transport
            }
        }
    }
    private func consume(_ frames: [SSEFrame], onDelta: @Sendable (String) -> Void) throws -> DrivePlanResponse? {
        for frame in frames {
            if frame.event == "say", let delta = parseSayDelta(frame.data) { onDelta(delta) }
            if frame.event == "turn" {
                let data = Data(frame.data.utf8)
                guard (try? JSONSerialization.jsonObject(with: data, options: .fragmentsAllowed)) != nil else { throw PlanStreamFailure.transport }
                // FIRST terminal wins. Callers replace animated text with this response's authoritative say.
                return try decodeContract(DrivePlanResponse.self, from: data)
            }
        }
        return nil
    }
}
