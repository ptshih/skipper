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

extension View {
    /// Pins screen chrome (filters, banners, a region picker) above a scroll view as a bar the
    /// content scrolls beneath. The scroll view must stay the navigation content's topmost view:
    /// wrapping it in a VStack under the chrome starts it at the safe-area edge, so nothing ever
    /// passes under the navigation bar and iOS 26's glass edge has nothing to blur (2026-09-16).
    /// iOS 26 extends that edge effect under a `safeAreaBar`; earlier systems have no such effect,
    /// so the fallback inset takes the page background to hide the rows passing under it.
    /// ⚠ Only under an INLINE title. iOS 26 draws a large title inside the scroll region, so the
    /// extended effect blurs the title itself (seen on My Drives, 2026-09-16); a large-title
    /// screen pins its chrome with `trailheadTopInset` instead.
    /// ⚠ A `background` on the chrome must not ignore the top safe-area edge (the default): the
    /// chrome touches that edge, so the fill bleeds up through the navigation bar and paints over
    /// the title (same day). Pass `ignoresSafeAreaEdges: .horizontal`.
    @ViewBuilder
    func trailheadTopBar<Bar: View>(@ViewBuilder _ bar: @escaping () -> Bar) -> some View {
        if #available(iOS 26.0, *) {
            safeAreaBar(edge: .top, spacing: 0, content: bar)
        } else {
            trailheadTopInset(bar)
        }
    }

    /// The large-title counterpart of `trailheadTopBar`: the chrome stays pinned on the page
    /// background, the rows pass under it and the navigation bar, and the large title collapses
    /// into the glass bar untouched because no edge effect is extended over it.
    func trailheadTopInset<Bar: View>(@ViewBuilder _ bar: @escaping () -> Bar) -> some View {
        safeAreaInset(edge: .top, spacing: 0) {
            bar().background(TrailheadColors.background, ignoresSafeAreaEdges: .horizontal)
        }
    }

    /// A system `List` on the Trailhead paper instead of the grouped system gray. Without this a
    /// settings-style screen is the one place the app stops looking like Skipper (audit, 2026-09-16).
    /// Pair it with `.listRowBackground(TrailheadColors.surfaceRaised)` on each Section so the
    /// rows read as raised placards on the paper rather than white cards on cream.
    func trailheadList() -> some View {
        scrollContentBackground(.hidden)
            .background(TrailheadColors.background.ignoresSafeArea())
    }
}

/// A text-link button whose whole row is tappable. A bare `Button("…")` hit-tests only its
/// glyphs (about 18 pt tall), and a `.frame(minHeight:)` applied OUTSIDE the button does not
/// grow that area — it only pads around it. The height belongs on the label, with a content
/// shape, which is what this style does (audit, 2026-09-16). Driving controls pass
/// `TrailheadSpace.minimumHit`; ordinary screens use the 44 pt default.
struct TrailheadLinkButtonStyle: ButtonStyle {
    var minHeight: CGFloat = 44

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .frame(minHeight: minHeight)
            .contentShape(Rectangle())
            .opacity(configuration.isPressed ? 0.6 : 1)
    }
}

extension ButtonStyle where Self == TrailheadLinkButtonStyle {
    static var trailheadLink: TrailheadLinkButtonStyle { TrailheadLinkButtonStyle() }
    static func trailheadLink(minHeight: CGFloat) -> TrailheadLinkButtonStyle { TrailheadLinkButtonStyle(minHeight: minHeight) }
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
