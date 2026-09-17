import SwiftUI

struct PlannerView: View {
    @State private var viewModel: PlannerViewModel
    let audio: (any AudioPreviewControlling)?
    let onOpenDrive: @MainActor (String) -> Void
    let onOpenLibrary: @MainActor () -> Void
    let onSignIn: @MainActor () -> Void

    @State private var inputText: String = ""
    @State private var isShowingRegionPicker: Bool = false

    init(
        planner: any PlannerService,
        api: any SkipperAPI,
        session: SessionStore,
        storage: StorageService? = nil,
        audio: (any AudioPreviewControlling)? = nil,
        analytics: AnalyticsTracker? = nil,
        onOpenDrive: @escaping @MainActor (String) -> Void,
        onOpenLibrary: @escaping @MainActor () -> Void,
        onSignIn: @escaping @MainActor () -> Void
    ) {
        _viewModel = State(initialValue: PlannerViewModel(
            planner: planner,
            api: api,
            session: session,
            storage: storage,
            analytics: analytics
        ))
        self.audio = audio
        self.onOpenDrive = onOpenDrive
        self.onOpenLibrary = onOpenLibrary
        self.onSignIn = onSignIn
    }

    var body: some View {
        NavigationStack {
            // Transcript or empty state. The scroll view is the navigation content itself so the
            // transcript passes under the bar; see `trailheadTopBar` for why a VStack cannot.
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(spacing: TrailheadSpace.md) {
                        if viewModel.turns.isEmpty {
                            emptyStateHero
                        } else {
                            transcriptFlow
                        }
                        Color.clear.frame(height: 1).id("bottomAnchor")
                    }
                    .padding(.horizontal, TrailheadSpace.md)
                    .padding(.vertical, TrailheadSpace.md)
                }
                .onChange(of: viewModel.turns.count) { _, _ in
                    withAnimation {
                        proxy.scrollTo("bottomAnchor", anchor: .bottom)
                    }
                }
                .onChange(of: viewModel.streamingSay) { _, _ in
                    proxy.scrollTo("bottomAnchor", anchor: .bottom)
                }
                // Named because the growing composer is a text view, i.e. a second scroll view
                // in the tree; a test's "first scroll view" must not land on it.
                .accessibilityIdentifier("planner.transcript")
            }
            .trailheadTopBar { headerBar }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                VStack(spacing: 0) {
                    if let err = viewModel.errorMessage {
                        errorBanner(err)
                    }
                    composerBar
                }
            }
            .background(TrailheadColors.background.ignoresSafeArea())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                // No gear here: Settings is a persistent tab one tap away, and a second door to
                // it read as clutter (audit, 2026-09-16) — the same call as the My Drives shortcut.
                ToolbarItem(placement: .principal) {
                    Text("Skipper")
                        .font(TrailheadType.wordmark)
                        .foregroundColor(TrailheadColors.ink)
                }
            }
            .task {
                await viewModel.loadInitialData()
            }
            .onChange(of: viewModel.session.isSignedIn) { _, _ in
                viewModel.reconcileSessionState()
            }
            .sheet(isPresented: $isShowingRegionPicker) {
                regionPickerSheet
            }
            .overlay(alignment: .topLeading) {
                Color.clear
                    .frame(width: 1, height: 1)
                    .accessibilityIdentifier("screen.planner")
                    .accessibilityElement(children: .ignore)
            }
        }
    }

    // MARK: - Header Bar

    private var headerBar: some View {
        HStack {
            Button {
                isShowingRegionPicker = true
            } label: {
                HStack(spacing: TrailheadSpace.xs) {
                    Image(systemName: "mappin.circle.fill")
                        .foregroundColor(TrailheadColors.accentWarm)
                    Text(viewModel.selectedRegion?.displayName ?? "Select Region")
                        .font(TrailheadType.subheadline)
                        .foregroundColor(TrailheadColors.ink)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundColor(TrailheadColors.inkMuted)
                }
                .padding(.horizontal, TrailheadSpace.md)
                .padding(.vertical, TrailheadSpace.xs + 2)
                .background(TrailheadColors.surfaceRaised)
                .clipShape(Capsule())
                .overlay(
                    Capsule().stroke(TrailheadColors.borderFaint, lineWidth: 1)
                )
            }

            Spacer()

            if !viewModel.turns.isEmpty && !viewModel.isSessionDone {
                Button("Start fresh") {
                    viewModel.startFresh()
                }
                .font(TrailheadType.caption)
                .foregroundColor(TrailheadColors.inkMuted)
                .accessibilityIdentifier("planner.start-fresh")
            }
        }
        .padding(.horizontal, TrailheadSpace.md)
        .padding(.vertical, TrailheadSpace.xs)
    }

    // MARK: - Error Banner

    private func errorBanner(_ message: String) -> some View {
        HStack(spacing: TrailheadSpace.sm) {
            Image(systemName: "exclamationmark.circle.fill")
                .foregroundColor(TrailheadColors.danger)
            Text(message)
                .font(TrailheadType.caption)
                .foregroundColor(TrailheadColors.danger)
            Spacer()
            if viewModel.canRetryTurn {
                Button("Retry") {
                    Task {
                        await viewModel.retryTurn()
                    }
                }
                .font(TrailheadType.caption.bold())
                .foregroundColor(TrailheadColors.accent)
                .accessibilityIdentifier("planner.retry")
            }
        }
        .padding(TrailheadSpace.sm)
        .background(TrailheadColors.danger.opacity(0.1))
    }

    // MARK: - Empty State

    private var emptyStateHero: some View {
        VStack(spacing: TrailheadSpace.lg) {
            Spacer(minLength: TrailheadSpace.xl)

            VStack(spacing: TrailheadSpace.sm) {
                Text("Where would you like to drive?")
                    .font(TrailheadType.title)
                    .foregroundColor(TrailheadColors.ink)
                    .multilineTextAlignment(.center)

                Text("Ask for a scenic route, a coastal road, or an afternoon loop.")
                    .font(TrailheadType.body)
                    .foregroundColor(TrailheadColors.inkMuted)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, TrailheadSpace.lg)
            }

            // Example asks
            VStack(spacing: TrailheadSpace.sm) {
                exampleAskButton("A 45-minute mountain drive with nice views")
                exampleAskButton("A relaxing afternoon loop along the coast")
                exampleAskButton("A scenic route to grab coffee and see some sights")
            }
            .padding(.top, TrailheadSpace.sm)

            Spacer(minLength: TrailheadSpace.xl)
        }
        .accessibilityIdentifier("planner.empty")
    }

    private func exampleAskButton(_ prompt: String) -> some View {
        Button {
            inputText = prompt
            sendMessage()
        } label: {
            HStack {
                Text(prompt)
                    .font(TrailheadType.subheadline)
                    .foregroundColor(TrailheadColors.ink)
                Spacer()
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 12))
                    .foregroundColor(TrailheadColors.accent)
            }
            .padding(TrailheadSpace.md)
            .background(TrailheadColors.surfaceRaised)
            .clipShape(RoundedRectangle(cornerRadius: TrailheadSpace.radiusMd))
            .overlay(
                RoundedRectangle(cornerRadius: TrailheadSpace.radiusMd)
                    .stroke(TrailheadColors.borderFaint, lineWidth: 1)
            )
        }
    }

    // MARK: - Transcript Flow

    @ViewBuilder
    private var transcriptFlow: some View {
        ForEach(Array(viewModel.turns.enumerated()), id: \.offset) { index, turn in
            VStack(alignment: .leading, spacing: TrailheadSpace.sm) {
                if turn.role == .rider {
                    // The shipped client's rider bubble: a sunken well in ink, not a colored
                    // slab. `accent` is a text/glyph role and is lifted at dusk so glyphs read
                    // on night; as a fill under white it fails contrast (2026-09-16).
                    HStack {
                        Spacer(minLength: TrailheadSpace.xl)
                        Text(turn.text)
                            .font(TrailheadType.body)
                            .foregroundColor(TrailheadColors.ink)
                            .padding(TrailheadSpace.md)
                            .background(TrailheadColors.surfaceSunken)
                            .clipShape(RoundedRectangle(cornerRadius: TrailheadSpace.radiusMd))
                            .overlay(
                                RoundedRectangle(cornerRadius: TrailheadSpace.radiusMd)
                                    .stroke(TrailheadColors.borderFaint, lineWidth: 1)
                            )
                    }
                } else {
                    HStack {
                        Text(turn.text)
                            .font(TrailheadType.body)
                            .foregroundColor(TrailheadColors.ink)
                            .padding(TrailheadSpace.md)
                            .background(TrailheadColors.surfaceRaised)
                            .clipShape(RoundedRectangle(cornerRadius: TrailheadSpace.radiusMd))
                            .overlay(
                                RoundedRectangle(cornerRadius: TrailheadSpace.radiusMd)
                                    .stroke(TrailheadColors.borderFaint, lineWidth: 1)
                            )
                        Spacer(minLength: TrailheadSpace.xl)
                    }
                }

                // Render proposal cards attached after this turn
                ForEach(viewModel.cards.filter { $0.afterTurn == index }) { card in
                    ProposalCardView(
                        card: card,
                        canOfferSignIn: viewModel.canOfferSignIn,
                        audio: audio,
                        onMakeDrive: {
                            Task {
                                await viewModel.makeDrive(cardId: card.id) { driveId in
                                    onOpenDrive(driveId)
                                }
                            }
                        },
                        onSignIn: {
                            onSignIn()
                        },
                        onOpenDrive: { driveId in
                            onOpenDrive(driveId)
                        }
                    )
                }
            }
        }

        // Live streaming turn
        if viewModel.isStreaming {
            HStack {
                if !viewModel.streamingSay.isEmpty {
                    Text(viewModel.streamingSay)
                        .font(TrailheadType.body)
                        .foregroundColor(TrailheadColors.ink)
                        .padding(TrailheadSpace.md)
                        .background(TrailheadColors.surfaceRaised)
                        .clipShape(RoundedRectangle(cornerRadius: TrailheadSpace.radiusMd))
                        .accessibilityIdentifier("planner.streaming")
                } else {
                    TypingDotsView()
                        .padding(TrailheadSpace.sm)
                        .background(TrailheadColors.surfaceRaised)
                        .clipShape(RoundedRectangle(cornerRadius: TrailheadSpace.radiusMd))
                }
                Spacer()
            }
        }
    }

    // MARK: - Composer Bar

    private var composerBar: some View {
        VStack(spacing: 0) {
            Divider()

            if viewModel.isSessionDone {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Plan complete")
                            .font(TrailheadType.headline)
                            .foregroundColor(TrailheadColors.ink)
                        Text("Start a new plan to explore another drive.")
                            .font(TrailheadType.caption)
                            .foregroundColor(TrailheadColors.inkMuted)
                    }
                    Spacer()
                    TrailheadButton("Start fresh", variant: .primary) {
                        viewModel.startFresh()
                    }
                    .accessibilityIdentifier("planner.start-fresh")
                    .frame(width: 130)
                }
                .padding(.horizontal, TrailheadSpace.md)
                .padding(.vertical, TrailheadSpace.sm)
                .background(TrailheadColors.surfaceRaised)
            } else {
                // The send button hugs the field's last line as it grows, as in Messages.
                HStack(alignment: .bottom, spacing: TrailheadSpace.sm) {
                    // Grows with the draft instead of scrolling a single line sideways. Return
                    // inserts a newline on a vertical-axis field, so only the button sends
                    // (Messages does the same); a long ask stays readable while it is written.
                    TextField("Message Skipper…", text: $inputText, axis: .vertical)
                        .lineLimit(1...6)
                        .font(TrailheadType.body)
                        .padding(.horizontal, TrailheadSpace.md)
                        .padding(.vertical, TrailheadSpace.sm)
                        .background(TrailheadColors.surfaceRaised)
                        .clipShape(RoundedRectangle(cornerRadius: TrailheadSpace.radiusMd))
                        .overlay(
                            RoundedRectangle(cornerRadius: TrailheadSpace.radiusMd)
                                .stroke(TrailheadColors.borderFaint, lineWidth: 1)
                        )
                        .disabled(viewModel.isStreaming)
                        .accessibilityIdentifier("planner.input")

                    Button {
                        sendMessage()
                    } label: {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.system(size: 36))
                            .foregroundColor(
                                inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || viewModel.isStreaming || viewModel.selectedRegion == nil
                                    ? TrailheadColors.inkMuted.opacity(0.4)
                                    : TrailheadColors.accent
                            )
                    }
                    .accessibilityLabel("Send")
                    .accessibilityIdentifier("planner.send")
                    .disabled(inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || viewModel.isStreaming || viewModel.selectedRegion == nil)
                }
                .padding(.horizontal, TrailheadSpace.md)
                .padding(.vertical, TrailheadSpace.xs)
            }
        }
        .background(TrailheadColors.background)
    }

    private func sendMessage() {
        let text = inputText
        inputText = ""
        Task {
            await viewModel.sendTurn(prompt: text)
        }
    }

    // MARK: - Region Picker Sheet

    private var regionPickerSheet: some View {
        NavigationStack {
            List(viewModel.availableRegions) { region in
                Button {
                    viewModel.selectRegion(region)
                    isShowingRegionPicker = false
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: TrailheadSpace.xs) {
                            Text(region.displayName)
                                .font(TrailheadType.headline)
                                .foregroundColor(TrailheadColors.ink)
                            Text(region.slug)
                                .font(TrailheadType.caption)
                                .foregroundColor(TrailheadColors.inkMuted)
                        }
                        Spacer()
                        if viewModel.selectedRegion?.id == region.id {
                            Image(systemName: "checkmark")
                                .foregroundColor(TrailheadColors.accent)
                        }
                    }
                }
            }
            .navigationTitle("Select Region")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") {
                        isShowingRegionPicker = false
                    }
                }
            }
        }
    }
}
