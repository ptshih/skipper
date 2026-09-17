import SwiftUI

struct DeveloperSettingsView: View {
    let session: SessionStore
    let storage: StorageService?
    @State private var downloadCount: Int = 0
    @State private var cacheCleared: Bool = false

    private var versionLabel: String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "—"
        return "\(version) (\(build))"
    }

    var body: some View {
        List {
            if session.isAdmin {
                Section(header: Text("App Information").font(TrailheadType.caption)) {
                    HStack {
                        Text("Version")
                            .font(TrailheadType.body)
                        Spacer()
                        Text(versionLabel)
                            .font(TrailheadType.mono)
                            .foregroundColor(TrailheadColors.inkMuted)
                    }

                    HStack {
                        Text("Session State")
                            .font(TrailheadType.body)
                        Spacer()
                        Text(session.isSignedIn ? "Signed In (\(session.user?.email ?? ""))" : "Signed Out")
                            .font(TrailheadType.caption)
                            .foregroundColor(TrailheadColors.inkMuted)
                    }
                }
                .listRowBackground(TrailheadColors.surfaceRaised)

                Section(header: Text("Offline Storage").font(TrailheadType.caption)) {
                    HStack {
                        Text("Downloaded Drives")
                            .font(TrailheadType.body)
                        Spacer()
                        Text("\(downloadCount)")
                            .font(TrailheadType.mono)
                            .foregroundColor(TrailheadColors.inkMuted)
                    }

                    Button(role: .destructive) {
                        Task {
                            guard session.isAdmin else { return }
                            if let storage {
                                _ = await storage.deleteAllDriveDownloads()
                            }
                            cacheCleared = true
                            downloadCount = 0
                        }
                    } label: {
                        HStack {
                            Text("Purge Offline Audio Cache")
                            Spacer()
                            if cacheCleared {
                                Image(systemName: "checkmark")
                                    .foregroundColor(TrailheadColors.accent)
                            }
                        }
                    }
                }
                .listRowBackground(TrailheadColors.surfaceRaised)
            } else {
                Text("Developer tools are available to admins only.")
                    .font(TrailheadType.body)
            }
        }
        .trailheadList()
        .navigationTitle("Developer")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if session.isAdmin, let storage {
                let downloaded = await storage.listDownloadedDrives()
                downloadCount = downloaded.count
            }
        }
    }
}
