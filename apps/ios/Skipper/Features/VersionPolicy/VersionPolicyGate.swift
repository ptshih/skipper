import SwiftUI

/// App presents policy notices above navigation. A required update stops and dismisses driving;
/// a recommended update retains navigation and audio underneath its dismissible notice.
/// Keep one controller for the launch and check after preference migration.
struct VersionPolicyGate: View {
    let controller: VersionPolicyController
    @Environment(\.openURL) private var openURL

    var body: some View {
        if let gate = controller.gate {
            GeometryReader { geometry in
                ScrollView {
                    VStack(spacing: TrailheadSpace.large) {
                        Text(gate == .force ? "Update required" : "Update available")
                            .font(TrailheadType.display)
                            .foregroundStyle(TrailheadColors.ink)
                            .accessibilityAddTraits(.isHeader)
                        Text(gate == .force ? "A new version of Skipper is required to keep going." : "A new version of Skipper is available.")
                            .font(TrailheadType.body)
                            .foregroundStyle(TrailheadColors.inkDim)
                        Button {
                            controller.openStore { openURL($0) }
                        } label: {
                            Text("Update")
                                .font(TrailheadType.bodyStrong)
                                .frame(maxWidth: .infinity, minHeight: TrailheadSpace.minimumHit)
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(TrailheadColors.onPrimary)
                        .background(TrailheadColors.primaryFill, in: RoundedRectangle(cornerRadius: 12))
                        .accessibilityIdentifier("version.update")
                        if gate == .nudge {
                            Button { controller.dismissNudge() } label: {
                                Text("Later")
                                    .font(TrailheadType.bodyStrong)
                                    .frame(maxWidth: .infinity, minHeight: TrailheadSpace.minimumHit)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .foregroundStyle(TrailheadColors.accent)
                            .accessibilityIdentifier("version.later")
                        }
                    }
                    .multilineTextAlignment(.center)
                    .padding(TrailheadSpace.large)
                    .frame(maxWidth: 480)
                    .frame(maxWidth: .infinity, minHeight: geometry.size.height)
                }
            }
            .background(TrailheadColors.surface.ignoresSafeArea())
            .interactiveDismissDisabled()
            .accessibilityIdentifier("version.gate")
        }
    }
}
