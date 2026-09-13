import SwiftUI

@main
struct SkipperApp: App {
    @State private var model: AppModel
    private let launch: AppLaunchConfiguration

    init() {
        // Decide isolation before SDKs or storage. UI fixtures may initialize Maps only.
        let launch = AppLaunchConfiguration.read()
        self.launch = launch
        if launch.allowsLiveServices, let configuration = try? AppConfiguration.bundled() {
            NativeSDKs.configure(configuration, launch: launch)
            let documents = URL.documentsDirectory
            _model = State(initialValue: AppModel(dependencies: .live(configuration: configuration,
                documentsURL: documents)))
        } else {
            #if DEBUG
            let dependencies = try? DebugDependencies.make(launch: launch)
            if dependencies != nil, let configuration = try? AppConfiguration.bundled() {
                NativeSDKs.configureMaps(configuration, launch: launch)
            }
            let model = AppModel(dependencies: dependencies)
            #else
            let model = AppModel(dependencies: nil)
            #endif
            if case .uiTest(_, _, let theme) = launch.mode { model.theme = theme }
            _model = State(initialValue: model)
        }
    }
    var body: some Scene {
        WindowGroup {
            AppRootView(model: model, launch: launch)
                .preferredColorScheme(model.theme.colorScheme)
                .tint(TrailheadColors.accent)
                .onOpenURL { model.open($0) }
                .task { await model.start() }
        }
    }
}

struct AppRootView: View {
    @Bindable var model: AppModel
    let launch: AppLaunchConfiguration
    var body: some View {
        AppVersionPresentation(controller: model.versionPolicy) {
            if let dependencies = model.dependencies, model.readiness == .ready {
                MainTabView(planner: dependencies.planner, api: dependencies.api, session: dependencies.session,
                    storage: dependencies.storage, audio: dependencies.preview.map { PlaybackAudioPreviewAdapter(controller: $0) }, analytics: dependencies.analytics,
                    network: dependencies.network, themeMode: $model.theme, simMode: $model.simMode,
                    selectedTab: $model.selectedTab, incomingDriveId: $model.incomingDriveId,
                    onStartDrive: { id, _ in Task { await model.startDrive(id) } })
                    .defaultAppStorage(dependencies.defaults)
                    .onChange(of: dependencies.session.user?.id) { before, after in
                        if before != nil && before != after {
                            model.stopDrive(); model.incomingDriveId = nil
                            dependencies.preview?.stop()
                        }
                    }
            } else if model.readiness == .awaitingMigration {
                ProgressView("Opening Skipper…")
            } else {
                ContentUnavailableView("Skipper couldn’t open", systemImage: "exclamationmark.triangle",
                    description: Text("Please close the app and try again."))
                    .accessibilityIdentifier("app.configuration.unavailable")
                    #if DEBUG
                    .overlay(alignment: .bottom) {
                        if case .uiTest = launch.mode {
                            Text("Unregistered UI test scenario").accessibilityIdentifier("test.scenario.unavailable")
                        } else if launch.mode == .rejectedTestConfiguration {
                            Text("Invalid UI test configuration").accessibilityIdentifier("test.configuration.invalid")
                        }
                    }
                    #endif
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(TrailheadColors.surface)
        .onChange(of: model.theme) { _, _ in model.persistPreferences() }
        .onChange(of: model.simMode) { _, _ in model.persistPreferences() }
        .onChange(of: model.versionPolicy?.gate) { _, _ in
            model.versionGateDidChange()
        }
        .fullScreenCover(isPresented: Binding(
            get: { model.presentsDriving },
            set: { model.playbackPresented = $0 }), onDismiss: { model.stopDrive() }) {
            if let controller = model.activePlayback {
                NavigationStack { DrivingView(controller: controller) }
                    .defaultAppStorage(model.dependencies?.defaults ?? .standard)
            }
        }
        .alert("Drive unavailable", isPresented: Binding(get: { !model.blocksForUpdate && model.playbackError != nil }, set: { if !$0 { model.playbackError = nil } })) {
            Button("OK", role: .cancel) { model.playbackError = nil }
        } message: { Text(model.playbackError ?? "") }
    }
}
