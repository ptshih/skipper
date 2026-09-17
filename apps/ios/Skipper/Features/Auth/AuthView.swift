import SwiftUI

enum AuthStep: Hashable {
    case email
    case code
    case password
    case reset
}

struct AuthView: View {
    @Bindable var session: SessionStore
    var analytics: AnalyticsTracker? = nil
    let onSuccess: @MainActor () -> Void
    var onCancel: (@MainActor () -> Void)? = nil

    @State private var step: AuthStep = .email
    @State private var email: String = ""
    @State private var code: String = ""
    @State private var password: String = ""
    @State private var errorText: String? = nil
    @State private var resetSent: Bool = false

    private var isEmailValid: Bool {
        let pattern = "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$"
        return email.trimmingCharacters(in: .whitespacesAndNewlines).range(of: pattern, options: .regularExpression) != nil
    }

    private var isCodeValid: Bool {
        let trimmed = code.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.count == 6 && trimmed.allSatisfy { $0.isNumber }
    }

    private var isPasswordValid: Bool {
        isEmailValid && !password.isEmpty
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: TrailheadSpace.lg) {
                    // Header icon and title
                    VStack(spacing: TrailheadSpace.sm) {
                        Image(systemName: "person.crop.circle.badge.checkmark")
                            .font(.system(size: 48))
                            .foregroundColor(TrailheadColors.accent)
                            .padding(.top, TrailheadSpace.lg)

                        Text(titleText)
                            .font(TrailheadType.title)
                            .foregroundColor(TrailheadColors.ink)

                        Text(subtitleText)
                            .font(TrailheadType.body)
                            .foregroundColor(TrailheadColors.inkMuted)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, TrailheadSpace.md)
                    }

                    // Error banner
                    if let error = errorText ?? session.lastError {
                        HStack(spacing: TrailheadSpace.sm) {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundColor(TrailheadColors.danger)
                            Text(error)
                                .font(TrailheadType.subheadline)
                                .foregroundColor(TrailheadColors.danger)
                            Spacer()
                        }
                        .padding(TrailheadSpace.md)
                        .background(TrailheadColors.danger.opacity(0.1))
                        .clipShape(RoundedRectangle(cornerRadius: TrailheadSpace.radiusSm))
                    }

                    // Forms based on step
                    VStack(spacing: TrailheadSpace.md) {
                        switch step {
                        case .email:
                            emailStepContent
                        case .code:
                            codeStepContent
                        case .password:
                            passwordStepContent
                        case .reset:
                            resetStepContent
                        }
                    }
                    .padding(.top, TrailheadSpace.sm)

                    Spacer(minLength: TrailheadSpace.xl)
                }
                .padding(.horizontal, TrailheadSpace.lg)
            }
            .background(TrailheadColors.background.ignoresSafeArea())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if let onCancel {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") {
                            onCancel()
                        }
                        .foregroundColor(TrailheadColors.inkMuted)
                    }
                }
            }
            .accessibilityIdentifier("account-wall")
        }
        .accessibilityIdentifier("account.sign-in")
    }

    private var titleText: String {
        switch step {
        case .email:
            return "Sign in to Skipper"
        case .code:
            return "Check your email"
        case .password:
            return "Sign in with password"
        case .reset:
            return "Reset your password"
        }
    }

    private var subtitleText: String {
        switch step {
        case .email:
            return "We'll send a one-time verification code to your email."
        case .code:
            return "Enter the 6-digit code sent to \(email.trimmingCharacters(in: .whitespacesAndNewlines))."
        case .password:
            return "Enter your account password to sign in."
        case .reset:
            return "We'll send you a link to reset your account password."
        }
    }

    // MARK: - Step Views

    @ViewBuilder
    private var emailStepContent: some View {
        VStack(spacing: TrailheadSpace.md) {
            TextField("Email address", text: $email)
                .keyboardType(.emailAddress)
                .autocapitalization(.none)
                .disableAutocorrection(true)
                .padding(TrailheadSpace.md)
                .background(TrailheadColors.surfaceRaised)
                .clipShape(RoundedRectangle(cornerRadius: TrailheadSpace.radiusMd))
                .overlay(
                    RoundedRectangle(cornerRadius: TrailheadSpace.radiusMd)
                        .stroke(TrailheadColors.borderFaint, lineWidth: 1)
                )
                .accessibilityIdentifier("auth.email")

            TrailheadButton(
                "Send Code",
                variant: .primary,
                isLoading: session.isBusy,
                isEnabled: isEmailValid
            ) {
                sendCode()
            }
            .accessibilityIdentifier("auth.send-code")

            Button("Use password instead") {
                errorText = nil
                step = .password
            }
            .buttonStyle(.trailheadLink)
            .font(TrailheadType.subheadline)
            .foregroundColor(TrailheadColors.accent)
            .padding(.top, TrailheadSpace.sm)
        }
    }

    @ViewBuilder
    private var codeStepContent: some View {
        VStack(spacing: TrailheadSpace.md) {
            TextField("6-digit code", text: $code)
                .keyboardType(.numberPad)
                .font(TrailheadType.title)
                .multilineTextAlignment(.center)
                .padding(TrailheadSpace.md)
                .background(TrailheadColors.surfaceRaised)
                .clipShape(RoundedRectangle(cornerRadius: TrailheadSpace.radiusMd))
                .overlay(
                    RoundedRectangle(cornerRadius: TrailheadSpace.radiusMd)
                        .stroke(TrailheadColors.borderFaint, lineWidth: 1)
                )
                .accessibilityIdentifier("auth.code")

            TrailheadButton(
                "Verify & Sign In",
                variant: .primary,
                isLoading: session.isBusy,
                isEnabled: isCodeValid
            ) {
                verifyCode()
            }
            .accessibilityIdentifier("auth.verify")

            HStack(spacing: TrailheadSpace.lg) {
                Button("Resend code") {
                    sendCode()
                }
                .buttonStyle(.trailheadLink)
                .font(TrailheadType.subheadline)
                .foregroundColor(TrailheadColors.accent)

                Button("Change email") {
                    errorText = nil
                    step = .email
                }
                .buttonStyle(.trailheadLink)
                .font(TrailheadType.subheadline)
                .foregroundColor(TrailheadColors.inkMuted)
            }
            .padding(.top, TrailheadSpace.sm)
        }
    }

    @ViewBuilder
    private var passwordStepContent: some View {
        VStack(spacing: TrailheadSpace.md) {
            TextField("Email address", text: $email)
                .keyboardType(.emailAddress)
                .autocapitalization(.none)
                .disableAutocorrection(true)
                .padding(TrailheadSpace.md)
                .background(TrailheadColors.surfaceRaised)
                .clipShape(RoundedRectangle(cornerRadius: TrailheadSpace.radiusMd))
                .overlay(
                    RoundedRectangle(cornerRadius: TrailheadSpace.radiusMd)
                        .stroke(TrailheadColors.borderFaint, lineWidth: 1)
                )
                .accessibilityIdentifier("auth.email")

            SecureField("Password", text: $password)
                .padding(TrailheadSpace.md)
                .background(TrailheadColors.surfaceRaised)
                .clipShape(RoundedRectangle(cornerRadius: TrailheadSpace.radiusMd))
                .overlay(
                    RoundedRectangle(cornerRadius: TrailheadSpace.radiusMd)
                        .stroke(TrailheadColors.borderFaint, lineWidth: 1)
                )

            TrailheadButton(
                "Sign In",
                variant: .primary,
                isLoading: session.isBusy,
                isEnabled: isPasswordValid
            ) {
                signInWithPassword()
            }

            HStack(spacing: TrailheadSpace.lg) {
                Button("Forgot password?") {
                    errorText = nil
                    resetSent = false
                    step = .reset
                }
                .buttonStyle(.trailheadLink)
                .accessibilityIdentifier("account.reset")
                .font(TrailheadType.subheadline)
                .foregroundColor(TrailheadColors.accent)

                Button("Use email code instead") {
                    errorText = nil
                    step = .email
                }
                .buttonStyle(.trailheadLink)
                .font(TrailheadType.subheadline)
                .foregroundColor(TrailheadColors.inkMuted)
            }
            .padding(.top, TrailheadSpace.sm)
        }
    }

    @ViewBuilder
    private var resetStepContent: some View {
        VStack(spacing: TrailheadSpace.md) {
            if resetSent {
                VStack(spacing: TrailheadSpace.sm) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 36))
                        .foregroundColor(TrailheadColors.accentWarm)
                    Text("Check your inbox for a password reset link.")
                        .font(TrailheadType.body)
                        .foregroundColor(TrailheadColors.ink)
                        .multilineTextAlignment(.center)
                }
                .padding(TrailheadSpace.md)
            } else {
                TextField("Email address", text: $email)
                    .keyboardType(.emailAddress)
                    .autocapitalization(.none)
                    .disableAutocorrection(true)
                    .padding(TrailheadSpace.md)
                    .background(TrailheadColors.surfaceRaised)
                    .clipShape(RoundedRectangle(cornerRadius: TrailheadSpace.radiusMd))
                    .overlay(
                        RoundedRectangle(cornerRadius: TrailheadSpace.radiusMd)
                            .stroke(TrailheadColors.borderFaint, lineWidth: 1)
                    )

                TrailheadButton(
                    "Send Reset Link",
                    variant: .primary,
                    isLoading: session.isBusy,
                    isEnabled: isEmailValid
                ) {
                    requestReset()
                }
            }

            Button("Back to sign in") {
                errorText = nil
                step = .email
            }
            .buttonStyle(.trailheadLink)
            .font(TrailheadType.subheadline)
            .foregroundColor(TrailheadColors.accent)
            .padding(.top, TrailheadSpace.sm)
        }
    }

    // MARK: - Actions

    private func sendCode() {
        guard isEmailValid else { return }
        errorText = nil
        Task {
            do {
                try await session.sendCode(email: email.trimmingCharacters(in: .whitespacesAndNewlines))
                step = .code
            } catch {
                errorText = session.lastError ?? "Could not send verification code."
            }
        }
    }

    private func verifyCode() {
        guard isCodeValid else { return }
        errorText = nil
        Task {
            do {
                try await session.signIn(
                    email: email.trimmingCharacters(in: .whitespacesAndNewlines),
                    code: code.trimmingCharacters(in: .whitespacesAndNewlines)
                )
                AnalyticsEvents.signupCompleted(track: analytics)
                onSuccess()
            } catch {
                errorText = session.lastError ?? "Verification code did not match."
            }
        }
    }

    private func signInWithPassword() {
        guard isPasswordValid else { return }
        errorText = nil
        Task {
            do {
                try await session.signIn(
                    email: email.trimmingCharacters(in: .whitespacesAndNewlines),
                    password: password
                )
                onSuccess()
            } catch {
                errorText = session.lastError ?? "Incorrect email or password."
            }
        }
    }

    private func requestReset() {
        guard isEmailValid else { return }
        errorText = nil
        Task {
            do {
                try await session.requestPasswordReset(email: email.trimmingCharacters(in: .whitespacesAndNewlines))
                resetSent = true
            } catch {
                errorText = session.lastError ?? "Could not send reset link."
            }
        }
    }
}
