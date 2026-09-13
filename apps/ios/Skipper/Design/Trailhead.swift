import SwiftUI
import UIKit

enum ThemeMode: String, Codable, CaseIterable, Sendable {
    case system, light, dark
    var colorScheme: ColorScheme? {
        switch self { case .system: nil; case .light: .light; case .dark: .dark }
    }
    var label: String {
        switch self { case .system: "Auto"; case .light: "Day"; case .dark: "Dusk" }
    }
}

/// Semantic colors are the only palette surface available to screens. Day is the visual reference.
enum TrailheadColors {
    static let surface = adaptive(0xF2E7CC, 0x14201B)
    static let surfaceRaised = adaptive(0xFBF3DD, 0x1E2B24)
    static let surfaceSunken = adaptive(0xE7D9B5, 0x101A15)
    static let ink = adaptive(0x2A2014, 0xECE0C4)
    static let inkDim = adaptive(0x5C4A30, 0xA99D80)
    static let inkFaint = adaptive(0x74603E, 0x9A9075)
    static let accent = adaptive(0x1E5B40, 0x5FA877)
    static let accentWarm = adaptive(0x9A4D17, 0xEBA351)
    static let primaryFill = adaptive(0x1E5B40, 0xEBA351)
    static let onPrimary = adaptive(0xFBF3DD, 0x2A2014)
    static let water = adaptive(0x2C6E7E, 0x5FA7B8)
    static let routeTrail = adaptive(0x6B552F, 0xCDB988)
    static let rule = adaptive(0xCDB988, 0x3A4A3E)
    static let danger = adaptive(0xA8401F, 0xE97559)
    /// Fill only; small text on day paper uses accentWarm instead.
    static let amberToken = adaptive(0xDD7A33, 0xEBA351)
    private static func adaptive(_ day: UInt32, _ dusk: UInt32) -> Color {
        Color(uiColor: UIColor { traits in
            let hex = traits.userInterfaceStyle == .dark ? dusk : day
            return UIColor(red: CGFloat((hex >> 16) & 255) / 255,
                           green: CGFloat((hex >> 8) & 255) / 255,
                           blue: CGFloat(hex & 255) / 255, alpha: 1)
        })
    }
}
enum TrailheadType {
    static let wordmark = Font.custom("ZillaSlab-Bold", size: 26, relativeTo: .title)
    static let display = Font.custom("ZillaSlab-Bold", size: 30, relativeTo: .largeTitle)
    static let title = Font.custom("Lora-Bold", size: 20, relativeTo: .title2)
    static let body = Font.custom("Lora-Regular", size: 16, relativeTo: .body)
    static let bodyStrong = Font.custom("Lora-SemiBold", size: 16, relativeTo: .body)
    static let caption = Font.custom("Lora-Regular", size: 13.5, relativeTo: .caption)
    static let mono = Font.custom("OverpassMono-Regular", size: 14, relativeTo: .subheadline)
    static let monoStrong = Font.custom("OverpassMono-SemiBold", size: 15, relativeTo: .subheadline)
}
enum TrailheadSpace {
    static let small: CGFloat = 8
    static let medium: CGFloat = 16
    static let large: CGFloat = 24
    static let extraLarge: CGFloat = 32
    static let minimumHit: CGFloat = 48
    static let primaryHit: CGFloat = 60
}
