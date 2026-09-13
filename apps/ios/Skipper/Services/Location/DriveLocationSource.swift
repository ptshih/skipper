import CoreLocation
import UIKit

enum DriveLocationPermission: Equatable { case undetermined, denied, reduced, precise }

@MainActor
protocol DriveLocationSourcing: AnyObject {
    var permission: DriveLocationPermission { get }
    var onPermission: ((DriveLocationPermission) -> Void)? { get set }
    var onRawFix: ((RawFix) -> Void)? { get set }
    var onError: (() -> Void)? { get set }
    var onForeground: (() -> Void)? { get set }
    func requestPermission()
    func start()
    func pause()
    func resume()
    func stop()
}

/// Foreground-only high-rate GPS. Constructed on MainActor so Core Location's delegate
/// and the stateful fix mapper run serially on the main run loop.
@MainActor
final class DriveLocationSource: NSObject, DriveLocationSourcing, @preconcurrency CLLocationManagerDelegate {
    private let manager: CLLocationManager
    private var running = false
    private var paused = false
    private var foreground = true
    private var observers: [NSObjectProtocol] = []
    var onPermission: ((DriveLocationPermission) -> Void)?
    var onRawFix: ((RawFix) -> Void)?
    var onError: (() -> Void)?
    var onForeground: (() -> Void)?

    var permission: DriveLocationPermission {
        switch manager.authorizationStatus {
        case .notDetermined: .undetermined
        case .authorizedAlways, .authorizedWhenInUse: manager.accuracyAuthorization == .fullAccuracy ? .precise : .reduced
        default: .denied
        }
    }

    override init() {
        manager = CLLocationManager()
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
        manager.distanceFilter = kCLDistanceFilterNone
        manager.activityType = .automotiveNavigation
        manager.pausesLocationUpdatesAutomatically = false
        manager.allowsBackgroundLocationUpdates = false
        foreground = UIApplication.shared.applicationState != .background
        observers.append(NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.foreground = false; self?.manager.stopUpdatingLocation() }
        })
        observers.append(NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.foreground = true
                self.onPermission?(self.permission)
                self.onForeground?()
                self.updateWatch()
            }
        })
    }

    func requestPermission() { manager.requestWhenInUseAuthorization() }
    func start() { running = true; paused = false; updateWatch() }
    func pause() { paused = true; manager.stopUpdatingLocation() }
    func resume() { guard running else { return }; paused = false; updateWatch() }
    func stop() { running = false; paused = false; manager.stopUpdatingLocation() }
    private func updateWatch() {
        guard running && !paused && foreground && permission == .precise else { manager.stopUpdatingLocation(); return }
        manager.startUpdatingLocation()
    }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        onPermission?(permission)
        updateWatch()
    }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard running && !paused && foreground && permission == .precise else { return }
        for location in locations {
            // Cached pre-drive fixes cannot move a new route or trigger a stop behind the car.
            guard abs(location.timestamp.timeIntervalSinceNow) <= 10,
                  CLLocationCoordinate2DIsValid(location.coordinate) else { continue }
            onRawFix?(RawFix(coords: RawFixCoords(latitude: location.coordinate.latitude,
                                                longitude: location.coordinate.longitude,
                                                accuracy: location.horizontalAccuracy,
                                                speed: location.speed, heading: location.course),
                             timestamp: location.timestamp.timeIntervalSince1970 * 1000))
        }
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        guard running && !paused else { return }
        // Transient acquisition failures leave the watch alive and show the searching cue.
        onError?()
    }
    isolated deinit { for observer in observers { NotificationCenter.default.removeObserver(observer) } }
}

@MainActor
protocol ScreenAwakeControlling: AnyObject { func setAwake(_ awake: Bool) }
@MainActor
final class DriveScreenAwake: ScreenAwakeControlling {
    private static var owners: Set<UUID> = []
    private let owner = UUID()
    func setAwake(_ awake: Bool) {
        if awake { Self.owners.insert(owner) } else { Self.owners.remove(owner) }
        UIApplication.shared.isIdleTimerDisabled = !Self.owners.isEmpty
    }
    isolated deinit {
        Self.owners.remove(owner)
        UIApplication.shared.isIdleTimerDisabled = !Self.owners.isEmpty
    }
}
