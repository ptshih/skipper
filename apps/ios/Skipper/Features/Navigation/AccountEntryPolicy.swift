import Foundation

/// Unknown credentials are not signed-out credentials. Recovery is a separate explicit action;
/// transient Keychain/network failures only offer Retry while public navigation remains usable.
enum AccountEntryPolicy {
    static func canOfferSignIn(in state: SessionState) -> Bool {
        switch state {
        case .signedOut, .anonymous: true
        case .loading, .deferred, .signedIn: false
        }
    }

    static func shouldPresentSignInOnTabChange(
        from oldTab: MainTab?,
        to newTab: MainTab,
        in state: SessionState,
        hasPendingDriveId: Bool = false
    ) -> Bool {
        guard !hasPendingDriveId else { return false }
        guard newTab == .library && oldTab != .library else { return false }
        return canOfferSignIn(in: state)
    }

    @MainActor static func canOfferRecovery(for session: SessionStore) -> Bool {
        session.state == .deferred && session.canRecoverCredentials
    }
}
