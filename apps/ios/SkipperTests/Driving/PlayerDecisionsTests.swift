import XCTest
import Foundation
@testable import Skipper

final class PlayerDecisionsTests: XCTestCase {
    func testDecidePumpPlayingClipBlocksEverything() {
        XCTAssertEqual(decidePump(clipBusy: true, queue: [4, 5], reachedEnd: false), .wait)
        XCTAssertEqual(decidePump(clipBusy: true, queue: [], reachedEnd: true), .wait)
    }

    func testDecidePumpPlaysHeadOfQueue() {
        XCTAssertEqual(decidePump(clipBusy: false, queue: [7, 8, 9], reachedEnd: false), .play(seq: 7))
    }

    func testDecidePumpQueuedStopOutranksFinishing() {
        XCTAssertEqual(decidePump(clipBusy: false, queue: [12], reachedEnd: true), .play(seq: 12))
    }

    func testDecidePumpFinishesOnlyWhenDrainedAndRoadEnded() {
        XCTAssertEqual(decidePump(clipBusy: false, queue: [], reachedEnd: true), .finish)
    }

    func testDecidePumpDrainedQueueMidRouteIsIdle() {
        XCTAssertEqual(decidePump(clipBusy: false, queue: [], reachedEnd: false), .idle)
    }

    func testDecidePumpSeqZeroIsRealStop() {
        XCTAssertEqual(decidePump(clipBusy: false, queue: [0], reachedEnd: true), .play(seq: 0))
    }

    func testDecideStallDecisionLadder() {
        let now: Double = 100_000
        let lastProgressAtStalled = now - POST_START_STALL_MS
        let duration: Double = 120.0

        // Progress still recent (< POST_START_STALL_MS) -> wait
        XCTAssertEqual(decideStall(
            now: now,
            lastProgressAt: now - (POST_START_STALL_MS - 100),
            lastProgressTime: 30,
            duration: duration,
            resumeTried: false
        ), .wait)

        // Frozen near duration (within CLIP_END_GRACE_SEC) -> completeAtEnd
        XCTAssertEqual(decideStall(
            now: now,
            lastProgressAt: lastProgressAtStalled,
            lastProgressTime: duration - CLIP_END_GRACE_SEC,
            duration: duration,
            resumeTried: false
        ), .completeAtEnd)

        // Stalled mid-clip, resume not yet tried -> resume
        XCTAssertEqual(decideStall(
            now: now,
            lastProgressAt: lastProgressAtStalled,
            lastProgressTime: 30,
            duration: duration,
            resumeTried: false
        ), .resume)

        // Stalled mid-clip, resume already tried -> giveUp
        XCTAssertEqual(decideStall(
            now: now,
            lastProgressAt: lastProgressAtStalled,
            lastProgressTime: 30,
            duration: duration,
            resumeTried: true
        ), .giveUp)

        // Unknown duration (0) never completeAtEnd
        XCTAssertEqual(decideStall(
            now: now,
            lastProgressAt: lastProgressAtStalled,
            lastProgressTime: 30,
            duration: 0,
            resumeTried: false
        ), .resume)
        XCTAssertEqual(decideStall(
            now: now,
            lastProgressAt: lastProgressAtStalled,
            lastProgressTime: 30,
            duration: 0,
            resumeTried: true
        ), .giveUp)
    }

    func testClampSeekSec() {
        XCTAssertEqual(clampSeekSec(ms: -1000, durationSec: 60), 0.0)
        XCTAssertEqual(clampSeekSec(ms: 30_000, durationSec: 60), 30.0)
        XCTAssertEqual(clampSeekSec(ms: 90_000, durationSec: 60), 60.0)
    }

    func testSeekTargetReached() {
        XCTAssertTrue(seekTargetReached(currentTime: 30.1, target: 30.0))
        XCTAssertFalse(seekTargetReached(currentTime: 30.5, target: 30.0))
    }

    func testFormatMmss() {
        XCTAssertEqual(formatMmss(83), "1:23")
        XCTAssertEqual(formatMmss(119.6), "2:00") // rounded to nearest second before split
        XCTAssertEqual(formatMmss(-5), "0:00")
        XCTAssertEqual(formatMmss(Double.nan), "0:00")
        XCTAssertEqual(formatMmss(Double.infinity), "0:00")
        XCTAssertEqual(formatMmssMs(125_000), "2:05")
    }
}
