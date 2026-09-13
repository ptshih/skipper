import SwiftUI

struct PlannerView: View {
    @State private var viewModel: PlannerViewModel
    let audio: (any AudioPreviewControlling)?
    let onOpenDrive: @MainActor (String) -> Void
    let onOpenLibrary: @MainActor () -> Void
    let onOpenSettings: @MainActor () -> Void
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
        onOpenSettings: @escaping @MainActor () -> Void,
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
        self.onOpenSettings = onOpenSettings
        self.onSignIn = onSignIn
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Top control bar
                headerBar

                // Transcript or empty state
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
                }

                // Error banner if any
                if let err = viewModel.errorMessage {
                    HStack(spacing: TrailheadSpace.sm) {
                        Image(systemName: "exclamationmark.circle.fill")
                            .foregroundColor(TrailheadColors.danger)
                        Text(err)
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

                // Composer bar
                composerBar
            }
            .background(TrailheadColors.background.ignoresSafeArea())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        onOpenSettings()
                    } label: {
                        Image(systemName: "gearshape")
                            .foregroundColor(TrailheadColors.inkMuted)
                    }
                }
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
                    HStack {
                        Spacer(minLength: TrailheadSpace.xl)
                        Text(turn.text)
                            .font(TrailheadType.body)
                            .foregroundColor(.white)
                            .padding(TrailheadSpace.md)
                            .background(TrailheadColors.accent)
                            .clipShape(RoundedRectangle(cornerRadius: TrailheadSpace.radiusMd))
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
                HStack(spacing: TrailheadSpace.sm) {
                    TextField("Message Skipper…", text: $inputText)
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
                        .onSubmit {
                            sendMessage()
                        }

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
