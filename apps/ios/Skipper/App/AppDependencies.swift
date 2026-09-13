import Foundation

/// Feature owners inject their service implementations here. Construction itself performs no requests.
@MainActor
struct AppDependencies {
    let api: any SkipperAPI
    let planner: any PlannerService
    let documentsURL: URL
    let launch: AppLaunchConfiguration
    let session: SessionStore
    let storage: StorageService
    let network: any NetworkAvailability
    let defaults: UserDefaults
    let preview: AudioPreviewController?
    let analytics: AnalyticsTracker?
    let makePlayback: @MainActor () -> DrivePlaybackController
    var initialTab: MainTab? = nil
    var coldOpenURL: URL? = nil

    @MainActor static func live(configuration: AppConfiguration, documentsURL: URL,
                               defaults: UserDefaults = .standard, keychain: any KeychainStore = SystemKeychainStore()) -> Self {
        let transport = URLSessionTransport()
        let network = DeviceNetworkAvailability()
        let vault = CredentialVault(keychain: keychain, logoutMarker: DefaultsLogoutMarker(defaults: defaults))
        let api = APIClient(baseURL: configuration.apiURL, transport: transport, cookies: vault, network: network)
        let storage = StorageService(rootURL: documentsURL, driveProvider: APIDriveDetailProvider(api: api))
        let auth = AuthClient(baseURL: configuration.apiURL, transport: transport, vault: vault, network: network)
        let session = SessionStore(auth: auth, vault: vault, network: network,
            purgeDownloads: {
                await MainActor.run { AudioChannel.shared.stopAll() }
                _ = await storage.deleteAllDriveDownloads()
            })
        let analytics = configuration.postHogKey == nil ? nil : NativeAnalytics.tracker(session: session)
        let preview = AudioPreviewController()
        preview.onRoutePreview = { completed in analytics?("preview_clip_played", ["completed": completed]) }
        return Self(api: api, planner: PlannerClient(baseURL: configuration.apiURL, transport: transport, network: network),
                    documentsURL: documentsURL, launch: .init(mode: .production), session: session, storage: storage,
                    network: network, defaults: defaults, preview: preview, analytics: analytics,
                    makePlayback: { DrivePlaybackController(session: { session.session }, traceDirectory: documentsURL.appendingPathComponent("traces")) })
    }
}

/// No fallback to production is permitted for an unrecognized test scenario.
/// QA scenario registration can construct AppDependencies with fixture-backed services and an isolated
/// run directory; it must feed the same production views and state machines.
struct UnavailableTestServices: SkipperAPI, PlannerService {
    struct Unavailable: Error {}
    func bootstrap(rotation: Int) async throws -> Bootstrap { throw Unavailable() }
    func listDrives() async throws -> DriveList { throw Unavailable() }
    func drive(id: String) async throws -> DriveManifest { throw Unavailable() }
    func propose(_ request: DriveProposeRequest) async throws -> DriveProposal { throw Unavailable() }
    func create(_ request: CreateDriveRequest) async throws -> DriveManifest { throw Unavailable() }
    func deleteDrive(id: String) async throws { throw Unavailable() }
    func setAccountPassword(_ password: String) async throws { throw Unavailable() }
    func version() async throws -> [VersionPolicy] { throw Unavailable() }
    func turn(_ request: DrivePlanRequest, onDelta: @escaping @Sendable (String) -> Void) async throws -> DrivePlanResponse { throw Unavailable() }
}

/// JSON DTO adaptation preserves the existing manifest wire format without coupling pure storage
/// types to transport names. Request validation still happens at the API boundary first.
struct APIDriveDetailProvider: StorageDriveDetailProvider {
    let api: any SkipperAPI
    func fetchDriveDetail(driveId: String) async throws -> StorageSavedDriveDetail {
        let manifest = try await api.drive(id: driveId)
        return try JSONDecoder().decode(StorageSavedDriveDetail.self, from: JSONEncoder().encode(manifest))
    }
}
