import SwiftUI

struct LegalView: View {
    var body: some View {
        List {
            Section(header: Text("Legal & Terms").font(TrailheadType.caption)) {
                Link(destination: URL(string: "https://skipper.fm/terms")!) {
                    HStack {
                        Text("Terms of Service")
                            .font(TrailheadType.body)
                            .foregroundColor(TrailheadColors.ink)
                        Spacer()
                        Image(systemName: "arrow.up.right")
                            .font(.system(size: 12))
                            .foregroundColor(TrailheadColors.inkMuted)
                    }
                }

                Link(destination: URL(string: "https://skipper.fm/privacy")!) {
                    HStack {
                        Text("Privacy Policy")
                            .font(TrailheadType.body)
                            .foregroundColor(TrailheadColors.ink)
                        Spacer()
                        Image(systemName: "arrow.up.right")
                            .font(.system(size: 12))
                            .foregroundColor(TrailheadColors.inkMuted)
                    }
                }
            }
            .listRowBackground(TrailheadColors.surfaceRaised)

            Section(header: Text("Sources & Licenses").font(TrailheadType.caption)) {
                Text("The skipper does his homework. Every tale and every rock on a drive is built from the sources below, and we keep the credit where it’s due.")
                    .font(TrailheadType.body)
                ForEach(LegalCredits.sources) { source in
                    VStack(alignment: .leading, spacing: TrailheadSpace.sm) {
                        Text(source.name)
                            .font(TrailheadType.headline)
                        Text(source.use)
                            .font(TrailheadType.body)
                        Text(source.note)
                            .font(TrailheadType.caption)
                            .foregroundStyle(TrailheadColors.inkMuted)
                        Link("Visit \(source.name)", destination: source.sourceURL)
                        if let license = source.license, let url = source.licenseURL {
                            Link(license, destination: url)
                        }
                    }
                    .padding(.vertical, TrailheadSpace.xs)
                }

                VStack(alignment: .leading, spacing: TrailheadSpace.xs) {
                    Text("Google Maps Platform")
                        .font(TrailheadType.headline)
                        .foregroundColor(TrailheadColors.ink)
                    Text("Mapping and route directions powered by Google Maps SDK.")
                        .font(TrailheadType.caption)
                        .foregroundColor(TrailheadColors.inkMuted)
                    Link("Google Maps Platform Terms", destination: URL(string: "https://cloud.google.com/maps-platform/terms")!)
                }
                .padding(.vertical, TrailheadSpace.xs)
            }
            .listRowBackground(TrailheadColors.surfaceRaised)

            Section(header: Text("The road music").font(TrailheadType.caption)) {
                Text("And the songs between stops: the skipper’s glovebox playlist, credited where it counts.")
                    .font(TrailheadType.body)
                ForEach(LegalCredits.music) { credit in
                    VStack(alignment: .leading, spacing: TrailheadSpace.sm) {
                        Text(credit.artist)
                            .font(TrailheadType.headline)
                        Text(credit.tracks.joined(separator: " · "))
                            .font(TrailheadType.body)
                        Text("Via \(credit.via)")
                            .font(TrailheadType.caption)
                            .foregroundStyle(TrailheadColors.inkMuted)
                        Link("Visit \(credit.artist)", destination: credit.sourceURL)
                        Link(credit.license, destination: credit.licenseURL)
                    }
                    .padding(.vertical, TrailheadSpace.xs)
                }
                VStack(alignment: .leading, spacing: TrailheadSpace.sm) {
                    Text(LegalCredits.additionalMusic)
                        .font(TrailheadType.caption)
                        .foregroundStyle(TrailheadColors.inkMuted)
                    Link("Pixabay Content License", destination: LegalCredits.pixabayLicenseURL)
                }
            }
            .listRowBackground(TrailheadColors.surfaceRaised)
        }
        .tint(TrailheadColors.accent)
        .trailheadList()
        .navigationTitle("Legal & Licenses")
        .navigationBarTitleDisplayMode(.inline)
    }
}
