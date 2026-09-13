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

    @MainActor static func canOfferRecovery(for session: SessionStore) -> Bool {
        session.state == .deferred && session.canRecoverCredentials
    }
}
