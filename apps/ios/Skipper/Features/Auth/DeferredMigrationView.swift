import SwiftUI

/// An account notice above public navigation, never an app-wide credential wall. Deferred can
/// mean a fresh offline install, an API outage, or retained credentials awaiting verification.
struct DeferredMigrationView: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    var canRecoverCredentials = false
    var isBusy = false
    var onRecover: (@MainActor () -> Void)? = nil
    let onRetry: @MainActor () -> Void

    var message: String {
        canRecoverCredentials ? "Saved sign-in unreadable." : "Account check unavailable."
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TrailheadSpace.small) {
            Text(message)
                .font(TrailheadType.caption)
                .foregroundStyle(TrailheadColors.inkDim)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("migration.notice")
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: TrailheadSpace.small) { actions }
            } else {
                HStack(spacing: TrailheadSpace.medium) { actions }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TrailheadSpace.medium)
        .padding(.vertical, TrailheadSpace.small)
        .background(TrailheadColors.surfaceRaised)
    }

    @ViewBuilder private var actions: some View {
        Button(action: onRetry) {
            Text(isBusy ? "Checking…" : "Retry")
                .font(TrailheadType.caption)
                .frame(minHeight: TrailheadSpace.minimumHit)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(TrailheadColors.accent)
        .disabled(isBusy)
        .accessibilityLabel(isBusy ? "Checking account" : "Retry account check")
        .accessibilityIdentifier("migration.retry")
        if canRecoverCredentials, let onRecover {
            Button(action: onRecover) {
                Text("Sign in again")
                    .font(TrailheadType.caption)
                    .frame(minHeight: TrailheadSpace.minimumHit)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(TrailheadColors.accent)
            .disabled(isBusy)
            .accessibilityIdentifier("migration.recover")
        }
    }
}
