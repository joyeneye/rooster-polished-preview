import SwiftUI

/// The way into ROOSTER. Nothing else in the app shows until a member signs in with an approved
/// account: the site's welcome screen (the ROOSTER card and how many of the 500 spots are claimed)
/// with sign-in built in. Joining (invite codes and requests) happens on jwhitedidit.net.
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
                    LogoCard()
                        .scaleEffect(0.62)
                        .frame(width: 220 * 0.62, height: 296 * 0.62)
                        .shadow(color: Color(hex: 0xF53E2D, opacity: 0.25), radius: 22)
                        .scaleEffect(appeared ? 1 : 0.94)
                        .opacity(appeared ? 1 : 0)
                        .padding(.top, 36)

                    SpotsMeter(api: api)
                        .padding(.top, 18)

                    if case .pending(let message) = session.state {
                        pending(message)
                    } else {
                        form
                    }
                }
                .frame(maxWidth: 360)
                .padding(.horizontal, 24)
                .padding(.bottom, 32)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
            .scrollBounceBehavior(.basedOnSize)
        }
        .environment(\.colorScheme, .light)
        .sheet(item: $browser) { destination in
            SafariView(url: destination.url).ignoresSafeArea()
        }
        .onAppear { withAnimation(.spring(duration: 0.9, bounce: 0.2)) { appeared = true } }
    }

    private var form: some View {
        VStack(spacing: 12) {
            VStack(spacing: 10) {
                TextField("Email", text: $email)
                    .textContentType(.username)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.next)
                    .focused($focus, equals: .email)
                    .onSubmit { focus = .password }
                    .modifier(FieldStyle())

                HStack(spacing: 0) {
                    Group {
                        if showsPassword {
                            TextField("Password", text: $password)
                        } else {
                            SecureField("Password", text: $password)
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
                            .foregroundStyle(Color(hex: 0x8A7F78))
                            .frame(width: 44, height: 44)
                    }
                    .accessibilityLabel(showsPassword ? "Hide password" : "Show password")
                }
                .modifier(FieldStyle(trailingPadding: 4))
            }
            .padding(.top, 26)

            if let error {
                Label(error, systemImage: "exclamationmark.circle.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color(hex: 0xB0102E))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .transition(.opacity)
            }
            if resetSent {
                Label("Check your email for a link to reset your password.", systemImage: "envelope.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color(hex: 0x2F6B3A))
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            Button(action: submit) {
                ZStack {
                    Text("Log in").opacity(working ? 0 : 1)
                    if working { ProgressView().tint(.white) }
                }
                .font(.system(size: 17, weight: .bold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, minHeight: 52)
                .background(Color(hex: 0xCF1235).opacity(canSubmit || working ? 1 : 0.45),
                            in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .shadow(color: Color(hex: 0xCF1235, opacity: canSubmit ? 0.2 : 0), radius: 12, y: 6)
            }
            .buttonStyle(PressableStyle())
            .disabled(!canSubmit)
            .padding(.top, 4)

            Button("Forgot password?", action: resetPassword)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color(hex: 0x6D2735))
                .frame(minHeight: 44)

            HStack(spacing: 12) {
                Rectangle().fill(Color(hex: 0xDED2C5)).frame(height: 1)
                Text("NEW TO ROOSTER").font(.roosterMono(10)).tracking(1.4).foregroundStyle(Color(hex: 0x8A7F78)).fixedSize()
                Rectangle().fill(Color(hex: 0xDED2C5)).frame(height: 1)
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
                .font(.system(size: 30, weight: .semibold))
                .foregroundStyle(Color(hex: 0xCF1235))
                .padding(.top, 30)
            Text("You're almost in")
                .font(.rooster(26))
                .foregroundStyle(Color(hex: 0x171719))
            Text(message)
                .font(.system(size: 15))
                .foregroundStyle(Color(hex: 0x5A514C))
                .multilineTextAlignment(.center)
            Button {
                Task { await session.signOut() }
            } label: {
                Text("Use a different account")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(Color(hex: 0x6D2735))
                    .frame(maxWidth: .infinity, minHeight: 50)
                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Color(hex: 0xD9C9BC)))
            }
            .padding(.top, 8)
        }
    }

    private func joinButton(_ title: String, fragment: String) -> some View {
        Button {
            if let url = URL(string: "https://jwhitedidit.net/members.html#\(fragment)") {
                browser = BrowserDestination(url: url)
            }
        } label: {
            Text(title)
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(Color(hex: 0x6D2735))
                .frame(maxWidth: .infinity, minHeight: 48)
                .background(.white.opacity(0.55), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Color(hex: 0xE2D5C9)))
        }
        .buttonStyle(PressableStyle())
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
            LogoCard()
                .scaleEffect(0.62)
                .frame(width: 220 * 0.62, height: 296 * 0.62)
                .shadow(color: Color(hex: 0xF53E2D, opacity: 0.25), radius: 22)
        }
        .accessibilityLabel("Opening ROOSTER")
    }
}

private struct WelcomeBackground: View {
    var body: some View {
        RadialGradient(
            colors: [Color(hex: 0xFFFAF3), Color(hex: 0xF6F1E8), Color(hex: 0xEADED1)],
            center: UnitPoint(x: 0.5, y: 0.3), startRadius: 0, endRadius: 720
        )
        .ignoresSafeArea()
    }
}

private struct FieldStyle: ViewModifier {
    var trailingPadding: CGFloat = 16

    func body(content: Content) -> some View {
        content
            .font(.system(size: 17))
            .foregroundStyle(Color(hex: 0x171719))
            .tint(Color(hex: 0xCF1235))
            .padding(.leading, 16)
            .padding(.trailing, trailingPadding)
            .frame(minHeight: 52)
            .background(.white, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Color(hex: 0xE2D5C9)))
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
            VStack(spacing: 6) {
                Text(claimed == nil ? "—" : shown.formatted())
                    .font(.roosterMono(22))
                    .foregroundStyle(Color(hex: 0xCF1235))
                    .contentTransition(.numericText(value: Double(shown)))
                Text("OF 500 SPOTS CLAIMED")
                    .font(.roosterMono(11))
                    .tracking(1.5)
                    .foregroundStyle(Color(hex: 0x251D1D))
                GeometryReader { geometry in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color(hex: 0xDED2C5))
                        Capsule()
                            .fill(LinearGradient(colors: [Color(hex: 0xDC0D32), Color(hex: 0xFF7A2F)], startPoint: .leading, endPoint: .trailing))
                            .frame(width: geometry.size.width * CGFloat(shown) / 500)
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

/// assets/rooster-logo.svg: the mark, ROOSTER and the tagline on black.
private struct LogoCard: View {
    var body: some View {
        ZStack {
            Color(hex: 0x050505)
            // Positions from the SVG's 220×296 artboard: the mark group is translated (25, 31) and
            // scaled 2.66, the wordmark sits on y 226 and the tagline on y 249.
            RoosterMark(size: 128).position(x: 110, y: 31 + 33 * 2.66)
            Text("ROOSTER")
                .font(.system(size: 22, weight: .bold))
                .tracking(5)
                .foregroundStyle(.white)
                .position(x: 112, y: 218)
            Text("PEOPLE  MUSIC  OPPORTUNITY")
                .font(.system(size: 7, weight: .bold))
                .tracking(3)
                .foregroundStyle(Color(hex: 0xE9E9E9))
                .position(x: 111, y: 246.5)
        }
        .frame(width: 220, height: 296)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("ROOSTER — People, Music, Opportunity")
    }
}
