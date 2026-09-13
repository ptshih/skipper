import Foundation
import Observation

/// Audio preview interface consumed by proposal preview cards and stop auditions.
/// skipper-playback owns the production audio channel via `@MainActor @Observable AudioPreviewController`.
@MainActor
protocol AudioPreviewControlling: AnyObject {
    var isPlaying: Bool { get }
    var currentItemKey: String? { get }
    var currentTimeSec: Double { get }
    var durationSec: Double { get }

    func play(url: URL, itemKey: String) async throws
    func pause()
    func resume()
    func seek(to seconds: Double)
    func stop()
}

/// Adapter connecting the production AudioPreviewController from Services/Playback to UI protocol.
@MainActor
final class PlaybackAudioPreviewAdapter: AudioPreviewControlling {
    private let controller: AudioPreviewController

    init(controller: AudioPreviewController) {
        self.controller = controller
    }

    var isPlaying: Bool { controller.playing }
    var currentItemKey: String? { controller.activeID }
    var currentTimeSec: Double { controller.position }
    var durationSec: Double { controller.duration }

    func play(url: URL, itemKey: String) async throws {
        if url.isFileURL {
            controller.playLocal(id: itemKey, url: url)
        } else {
            controller.playRoutePreview(cardId: itemKey, url: url)
        }
    }

    func pause() {
        controller.pause()
    }

    func resume() {
        controller.resume()
    }

    func seek(to seconds: Double) {
        controller.seek(to: seconds)
    }

    func stop() {
        controller.stop()
    }
}

/// Thin UI mock/fallback adapter for previews and tests before live playback wiring.
@MainActor @Observable
final class MockAudioPreviewController: AudioPreviewControlling {
    var isPlaying: Bool = false
    var currentItemKey: String? = nil
    var currentTimeSec: Double = 0
    var durationSec: Double = 30.0
    var lastPlayedURL: URL?

    init() {}

    func play(url: URL, itemKey: String) async throws {
        lastPlayedURL = url
        currentItemKey = itemKey
        isPlaying = true
        currentTimeSec = 0
    }

    func pause() {
        isPlaying = false
    }

    func resume() {
        isPlaying = true
    }

    func seek(to seconds: Double) {
        currentTimeSec = seconds
    }

    func stop() {
        isPlaying = false
        currentItemKey = nil
        currentTimeSec = 0
    }
}
