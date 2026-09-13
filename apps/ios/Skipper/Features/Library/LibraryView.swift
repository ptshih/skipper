import SwiftUI

struct LibraryView: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var viewModel: LibraryViewModel
    let onOpenDrive: @MainActor (String) -> Void
    let onOpenPlanner: @MainActor () -> Void
    let onSignIn: @MainActor () -> Void

    init(
        api: any SkipperAPI,
        session: SessionStore,
        storage: StorageService? = nil,
        analytics: AnalyticsTracker? = nil,
        onOpenDrive: @escaping @MainActor (String) -> Void,
        onOpenPlanner: @escaping @MainActor () -> Void,
        onSignIn: @escaping @MainActor () -> Void
    ) {
        _viewModel = State(initialValue: LibraryViewModel(
            api: api,
            session: session,
            storage: storage,
            analytics: analytics
        ))
        self.onOpenDrive = onOpenDrive
        self.onOpenPlanner = onOpenPlanner
        self.onSignIn = onSignIn
    }

    init(
        viewModel: LibraryViewModel,
        onOpenDrive: @escaping @MainActor (String) -> Void,
        onOpenPlanner: @escaping @MainActor () -> Void,
        onSignIn: @escaping @MainActor () -> Void
    ) {
        _viewModel = State(initialValue: viewModel)
        self.onOpenDrive = onOpenDrive
        self.onOpenPlanner = onOpenPlanner
        self.onSignIn = onSignIn
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Offline fallback banner
                if viewModel.isOfflineFallback {
                    HStack(spacing: TrailheadSpace.sm) {
                        Image(systemName: "wifi.slash")
                            .foregroundColor(TrailheadColors.accentWarm)
                        Text(viewModel.drives.isEmpty ? "You’re offline" : "Using saved offline drives")
                            .font(TrailheadType.caption)
                            .foregroundColor(TrailheadColors.ink)
                            .lineLimit(nil)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer()
                    }
                    .padding(.horizontal, TrailheadSpace.md)
                    .padding(.vertical, TrailheadSpace.xs)
                    .background(TrailheadColors.accentWarm.opacity(0.15))
                }

                // Credit Hint Banner if <= 5
                if let credits = viewModel.credits, credits.remaining <= 5 {
                    CreditHintView(remaining: credits.remaining, cap: credits.cap)
                        .padding(.horizontal, TrailheadSpace.md)
                        .padding(.top, TrailheadSpace.sm)
                }

                // Region filter chips (only offered when multiple regions are represented)
                if viewModel.shouldOfferRegionFilter {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: TrailheadSpace.sm) {
                            FilterChip(
                                title: "All",
                                isSelected: viewModel.selectedRegion == nil
                            ) {
                                viewModel.selectRegion(nil)
                            }

                            ForEach(viewModel.facets) { facet in
                                FilterChip(
                                    title: facet.displayName,
                                    isSelected: viewModel.selectedRegion == facet.id
                                ) {
                                    viewModel.selectRegion(facet.id)
                                }
                            }
                        }
                        .padding(.horizontal, TrailheadSpace.md)
                        .padding(.vertical, TrailheadSpace.sm)
                    }
                }

                // Content list
                if AccountEntryPolicy.canOfferSignIn(in: viewModel.session.state) && viewModel.drives.isEmpty {
                    emptyState
                } else if viewModel.session.state == .deferred && viewModel.drives.isEmpty {
                    ContentUnavailableView("Verifying your account", systemImage: "lock",
                        description: Text("Your saved drives will be available after account verification. You can still use the planner."))
                } else if viewModel.isOfflineFallback && viewModel.drives.isEmpty && !viewModel.isLoading {
                    ContentUnavailableView("No drives available offline", systemImage: "arrow.down.circle",
                        description: Text("Go online to view your library and download a drive."))
                        .accessibilityIdentifier("library.empty")
                } else if viewModel.drives.isEmpty, let message = viewModel.errorMessage {
                    ScrollView { loadError(message).padding(TrailheadSpace.md) }
                } else if viewModel.filteredDrives.isEmpty && !viewModel.isLoading {
                    emptyState
                } else {
                    drivesList
                }
            }
            .background(TrailheadColors.background.ignoresSafeArea())
            .navigationTitle("My Drives")
            .navigationBarTitleDisplayMode(.large)
            .overlay(alignment: .topLeading) {
                Color.clear
                    .frame(width: 1, height: 1)
                    .accessibilityIdentifier("screen.library")
                    .accessibilityElement(children: .ignore)
            }
            .onChange(of: viewModel.session.user?.id) { _, _ in viewModel.reconcileSession() }
            .task(id: viewModel.session.user?.id) {
                await viewModel.loadDrives()
            }
            .refreshable {
                await viewModel.loadDrives()
            }
        }
    }

    private func loadError(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: TrailheadSpace.sm) {
            Text("Could not refresh My Drives")
                .font(TrailheadType.headline)
                .foregroundColor(TrailheadColors.ink)
            Text(message)
                .font(TrailheadType.body)
                .foregroundColor(TrailheadColors.inkMuted)
                .accessibilityIdentifier("library.error")
            Button("Try Again") { Task { await viewModel.loadDrives() } }
                .buttonStyle(.bordered)
                .disabled(viewModel.isLoading)
                .accessibilityIdentifier("library.retry")
        }
        .lineLimit(nil)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Drives List

    private var drivesList: some View {
        List {
            if let message = viewModel.errorMessage {
                loadError(message)
                    .listRowBackground(TrailheadColors.background)
            }
            ForEach(viewModel.filteredDrives) { drive in
                Button {
                    onOpenDrive(drive.driveId)
                } label: {
                    HStack(alignment: .top, spacing: TrailheadSpace.md) {
                        // Icon thumbnail
                        ZStack {
                            RoundedRectangle(cornerRadius: TrailheadSpace.radiusSm)
                                .fill(TrailheadColors.surfaceRaised)
                                .frame(width: 48, height: 48)
                                .overlay(
                                    RoundedRectangle(cornerRadius: TrailheadSpace.radiusSm)
                                        .stroke(TrailheadColors.borderFaint, lineWidth: 1)
                                )

                            Image(systemName: "steeringwheel")
                                .font(.system(size: 22))
                                .foregroundColor(TrailheadColors.accent)
                        }

                        VStack(alignment: .leading, spacing: TrailheadSpace.xs) {
                            Text(drive.title)
                                .font(TrailheadType.headline)
                                .foregroundColor(TrailheadColors.ink)
                                .lineLimit(nil)
                                .fixedSize(horizontal: false, vertical: true)

                            if let subtitle = drive.subtitle {
                                Text(subtitle)
                                    .font(TrailheadType.caption)
                                    .foregroundColor(TrailheadColors.inkMuted)
                                    .lineLimit(nil)
                                    .fixedSize(horizontal: false, vertical: true)
                            }

                            if dynamicTypeSize.isAccessibilitySize {
                                VStack(alignment: .leading, spacing: TrailheadSpace.xs) {
                                    Text("\(drive.stopCount) stops")
                                        .font(TrailheadType.caption)
                                        .foregroundColor(TrailheadColors.inkMuted)

                                    if let mins = drive.estMinutes {
                                        Text("\(mins) min")
                                            .font(TrailheadType.caption)
                                            .foregroundColor(TrailheadColors.inkMuted)
                                    }

                                    downloadBadge(for: drive.downloadState)
                                }
                            } else {
                                HStack(spacing: TrailheadSpace.sm) {
                                    Text("\(drive.stopCount) stops")
                                        .font(TrailheadType.caption)
                                        .foregroundColor(TrailheadColors.inkMuted)

                                    if let mins = drive.estMinutes {
                                        Text("·")
                                            .foregroundColor(TrailheadColors.inkMuted)
                                        Text("\(mins) min")
                                            .font(TrailheadType.caption)
                                            .foregroundColor(TrailheadColors.inkMuted)
                                    }

                                    downloadBadge(for: drive.downloadState)
                                }
                            }
                        }

                        Spacer()

                        Image(systemName: "chevron.right")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundColor(TrailheadColors.inkMuted)
                            .padding(.top, TrailheadSpace.sm)
                    }
                    .padding(.vertical, TrailheadSpace.xs)
                }
                .listRowBackground(TrailheadColors.background)
                .accessibilityIdentifier("library.drive.\(drive.driveId)")
            }
        }
        .listStyle(.plain)
        .safeAreaInset(edge: .bottom) {
            Color.clear.frame(height: 70)
        }
    }

    @ViewBuilder
    private func downloadBadge(for state: LibraryDownloadState) -> some View {
        switch state {
        case .notDownloaded:
            EmptyView()
        case .complete:
            if !dynamicTypeSize.isAccessibilitySize {
                Text("·")
                    .foregroundColor(TrailheadColors.inkMuted)
            }
            HStack(spacing: 2) {
                Image(systemName: "arrow.down.circle.fill")
                    .font(.system(size: 10))
                Text("Downloaded")
                    .font(TrailheadType.caption)
            }
            .foregroundColor(TrailheadColors.accent)
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Downloaded")
            .accessibilityIdentifier("library.badge.downloaded")
        case .partial(let downloaded, let total):
            if !dynamicTypeSize.isAccessibilitySize {
                Text("·")
                    .foregroundColor(TrailheadColors.inkMuted)
            }
            HStack(spacing: 2) {
                Image(systemName: "arrow.down.circle")
                    .font(.system(size: 10))
                Text("Downloaded (\(downloaded) of \(total))")
                    .font(TrailheadType.caption)
            }
            .foregroundColor(TrailheadColors.accentWarm)
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Downloaded (\(downloaded) of \(total))")
            .accessibilityIdentifier("library.badge.partial")
        }
    }

    // MARK: - Empty State

    private var emptyState: some View {
        ScrollView {
            VStack(spacing: TrailheadSpace.lg) {
                Spacer()
                    .frame(height: TrailheadSpace.xl)

                Image(systemName: "map")
                    .font(.system(size: 48))
                    .foregroundColor(TrailheadColors.inkMuted)

                VStack(spacing: TrailheadSpace.xs) {
                    Text("No drives here yet")
                        .font(TrailheadType.title)
                        .foregroundColor(TrailheadColors.ink)
                        .multilineTextAlignment(.center)
                        .lineLimit(nil)
                        .fixedSize(horizontal: false, vertical: true)

                    Text("Create a drive in the planner to see it in your library.")
                        .font(TrailheadType.body)
                        .foregroundColor(TrailheadColors.inkMuted)
                        .multilineTextAlignment(.center)
                        .lineLimit(nil)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, TrailheadSpace.lg)
                }

                TrailheadButton(
                    "Plan a Drive",
                    icon: "plus",
                    variant: .primary
                ) {
                    onOpenPlanner()
                }
                .padding(.horizontal, TrailheadSpace.lg)

                Spacer()
            }
            .padding(TrailheadSpace.md)
            .frame(maxWidth: .infinity)
        }
        .accessibilityIdentifier("library.empty")
    }
}
