import Foundation

@MainActor
struct PreferenceMigration {
    let keychain: any KeychainStore
    let defaults: UserDefaults
    static let keys = ["skipper.themeMode", "skipper.simMode", "skipper.drivePlayerView", "skipper.updateNudgeDismissed"]

    func run() throws {
        let legacy = LegacySecureStore(keychain: keychain)
        for key in Self.keys {
            // Keep the original rows: UserDefaults has no durable flush acknowledgement that would
            // justify deleting the only recovery copy. Existing native preferences always win.
            guard defaults.object(forKey: key) == nil, let value = try legacy.read(key)?.text else { continue }
            let valid: Bool
            switch key {
            case "skipper.themeMode": valid = ["system", "light", "dark"].contains(value)
            case "skipper.simMode": valid = ["0", "1"].contains(value)
            case "skipper.drivePlayerView": valid = ["map", "list"].contains(value)
            default: valid = !value.isEmpty
            }
            if valid { defaults.set(value, forKey: key) }
        }
    }
}
