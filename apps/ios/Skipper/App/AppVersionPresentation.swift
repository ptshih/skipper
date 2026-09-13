import SwiftUI

/// A recommendation must not unmount a live planner or dismiss an existing sheet/drive.
/// Its overlay waits beneath those presentations. Only a required update replaces the subtree.
struct AppVersionPresentation<Content: View>: View {
    let controller: VersionPolicyController?
    @ViewBuilder let content: () -> Content

    var body: some View {
        if let controller, controller.gate == .force {
            VersionPolicyGate(controller: controller)
        } else {
            content()
                .allowsHitTesting(controller?.gate != .nudge)
                .accessibilityHidden(controller?.gate == .nudge)
                .overlay {
                    if let controller, controller.gate == .nudge {
                        VersionPolicyGate(controller: controller)
                    }
                }
        }
    }
}
