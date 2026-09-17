import SwiftUI

struct ProposalCardView: View {
    let card: ProposalCardItem
    var canOfferSignIn: Bool = true
    let audio: (any AudioPreviewControlling)?
    let onMakeDrive: () -> Void
    let onSignIn: () -> Void
    let onOpenDrive: (String) -> Void

    private var isPlayingPreview: Bool {
        audio?.isPlaying == true && audio?.currentItemKey == "proposal-\(card.id)"
    }

    var body: some View {
        TrailheadCard {
            VStack(alignment: .leading, spacing: TrailheadSpace.md) {
                // Header with endpoints
                if let proposal = card.proposal {
                    VStack(alignment: .leading, spacing: TrailheadSpace.xs) {
                        Text("\(proposal.start.name) to \(proposal.end.name)")
                            .font(TrailheadType.headline)
                            .foregroundColor(TrailheadColors.ink)

                        HStack(spacing: TrailheadSpace.sm) {
                            let minutes = proposal.durationSeconds / 60
                            Text("\(minutes) min")
                                .font(TrailheadType.caption)
                                .foregroundColor(TrailheadColors.inkMuted)

                            let miles = Double(proposal.distanceMeters) / 1609.34
                            Text(String(format: "%.1f mi", miles))
                                .font(TrailheadType.caption)
                                .foregroundColor(TrailheadColors.inkMuted)

                            if let stops = proposal.estStopCount {
                                Text("\(stops) stops")
                                    .font(TrailheadType.caption)
                                    .foregroundColor(TrailheadColors.inkMuted)
                            }
                        }
                    }

                    // Route preview map
                    // A preview, not a map to explore: with gestures on, the UIKit map wins the
                    // pan and a swipe over the card scrolls the map instead of the transcript.
                    GoogleRouteMap(
                        coordinates: proposal.polyline,
                        padding: 30,
                        allowsGestures: false
                    )
                    .frame(height: 180)
                    .clipShape(RoundedRectangle(cornerRadius: TrailheadSpace.radiusSm))

                    // Audio preview clip button
                    if let previewClip = proposal.previewClip, let clipURL = URL(string: previewClip.url) {
                        HStack(spacing: TrailheadSpace.sm) {
                            Button {
                                toggleAudioPreview(url: clipURL)
                            } label: {
                                HStack(spacing: TrailheadSpace.xs) {
                                    Image(systemName: isPlayingPreview ? "pause.circle.fill" : "play.circle.fill")
                                        .font(.system(size: 20))
                                    Text(isPlayingPreview ? "Pause Sample" : "Listen to Sample")
                                        .font(TrailheadType.caption)
                                }
                                .foregroundColor(TrailheadColors.accent)
                                .padding(.vertical, TrailheadSpace.xs)
                                .padding(.horizontal, TrailheadSpace.sm)
                                .background(TrailheadColors.accent.opacity(0.12))
                                .cornerRadius(TrailheadSpace.radiusSm)
                            }
                            Spacer()
                        }
                    }
                } else if card.isLoadingProposal {
                    HStack(spacing: TrailheadSpace.sm) {
                        ProgressView()
                            .tint(TrailheadColors.accent)
                        Text("Estimating route…")
                            .font(TrailheadType.caption)
                            .foregroundColor(TrailheadColors.inkMuted)
                    }
                    .frame(height: 80)
                } else if let error = card.proposalError {
                    Text(error)
                        .font(TrailheadType.caption)
                        .foregroundColor(TrailheadColors.inkMuted)
                        .padding(.vertical, TrailheadSpace.sm)
                }

                // CTA Button based on state
                switch card.state {
                case .noStops:
                    VStack(alignment: .leading, spacing: TrailheadSpace.xs) {
                        Text("Nothing along that road I can talk about yet.")
                            .font(TrailheadType.caption)
                            .foregroundColor(TrailheadColors.inkMuted)
                            .accessibilityIdentifier("proposal.noStops")

                        TrailheadButton(
                            "Make this drive",
                            icon: "sparkles",
                            variant: .secondary,
                            isEnabled: false
                        ) {}
                        .accessibilityIdentifier("proposal.make")
                    }

                case .idle:
                    VStack(alignment: .leading, spacing: TrailheadSpace.xs) {
                        TrailheadButton(
                            "Make this drive",
                            icon: "sparkles",
                            variant: .primary,
                            isEnabled: card.proposal != nil && card.proposal?.estStopCount != 0
                        ) {
                            onMakeDrive()
                        }
                        .accessibilityIdentifier("proposal.make")

                        Text("Uses one of your free drives.")
                            .font(TrailheadType.caption)
                            .foregroundColor(TrailheadColors.inkMuted)
                            .accessibilityIdentifier("voice.proposal.costNote")
                    }

                case .creating:
                    TrailheadButton(
                        "Creating drive…",
                        variant: .primary,
                        isLoading: true,
                        isEnabled: false
                    ) {}

                case .needsAccount:
                    VStack(spacing: TrailheadSpace.sm) {
                        HStack(spacing: TrailheadSpace.xs) {
                            Image(systemName: "person.crop.circle.badge.plus")
                                .foregroundColor(TrailheadColors.accentWarm)
                            Text("Sign in to save this drive and listen on the road.")
                                .font(TrailheadType.caption)
                                .foregroundColor(TrailheadColors.inkMuted)
                        }
                        if canOfferSignIn {
                            TrailheadButton(
                                "Sign In to Make Drive",
                                variant: .primary
                            ) {
                                onSignIn()
                            }
                            .accessibilityIdentifier("proposal.sign-in")
                        }
                    }

                case .made(let driveId):
                    VStack(spacing: TrailheadSpace.sm) {
                        HStack(spacing: TrailheadSpace.xs) {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundColor(TrailheadColors.accent)
                            Text("Drive ready!")
                                .font(TrailheadType.headline)
                                .foregroundColor(TrailheadColors.ink)
                        }
                        TrailheadButton(
                            "View Drive Details",
                            icon: "arrow.right",
                            variant: .secondary
                        ) {
                            onOpenDrive(driveId)
                        }
                    }

                case .failed(let message):
                    VStack(spacing: TrailheadSpace.sm) {
                        Text(message)
                            .font(TrailheadType.caption)
                            .foregroundColor(TrailheadColors.danger)
                        TrailheadButton(
                            "Try Again",
                            variant: .primary
                        ) {
                            onMakeDrive()
                        }
                        .accessibilityIdentifier("proposal.retry")
                    }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("planner.proposal")
    }

    private func toggleAudioPreview(url: URL) {
        guard let audio else { return }
        Task { @MainActor in
            if isPlayingPreview {
                audio.pause()
            } else {
                try? await audio.play(url: url, itemKey: "proposal-\(card.id)")
            }
        }
    }
}
