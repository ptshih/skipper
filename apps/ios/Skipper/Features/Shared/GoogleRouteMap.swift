import SwiftUI
import GoogleMaps

enum MapStopState: String, Sendable, Equatable {
    case upcoming
    case playing
    case passed
}

struct MapStopMarker: Identifiable, Sendable, Equatable {
    let id: Int
    let seq: Int
    let name: String
    let latitude: Double
    let longitude: Double
    let kind: String?
    let state: MapStopState

    init(
        seq: Int,
        name: String,
        latitude: Double,
        longitude: Double,
        kind: String? = nil,
        state: MapStopState = .upcoming
    ) {
        self.id = seq
        self.seq = seq
        self.name = name
        self.latitude = latitude
        self.longitude = longitude
        self.kind = kind
        self.state = state
    }
}

/// Native Google Route Map view wrapping GMSMapView under Google Maps SDK.
/// Used for proposal route previews, drive detail itinerary maps, and live GPS driving route display.
/// Manages camera policy: fits entire route only on route/initial context change;
/// follows vehicle location and heading while driving; drops follow mode on user pan gesture;
/// and presents a floating Recenter chip to re-engage camera tracking.
struct GoogleRouteMap: View {
    let coordinates: [Coordinate]
    let currentCoordinate: Coordinate?
    let heading: Double?
    let stops: [MapStopMarker]
    let selectedStopSeq: Int?
    let onSelectStop: ((Int) -> Void)?
    let padding: CGFloat
    let isFollowingBinding: Binding<Bool>?
    /// False for a static preview inside a scrolling transcript; true wherever the rider explores.
    let allowsGestures: Bool

    @Environment(\.colorScheme) private var colorScheme
    @State private var internalIsFollowing: Bool = true
    @State private var recenterTrigger = UUID()

    private var isFollowing: Bool {
        isFollowingBinding?.wrappedValue ?? internalIsFollowing
    }

    init(
        coordinates: [Coordinate],
        currentCoordinate: Coordinate? = nil,
        heading: Double? = nil,
        stops: [MapStopMarker] = [],
        selectedStopSeq: Int? = nil,
        onSelectStop: ((Int) -> Void)? = nil,
        padding: CGFloat = 40,
        isFollowing: Binding<Bool>? = nil,
        allowsGestures: Bool = true
    ) {
        self.coordinates = coordinates
        self.currentCoordinate = currentCoordinate
        self.heading = heading
        self.stops = stops
        self.selectedStopSeq = selectedStopSeq
        self.onSelectStop = onSelectStop
        self.padding = padding
        self.isFollowingBinding = isFollowing
        self.allowsGestures = allowsGestures
    }

    var body: some View {
        if NativeSDKs.mapsReady {
            ZStack(alignment: .bottom) {
                GoogleRouteMapSurface(core: GoogleRouteMapCore(
                    coordinates: coordinates,
                    currentCoordinate: currentCoordinate,
                    heading: heading,
                    stops: stops,
                    selectedStopSeq: selectedStopSeq,
                    onSelectStop: onSelectStop,
                    padding: padding,
                    allowsGestures: allowsGestures,
                    colorScheme: colorScheme,
                    isFollowing: isFollowing,
                    onUserPan: {
                        if let isFollowingBinding {
                            isFollowingBinding.wrappedValue = false
                        }
                        internalIsFollowing = false
                    },
                    recenterTrigger: recenterTrigger
                ))
                // A geometry change owns a new native renderer and readiness state. Late
                // callbacks from the old map cannot mark the replacement route ready.
                .id(MapRouteGeometry(coordinates: coordinates, stops: stops))

                // Recenter chip — appears when rider pans away from follow tracking
                if !isFollowing {
                    Button {
                        recenter()
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "location.fill")
                                .font(.system(size: 13, weight: .semibold))
                            Text(currentCoordinate != nil ? "Recenter" : "Fit route")
                                .font(TrailheadType.caption)
                                .fontWeight(.semibold)
                        }
                        .foregroundColor(TrailheadColors.ink)
                        .padding(.horizontal, TrailheadSpace.medium)
                        .padding(.vertical, 6)
                        .background(TrailheadColors.surfaceRaised)
                        .clipShape(Capsule())
                        .overlay(
                            Capsule().stroke(TrailheadColors.rule, lineWidth: 1)
                        )
                        .shadow(color: Color.black.opacity(0.12), radius: 4, x: 0, y: 2)
                    }
                    .accessibilityIdentifier("map.recenter")
                    .padding(.bottom, TrailheadSpace.medium)
                    .transition(.opacity.combined(with: .scale(scale: 0.95)))
                }
            }
            .animation(.easeInOut(duration: 0.2), value: isFollowing)
        } else {
            mapUnavailableView
        }
    }

    private var mapUnavailableView: some View {
        ZStack {
            TrailheadColors.surfaceRaised
            VStack(spacing: TrailheadSpace.xs) {
                Image(systemName: "map")
                    .font(.system(size: 24))
                    .foregroundColor(TrailheadColors.inkMuted)
                Text("Map preview unavailable")
                    .font(TrailheadType.caption)
                    .foregroundColor(TrailheadColors.inkMuted)
            }
        }
        .accessibilityIdentifier("map.unavailable")
    }

    public static func safePadding(for bounds: CGRect, requested: CGFloat) -> CGFloat {
        let minDimension = min(bounds.width, bounds.height)
        guard minDimension > 0 else { return 0 }
        let maxSafePadding = max(0, minDimension * 0.35)
        return max(0, min(requested, maxSafePadding))
    }

    private func recenter() {
        if let isFollowingBinding {
            isFollowingBinding.wrappedValue = true
        }
        internalIsFollowing = true
        recenterTrigger = UUID()
    }
}

/// Only geometry controls renderer identity; narration/selection marker changes retain the camera.
struct MapRouteGeometry: Hashable {
    let values: [[Double]]
    init(coordinates: [Coordinate], stops: [MapStopMarker]) {
        values = [coordinates.flatMap { [$0.longitude, $0.latitude] },
                  stops.flatMap { [$0.longitude, $0.latitude] }]
    }
}

private struct GoogleRouteMapSurface: View {
    var core: GoogleRouteMapCore
    @State private var snapshotReady = false

    var body: some View {
        var configured = core
        configured.onSnapshotReady = { snapshotReady = true }
        return ZStack {
            configured
            #if DEBUG
            if DebugDependencies.runDirectory(for: AppLaunchConfiguration.read()) != nil {
                Text(snapshotReady ? "snapshot-ready" : "loading")
                    .font(.system(size: 1))
                    .foregroundStyle(.clear)
                    .accessibilityElement(children: .ignore)
                    .accessibilityIdentifier("map.render-status")
                    .accessibilityValue(snapshotReady ? "snapshot-ready" : "loading")
                    .accessibilityLabel("Map Render Status")
            }
            #endif
        }
    }
}

/// The same event-driven camera policy serves SDK callbacks and deterministic tests.
/// Commands remain pending through zero-size layout; active follow never falls back to overview.
@MainActor final class MapCameraLifecycle {
    enum Command: Equatable {
        case overview
        case follow(Coordinate, Double?)
    }
    var apply: (Command) -> Bool = { _ in false }
    private(set) var hasPositionedCamera = false
    private(set) var viewport = CGRect.zero
    private var pending: Command?
    private var rider: Coordinate?
    private var heading: Double?
    private var follows = true
    private var hasUserInteracted = false
    private var canFit = false

    static func validLayout(_ bounds: CGRect) -> Bool {
        bounds.width.isFinite && bounds.height.isFinite && bounds.width >= 30 && bounds.height >= 30
    }

    func update(rider: Coordinate?, heading: Double?, isFollowing: Bool, canFit: Bool, recenter: Bool) {
        let changed = self.rider != rider || self.heading != heading || follows != isFollowing
        self.rider = rider; self.heading = heading; self.follows = isFollowing; self.canFit = canFit
        if recenter { hasUserInteracted = false }
        if !isFollowing {
            // A replacement renderer has no camera to preserve. Give it one route overview
            // without enabling rider follow; an actual pan in this renderer still wins.
            pending = !hasPositionedCamera && !hasUserInteracted && canFit ? .overview : nil
            applyPending()
            return
        }
        if let rider {
            if changed || recenter || !hasPositionedCamera { pending = .follow(rider, heading) }
        } else if canFit && (recenter || !hasPositionedCamera || changed) {
            pending = .overview
        } else if !canFit { pending = nil }
        applyPending()
    }

    func layout(_ bounds: CGRect) {
        viewport = bounds
        applyPending()
    }

    func userPanned() { follows = false; hasUserInteracted = true; pending = nil }

    private func applyPending() {
        guard Self.validLayout(viewport), let command = pending else { return }
        // Clear first: moving Google's camera may synchronously cause another layout callback.
        pending = nil
        if apply(command) { hasPositionedCamera = true }
        else { pending = command }
    }
}

/// One object per native map generation. Dismantling makes any late SDK callback inert.
@MainActor final class MapRenderLifecycle {
    let generation: UUID
    private(set) var isActive = true
    private(set) var isReady = false
    init(generation: UUID = UUID()) { self.generation = generation }
    func acceptSnapshot(cameraPositioned: Bool, validLayout: Bool, routeAttached: Bool) -> Bool {
        guard isActive, !isReady, cameraPositioned, validLayout, routeAttached else { return false }
        isReady = true
        return true
    }
    func invalidate() { isActive = false; isReady = false }
}

#if DEBUG
struct ProjectedRouteBounds: Codable, Sendable, Equatable {
    let minX: Double
    let minY: Double
    let maxX: Double
    let maxY: Double
}

struct MapRenderReceipt: Codable, Sendable, Equatable {
    let generation: UUID
    let snapshotReadyCount: Int
    let tileRenderingFinishedCount: Int
    let viewWidth: Double
    let viewHeight: Double
    let cameraZoom: Double
    let routePointCount: Int
    let projectedRouteBounds: ProjectedRouteBounds
    let routeFitsViewport: Bool
}

/// No instance, counters, projection collection, or output exists outside a validated UI run.
@MainActor final class MapRenderDiagnostics {
    private static var currentGenerations: [URL: UUID] = [:]
    let generation: UUID
    let destination: URL
    private(set) var snapshotReadyCount = 0
    private(set) var tileRenderingFinishedCount = 0
    private let write: (Data, URL) throws -> Void

    init?(launch: AppLaunchConfiguration, generation: UUID,
          write: @escaping (Data, URL) throws -> Void = { try $0.write(to: $1, options: .atomic) }) {
        guard let directory = DebugDependencies.runDirectory(for: launch) else { return nil }
        self.generation = generation
        self.destination = directory.appendingPathComponent("map-render-receipt.json")
        self.write = write
        Self.currentGenerations[destination] = generation
        // Replace any previous map's readiness immediately, including a new invalid/empty route.
        persist(viewSize: .zero, zoom: 0, routePointCount: 0,
                projected: .init(minX: 0, minY: 0, maxX: 0, maxY: 0), fits: false)
    }

    func tilesFinished() {
        guard Self.currentGenerations[destination] == generation else { return }
        tileRenderingFinishedCount += 1
    }
    func snapshot(viewSize: CGSize, zoom: Double, routePointCount: Int,
                  projected: ProjectedRouteBounds, fits: Bool) {
        guard Self.currentGenerations[destination] == generation else { return }
        snapshotReadyCount += 1
        persist(viewSize: viewSize, zoom: zoom, routePointCount: routePointCount, projected: projected, fits: fits)
    }
    private func persist(viewSize: CGSize, zoom: Double, routePointCount: Int,
                         projected: ProjectedRouteBounds, fits: Bool) {
        guard Self.currentGenerations[destination] == generation else { return }
        let receipt = MapRenderReceipt(generation: generation, snapshotReadyCount: snapshotReadyCount,
            tileRenderingFinishedCount: tileRenderingFinishedCount, viewWidth: viewSize.width,
            viewHeight: viewSize.height, cameraZoom: zoom, routePointCount: routePointCount,
            projectedRouteBounds: projected, routeFitsViewport: fits)
        guard let data = try? JSONEncoder().encode(receipt) else { return }
        try? write(data, destination)
    }
}
#endif

// MARK: - Layout-Aware Map View

final class RouteMapView: GMSMapView {
    var onLayoutSubviews: ((RouteMapView) -> Void)?

    override func layoutSubviews() {
        super.layoutSubviews()
        onLayoutSubviews?(self)
    }
}

// MARK: - Core Representable

struct GoogleRouteMapCore: UIViewRepresentable {
    let coordinates: [Coordinate]
    let currentCoordinate: Coordinate?
    let heading: Double?
    let stops: [MapStopMarker]
    let selectedStopSeq: Int?
    let onSelectStop: ((Int) -> Void)?
    let padding: CGFloat
    var allowsGestures: Bool = true
    let colorScheme: ColorScheme
    let isFollowing: Bool
    let onUserPan: () -> Void
    let recenterTrigger: UUID
    var onSnapshotReady: (() -> Void)? = nil

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> GMSMapView {
        let options = GMSMapViewOptions()
        options.frame = .zero
        let mapView = RouteMapView(options: options)
        mapView.delegate = context.coordinator
        mapView.isMyLocationEnabled = false
        mapView.settings.compassButton = false
        mapView.settings.myLocationButton = false
        mapView.settings.rotateGestures = false
        mapView.settings.tiltGestures = false
        mapView.settings.scrollGestures = allowsGestures
        mapView.settings.zoomGestures = allowsGestures

        mapView.onLayoutSubviews = { [weak coordinator = context.coordinator] mv in
            coordinator?.mapViewDidLayout(mv)
        }

        context.coordinator.mapView = mapView
        return mapView
    }

    func updateUIView(_ mapView: GMSMapView, context: Context) {
        let coordinator = context.coordinator
        coordinator.onUserPan = onUserPan
        coordinator.onSelectStop = onSelectStop
        coordinator.onSnapshotReady = onSnapshotReady
        coordinator.currentPadding = padding

        mapView.overrideUserInterfaceStyle = (colorScheme == .dark) ? .dark : .light

        let recenter = coordinator.lastRecenterTrigger != nil && coordinator.lastRecenterTrigger != recenterTrigger
        coordinator.lastRecenterTrigger = recenterTrigger

        // 2. Route polyline & bounds (only rebuilt when coordinates change)
        let routeChanged = (coordinates != coordinator.lastCoordinates)
        if routeChanged {
            coordinator.lastCoordinates = coordinates
            coordinator.polyline?.map = nil
            coordinator.polyline = nil

            if coordinates.count >= 2 {
                let path = GMSMutablePath()
                var bounds: GMSCoordinateBounds?
                for coord in coordinates {
                    let clCoord = CLLocationCoordinate2D(latitude: coord.latitude, longitude: coord.longitude)
                    path.add(clCoord)
                    bounds = bounds.map { $0.includingCoordinate(clCoord) } ?? GMSCoordinateBounds(coordinate: clCoord, coordinate: clCoord)
                }
                for stop in stops {
                    let clCoord = CLLocationCoordinate2D(latitude: stop.latitude, longitude: stop.longitude)
                    bounds = bounds.map { $0.includingCoordinate(clCoord) } ?? GMSCoordinateBounds(coordinate: clCoord, coordinate: clCoord)
                }

                let polyline = GMSPolyline(path: path)
                polyline.strokeColor = UIColor(TrailheadColors.routeTrail)
                polyline.strokeWidth = 4.0
                polyline.map = mapView
                coordinator.polyline = polyline
                coordinator.routeBounds = bounds
            } else {
                coordinator.routeBounds = nil
            }

        }

        // 3. Stop markers (incremental update, avoids clearing whole map)
        var currentStopSeqs = Set<Int>()
        for stop in stops {
            currentStopSeqs.insert(stop.seq)
            let clCoord = CLLocationCoordinate2D(latitude: stop.latitude, longitude: stop.longitude)

            let pinColor: UIColor
            if selectedStopSeq == stop.seq || stop.state == .playing {
                pinColor = UIColor(TrailheadColors.accentWarm)
            } else if stop.state == .passed {
                pinColor = UIColor(TrailheadColors.inkMuted)
            } else {
                pinColor = UIColor(TrailheadColors.accent)
            }

            if let existing = coordinator.stopMarkers[stop.seq] {
                existing.position = clCoord
                existing.title = stop.name
                existing.icon = GMSMarker.markerImage(with: pinColor)
            } else {
                let marker = GMSMarker(position: clCoord)
                marker.title = stop.name
                marker.userData = stop.seq
                marker.icon = GMSMarker.markerImage(with: pinColor)
                marker.map = mapView
                coordinator.stopMarkers[stop.seq] = marker
            }
        }

        // Remove markers that are no longer in stops
        let removedSeqs = coordinator.stopMarkers.keys.filter { !currentStopSeqs.contains($0) }
        for seq in removedSeqs {
            coordinator.stopMarkers[seq]?.map = nil
            coordinator.stopMarkers.removeValue(forKey: seq)
        }

        // 4. Rider location puck (follow mode)
        if let current = currentCoordinate {
            let puckCoord = CLLocationCoordinate2D(latitude: current.latitude, longitude: current.longitude)
            if let puck = coordinator.puckMarker {
                puck.position = puckCoord
                puck.map = mapView
            } else {
                let puck = GMSMarker(position: puckCoord)
                puck.isFlat = true
                puck.groundAnchor = CGPoint(x: 0.5, y: 0.5)
                puck.icon = Self.puckImage()
                puck.map = mapView
                coordinator.puckMarker = puck
            }

        } else {
            coordinator.puckMarker?.map = nil
            coordinator.puckMarker = nil
        }
        coordinator.camera.update(rider: currentCoordinate, heading: heading, isFollowing: isFollowing,
            canFit: coordinator.routeBounds?.isValid == true, recenter: recenter)
        coordinator.camera.layout(mapView.bounds)
    }

    static func dismantleUIView(_ uiView: GMSMapView, coordinator: Coordinator) {
        coordinator.render.invalidate()
        uiView.delegate = nil
        (uiView as? RouteMapView)?.onLayoutSubviews = nil
        coordinator.onSnapshotReady = nil
        coordinator.mapView = nil
    }

    private static func puckImage() -> UIImage {
        let size = CGSize(width: 20, height: 20)
        let renderer = UIGraphicsImageRenderer(size: size)
        return renderer.image { ctx in
            // Outer white ring
            UIColor.white.setFill()
            ctx.cgContext.fillEllipse(in: CGRect(origin: .zero, size: size))
            // Inner brand blue dot
            UIColor(TrailheadColors.accent).setFill()
            ctx.cgContext.fillEllipse(in: CGRect(x: 3, y: 3, width: 14, height: 14))
        }
    }

    // MARK: - Coordinator

    @MainActor
    final class Coordinator: NSObject, GMSMapViewDelegate {
        weak var mapView: GMSMapView?
        var polyline: GMSPolyline?
        var stopMarkers: [Int: GMSMarker] = [:]
        var puckMarker: GMSMarker?

        var lastCoordinates: [Coordinate] = []
        var routeBounds: GMSCoordinateBounds?
        var currentPadding: CGFloat = 30
        var lastRecenterTrigger: UUID?
        let camera = MapCameraLifecycle()
        let render = MapRenderLifecycle()
        var onSnapshotReady: (() -> Void)?
        var onUserPan: (() -> Void)?
        var onSelectStop: ((Int) -> Void)?
        #if DEBUG
        private var diagnostics: MapRenderDiagnostics?
        #endif

        override init() {
            super.init()
            camera.apply = { [weak self] command in self?.applyCamera(command) ?? false }
            #if DEBUG
            diagnostics = MapRenderDiagnostics(launch: AppLaunchConfiguration.read(), generation: render.generation)
            #endif
        }

        func mapViewDidLayout(_ mapView: GMSMapView) {
            guard render.isActive, self.mapView === mapView else { return }
            camera.layout(mapView.bounds)
        }

        private func applyCamera(_ command: MapCameraLifecycle.Command) -> Bool {
            guard render.isActive, let mapView, MapCameraLifecycle.validLayout(mapView.bounds) else { return false }
            switch command {
            case .overview:
                guard let bounds = routeBounds, bounds.isValid else { return false }
                let padding = GoogleRouteMap.safePadding(for: mapView.bounds, requested: currentPadding)
                if bounds.southWest.latitude == bounds.northEast.latitude && bounds.southWest.longitude == bounds.northEast.longitude {
                    mapView.moveCamera(.setTarget(bounds.southWest, zoom: 14))
                } else {
                    mapView.moveCamera(.fit(bounds, withPadding: padding))
                }
            case .follow(let rider, let heading):
                let position = CLLocationCoordinate2D(latitude: rider.latitude, longitude: rider.longitude)
                guard CLLocationCoordinate2DIsValid(position) else { return false }
                let zoom: Float = mapView.camera.zoom > 12 ? mapView.camera.zoom : 16
                let target = GMSCameraPosition(target: position, zoom: zoom,
                    bearing: heading ?? mapView.camera.bearing, viewingAngle: 0)
                if camera.hasPositionedCamera { mapView.animate(to: target) }
                else { mapView.camera = target }
            }
            return true
        }

        // MARK: - GMSMapViewDelegate

        @MainActor
        func mapView(_ mapView: GMSMapView, willMove gesture: Bool) {
            // When rider pans, zooms, or drags the map with a gesture, drop follow mode
            if gesture {
                camera.userPanned()
                onUserPan?()
            }
        }

        @MainActor
        func mapView(_ mapView: GMSMapView, didTap marker: GMSMarker) -> Bool {
            if let seq = marker.userData as? Int {
                onSelectStop?(seq)
                return true
            }
            return false
        }

        @MainActor
        func mapViewDidFinishTileRendering(_ mapView: GMSMapView) {
            guard render.isActive, self.mapView === mapView else { return }
            #if DEBUG
            diagnostics?.tilesFinished()
            #endif
        }

        @MainActor
        func mapViewSnapshotReady(_ mapView: GMSMapView) {
            guard render.isActive, self.mapView === mapView,
                  camera.hasPositionedCamera, MapCameraLifecycle.validLayout(mapView.bounds),
                  polyline?.map === mapView else { return }
            if render.acceptSnapshot(cameraPositioned: true, validLayout: true, routeAttached: true) {
                onSnapshotReady?()
            }
            #if DEBUG
            if let diagnostics { recordSnapshot(mapView, diagnostics: diagnostics) }
            #endif
        }

        #if DEBUG
        private func recordSnapshot(_ mapView: GMSMapView, diagnostics: MapRenderDiagnostics) {
            // Only project synthetic route geometry after validated fixture diagnostics exist.
            let points = lastCoordinates.map {
                mapView.projection.point(for: CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude))
            }
            guard !points.isEmpty, points.allSatisfy({ $0.x.isFinite && $0.y.isFinite }) else { return }
            let projected = ProjectedRouteBounds(minX: Double(points.map(\.x).min()!),
                minY: Double(points.map(\.y).min()!), maxX: Double(points.map(\.x).max()!),
                maxY: Double(points.map(\.y).max()!))
            let bounds = mapView.bounds
            let fits = projected.minX >= -1 && projected.minY >= -1 &&
                projected.maxX <= bounds.width + 1 && projected.maxY <= bounds.height + 1
            diagnostics.snapshot(viewSize: bounds.size, zoom: Double(mapView.camera.zoom),
                routePointCount: lastCoordinates.count, projected: projected, fits: fits)
        }
        #endif
    }
}
