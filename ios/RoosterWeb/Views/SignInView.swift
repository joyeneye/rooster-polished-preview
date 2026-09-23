import SwiftUI

/// The way into ROOSTER. Nothing else in the app shows until a member signs in with an approved
/// account: the ROOSTER mark, how many of the 500 spots are claimed, and sign-in. Joining (invite
/// codes and requests) happens on jwhitedidit.net.
struct SignInView: View {
    @EnvironmentObject private var session: SessionModel
    let api: FeedAPI

    private enum Field { case email, password }

    @State private var email = ""
    @State private var password = ""
    @State private var showsPassword = false
    @State private var working = false
    @State private var error: String?
    @State private var resetSent = false
    @State private var browser: BrowserDestination?
    @State private var appeared = false
    @FocusState private var focus: Field?

    private var canSubmit: Bool {
        email.contains("@") && !password.isEmpty && !working
    }

    var body: some View {
        ZStack {
            WelcomeBackground()
            ScrollView {
                VStack(spacing: 0) {
                    BrandLockup()
                        .scaleEffect(appeared ? 1 : 0.94)
                        .opacity(appeared ? 1 : 0)
                        .padding(.top, 44)

                    SpotsMeter(api: api)
                        .padding(.top, 26)

                    if case .pending(let message) = session.state {
                        pending(message)
                    } else {
                        form
                    }
                }
                .frame(maxWidth: 380)
                .padding(.horizontal, 24)
                .padding(.bottom, 32)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
            .scrollBounceBehavior(.basedOnSize)
        }
        // The concept is dark only, signed out as much as signed in.
        .environment(\.colorScheme, .dark)
        .preferredColorScheme(.dark)
        .sheet(item: $browser) { destination in
            SafariView(url: destination.url).ignoresSafeArea()
        }
        .onAppear { withAnimation(.spring(duration: 0.9, bounce: 0.2)) { appeared = true } }
    }

    private var form: some View {
        VStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 10) {
                Eyebrow(text: "Members sign in")
                    .padding(.leading, 4)
                TextField("", text: $email, prompt: Text("Email").foregroundStyle(Theme.muted))
                    .textContentType(.username)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.next)
                    .focused($focus, equals: .email)
                    .onSubmit { focus = .password }
                    .modifier(FieldStyle(focused: focus == .email))

                HStack(spacing: 0) {
                    Group {
                        if showsPassword {
                            TextField("", text: $password, prompt: Text("Password").foregroundStyle(Theme.muted))
                        } else {
                            SecureField("", text: $password, prompt: Text("Password").foregroundStyle(Theme.muted))
                        }
                    }
                    .textContentType(.password)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.go)
                    .focused($focus, equals: .password)
                    .onSubmit(submit)
                    Button { showsPassword.toggle() } label: {
                        Image(systemName: showsPassword ? "eye.slash" : "eye")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundStyle(Theme.muted)
                            .frame(width: 44, height: 44)
                    }
                    .accessibilityLabel(showsPassword ? "Hide password" : "Show password")
                }
                .modifier(FieldStyle(trailingPadding: 4, focused: focus == .password))
            }
            .padding(.top, 30)

            if let error {
                Label(error, systemImage: "exclamationmark.circle.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .transition(.opacity)
            }
            if resetSent {
                Label("Check your email for a link to reset your password.", systemImage: "envelope.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.green)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            Button(action: submit) {
                ZStack {
                    Text("Log in").opacity(working ? 0 : 1)
                    if working { ProgressView().tint(.white) }
                }
            }
            .buttonStyle(DesignPrimaryButtonStyle(height: 54))
            .opacity(canSubmit || working ? 1 : 0.45)
            .disabled(!canSubmit)
            .padding(.top, 6)

            Button("Forgot password?", action: resetPassword)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Theme.ink.opacity(0.8))
                .frame(minHeight: 44)

            HStack(spacing: 12) {
                Rectangle().fill(Theme.line).frame(height: 1)
                Eyebrow(text: "New to ROOSTER").fixedSize()
                Rectangle().fill(Theme.line).frame(height: 1)
            }
            .padding(.top, 10)

            HStack(spacing: 10) {
                joinButton("Enter invite code", fragment: "invite-code")
                joinButton("Request an invite", fragment: "request-invite")
            }
        }
        .animation(.snappy, value: error)
    }

    private func pending(_ message: String) -> some View {
        VStack(spacing: 14) {
            Image(systemName: "hourglass")
                .font(.system(size: 26, weight: .semibold))
                .foregroundStyle(Theme.red)
                .frame(width: 60, height: 60)
                .background(Theme.red.opacity(0.14), in: Circle())
            Text("YOU'RE ALMOST IN")
                .font(.roosterDisplay(20))
                .tracking(0.8)
                .foregroundStyle(Theme.ink)
            Text(message)
                .font(.system(size: 15))
                .foregroundStyle(Theme.muted)
                .multilineTextAlignment(.center)
            Button {
                Task { await session.signOut() }
            } label: {
                Text("Use a different account")
            }
            .buttonStyle(.designGlass)
            .padding(.top, 8)
        }
        .frame(maxWidth: .infinity)
        .designCard(padding: 22)
        .padding(.top, 30)
    }

    private func joinButton(_ title: String, fragment: String) -> some View {
        Button {
            if let url = URL(string: "https://jwhitedidit.net/members.html#\(fragment)") {
                browser = BrowserDestination(url: url)
            }
        } label: {
            Text(title)
                .font(.system(size: 15, weight: .semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.85)
        }
        .buttonStyle(DesignGlassButtonStyle(height: 48))
    }

    private func submit() {
        guard canSubmit else { return }
        focus = nil
        working = true
        error = nil
        resetSent = false
        Task {
            do {
                try await session.signIn(email: email.trimmingCharacters(in: .whitespaces), password: password)
                UINotificationFeedbackGenerator().notificationOccurred(.success)
            } catch let failure as IdentityError {
                UINotificationFeedbackGenerator().notificationOccurred(.error)
                error = failure.text
            } catch {
                self.error = "ROOSTER sign-in is unavailable right now. Try again in a moment."
            }
            working = false
        }
    }

    private func resetPassword() {
        let address = email.trimmingCharacters(in: .whitespaces)
        guard address.contains("@") else {
            error = "Enter your email above, then tap Forgot password."
            focus = .email
            return
        }
        error = nil
        Task {
            do {
                try await session.sendPasswordReset(to: address)
                resetSent = true
            } catch let failure as IdentityError {
                error = failure.text
            } catch {}
        }
    }
}

/// Shown for the moment it takes to restore a saved session at launch.
struct SessionCheckView: View {
    var body: some View {
        ZStack {
            WelcomeBackground()
            BrandLockup()
        }
        .preferredColorScheme(.dark)
        .accessibilityLabel("Opening ROOSTER")
    }
}

/// The near-black ground with one low red glow behind the mark.
private struct WelcomeBackground: View {
    var body: some View {
        ZStack {
            Theme.background
            RadialGradient(colors: [Theme.red.opacity(0.28), Theme.red.opacity(0.06), .clear],
                           center: UnitPoint(x: 0.5, y: 0.16), startRadius: 0, endRadius: 360)
        }
        .ignoresSafeArea()
    }
}

/// The R mark, the Orbitron wordmark and the tagline.
private struct BrandLockup: View {
    var body: some View {
        VStack(spacing: 18) {
            RoosterMark(size: 84)
                .shadow(color: Theme.red.opacity(0.55), radius: 26)
            VStack(spacing: 10) {
                RoosterWordmark(size: 38)
                Text("PEOPLE · MUSIC · OPPORTUNITY")
                    .font(.system(size: 11, weight: .semibold))
                    .tracking(2.6)
                    .foregroundStyle(Theme.muted)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("ROOSTER — People, Music, Opportunity")
    }
}

private struct FieldStyle: ViewModifier {
    var trailingPadding: CGFloat = 16
    var focused = false

    func body(content: Content) -> some View {
        content
            .font(.system(size: 17))
            .foregroundStyle(Theme.ink)
            .tint(Theme.red)
            .padding(.leading, 16)
            .padding(.trailing, trailingPadding)
            .frame(minHeight: 54)
            .background(Theme.raised, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(focused ? Theme.red.opacity(0.6) : Theme.line))
    }
}

/// "31 OF 500 SPOTS CLAIMED", counting up (roster-startup.js).
private struct SpotsMeter: View {
    let api: FeedAPI
    @State private var claimed: Int?
    @State private var shown = 0
    @State private var failed = false

    var body: some View {
        if !failed {
            VStack(spacing: 8) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(claimed == nil ? "—" : shown.formatted())
                        .font(.roosterDisplay(24))
                        .foregroundStyle(Theme.ink)
                        .contentTransition(.numericText(value: Double(shown)))
                    Text("OF 500 SPOTS CLAIMED")
                        .font(.system(size: 11, weight: .semibold))
                        .tracking(1.5)
                        .foregroundStyle(Theme.muted)
                }
                GeometryReader { geometry in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Theme.raised)
                        Capsule()
                            .fill(Theme.red)
                            .frame(width: geometry.size.width * CGFloat(shown) / 500)
                            .shadow(color: Theme.red.opacity(0.6), radius: 6)
                    }
                }
                .frame(height: 4)
            }
            .frame(width: 260)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(claimed.map { "\($0) of 500 spots claimed" } ?? "ROOSTER is growing toward 500 members")
            .task {
                guard claimed == nil else { return }
                do {
                    let value = try await api.memberCount()
                    claimed = value
                    withAnimation(.timingCurve(0.2, 0.75, 0.2, 1, duration: 1.7)) { shown = value }
                } catch {
                    withAnimation { failed = true }
                }
            }
        }
    }
}
