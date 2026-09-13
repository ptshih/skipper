import SwiftUI

struct DrivingView: View {
    @Bindable var controller: DrivePlaybackController
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @AppStorage("skipper.drivePlayerView") private var playerView = "map"
    @AppStorage("skipper.simMode") private var simMode = "0"
    @State private var confirmEnd = false
    @State private var showSources = false
    @State private var sourceCredits: [StorageAttribution] = []
    @State private var showDiagnostics = false
    @State private var scrubPosition: Double = 0
    @State private var scrubbing = false

    var body: some View {
        VStack(spacing: 0) {
            header
            if controller.phase == .driving {
                if dynamicTypeSize.isAccessibilitySize {
                    ScrollView { routePresentation.frame(height: 240); player }
                } else {
                    routePresentation
                    player
                }
            } else {
                ScrollView { gate.padding(TrailheadSpace.large) }
            }
        }
        .background(TrailheadColors.surface)
        .foregroundStyle(TrailheadColors.ink)
        .navigationTitle("Ride with Skipper")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("Close", systemImage: "xmark") {
                    if controller.phase == .driving { confirmEnd = true }
                    else { controller.stop(); dismiss() }
                }
            }
            if controller.canAdmin {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Driving diagnostics", systemImage: "wrench.and.screwdriver") { showDiagnostics = true }
                }
            }
        }
        .confirmationDialog("Pull over and end this drive?", isPresented: $confirmEnd, titleVisibility: .visible) {
            Button("End drive", role: .destructive) { controller.stop(); dismiss() }
            Button("Keep rolling", role: .cancel) {}
        }
        .sheet(isPresented: $showSources) { sources }
        .sheet(isPresented: $showDiagnostics) { diagnostics }
        .onDisappear { controller.stop() }
        .accessibilityIdentifier("driving-screen")
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: TrailheadSpace.small) {
            HStack {
                Text("SKIPPER").font(TrailheadType.wordmark)
                Spacer()
                Text("\(controller.playedSeqs.count) / \(controller.stops.count) stops").font(TrailheadType.mono)
            }
            Text(controller.detail?.label ?? "Your drive").font(TrailheadType.bodyStrong)
            if controller.phase == .driving {
                ProgressView(value: controller.progress).tint(TrailheadColors.accent)
                    .accessibilityLabel("Route progress")
                if controller.simulation { Text("SIMULATION").font(TrailheadType.mono).foregroundStyle(TrailheadColors.accentWarm) }
                if controller.gpsSearching {
                    Label("Searching for GPS…", systemImage: "location.magnifyingglass")
                        .font(TrailheadType.caption).foregroundStyle(TrailheadColors.inkDim)
                }
            }
        }
        .padding(TrailheadSpace.medium)
    }

    @ViewBuilder private var routePresentation: some View {
        ZStack(alignment: .topTrailing) {
            if playerView == "map" {
                DrivingMapPresentation(coordinates: controller.coordinates,
                               currentCoordinate: controller.fix.map { Coordinate(longitude: $0.lng, latitude: $0.lat) },
                               heading: controller.fix?.headingDeg,
                               stops: controller.stops.compactMap { stop in
                    guard let lat = stop.lat, let lng = stop.lng else { return nil }
                    return MapStopMarker(seq: stop.seq, name: stop.name ?? "Stop", latitude: lat, longitude: lng,
                                         kind: stop.form, state: controller.activeSeq == stop.seq ? .playing : controller.playedSeqs.contains(stop.seq) ? .passed : .upcoming)
                }, selectedStopSeq: controller.activeSeq, onSelectStop: { controller.replayStop($0) })
                .equatable()
                .accessibilityLabel("Driving route map")
            } else {
                ScrollViewReader { proxy in
                    List(controller.stops, id: \.seq) { stop in
                        Button { controller.replayStop(stop.seq) } label: {
                            HStack(spacing: TrailheadSpace.medium) {
                                Image(systemName: controller.activeSeq == stop.seq ? "waveform" : controller.playedSeqs.contains(stop.seq) ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(controller.activeSeq == stop.seq ? TrailheadColors.accentWarm : TrailheadColors.accent)
                                VStack(alignment: .leading) {
                                    Text(stop.name ?? "Stop \(stop.seq + 1)").font(TrailheadType.bodyStrong)
                                    Text(controller.skippedSeqs.contains(stop.seq) ? "Passed — audio unavailable" : stop.form.capitalized)
                                        .font(TrailheadType.caption).foregroundStyle(TrailheadColors.inkDim)
                                }
                                Spacer()
                                if controller.isReplayable(stop.seq) { Image(systemName: "arrow.counterclockwise") }
                            }
                            .frame(minHeight: TrailheadSpace.minimumHit)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .listRowBackground(controller.activeSeq == stop.seq ? TrailheadColors.surfaceSunken : TrailheadColors.surface)
                        .id(stop.seq)
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                    .onChange(of: controller.activeSeq) { _, seq in if let seq { proxy.scrollTo(seq, anchor: .center) } }
                }
            }
            Button { playerView = playerView == "map" ? "list" : "map" } label: {
                Image(systemName: playerView == "map" ? "list.bullet" : "map")
                    .frame(width: TrailheadSpace.minimumHit, height: TrailheadSpace.minimumHit)
                    .background(TrailheadColors.surfaceRaised, in: Circle())
            }
            .accessibilityLabel(playerView == "map" ? "Show stop list" : "Show map")
            .padding(TrailheadSpace.small)
        }
        .frame(minHeight: 120)
    }

    private var player: some View {
        VStack(spacing: TrailheadSpace.small) {
            HStack {
                Text(controller.activeSeq == nil ? "ON THE ROAD" : controller.paused || controller.interrupted ? "PAUSED" : "NOW PLAYING")
                    .font(TrailheadType.monoStrong).foregroundStyle(TrailheadColors.accentWarm)
                Spacer()
                if !(controller.activeStop?.attribution ?? []).isEmpty {
                    Button("Sources", systemImage: "info.circle") { sourceCredits = controller.activeStop?.attribution ?? []; showSources = true }
                        .labelStyle(.iconOnly).frame(minWidth: TrailheadSpace.minimumHit, minHeight: TrailheadSpace.minimumHit)
                }
            }
            Text(controller.activeStop?.name ?? nextStopText)
                .font(TrailheadType.title).frame(maxWidth: .infinity, alignment: .leading)
            if controller.buffering { ProgressView("Getting the recording ready…").font(TrailheadType.caption) }
            if controller.canSeek {
                Slider(value: Binding(get: { scrubbing ? scrubPosition : controller.position }, set: { scrubPosition = $0 }), in: 0...max(0.1, controller.duration), onEditingChanged: { editing in
                    if editing { scrubPosition = controller.position; scrubbing = true; controller.setScrubbing(true) }
                    else { controller.seek(to: scrubPosition); scrubbing = false; controller.setScrubbing(false) }
                })
                .tint(TrailheadColors.accent)
                .accessibilityLabel("Narration position")
                HStack { Text(clock(controller.position)); Spacer(); Text(clock(controller.duration)) }.font(TrailheadType.mono)
            }
            if let note = controller.error ?? controller.stallNote { Text(note).font(TrailheadType.caption).foregroundStyle(TrailheadColors.inkDim) }
            HStack(spacing: TrailheadSpace.medium) {
                transport("Back 15 seconds", icon: "gobackward.15", enabled: controller.canSeek) { controller.seekBy(-15) }
                primary(controller.paused || controller.interrupted ? "Resume" : "Pause", icon: controller.paused || controller.interrupted ? "play.fill" : "pause.fill") { controller.togglePause() }
                    .disabled(controller.interrupted)
                transport("Forward 15 seconds", icon: "goforward.15", enabled: controller.canSeek) { controller.seekBy(15) }
            }
            HStack {
                Button("Replay last stop", systemImage: "arrow.counterclockwise") { controller.replayLast() }
                    .disabled(!controller.canReplay).frame(minHeight: TrailheadSpace.minimumHit)
                Spacer()
                Button("Pull over") { confirmEnd = true }.frame(minHeight: TrailheadSpace.minimumHit)
            }
            .font(TrailheadType.caption)
        }
        .padding(TrailheadSpace.medium)
        .background(TrailheadColors.surfaceRaised)
    }

    private var nextStopText: String {
        if let next = controller.stops.first(where: { $0.seq == controller.nextSeq }) { return "Coming up: \(next.name ?? "your next stop")" }
        return "Enjoy the road. I'll pipe up when we're there."
    }
    @ViewBuilder private var gate: some View {
        VStack(spacing: TrailheadSpace.large) {
            Image(systemName: controller.phase == .done ? "checkmark.seal" : "car.side").font(.largeTitle).foregroundStyle(TrailheadColors.accent)
            switch controller.phase {
            case .done:
                Text("That's a wrap, road crew.").font(TrailheadType.display)
                Text("\(controller.playedSeqs.subtracting(controller.skippedSeqs).count) stops heard. Thanks for riding along.").font(TrailheadType.body)
                primary("Ride again", icon: "arrow.counterclockwise") { controller.start(simulate: controller.canAdmin && simMode == "1") }
                Button("Back to your drive") { dismiss() }.frame(minHeight: TrailheadSpace.minimumHit)
            case .locationPrime:
                Text("Let Skipper follow the road.").font(TrailheadType.display)
                Text("Precise Location lets me time each story to the places you pass. Keep Skipper open while driving; your route stays on this phone.").font(TrailheadType.body)
                primary("Allow location", icon: "location") { controller.confirmLocationPermission() }
            case .locationDenied, .locationReduced:
                Text("Let's get our bearings.").font(TrailheadType.display)
                Text("In Settings, allow Skipper to use your location While Using the App and turn on Precise Location. Come back here when you're ready.").font(TrailheadType.body)
                primary("Open Settings", icon: "gearshape") { if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) } }
            case .empty:
                ContentUnavailableView("Save your drive first", systemImage: "arrow.down.circle", description: Text("This drive needs local recordings before we can roll."))
            default:
                Text("The road's ready when you are.").font(TrailheadType.display)
                Text("Keep Skipper open and your eyes on the road. I'll handle the stories.").font(TrailheadType.body)
                if controller.missingClipCount > 0 {
                    Text("\(controller.missingClipCount) recordings aren't saved on this phone. Those stops will be quiet.")
                        .font(TrailheadType.body).foregroundStyle(TrailheadColors.inkDim)
                }
                if let error = controller.error { Text(error).font(TrailheadType.body).foregroundStyle(TrailheadColors.danger) }
                if controller.needsDownload {
                    Text("Head back to finish saving this drive before setting off.").font(TrailheadType.body)
                    Button("Back to your drive") { dismiss() }.frame(minHeight: TrailheadSpace.primaryHit)
                } else {
                    primary(controller.canAdmin && simMode == "1" ? "Simulate drive" : "Let's roll", icon: "play.fill") { controller.start(simulate: controller.canAdmin && simMode == "1") }
                        .accessibilityIdentifier("start-drive")
                }
            }
        }
        .multilineTextAlignment(.center)
    }

    private func primary(_ title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: icon).font(TrailheadType.bodyStrong)
                .frame(maxWidth: .infinity, minHeight: TrailheadSpace.primaryHit)
                .foregroundStyle(TrailheadColors.onPrimary)
                .background(TrailheadColors.primaryFill, in: RoundedRectangle(cornerRadius: TrailheadSpace.medium))
        }.buttonStyle(.plain)
    }
    private func transport(_ label: String, icon: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) { Image(systemName: icon).font(.title2).frame(minWidth: TrailheadSpace.minimumHit, minHeight: TrailheadSpace.minimumHit) }
            .accessibilityLabel(label).disabled(!enabled)
    }
    private func clock(_ seconds: Double) -> String { let value = Int(max(0, seconds)); return String(format: "%d:%02d", value / 60, value % 60) }

    private var sources: some View {
        NavigationStack {
            List(Array(sourceCredits.enumerated()), id: \.offset) { _, source in
                VStack(alignment: .leading, spacing: TrailheadSpace.small) {
                    Text(source.title ?? source.sourceId ?? "Source").font(TrailheadType.bodyStrong)
                    if let url = safeLink(source.url) { Link("Read source", destination: url) }
                    if let license = source.license { Text(license).font(TrailheadType.caption) }
                }
            }
            .navigationTitle("Sources & licenses")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { showSources = false } } }
        }
    }
    private func safeLink(_ value: String?) -> URL? {
        guard let value, let url = URL(string: value), ["https", "http"].contains(url.scheme?.lowercased() ?? "") else { return nil }; return url
    }
    private var diagnostics: some View {
        DrivingDiagnosticsView(controller: controller, onClose: { showDiagnostics = false })
    }
}

/// Narration clocks update the surrounding player five times a second; only a changed
/// route, fix, or stop state should ask the native map to redraw or move its camera.
private struct DrivingMapPresentation: View, Equatable {
    let coordinates: [Coordinate]
    let currentCoordinate: Coordinate?
    let heading: Double?
    let stops: [MapStopMarker]
    let selectedStopSeq: Int?
    let onSelectStop: (Int) -> Void
    nonisolated static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.coordinates == rhs.coordinates && lhs.currentCoordinate == rhs.currentCoordinate &&
        lhs.heading == rhs.heading && lhs.stops == rhs.stops && lhs.selectedStopSeq == rhs.selectedStopSeq
    }
    var body: some View {
        GoogleRouteMap(coordinates: coordinates, currentCoordinate: currentCoordinate, heading: heading,
                       stops: stops, selectedStopSeq: selectedStopSeq, onSelectStop: onSelectStop)
    }
}
