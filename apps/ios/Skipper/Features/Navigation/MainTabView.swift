import SwiftUI

enum MainTab: String, Hashable, CaseIterable {
    case planner
    case library
    case settings
}

struct MainTabView: View {
    let planner: any PlannerService
    let api: any SkipperAPI
    let session: SessionStore
    let storage: StorageService?
    let audio: (any AudioPreviewControlling)?
    let analytics: AnalyticsTracker?
    let network: any NetworkAvailability

    @Binding var themeMode: ThemeMode
    @Binding var simMode: Bool
    let onStartDrive: @MainActor (String, DriveManifest) -> Void

    private var customTabBinding: Binding<MainTab>?
    private var customDriveBinding: Binding<String?>?

    @State private var internalTab: MainTab = .planner
    @State private var internalDriveId: String? = nil
    @State private var isShowingAuthSheet: Bool = false
    @State private var libraryModel: LibraryViewModel

    private var activeTab: Binding<MainTab> {
        customTabBinding ?? $internalTab
    }

    private var activeDriveId: Binding<String?> {
        customDriveBinding ?? $internalDriveId
    }

    init(
        planner: any PlannerService,
        api: any SkipperAPI,
        session: SessionStore,
        storage: StorageService? = nil,
        audio: (any AudioPreviewControlling)? = nil,
        analytics: AnalyticsTracker? = nil,
        network: any NetworkAvailability = UnknownNetworkAvailability(),
        themeMode: Binding<ThemeMode>,
        simMode: Binding<Bool>,
        selectedTab: Binding<MainTab>? = nil,
        incomingDriveId: Binding<String?>? = nil,
        onStartDrive: @escaping @MainActor (String, DriveManifest) -> Void
    ) {
        self.planner = planner
        self.api = api
        self.session = session
        self.storage = storage
        self.audio = audio
        self.analytics = analytics
        self.network = network
        self._libraryModel = State(initialValue: LibraryViewModel(api: api, session: session,
            storage: storage, analytics: analytics))
        self._themeMode = themeMode
        self._simMode = simMode
        self.customTabBinding = selectedTab
        self.customDriveBinding = incomingDriveId
        self.onStartDrive = onStartDrive
    }

    var body: some View {
        // Reserve space outside TabView: a TabView-level safe-area inset can cover the
        // child NavigationStack's large title instead of moving its navigation bar.
        VStack(spacing: 0) {
            if session.state == .deferred {
                DeferredMigrationView(canRecoverCredentials: AccountEntryPolicy.canOfferRecovery(for: session),
                    isBusy: session.isBusy, onRecover: {
                        if AccountEntryPolicy.canOfferRecovery(for: session) { isShowingAuthSheet = true }
                    }) {
                    Task { await session.refresh() }
                }
                .fixedSize(horizontal: false, vertical: true)
            }
            tabInterface
        }
        .sheet(isPresented: $isShowingAuthSheet) {
            AuthView(
                session: session,
                analytics: analytics,
                onSuccess: {
                    isShowingAuthSheet = false
                },
                onCancel: {
                    isShowingAuthSheet = false
                }
            )
        }
        .sheet(item: Binding(
            get: { activeDriveId.wrappedValue.map { IdentifiableString(id: $0) } },
            set: { activeDriveId.wrappedValue = $0?.id }
        )) { item in
            NavigationStack {
                DriveDetailView(
                    driveId: item.id,
                    api: api,
                    storage: storage,
                    session: session,
                    audio: audio,
                    analytics: analytics,
                    network: network,
                    onStartDrive: { id, manifest in
                        activeDriveId.wrappedValue = nil
                        onStartDrive(id, manifest)
                    },
                    onBack: {
                        activeDriveId.wrappedValue = nil
                    },
                    onDeleted: { id in
                        libraryModel.removeDriveLocally(driveId: id)
                    }
                )
            }
        }
    }

    private var tabInterface: some View {
        TabView(selection: activeTab) {
            PlannerView(
                planner: planner,
                api: api,
                session: session,
                storage: storage,
                audio: audio,
                analytics: analytics,
                onOpenDrive: { driveId in
                    activeDriveId.wrappedValue = driveId
                },
                onOpenLibrary: {
                    activeTab.wrappedValue = .library
                },
                onOpenSettings: {
                    activeTab.wrappedValue = .settings
                },
                onSignIn: {
                    presentSignIn()
                }
            )
            .tabItem {
                Label("Plan", systemImage: "map")
            }
            .tag(MainTab.planner)

            LibraryView(
                viewModel: libraryModel,
                onOpenDrive: { driveId in
                    activeDriveId.wrappedValue = driveId
                },
                onOpenPlanner: {
                    activeTab.wrappedValue = .planner
                },
                onSignIn: {
                    presentSignIn()
                }
            )
            .tabItem {
                Label("My Drives", systemImage: "car.2.fill")
            }
            .tag(MainTab.library)

            SettingsView(
                session: session,
                api: api,
                storage: storage,
                themeMode: $themeMode,
                simMode: $simMode,
                onSignIn: {
                    presentSignIn()
                }
            )
            .tabItem {
                Label("Settings", systemImage: "gearshape")
            }
            .tag(MainTab.settings)
        }
        .tint(TrailheadColors.accent)
    }

    private func presentSignIn() {
        guard AccountEntryPolicy.canOfferSignIn(in: session.state) else { return }
        isShowingAuthSheet = true
    }
}

private struct IdentifiableString: Identifiable {
    let id: String
}
