import Foundation
import Security
import LocalAuthentication

struct KeychainAddress: Hashable, Codable, Sendable {
    let service: String
    let key: String
}
protocol KeychainStore: Sendable {
    func read(_ address: KeychainAddress) throws -> Data?
    func write(_ data: Data, at address: KeychainAddress) throws
    func delete(_ address: KeychainAddress) throws
}

struct SystemKeychainStore: KeychainStore {
    /// Exact Expo representation: account AND generic are UTF-8 Data. No access-group override
    /// means the existing app's default signed group, continuous under fm.skipper.app.
    static func query(_ address: KeychainAddress) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: address.service,
         kSecAttrAccount as String: Data(address.key.utf8),
         kSecAttrGeneric as String: Data(address.key.utf8),
         kSecAttrSynchronizable as String: false]
    }
    func read(_ address: KeychainAddress) throws -> Data? {
        var query = Self.query(address)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        // Migration must defer when a protected item is unavailable; never trigger an auth prompt.
        let context = LAContext(); context.interactionNotAllowed = true
        query[kSecUseAuthenticationContext as String] = context
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw AuthFailure.keychainUnavailable(status) }
        return data
    }
    func write(_ data: Data, at address: KeychainAddress) throws {
        let query = Self.query(address)
        let attributes: [String: Any] = [kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            kSecAttrSynchronizable as String: false]
        var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(query.merging(attributes) { _, new in new } as CFDictionary, nil)
            if status == errSecDuplicateItem { status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary) }
        }
        guard status == errSecSuccess else { throw AuthFailure.keychainUnavailable(status) }
        // A successful API return is not enough to delete the only recoverable legacy credential.
        guard try read(address) == data else { throw AuthFailure.verificationFailed }
    }
    func delete(_ address: KeychainAddress) throws {
        let status = SecItemDelete(Self.query(address) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw AuthFailure.keychainUnavailable(status) }
    }
}

struct LegacySecureStore: Sendable {
    let keychain: any KeychainStore
    static let services = ["app:no-auth", "app:auth", "app"]
    struct Value: Sendable { let text: String; let addresses: [KeychainAddress] }
    private func raw(_ key: String) throws -> (Data, KeychainAddress)? {
        for service in Self.services {
            let address = KeychainAddress(service: service, key: key)
            if let data = try keychain.read(address) { return (data, address) }
        }
        return nil
    }
    func read(_ key: String) throws -> Value? {
        guard let (data, address) = try raw(key) else { return nil }
        guard let text = String(data: data, encoding: .utf8) else { throw AuthFailure.malformedCredentials }
        let marker = "\u{0001}ba-chunks:"
        guard text.hasPrefix(marker) else { return Value(text: text, addresses: [address]) }
        guard let count = Int(text.dropFirst(marker.count)), count > 0, count <= 10_000 else { throw AuthFailure.incompleteLegacyChunks }
        var result = ""
        var addresses = [address]
        for index in 0..<count {
            guard let (chunk, chunkAddress) = try raw("\(key).\(index)"), let string = String(data: chunk, encoding: .utf8) else {
                throw AuthFailure.incompleteLegacyChunks
            }
            result += string; addresses.append(chunkAddress)
        }
        return Value(text: result, addresses: addresses)
    }
    func removeKnownKeys(_ addresses: [KeychainAddress]) throws {
        // Remove only known base/chunk names; no global Keychain enumeration or sweep.
        for key in Set(addresses.map(\.key)) {
            for service in Self.services { try keychain.delete(.init(service: service, key: key)) }
        }
    }
}
