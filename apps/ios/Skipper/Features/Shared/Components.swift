import SwiftUI

extension TrailheadSpace {
    static let xs: CGFloat = 4
    static let sm: CGFloat = TrailheadSpace.small
    static let md: CGFloat = TrailheadSpace.medium
    static let lg: CGFloat = TrailheadSpace.large
    static let xl: CGFloat = TrailheadSpace.extraLarge
    static let radiusSm: CGFloat = 8
    static let radiusMd: CGFloat = 14
    static let radiusLg: CGFloat = 20
}

extension TrailheadColors {
    static let background = TrailheadColors.surface
    static let inkMuted = TrailheadColors.inkDim
    static let border = TrailheadColors.rule
    static let borderFaint = TrailheadColors.rule.opacity(0.5)
}

extension TrailheadType {
    static let headline = TrailheadType.bodyStrong
    static let subheadline = TrailheadType.caption
}

enum TrailheadButtonVariant {
    case primary
    case secondary
    case danger
    case ghost
}

struct TrailheadButton: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let title: String
    let icon: String?
    let variant: TrailheadButtonVariant
    let isLoading: Bool
    let isEnabled: Bool
    let action: () -> Void

    init(
        _ title: String,
        icon: String? = nil,
        variant: TrailheadButtonVariant = .primary,
        isLoading: Bool = false,
        isEnabled: Bool = true,
        action: @escaping () -> Void
    ) {
        self.title = title
        self.icon = icon
        self.variant = variant
        self.isLoading = isLoading
        self.isEnabled = isEnabled
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Group {
                if dynamicTypeSize.isAccessibilitySize {
                    VStack(spacing: TrailheadSpace.xs) {
                        if isLoading {
                            ProgressView()
                                .tint(foregroundColor)
                        } else if let icon {
                            Image(systemName: icon)
                                .font(TrailheadType.headline)
                        }
                        Text(title)
                            .font(TrailheadType.headline)
                            .multilineTextAlignment(.center)
                            .lineLimit(nil)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                } else {
                    HStack(spacing: TrailheadSpace.sm) {
                        if isLoading {
                            ProgressView()
                                .tint(foregroundColor)
                        } else if let icon {
                            Image(systemName: icon)
                                .font(TrailheadType.headline)
                        }
                        Text(title)
                            .font(TrailheadType.headline)
                            .multilineTextAlignment(.center)
                            .lineLimit(nil)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .padding(.horizontal, TrailheadSpace.md)
            .padding(.vertical, TrailheadSpace.sm)
            .frame(maxWidth: .infinity)
            .frame(minHeight: TrailheadSpace.primaryHit)
            .background(backgroundColor)
            .foregroundColor(foregroundColor)
            .overlay(
                RoundedRectangle(cornerRadius: TrailheadSpace.radiusMd)
                    .stroke(borderColor, lineWidth: variant == .secondary ? 1.5 : 0)
            )
            .clipShape(RoundedRectangle(cornerRadius: TrailheadSpace.radiusMd))
        }
        .disabled(!isEnabled || isLoading)
        .opacity(isEnabled ? 1.0 : 0.45)
    }

    private var backgroundColor: Color {
        switch variant {
        case .primary:
            return TrailheadColors.accent
        case .secondary:
            return TrailheadColors.surfaceRaised
        case .danger:
            return TrailheadColors.danger
        case .ghost:
            return Color.clear
        }
    }

    private var foregroundColor: Color {
        switch variant {
        case .primary, .danger:
            return Color.white
        case .secondary:
            return TrailheadColors.ink
        case .ghost:
            return TrailheadColors.accent
        }
    }

    private var borderColor: Color {
        switch variant {
        case .secondary:
            return TrailheadColors.border
        default:
            return Color.clear
        }
    }
}

struct TrailheadCard<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TrailheadSpace.sm) {
            content
        }
        .padding(TrailheadSpace.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(TrailheadColors.surfaceRaised)
        .clipShape(RoundedRectangle(cornerRadius: TrailheadSpace.radiusMd))
        .overlay(
            RoundedRectangle(cornerRadius: TrailheadSpace.radiusMd)
                .stroke(TrailheadColors.borderFaint, lineWidth: 1)
        )
    }
}

struct FilterChip: View {
    let title: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(TrailheadType.subheadline)
                .fontWeight(isSelected ? .semibold : .regular)
                .padding(.horizontal, TrailheadSpace.md)
                .padding(.vertical, TrailheadSpace.xs + 2)
                .background(isSelected ? TrailheadColors.accent : TrailheadColors.surfaceRaised)
                .foregroundColor(isSelected ? .white : TrailheadColors.inkMuted)
                .clipShape(Capsule())
                .overlay(
                    Capsule()
                        .stroke(isSelected ? Color.clear : TrailheadColors.borderFaint, lineWidth: 1)
                )
        }
        .accessibilityLabel(Text(title))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

struct TypingDotsView: View {
    @State private var phase = 0

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<3) { index in
                Circle()
                    .fill(TrailheadColors.inkMuted)
                    .frame(width: 6, height: 6)
                    .opacity(phase == index ? 1.0 : 0.3)
                    .animation(
                        Animation.easeInOut(duration: 0.6)
                            .repeatForever(autoreverses: true)
                            .delay(Double(index) * 0.2),
                        value: phase
                    )
            }
        }
        .padding(.horizontal, TrailheadSpace.sm)
        .padding(.vertical, TrailheadSpace.xs)
        .onAppear {
            phase = 2
        }
    }
}

struct CreditHintView: View {
    let remaining: Int
    let cap: Int

    var body: some View {
        if remaining <= 5 {
            HStack(spacing: TrailheadSpace.xs) {
                Image(systemName: "sparkles")
                    .foregroundColor(TrailheadColors.accentWarm)
                Text("\(remaining) of \(cap) free drives left")
                    .font(TrailheadType.caption)
                    .foregroundColor(TrailheadColors.inkMuted)
            }
            .padding(.horizontal, TrailheadSpace.md)
            .padding(.vertical, TrailheadSpace.xs)
        }
    }
}

struct AttributionSheet: View {
    let attributions: [Attribution]
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section(header: Text("Sources & Data Providers").font(TrailheadType.caption)) {
                    if attributions.isEmpty {
                        Text("OpenStreetMap, Wikipedia, Wikidata, Macrostrat, Google Places")
                            .font(TrailheadType.body)
                            .foregroundColor(TrailheadColors.inkMuted)
                    } else {
                        ForEach(Array(attributions.enumerated()), id: \.offset) { _, item in
                            VStack(alignment: .leading, spacing: TrailheadSpace.xs) {
                                Text(item.title ?? item.sourceId)
                                    .font(TrailheadType.headline)
                                    .foregroundColor(TrailheadColors.ink)
                                Text(item.source.rawValue.replacingOccurrences(of: "_", with: " ").capitalized)
                                    .font(TrailheadType.caption)
                                    .foregroundColor(TrailheadColors.inkMuted)
                                if let urlString = item.url, let url = URL(string: urlString) {
                                    Link(urlString, destination: url)
                                        .font(TrailheadType.caption)
                                        .foregroundColor(TrailheadColors.accent)
                                }
                                if let license = item.license, !license.isEmpty {
                                    if let deed = deedURL(for: license) {
                                        Link(license, destination: deed)
                                            .font(TrailheadType.caption)
                                            .foregroundColor(TrailheadColors.accent)
                                    } else {
                                        Text(license)
                                            .font(TrailheadType.caption)
                                            .foregroundColor(TrailheadColors.inkMuted)
                                    }
                                }
                            }
                            .padding(.vertical, TrailheadSpace.xs)
                        }
                    }
                }
            }
            .navigationTitle("Attributions")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
    }

    private func deedURL(for license: String) -> URL? {
        let trimmed = license.trimmingCharacters(in: .whitespacesAndNewlines)
        switch trimmed {
        case "CC BY-SA 4.0":
            return URL(string: "https://creativecommons.org/licenses/by-sa/4.0/")
        case "CC BY 4.0":
            return URL(string: "https://creativecommons.org/licenses/by/4.0/")
        case "CC0 1.0":
            return URL(string: "https://creativecommons.org/publicdomain/zero/1.0/")
        default:
            return nil
        }
    }
}
