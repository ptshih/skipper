import SwiftUI

struct SettingsView: View {
    let session: SessionStore
    let api: any SkipperAPI
    let storage: StorageService?
    @Binding var themeMode: ThemeMode
    @Binding var simMode: Bool
    let onSignIn: @MainActor () -> Void

    enum DeletionProofMode: Equatable {
        case password
        case code
    }

    @State private var userName: String = ""
    @State private var nameRequest = SettingsRequestState()

    @State private var newPassword: String = ""
    @State private var passwordState = SettingsPasswordState()
    @State private var isCheckingPassword = false
    @State private var isResolvingDeletion = false
    @State private var loadedUserId: String?

    @State private var isShowingSignOutConfirm: Bool = false
    @State private var isShowingDeleteSheet: Bool = false
    @State private var deleteProofMode: DeletionProofMode = .code
    @State private var deletePassword: String = ""
    @State private var deleteCode: String = ""
    @State private var deletionRequest = SettingsRequestState()
    @State private var deletionCodeRequest = SettingsRequestState()
    @State private var signOutRequest = SettingsRequestState()

    private var isAccountBusy: Bool {
        session.isBusy || nameRequest.isRunning || passwordState.request.isRunning
            || deletionRequest.isRunning || deletionCodeRequest.isRunning || signOutRequest.isRunning
    }

    var body: some View {
        NavigationStack {
            List {
                // MARK: - Account Section
                Section(header: Text("Account").font(TrailheadType.caption)) {
                    if session.isSignedIn, let user = session.user {
                        HStack {
                            Text("Email")
                                .font(TrailheadType.body)
                            Spacer()
                            Text(user.email)
                                .font(TrailheadType.caption)
                                .foregroundColor(TrailheadColors.inkMuted)
                        }

                        // Name Update
                        VStack(alignment: .leading, spacing: TrailheadSpace.xs) {
                            Text("Display Name")
                                .font(TrailheadType.caption)
                                .foregroundColor(TrailheadColors.inkMuted)
                            HStack {
                                TextField("Your Name", text: $userName)
                                    .font(TrailheadType.body)
                                    .textFieldStyle(.plain)

                                if nameRequest.isRunning {
                                    ProgressView().accessibilityLabel("Saving name")
                                } else if userName.trimmingCharacters(in: .whitespacesAndNewlines) != user.name && !userName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                                    Button("Save") {
                                        saveName()
                                    }
                                    .font(TrailheadType.caption)
                                    .foregroundColor(TrailheadColors.accent)
                                    .disabled(isAccountBusy)
                                    .accessibilityIdentifier("settings.save-name")
                                }
                            }
                            .disabled(nameRequest.isRunning)
                            requestResult(nameRequest)
                        }
                        .onChange(of: userName) { nameRequest.clearResult() }

                        // Set/Update Password
                        VStack(alignment: .leading, spacing: TrailheadSpace.xs) {
                            Text(passwordState.hasPassword ? "Change Password" : "Set Password")
                                .font(TrailheadType.caption)
                                .foregroundColor(TrailheadColors.inkMuted)
                            if isCheckingPassword {
                                ProgressView("Checking password options…")
                            } else if passwordState.hasPassword {
                                Text("We’ll email you a link to set a new password.")
                                    .font(TrailheadType.caption)
                                    .foregroundStyle(TrailheadColors.inkMuted)
                            } else {
                                SecureField("New password (at least 8 characters)", text: $newPassword)
                                    .textContentType(.newPassword)
                                    .font(TrailheadType.body)
                                    .disabled(isAccountBusy)
                            }
                            if passwordState.request.isRunning {
                                ProgressView().accessibilityLabel("Updating password options")
                            } else if !isCheckingPassword {
                                Button(passwordState.hasPassword ? "Send Password Reset Email" : "Set Password") {
                                    savePassword()
                                }
                                .disabled(isAccountBusy || (!passwordState.hasPassword && newPassword.count < 8))
                                .accessibilityIdentifier("settings.password-action")
                            }
                            requestResult(passwordState.request)
                        }
                    } else if AccountEntryPolicy.canOfferSignIn(in: session.state) {
                        Button {
                            onSignIn()
                        } label: {
                            HStack {
                                Label("Sign In or Register", systemImage: "person.crop.circle")
                                    .font(TrailheadType.headline)
                                    .foregroundColor(TrailheadColors.accent)
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .font(.system(size: 12))
                                    .foregroundColor(TrailheadColors.inkMuted)
                            }
                        }
                        .accessibilityIdentifier("account.sign-in")
                    }
                }
                .listRowBackground(TrailheadColors.surfaceRaised)

                // MARK: - Appearance Section
                Section(header: Text("Appearance").font(TrailheadType.caption)) {
                    Picker("Theme", selection: $themeMode) {
                        ForEach(ThemeMode.allCases, id: \.self) { mode in
                            Text(mode.label).tag(mode)
                        }
                    }
                    .pickerStyle(.segmented)
                }
                .listRowBackground(TrailheadColors.surfaceRaised)

                // MARK: - Driving Simulation
                if session.isAdmin {
                    Section(header: Text("Driving").font(TrailheadType.caption)) {
                        Toggle("Simulation Mode", isOn: $simMode)
                            .font(TrailheadType.body)
                            .tint(TrailheadColors.accent)
                    }
                    .listRowBackground(TrailheadColors.surfaceRaised)
                }

                // MARK: - Legal & Developer
                Section(header: Text("About").font(TrailheadType.caption)) {
                    NavigationLink {
                        LegalView()
                    } label: {
                        Text("Legal & Licenses")
                            .font(TrailheadType.body)
                    }

                    if session.isAdmin {
                        NavigationLink {
                            DeveloperSettingsView(session: session, storage: storage)
                        } label: {
                            Text("Developer & Diagnostics")
                                .font(TrailheadType.body)
                        }
                    }
                }
                .listRowBackground(TrailheadColors.surfaceRaised)

                // MARK: - Sign Out & Destructive Actions
                if session.isSignedIn {
                    Section {
                        Button(role: .destructive) {
                            isShowingSignOutConfirm = true
                        } label: {
                            Text("Sign Out")
                                .font(TrailheadType.body)
                        }
                        .disabled(isAccountBusy)

                        Button(role: .destructive) {
                            isResolvingDeletion = true
                            isShowingDeleteSheet = true
                        } label: {
                            Text("Delete Account…")
                                .font(TrailheadType.body)
                        }
                        .disabled(isAccountBusy)
                        requestResult(signOutRequest)
                    }
                    .listRowBackground(TrailheadColors.surfaceRaised)
                }
            }
            .trailheadList()
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .task(id: session.user?.id) {
                userName = session.user?.name ?? ""
                newPassword = ""
                nameRequest.clearResult()
                if loadedUserId != session.user?.id {
                    loadedUserId = session.user?.id
                    passwordState = SettingsPasswordState()
                }
                if let user = session.user {
                    isCheckingPassword = true
                    defer {
                        if !Task.isCancelled, session.user?.id == user.id {
                            isCheckingPassword = false
                        }
                    }
                    let lookup = await session.hasPassword()
                    guard !Task.isCancelled, session.user?.id == user.id else { return }
                    passwordState.applyLookupResult(lookup)
                } else {
                    passwordState.hasPassword = false
                    isCheckingPassword = false
                }
            }
            .alert("Sign Out?", isPresented: $isShowingSignOutConfirm) {
                Button("Cancel", role: .cancel) {}
                Button("Sign Out", role: .destructive) {
                    Task {
                        await signOutRequest.run { try await session.signOut() }
                    }
                }
            } message: {
                Text("Your downloaded drives and offline content will be removed from this device.")
            }
            .sheet(isPresented: $isShowingDeleteSheet, onDismiss: {
                deletePassword = ""
                deleteCode = ""
                deleteProofMode = .code
                deletionRequest.clearResult()
                deletionCodeRequest.clearResult()
            }) {
                deleteAccountSheet
                    .task {
                        let lookup = await session.hasPassword()
                        guard !Task.isCancelled else { return }
                        deleteProofMode = (lookup == true) ? .password : .code
                        isResolvingDeletion = false
                    }
            }
        }
    }

    private func saveName() {
        let name = userName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, !isAccountBusy else { return }
        Task {
            await nameRequest.run(success: "Name saved.") { try await session.updateName(name) }
        }
    }

    private func savePassword() {
        guard !isAccountBusy, !isCheckingPassword, let email = session.user?.email else { return }
        Task {
            let succeeded = await passwordState.submit(newPassword: newPassword,
                setPassword: { try await api.setAccountPassword($0) },
                requestReset: { try await session.requestPasswordReset(email: email) })
            if succeeded || passwordState.hasPassword { newPassword = "" }
        }
    }

    @ViewBuilder
    private func requestResult(_ request: SettingsRequestState) -> some View {
        if let error = request.errorMessage {
            Text(error)
                .font(TrailheadType.caption)
                .foregroundStyle(TrailheadColors.danger)
        }
        if let success = request.successMessage {
            Text(success)
                .font(TrailheadType.caption)
                .foregroundStyle(TrailheadColors.accent)
        }
    }

    // MARK: - Delete Account Sheet

    private var deleteAccountSheet: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: TrailheadSpace.md) {
                    Text("Delete your account?")
                        .font(TrailheadType.title)
                        .foregroundColor(TrailheadColors.danger)

                    Text("This will permanently delete your account, saved drives, and remaining credits. This action cannot be undone.")
                        .font(TrailheadType.body)
                        .foregroundColor(TrailheadColors.inkMuted)

                    if isResolvingDeletion {
                        ProgressView("Checking account verification options…")
                    } else if deleteProofMode == .password {
                        VStack(alignment: .leading, spacing: TrailheadSpace.xs) {
                            Text("Confirm with your password:")
                                .font(TrailheadType.caption)
                                .foregroundColor(TrailheadColors.ink)
                            SecureField("Password", text: $deletePassword)
                                .textContentType(.password)
                                .disabled(deletionRequest.isRunning)
                                .font(TrailheadType.body)
                                .padding(TrailheadSpace.sm)
                                .background(TrailheadColors.surfaceRaised)
                                .clipShape(RoundedRectangle(cornerRadius: TrailheadSpace.radiusSm))
                        }
                    } else {
                        VStack(alignment: .leading, spacing: TrailheadSpace.xs) {
                            Text("Send a verification code to your email, then enter it here:")
                                .font(TrailheadType.caption)
                                .foregroundColor(TrailheadColors.ink)
                            HStack {
                                TextField("6-digit code", text: $deleteCode)
                                    .keyboardType(.numberPad)
                                    .textContentType(.oneTimeCode)
                                    .disabled(deletionRequest.isRunning)
                                    .font(TrailheadType.mono)
                                    .padding(TrailheadSpace.sm)
                                    .background(TrailheadColors.surfaceRaised)
                                    .clipShape(RoundedRectangle(cornerRadius: TrailheadSpace.radiusSm))

                                Button(deletionCodeRequest.successMessage == nil ? "Send Code" : "Resend Code") {
                                    Task {
                                        await deletionCodeRequest.run(success: "Verification code sent. Check your email.") {
                                            try await session.sendDeletionCode()
                                        }
                                    }
                                }
                                .font(TrailheadType.caption)
                                .foregroundColor(TrailheadColors.accent)
                                .disabled(isAccountBusy)
                                .accessibilityIdentifier("settings.send-deletion-code")
                            }
                            if deletionCodeRequest.isRunning { ProgressView("Sending code…") }
                            requestResult(deletionCodeRequest)
                        }
                    }

                    requestResult(deletionRequest)

                    TrailheadButton(
                        "Permanently Delete Account",
                        variant: .danger,
                        isLoading: deletionRequest.isRunning,
                        isEnabled: !isAccountBusy && !isResolvingDeletion && (deleteProofMode == .password ? !deletePassword.isEmpty : !deleteCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    ) {
                        performAccountDeletion()
                    }
                }
                .padding(TrailheadSpace.lg)
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        isShowingDeleteSheet = false
                    }
                    .disabled(deletionRequest.isRunning || deletionCodeRequest.isRunning)
                }
            }
        }
        .interactiveDismissDisabled(deletionRequest.isRunning || deletionCodeRequest.isRunning)
    }

    private func performAccountDeletion() {
        guard !isAccountBusy, !isResolvingDeletion else { return }
        let proof: SessionStore.DeletionProof = (deleteProofMode == .password) ? .password(deletePassword) : .code(deleteCode)
        Task {
            if await deletionRequest.run(operation: { try await session.deleteAccount(proof: proof) }) {
                isShowingDeleteSheet = false
            }
        }
    }
}
