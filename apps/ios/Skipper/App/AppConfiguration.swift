import Foundation

struct AppConfiguration: Sendable {
    let apiURL: URL
    let googleMapsAPIKey: String?
    let postHogKey: String?
    let postHogHost: String

    static func bundled(_ bundle: Bundle = .main) throws -> Self {
        func value(_ key: String) -> String? {
            guard let value = bundle.object(forInfoDictionaryKey: key) as? String,
                  !value.isEmpty, !value.contains("$(") else { return nil }
            return value
        }
        guard let rawURL = value("SkipperAPIURL"), let apiURL = URL(string: rawURL),
              apiURL.scheme == "https", apiURL.host != nil else { throw ContractError() }
        return AppConfiguration(apiURL: apiURL, googleMapsAPIKey: value("SkipperGoogleMapsAPIKey"),
                                postHogKey: value("SkipperPostHogKey"),
                                postHogHost: value("SkipperPostHogHost") ?? "https://us.i.posthog.com")
    }
}

/// Read before SDKs, Keychain, network, or disk services are created. Release builds ignore test env.
struct AppLaunchConfiguration: Sendable, Equatable {
    enum Mode: Sendable, Equatable {
        case production
        case unitTest
        case uiTest(scenario: String, runID: String, theme: ThemeMode)
        case rejectedTestConfiguration
    }
    let mode: Mode
    static func read(environment: [String: String] = ProcessInfo.processInfo.environment) -> Self {
        #if DEBUG
        if environment["SKIPPER_UI_TESTING"] == "1" {
            guard let scenario = environment["SKIPPER_UI_SCENARIO"], !scenario.isEmpty,
                  let runID = environment["SKIPPER_UI_RUN_ID"], UUID(uuidString: runID) != nil,
                  let theme = ThemeMode(rawValue: environment["SKIPPER_UI_THEME"] ?? "system") else {
                return Self(mode: .rejectedTestConfiguration)
            }
            return Self(mode: .uiTest(scenario: scenario, runID: runID, theme: theme))
        }
        if environment["SKIPPER_TESTING"] == "1" || environment["XCTestConfigurationFilePath"] != nil {
            return Self(mode: .unitTest)
        }
        #endif
        return Self(mode: .production)
    }
    var allowsLiveServices: Bool { mode == .production }
    var allowsMapsSDK: Bool {
        switch mode {
        case .production, .uiTest: true
        case .unitTest, .rejectedTestConfiguration: false
        }
    }
}
