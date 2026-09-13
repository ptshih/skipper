import SwiftUI

struct DrivingDiagnosticsView: View {
    @Bindable var controller: DrivePlaybackController
    let onClose: () -> Void
    @AppStorage("skipper.simMode") private var simMode = "0"
    @State private var traces: [DriveStoredTrace] = []
    @State private var error: String?
    @State private var export: TraceExport?
    @State private var deleting: DriveStoredTrace?

    var body: some View {
        NavigationStack {
            Form {
                if controller.canAdmin {
                    Section("Simulation") {
                        Toggle("Simulate saved drives", isOn: Binding(get: { simMode == "1" }, set: { simMode = $0 ? "1" : "0" }))
                            .disabled(controller.phase == .driving)
                        Toggle("Fast-forward quiet road", isOn: $controller.fastSimulation)
                        Text("Narration plays at normal speed. New road triggers take priority over replays.")
                    }
                    Section("Local GPS traces") {
                        Text("Administrator drives record GPS locally, including rejected fixes. Coordinates never enter analytics. Share a trace only when you intend to export it.")
                        Button("Save current trace and refresh") { _ = controller.exportTrace(); refresh() }
                        ForEach(traces) { trace in
                            VStack(alignment: .leading, spacing: TrailheadSpace.small) {
                                Text(trace.name).font(TrailheadType.mono).textSelection(.enabled)
                                Text(ByteCountFormatter.string(fromByteCount: Int64(trace.sizeBytes), countStyle: .file)).font(TrailheadType.caption)
                                HStack {
                                    Button("Share", systemImage: "square.and.arrow.up") {
                                        do { export = TraceExport(url: try controller.exportTrace(named: trace.name)) }
                                        catch { self.error = "This trace couldn't be shared. Check your administrator session." }
                                    }
                                    Button("Replay", systemImage: "play") {
                                        do { try controller.replayTrace(named: trace.name); onClose() }
                                        catch { self.error = "Replay needs the same saved drive and an administrator session." }
                                    }.disabled(controller.phase == .driving)
                                    Button("Delete", systemImage: "trash", role: .destructive) { deleting = trace }
                                }.buttonStyle(.borderless).frame(minHeight: TrailheadSpace.minimumHit)
                            }
                        }
                        if traces.isEmpty { Text("No recorded traces yet.") }
                    }
                    if let error { Text(error).foregroundStyle(TrailheadColors.danger) }
                } else { Text("An administrator session is required.") }
            }
            .navigationTitle("Driving diagnostics")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done", action: onClose) } }
            .task { refresh() }
            .sheet(item: $export) { item in
                if controller.canAdmin { TraceShareSheet(url: item.url) }
                else { Text("An administrator session is required.") }
            }
            .confirmationDialog("Delete this local trace?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
                Button("Delete trace", role: .destructive) {
                    guard let deleting else { return }
                    do { try controller.deleteTrace(named: deleting.name); refresh() }
                    catch { self.error = "This trace couldn't be deleted." }
                    self.deleting = nil
                }
            }
        }
    }
    private func refresh() {
        do { traces = try controller.storedTraces(); error = nil }
        catch { traces = []; self.error = "Traces are available only to a current administrator." }
    }
}

private struct TraceExport: Identifiable { let id = UUID(); let url: URL }
private struct TraceShareSheet: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> UIActivityViewController { UIActivityViewController(activityItems: [url], applicationActivities: nil) }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
