import SwiftUI

struct DriveDetailView: View {
    @State private var viewModel: DriveDetailViewModel
    let onStartDrive: @MainActor (String, DriveManifest) -> Void
    let onBack: @MainActor () -> Void
    let onDeleted: @MainActor (String) -> Void
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var isShowingAttributions = false
    @State private var isShowingDeleteConfirm = false
    @State private var isShowingAuth = false
    @State private var scrubPosition: Double?

    init(driveId: String, api: any SkipperAPI, storage: StorageService? = nil,
         session: SessionStore? = nil, audio: (any AudioPreviewControlling)? = nil,
         analytics: AnalyticsTracker? = nil, network: any NetworkAvailability = UnknownNetworkAvailability(),
         onStartDrive: @escaping @MainActor (String, DriveManifest) -> Void,
         onBack: @escaping @MainActor () -> Void,
         onDeleted: @escaping @MainActor (String) -> Void = { _ in }) {
        _viewModel = State(initialValue: DriveDetailViewModel(driveId: driveId, api: api, storage: storage,
            session: session, audio: audio, analytics: analytics, network: network))
        self.onStartDrive = onStartDrive; self.onBack = onBack
        self.onDeleted = onDeleted
    }

    var body: some View {
        Group {
            if viewModel.needsAccount {
                accountWall
            } else if let manifest = viewModel.manifest {
                content(for: manifest)
            } else if viewModel.isLoading {
                ProgressView("Loading drive…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    VStack(spacing: TrailheadSpace.large) {
                        Text(viewModel.errorMessage ?? "Could not load drive")
                            .font(TrailheadType.body)
                            .foregroundStyle(TrailheadColors.danger)
                        TrailheadButton("Retry", variant: .secondary) { Task { await viewModel.load() } }
                    }.padding(TrailheadSpace.large)
                }
            }
        }
        .background(TrailheadColors.surface.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await viewModel.load()
            await viewModel.observeWhileVisible()
        }
        .onDisappear { viewModel.endPresentation() }
        .onChange(of: viewModel.session?.user?.id) { _, _ in
            viewModel.accountDidChange()
            if viewModel.session?.isSignedIn == true { Task { await viewModel.load() } }
        }
        .toolbar { ToolbarItem(placement: .topBarTrailing) { utilityMenu } }
        .sheet(isPresented: $isShowingAttributions) {
            if let manifest = viewModel.manifest {
                AttributionSheet(attributions: manifest.clips.compactMap(\.attribution).flatMap { $0 })
            }
        }
        .sheet(isPresented: $isShowingAuth) {
            if let session = viewModel.session {
                AuthView(session: session, analytics: viewModel.analytics, onSuccess: {
                    isShowingAuth = false
                    Task { await viewModel.load() }
                }, onCancel: { isShowingAuth = false })
            }
        }
        .alert("Delete this drive?", isPresented: $isShowingDeleteConfirm) {
            Button("Cancel", role: .cancel) {}
            Button("Delete", role: .destructive) {
                Task {
                    await viewModel.deleteDrive { id in
                        onDeleted(id)
                        onBack()
                    }
                }
            }
        } message: {
            Text("This permanently removes the drive and its download. It won’t return the credit used to create it.")
        }
    }

    private var accountWall: some View {
        ScrollView {
            VStack(spacing: TrailheadSpace.large) {
                Text("Sign in to open your drive")
                    .font(TrailheadType.display)
                    .accessibilityIdentifier("drive.account-wall")
                Text("Your saved drives belong to your account.").font(TrailheadType.body)
                if let session = viewModel.session, AccountEntryPolicy.canOfferSignIn(in: session.state) {
                    TrailheadButton("Sign in") { isShowingAuth = true }
                } else if let session = viewModel.session, AccountEntryPolicy.canOfferRecovery(for: session) {
                    TrailheadButton("Sign in again") { isShowingAuth = true }
                } else if let session = viewModel.session {
                    TrailheadButton("Retry account check", variant: .secondary) {
                        Task { await session.retry(); await viewModel.load() }
                    }
                }
                TrailheadButton("Keep browsing", variant: .ghost, action: onBack)
            }
            .foregroundStyle(TrailheadColors.ink)
            .padding(TrailheadSpace.large)
        }
    }

    private var utilityMenu: some View {
        Menu {
            if let manifest = viewModel.manifest, !viewModel.needsAccount {
                if !manifest.clips.compactMap(\.attribution).flatMap({ $0 }).isEmpty {
                    Button("Sources & Attributions", systemImage: "info.circle") { isShowingAttributions = true }
                }
                if viewModel.isDownloading {
                    Button("Cancel download", role: .destructive) { Task { await viewModel.cancelDownload() } }
                } else {
                    if viewModel.isUpdatable {
                        Button("Update download") { Task { await viewModel.startDownload() } }.disabled(viewModel.isOffline)
                    } else if viewModel.hasLocalAudio && viewModel.missingCount > 0 {
                        Button("Download remaining audio") { Task { await viewModel.startDownload() } }.disabled(viewModel.isOffline)
                    } else if viewModel.isExpired {
                        Button("Refresh download") { Task { await viewModel.startDownload() } }.disabled(viewModel.isOffline)
                    }
                    if !viewModel.hasLocalAudio {
                        if viewModel.directoryState != .none {
                            Button("Repair download") { Task { await viewModel.repairDownload() } }
                                .disabled(viewModel.isOffline || viewModel.isRepairing)
                        }
                        Button("Download for offline") { Task { await viewModel.startDownload() } }.disabled(viewModel.isOffline)
                    }
                    if viewModel.directoryState != .none {
                        Button("Remove download", role: .destructive) { Task { await viewModel.purgeDownload() } }
                    }
                }
                if let mailURL = URL(string: "mailto:hello@skipper.fm?subject=Issue%20with%20drive%20\(viewModel.driveId)") {
                    Link("Report an Issue", destination: mailURL)
                }
                Button("Delete Drive", role: .destructive) { isShowingDeleteConfirm = true }
            }
        } label: {
            Image(systemName: "ellipsis.circle")
                .frame(minWidth: TrailheadSpace.minimumHit, minHeight: TrailheadSpace.minimumHit)
                .accessibilityLabel("Drive actions")
        }
        .accessibilityIdentifier("drive.actions")
    }

    private func content(for manifest: DriveManifest) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TrailheadSpace.large) {
                headerSection(manifest)
                startAndDownloadActions
                Picker("View", selection: Binding(get: { viewModel.selectedTab }, set: viewModel.selectTab)) {
                    ForEach(DriveDetailTab.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                if viewModel.selectedTab == .list {
                    LazyVStack(spacing: TrailheadSpace.medium) {
                        ForEach(manifest.clips, id: \.seq) { clip in stopRow(clip) }
                    }
                } else {
                    mapView(manifest).frame(height: 360)
                }
                if dynamicTypeSize.isAccessibilitySize { previewPlayer }
            }
            .padding(TrailheadSpace.medium)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            // Large text keeps all controls in the scroll flow instead of consuming the SE viewport.
            if !dynamicTypeSize.isAccessibilitySize { previewPlayer }
        }
    }

    private func headerSection(_ manifest: DriveManifest) -> some View {
        VStack(alignment: .leading, spacing: TrailheadSpace.small) {
            Text(manifest.label.isEmpty ? "Your drive" : manifest.label)
                .font(TrailheadType.display)
                .foregroundStyle(TrailheadColors.ink)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("drive.title")
            Text(routeSummary(manifest))
                .font(TrailheadType.caption)
                .foregroundStyle(TrailheadColors.inkDim)
                .fixedSize(horizontal: false, vertical: true)
        }
        // Explicit containment keeps the screen marker separate from the actual title;
        // an implicit container identifier can replace its descendants' identifiers.
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("screen.drive-detail")
    }

    private var startAndDownloadActions: some View {
        VStack(alignment: .leading, spacing: TrailheadSpace.medium) {
            if viewModel.hasLocalAudio && viewModel.missingCount > 0 {
                Text(viewModel.isOffline
                     ? "\(viewModel.missingCount) of \(viewModel.expectedCount) audio stops aren’t saved. You can drive with the audio on this phone; missing stops will be skipped."
                     : "\(viewModel.missingCount) of \(viewModel.expectedCount) audio stops left to save. Finish the download before starting.")
                    .font(TrailheadType.caption)
                    .foregroundStyle(TrailheadColors.inkDim)
                    .accessibilityIdentifier("drive.missing-summary")
            } else if viewModel.hasLocalAudio {
                Text("Saved offline").font(TrailheadType.caption).foregroundStyle(TrailheadColors.accent)
            }
            if viewModel.isUpdatable || viewModel.isExpired {
                Text(viewModel.isUpdatable ? "Updated audio is available. Your saved copy is still playable." : "This saved copy is getting old. Refresh it when you have a connection.")
                    .font(TrailheadType.caption).foregroundStyle(TrailheadColors.inkDim)
                    .accessibilityIdentifier("drive.refresh-summary")
            }
            if viewModel.isDownloading {
                Text("Saving audio: \(viewModel.downloadDone) of \(viewModel.downloadTotal)")
                    .font(TrailheadType.caption)
                ProgressView(value: Double(viewModel.downloadDone), total: Double(max(1, viewModel.downloadTotal)))
                TrailheadButton("Cancel download", variant: .secondary) { Task { await viewModel.cancelDownload() } }
            } else if viewModel.gate != .play {
                Text(viewModel.isOffline ? "Connect to download audio before starting this drive." : "Save the audio before you set off. Highways often lose cell coverage.")
                    .font(TrailheadType.caption).foregroundStyle(TrailheadColors.inkDim)
                TrailheadButton("Download", icon: "arrow.down.circle", variant: .secondary,
                    isLoading: viewModel.isRepairing, isEnabled: !viewModel.isOffline && !viewModel.isRepairing) {
                    Task { await viewModel.startDownload() }
                }
                .accessibilityIdentifier("drive.download")
            }
            if let error = viewModel.downloadError ?? viewModel.errorMessage {
                Text(error).font(TrailheadType.caption).foregroundStyle(TrailheadColors.danger)
            }
            TrailheadButton("Start Drive", icon: "location.fill", isEnabled: viewModel.gate == .play) {
                Task {
                    if let manifest = await viewModel.prepareToStart() { onStartDrive(viewModel.driveId, manifest) }
                }
            }
            .accessibilityIdentifier("drive.start")
        }
    }

    private func stopRow(_ clip: DriveClip) -> some View {
        VStack(alignment: .leading, spacing: TrailheadSpace.small) {
            Text(clip.name ?? "Stop \(clip.seq)")
                .font(TrailheadType.bodyStrong).foregroundStyle(TrailheadColors.ink)
            Text(clip.form.rawValue.capitalized)
                .font(TrailheadType.caption).foregroundStyle(TrailheadColors.accent)
            if viewModel.isStopAuditionable(seq: clip.seq) {
                Button {
                    Task { await viewModel.auditionStop(seq: clip.seq) }
                } label: {
                    Label(viewModel.auditionStopSeq == clip.seq && viewModel.previewPlaying ? "Pause preview" : "Preview stop",
                          systemImage: viewModel.auditionStopSeq == clip.seq && viewModel.previewPlaying ? "pause.circle.fill" : "play.circle")
                        .font(TrailheadType.bodyStrong)
                        .frame(minHeight: TrailheadSpace.minimumHit)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(TrailheadColors.accent)
                .accessibilityLabel("\(viewModel.auditionStopSeq == clip.seq && viewModel.previewPlaying ? "Pause" : "Preview") \(clip.name ?? "stop \(clip.seq)")")
                .accessibilityIdentifier("drive.preview.\(clip.seq)")
            } else {
                Text("Audio not saved on this phone").font(TrailheadType.caption).foregroundStyle(TrailheadColors.inkDim)
            }
            Divider()
        }
    }

    private func mapView(_ manifest: DriveManifest) -> some View {
        GoogleRouteMap(coordinates: manifest.polyline, stops: manifest.clips.compactMap { clip in
            guard let lat = clip.lat, let lng = clip.lng else { return nil }
            return MapStopMarker(seq: clip.seq, name: clip.name ?? "Stop \(clip.seq)", latitude: lat, longitude: lng,
                kind: clip.form.rawValue, state: viewModel.auditionStopSeq == clip.seq ? .playing : .upcoming)
        }, selectedStopSeq: viewModel.auditionStopSeq,
            onSelectStop: { seq in Task { await viewModel.auditionStop(seq: seq) } }, padding: 40)
    }

    @ViewBuilder private var previewPlayer: some View {
        if let seq = viewModel.auditionStopSeq {
            VStack(spacing: TrailheadSpace.small) {
                HStack(alignment: .top) {
                    Text(viewModel.manifest?.clips.first(where: { $0.seq == seq })?.name ?? "Stop \(seq)")
                        .font(TrailheadType.bodyStrong).frame(maxWidth: .infinity, alignment: .leading)
                    Button { isShowingAttributions = true } label: {
                        Image(systemName: "info.circle").frame(minWidth: 48, minHeight: 48)
                    }.accessibilityLabel("Sources & Attributions")
                    Button { viewModel.stopAudition() } label: {
                        Image(systemName: "xmark").frame(minWidth: 48, minHeight: 48)
                    }.accessibilityLabel("Close preview")
                }
                Slider(value: Binding(get: { scrubPosition ?? viewModel.previewPosition }, set: {
                    scrubPosition = $0
                    viewModel.seekPreview(to: $0)
                }), in: 0...max(1, viewModel.previewDuration), onEditingChanged: { editing in
                    if !editing { scrubPosition = nil }
                }) { Text("Preview position") }
                .disabled(!viewModel.canSeekPreview)
                .accessibilityIdentifier("drive.preview.scrubber")
                Text("\(time(viewModel.previewPosition)) / \(time(viewModel.previewDuration))")
                    .font(TrailheadType.mono).accessibilityIdentifier("drive.preview.time")
                HStack {
                    Button { viewModel.seekPreview(by: -15) } label: {
                        Image(systemName: "gobackward.15").frame(minWidth: 60, minHeight: 48)
                    }.disabled(!viewModel.canSeekPreview).accessibilityLabel("Back 15 seconds")
                    Spacer()
                    Button { Task { await viewModel.auditionStop(seq: seq) } } label: {
                        Image(systemName: viewModel.previewPlaying ? "pause.fill" : "play.fill").frame(minWidth: 60, minHeight: 48)
                    }.accessibilityLabel(viewModel.previewPlaying ? "Pause preview" : "Resume preview")
                    Spacer()
                    Button { viewModel.seekPreview(by: 15) } label: {
                        Image(systemName: "goforward.15").frame(minWidth: 60, minHeight: 48)
                    }.disabled(!viewModel.canSeekPreview).accessibilityLabel("Forward 15 seconds")
                }
                .font(.title2)
            }
            .padding(TrailheadSpace.medium)
            .foregroundStyle(TrailheadColors.ink)
            .background(TrailheadColors.surfaceRaised)
        }
    }

    private func routeSummary(_ manifest: DriveManifest) -> String {
        var parts = ["\(manifest.clips.count) \(manifest.clips.count == 1 ? "stop" : "stops")"]
        if let duration = manifest.durationSeconds { parts.insert("\(duration / 60) min", at: 0) }
        if let distance = manifest.distanceMeters { parts.append(String(format: "%.1f mi", Double(distance) / 1609.34)) }
        return parts.joined(separator: " · ")
    }
    private func time(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds >= 0, seconds < Double(Int.max) else { return "0:00" }
        let value = Int(seconds)
        return String(format: "%d:%02d", value / 60, value % 60)
    }
}
