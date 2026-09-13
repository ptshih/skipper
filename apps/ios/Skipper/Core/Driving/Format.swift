import Foundation

/// Format a duration as `M:SS` (e.g. 83 -> "1:23"). Rounds to nearest second before splitting.
/// Non-finite inputs clamp to "0:00".
public func formatMmss(_ seconds: Double) -> String {
    guard seconds.isFinite else { return "0:00" }
    let total = max(0, Int(seconds.rounded()))
    let m = total / 60
    let s = total % 60
    return String(format: "%d:%02d", m, s)
}

/// Format milliseconds as `M:SS`.
public func formatMmssMs(_ ms: Double) -> String {
    return formatMmss(ms / 1000.0)
}
