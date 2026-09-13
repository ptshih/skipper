import SwiftUI
import UIKit
import XCTest
@testable import Skipper

@MainActor final class DeferredNavigationTests: XCTestCase {
    private let driveID = "11111111-1111-4111-8111-111111111111"
    private let baseURL = URL(string: "https://deferred.example.invalid")!
    private let clock = FixedAuthClock(date: Date(timeIntervalSince1970: 1_789_214_400))

    func testFreshOfflineInstallKeepsAllTabsWithoutClaimingSavedCredentials() async throws {
        let keychain = AuthTestKeychain()
        let auth = AuthTestService()
        let vault = CredentialVault(keychain: keychain, clock: clock)
        let network = AuthTestNetwork(offline: true)
        let session = SessionStore(auth: auth, vault: vault, network: network, clock: clock, purgeDownloads: {
            XCTFail("Opening public navigation must not purge downloads")
        })
        await session.start()
        XCTAssertEqual(session.state, .deferred)
        XCTAssertFalse(AccountEntryPolicy.canOfferSignIn(in: session.state))
        XCTAssertFalse(AccountEntryPolicy.canOfferRecovery(for: session))
        XCTAssertFalse(session.canRecoverCredentials)
        let notice = DeferredMigrationView(canRecoverCredentials: session.canRecoverCredentials, onRetry: {})
        XCTAssertEqual(notice.message, "Account check unavailable.")
        let transport = publicTransport()
        try await assertPublicTabs(session: session, api: APIClient(baseURL: baseURL, transport: transport,
            cookies: vault, network: network), network: network)
        XCTAssertTrue(transport.calls.isEmpty)
        let authCalls = await auth.recorded()
        XCTAssertTrue(authCalls.isEmpty)
        let allowed = await session.canAccessLocalDrive(driveID)
        XCTAssertFalse(allowed)
        XCTAssertFalse(session.anonymousAttempted)
    }

    func testAPIOutageKeepsPublicPlannerMountedWithoutAnonymousMint() async throws {
        let auth = AuthTestService(failure: APIError(status: 500, code: nil, message: "Fixture outage"))
        let vault = CredentialVault(keychain: AuthTestKeychain(), clock: clock)
        let session = SessionStore(auth: auth, vault: vault, clock: clock, purgeDownloads: {})
        await session.start()
        XCTAssertEqual(session.state, .deferred)
        let transport = publicTransport()
        try await assertPublicTabs(session: session,
            api: APIClient(baseURL: baseURL, transport: transport, cookies: vault))
        try await waitUntil { transport.calls.contains("GET /bootstrap") }
        XCTAssertEqual(transport.calls, ["GET /bootstrap"], "The mounted public Planner must actually load its bootstrap")
        let calls = await auth.recorded()
        XCTAssertEqual(calls, ["session"])
        XCTAssertFalse(session.anonymousAttempted)
        let allowed = await session.canAccessLocalDrive(driveID)
        XCTAssertFalse(allowed)
    }

    func testExpiredLegacyOfflineCredentialsKeepTabsAndOriginalBytesWithoutLocalGrant() async throws {
        let keychain = try syntheticKeychain()
        let originals = keychain.snapshot
        let later = FixedAuthClock(date: Date(timeIntervalSince1970: 1_800_000_000))
        let vault = CredentialVault(keychain: keychain, clock: later)
        let auth = AuthTestService()
        let network = AuthTestNetwork(offline: true)
        let session = SessionStore(auth: auth, vault: vault, network: network, clock: later, purgeDownloads: {
            XCTFail("Expired credentials must not purge retained downloads")
        })
        await session.start()
        XCTAssertEqual(session.state, .deferred)
        XCTAssertTrue(session.needsRefresh)
        XCTAssertFalse(session.canRecoverCredentials)
        try await assertPublicTabs(session: session, api: APIClient(baseURL: baseURL,
            transport: publicTransport(), cookies: vault, network: network), network: network)
        for (key, value) in originals { XCTAssertEqual(keychain.snapshot[key], value) }
        let allowed = await session.canAccessLocalDrive(driveID)
        XCTAssertFalse(allowed)
        let calls = await auth.recorded()
        XCTAssertTrue(calls.isEmpty)
    }

    func testLockedLegacyCredentialsKeepPublicRequestsAndRetryWithoutRecoveryOrMint() async throws {
        let keychain = try syntheticKeychain()
        let originals = keychain.snapshot
        keychain.readError = .keychainUnavailable(-25308)
        let vault = CredentialVault(keychain: keychain, clock: clock)
        let auth = AuthTestService(failure: URLError(.notConnectedToInternet))
        let session = SessionStore(auth: auth, vault: vault, clock: clock, purgeDownloads: {})
        await session.start()
        XCTAssertEqual(session.state, .deferred)
        XCTAssertFalse(session.canRecoverCredentials)
        let transport = publicTransport()
        try await assertPublicTabs(session: session, api: APIClient(baseURL: baseURL, transport: transport, cookies: vault))
        try await waitUntil { transport.calls.contains("GET /bootstrap") }
        XCTAssertEqual(keychain.snapshot, originals)
        let denied = await session.canAccessLocalDrive(driveID)
        XCTAssertFalse(denied)
        await session.retry()
        XCTAssertEqual(session.state, .deferred)
        let calls = await auth.recorded()
        XCTAssertTrue(calls.isEmpty, "Locked Keychain must never trigger authentication or anonymous mint")
        XCTAssertEqual(keychain.snapshot, originals)
    }

    func testCorruptCredentialsExposeExplicitRecoveryWhilePublicTabsRemainMounted() async throws {
        let original = Data("{unreadable-native-credentials".utf8)
        let keychain = AuthTestKeychain(rows: [CredentialVault.address: original])
        let input = try FeaturesQAFixtures.input("contracts/ui-flows", id: "corrupt-credentials-recovery")
        let transport = FeaturesQAHTTP(responses: [
            "GET /bootstrap": Data(#"{"regions":[],"adjustSay":"","noStopsSay":""}"#.utf8),
            "POST /api/auth/sign-in/email-otp": Data("{}".utf8),
            "GET /api/auth/get-session": try FeaturesQAFixtures.data(XCTUnwrap(input["signedInSession"]))
        ])
        let vault = CredentialVault(keychain: keychain, clock: clock)
        let auth = AuthClient(baseURL: baseURL, transport: transport, vault: vault)
        let session = SessionStore(auth: auth, vault: vault, clock: clock, purgeDownloads: {
            XCTFail("Explicit credential recovery preserves downloads")
        })
        await session.start()
        XCTAssertTrue(session.canRecoverCredentials)
        XCTAssertFalse(AccountEntryPolicy.canOfferSignIn(in: session.state))
        XCTAssertTrue(AccountEntryPolicy.canOfferRecovery(for: session))
        let notice = DeferredMigrationView(canRecoverCredentials: session.canRecoverCredentials, onRetry: {})
        XCTAssertEqual(notice.message, "Saved sign-in unreadable.")
        try await assertPublicTabs(session: session, api: APIClient(baseURL: baseURL, transport: transport, cookies: vault))
        try await waitUntil { transport.calls.contains("GET /bootstrap") }
        XCTAssertEqual(transport.calls, ["GET /bootstrap"], "Rendering recovery controls must not invoke recovery")
        XCTAssertEqual(keychain.snapshot[CredentialVault.address], original)
        let before = await session.canAccessLocalDrive(driveID)
        XCTAssertFalse(before)
        // The existing explicit Auth flow performs recovery. Navigation itself grants nothing.
        try await session.signIn(email: "rider@example.invalid", code: "123456")
        XCTAssertTrue(session.isSignedIn)
        XCTAssertFalse(AccountEntryPolicy.canOfferSignIn(in: session.state))
        XCTAssertFalse(AccountEntryPolicy.canOfferRecovery(for: session))
        XCTAssertTrue(session.hasUnverifiedLocalOwnership)
        XCTAssertEqual(keychain.snapshot[CredentialVault.address], original)
        let after = await session.canAccessLocalDrive(driveID)
        XCTAssertFalse(after, "Recovery still requires independent per-drive owner evidence")
        XCTAssertFalse(transport.calls.contains { $0.contains("sign-in/anonymous") })
    }

    func testRetryCanRestoreVerifiedLegacySessionWithoutChangingTabAvailability() async throws {
        let keychain = try syntheticKeychain()
        keychain.readError = .keychainUnavailable(-25308)
        let vault = CredentialVault(keychain: keychain, clock: clock)
        let auth = AuthTestService()
        let network = AuthTestNetwork(offline: true)
        let session = SessionStore(auth: auth, vault: vault, network: network, clock: clock, purgeDownloads: {})
        await session.start()
        XCTAssertEqual(session.state, .deferred)
        keychain.readError = nil
        await session.retry()
        XCTAssertTrue(session.isSignedIn, "Only successfully read, fresh imported state restores the account")
        try await assertPublicTabs(session: session, api: APIClient(baseURL: baseURL, transport: publicTransport(),
            cookies: vault, network: network), network: network)
        let calls = await auth.recorded()
        XCTAssertTrue(calls.isEmpty)
    }

    func testOrdinarySignInRequiresKnownSignedOutOrAnonymousState() async throws {
        let signedOut = AuthTestKeychain(rows: [
            .init(service: "app:no-auth", key: "skipper_cookie"): Data("{}".utf8)
        ])
        let anonymous = try syntheticKeychain(session: syntheticSession(anonymous: true))
        for keychain in [signedOut, anonymous] {
            let vault = CredentialVault(keychain: keychain, clock: clock)
            let auth = AuthTestService()
            let session = SessionStore(auth: auth, vault: vault, network: AuthTestNetwork(offline: true),
                clock: clock, purgeDownloads: {})
            XCTAssertFalse(AccountEntryPolicy.canOfferSignIn(in: session.state), "Loading does not establish sign-out")
            await session.start()
            XCTAssertTrue(AccountEntryPolicy.canOfferSignIn(in: session.state))
            XCTAssertFalse(AccountEntryPolicy.canOfferRecovery(for: session))
            let calls = await auth.recorded()
            XCTAssertTrue(calls.isEmpty, "A cached anonymous identity is not a new anonymous mint")
        }
    }

    func testDeferredNoticeReservesSpaceAboveLibraryNavigationAtSmallAndLargestTextSizes() async throws {
        for recoverable in [false, true] {
            for textSize in [DynamicTypeSize.large, .accessibility5] {
                let keychain = AuthTestKeychain(rows: recoverable
                    ? [CredentialVault.address: Data("{broken".utf8)] : [:])
                let vault = CredentialVault(keychain: keychain, clock: clock)
                let network = AuthTestNetwork(offline: true)
                let session = SessionStore(auth: AuthTestService(), vault: vault, network: network,
                    clock: clock, purgeDownloads: { XCTFail("Layout must not purge downloads") })
                await session.start()
                XCTAssertEqual(session.canRecoverCredentials, recoverable)
                try await assertNoticeLayout(session: session,
                    api: APIClient(baseURL: baseURL, transport: publicTransport(), cookies: vault, network: network),
                    network: network, textSize: textSize)
            }
        }
    }

    private func assertNoticeLayout(session: SessionStore, api: any SkipperAPI,
                                    network: any NetworkAvailability, textSize: DynamicTypeSize) async throws {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let oldKey = scene.windows.first(where: \.isKeyWindow)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 375, height: 667)
        let content = MainTabView(planner: DeferredNoPlannerCalls(), api: api, session: session,
            network: network, themeMode: .constant(.light), simMode: .constant(false),
            selectedTab: .constant(.library), onStartDrive: { _, _ in XCTFail("Layout cannot start playback") })
            .environment(\.dynamicTypeSize, textSize)
        let host = UIHostingController(rootView: content)
        window.rootViewController = host
        window.makeKeyAndVisible()
        defer { window.isHidden = true; window.rootViewController = nil; oldKey?.makeKeyAndVisible() }
        try await waitUntil { self.navigationBar(in: host.view)?.topItem?.title == "My Drives" }
        host.view.layoutIfNeeded()
        let navigation = try XCTUnwrap(navigationBar(in: host.view))
        let tabs = try XCTUnwrap(tabBar(in: host.view))
        // Measure the real notice at the same width and text size. The prior overlay put the
        // navigation bar inside these bounds even though all tab-presence assertions passed.
        let notice = UIHostingController(rootView: DeferredMigrationView(
            canRecoverCredentials: session.canRecoverCredentials, onRecover: {}, onRetry: {})
            .environment(\.dynamicTypeSize, textSize))
        let noticeHeight = notice.sizeThatFits(in: CGSize(width: host.view.bounds.width, height: .greatestFiniteMagnitude)).height
        let navigationFrame = navigation.convert(navigation.bounds, to: host.view)
        let tabsFrame = tabs.convert(tabs.bounds, to: host.view)
        XCTAssertEqual(host.view.bounds.size, CGSize(width: 375, height: 667))
        XCTAssertGreaterThanOrEqual(navigationFrame.minY, host.view.safeAreaInsets.top + noticeHeight - 1,
            "The notice must not cover the navigation title")
        XCTAssertGreaterThan(tabsFrame.minY - navigationFrame.maxY, 44, "Leave a usable public content area")
        XCTAssertLessThanOrEqual(tabsFrame.maxY, host.view.bounds.maxY)
        XCTAssertEqual(tabs.items?.count, 3)
        XCTAssertTrue(tabs.items?.allSatisfy(\.isEnabled) == true)
        let screenshot = UIGraphicsImageRenderer(bounds: host.view.bounds).image { _ in
            host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true)
        }
        let attachment = XCTAttachment(image: screenshot)
        attachment.name = "deferred-375x667-\(session.canRecoverCredentials ? "recovery" : "retry")-\(textSize)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func navigationBar(in view: UIView) -> UINavigationBar? {
        if let bar = view as? UINavigationBar, !bar.isHidden { return bar }
        for child in view.subviews { if let found = navigationBar(in: child) { return found } }
        return nil
    }

    /// Mount the production root, not a reconstructed routing enum. The previous whole-app
    /// deferred branch fails here: it has neither a UITabBar nor a mounted Planner bootstrap.
    private func assertPublicTabs(session: SessionStore, api: any SkipperAPI,
                                  network: any NetworkAvailability = UnknownNetworkAvailability()) async throws {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let oldKey = scene.windows.first(where: \.isKeyWindow)
        let window = UIWindow(windowScene: scene)
        window.frame = scene.coordinateSpace.bounds
        let content = MainTabView(planner: DeferredNoPlannerCalls(), api: api, session: session,
            network: network, themeMode: .constant(.system), simMode: .constant(false),
            onStartDrive: { _, _ in XCTFail("Public navigation cannot start a drive") })
        let host = UIHostingController(rootView: content)
        window.rootViewController = host
        window.makeKeyAndVisible()
        defer { window.isHidden = true; window.rootViewController = nil; oldKey?.makeKeyAndVisible() }
        try await waitUntil { self.tabBar(in: host.view)?.items?.count == 3 }
        let bar = try XCTUnwrap(tabBar(in: host.view))
        XCTAssertEqual(bar.items?.compactMap(\.title), ["Plan", "My Drives", "Settings"])
        XCTAssertFalse(bar.isHidden)
        XCTAssertTrue(bar.items?.allSatisfy(\.isEnabled) == true)
        // Let the production Planner's .task run before releasing the hosted hierarchy.
        await Task.yield()
    }

    private func tabBar(in view: UIView) -> UITabBar? {
        if let bar = view as? UITabBar { return bar }
        for child in view.subviews { if let found = tabBar(in: child) { return found } }
        return nil
    }
    private func waitUntil(_ condition: () -> Bool) async throws {
        for _ in 0..<100 {
            if condition() { return }
            try await Task.sleep(for: .milliseconds(20))
        }
        XCTFail("Production navigation did not reach the expected mounted state")
    }
    private func publicTransport() -> FeaturesQAHTTP {
        FeaturesQAHTTP(responses: ["GET /bootstrap": Data(#"{"regions":[],"adjustSay":"","noStopsSay":""}"#.utf8)])
    }
}

private struct DeferredNoPlannerCalls: PlannerService {
    func turn(_ request: DrivePlanRequest, onDelta: @escaping @Sendable (String) -> Void) async throws -> DrivePlanResponse {
        XCTFail("Mounting public navigation must not send a paid planner turn")
        throw URLError(.unsupportedURL)
    }
}
