import Foundation

struct SSEFrame: Sendable, Equatable { let event: String; let data: String }

/// Parse raw bytes, not decoded network chunks: UTF-8 and CRLF may straddle any chunk boundary.
/// Unknown fields/events are forward-compatible; retry/id never reconnect a billed request.
struct SSEParser: Sendable {
    private var line = Data()
    private var event = "message"
    private var dataLines: [String] = []
    private var previousCR = false
    private var firstLine = true

    mutating func push(_ bytes: Data) -> [SSEFrame] {
        var frames: [SSEFrame] = []
        for byte in bytes {
            if previousCR { previousCR = false; if byte == 10 { continue } }
            if byte == 13 || byte == 10 {
                if let frame = finishLine() { frames.append(frame) }
                previousCR = byte == 13
            } else { line.append(byte) }
        }
        return frames
    }
    mutating func end() -> [SSEFrame] {
        var frames: [SSEFrame] = []
        if !line.isEmpty, let frame = finishLine() { frames.append(frame) }
        if let frame = dispatch() { frames.append(frame) }
        return frames
    }
    private mutating func finishLine() -> SSEFrame? {
        var value = String(decoding: line, as: UTF8.self); line.removeAll(keepingCapacity: true)
        if firstLine { firstLine = false; if value.first == "\u{FEFF}" { value.removeFirst() } }
        if value.isEmpty { return dispatch() }
        if value.hasPrefix(":") { return nil }
        let parts = value.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
        let field = String(parts[0])
        var content = parts.count > 1 ? String(parts[1]) : ""
        if content.hasPrefix(" ") { content.removeFirst() }
        if field == "event" { event = content }
        if field == "data" { dataLines.append(content) }
        return nil
    }
    private mutating func dispatch() -> SSEFrame? {
        defer { event = "message"; dataLines.removeAll(keepingCapacity: true) }
        return dataLines.isEmpty ? nil : SSEFrame(event: event, data: dataLines.joined(separator: "\n"))
    }
}

func parseSayDelta(_ data: String) -> String? {
    struct Delta: Decodable { let delta: String }
    guard let value = try? JSONDecoder().decode(Delta.self, from: Data(data.utf8)), !value.delta.isEmpty else { return nil }
    return value.delta
}
