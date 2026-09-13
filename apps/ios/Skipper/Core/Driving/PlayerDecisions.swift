import Foundation

/// A remote clip producing no audio within this window is dead (ms).
public let PRE_START_STALL_MS: Double = 12_000.0

/// Same "never produced audio" verdict for a local clip loaded from disk (ms).
public let LOCAL_CLIP_STALL_MS: Double = 2_500.0

/// Watchdog: no playback progress for this long after starting indicates stall (ms).
public let POST_START_STALL_MS: Double = 6_000.0

/// Within this much of duration, a frozen clock is treated as completed (sec).
public let CLIP_END_GRACE_SEC: Double = 0.6

/// A committed seek target is reached when clock lands within this epsilon (sec).
public let SEEK_REACHED_EPS_SEC: Double = 0.4

/// What the post-start stall watchdog should do this tick.
public enum StallVerdict: String, Codable, Sendable, Equatable {
    case wait
    case completeAtEnd
    case resume
    case giveUp
}

/// Decide the post-start stall action from current playback state.
public func decideStall(
    now: Double,
    lastProgressAt: Double,
    lastProgressTime: Double,
    duration: Double,
    resumeTried: Bool
) -> StallVerdict {
    if now - lastProgressAt < POST_START_STALL_MS {
        return .wait
    }
    if duration > 0.0 && lastProgressTime >= duration - CLIP_END_GRACE_SEC {
        return .completeAtEnd
    }
    return resumeTried ? .giveUp : .resume
}

/// What the fire-queue pump should do this tick.
public enum PumpAction: Equatable, Sendable {
    case wait
    case play(seq: Int)
    case finish
    case idle
}

/// Decide the next playback pump action.
/// Priority order:
/// 1. Busy beats everything (never talk over active clip).
/// 2. Queued stop beats finishing (never drop paid stops).
/// 3. Finishing requires both drained queue and finished road.
public func decidePump(
    clipBusy: Bool,
    queue: [Int],
    reachedEnd: Bool
) -> PumpAction {
    if clipBusy {
        return .wait
    }
    if let next = queue.first {
        return .play(seq: next)
    }
    return reachedEnd ? .finish : .idle
}

/// Clamp a seek position (ms) to [0, durationSec], returned in seconds.
public func clampSeekSec(ms: Double, durationSec: Double) -> Double {
    return min(durationSec, max(0.0, ms / 1000.0))
}

/// Has the playback clock landed on the committed seek target?
public func seekTargetReached(currentTime: Double, target: Double) -> Bool {
    return abs(currentTime - target) < SEEK_REACHED_EPS_SEC
}
