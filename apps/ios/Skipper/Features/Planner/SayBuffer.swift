import Foundation

/// Buffers streamed assistant text tokens and reveals text at sentence boundaries.
/// Matches the TS SayBuffer behavior for conversational cadence.
struct SayBuffer: Sendable {
    private(set) var shown: String = ""
    private(set) var buffer: String = ""

    mutating func appendDelta(_ delta: String) {
        buffer += delta
        flushSentences()
    }

    mutating func flushRemaining() {
        if !buffer.isEmpty {
            shown += buffer
            buffer = ""
        }
    }

    mutating func reset() {
        shown = ""
        buffer = ""
    }

    private mutating func flushSentences() {
        let sentenceDelimiters = [". ", "! ", "? ", ".\n", "!\n", "?\n", "\n\n"]
        var searchIndex = buffer.startIndex

        while let match = findFirstDelimiter(in: buffer[searchIndex...], delimiters: sentenceDelimiters) {
            let splitIndex = match.upperBound
            let completedSentence = String(buffer[..<splitIndex])
            shown += completedSentence
            buffer = String(buffer[splitIndex...])
            searchIndex = buffer.startIndex
        }
    }

    private func findFirstDelimiter(in substring: Substring, delimiters: [String]) -> Range<String.Index>? {
        var earliestRange: Range<String.Index>? = nil
        for delim in delimiters {
            if let range = substring.range(of: delim) {
                if let earliest = earliestRange {
                    if range.lowerBound < earliest.lowerBound {
                        earliestRange = range
                    }
                } else {
                    earliestRange = range
                }
            }
        }
        return earliestRange
    }
}
