import SwiftUI

/// The welcome screen from roster-startup.js, native: the ROOSTER card, how many of the 500
/// spots are claimed, Log in and Enter invite code. It holds for 2.7s, like the site, unless
/// the viewer is reaching for a button.
struct WelcomeView: View {
    let api: FeedAPI
    let choose: (String?) -> Void

    @State private var appeared = false
    @State private var claimed: Int?
    @State private var shown = 0
    @State private var countFailed = false

    var body: some View {
        ZStack {
            RadialGradient(
                colors: [Color(hex: 0xFFFAF3), Color(hex: 0xF6F1E8), Color(hex: 0xEADED1)],
                center: UnitPoint(x: 0.5, y: 0.3), startRadius: 0, endRadius: 720
            )
            .ignoresSafeArea()

            VStack(spacing: 10) {
                LogoCard()
                    .frame(width: 220, height: 296)
                    .shadow(color: Color(hex: 0xF53E2D, opacity: 0.25), radius: 26)
                    .scaleEffect(appeared ? 1 : 0.94)
                    .opacity(appeared ? 1 : 0)

                if !countFailed {
                    VStack(spacing: 6) {
                        Text(claimed == nil ? "—" : shown.formatted())
                            .font(.roosterMono(24))
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
                    .frame(width: 280)
                    .padding(.top, 8)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(claimed.map { "\($0) of 500 spots claimed" } ?? "ROOSTER is growing toward 500 members")
                }

                VStack(spacing: 4) {
                    Button { choose("/members.html#member-login") } label: {
                        Text("Log in")
                            .font(.system(size: 17, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 280, height: 52)
                            .background(Color(hex: 0xCF1235), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                            .shadow(color: Color(hex: 0xCF1235, opacity: 0.18), radius: 12, y: 6)
                    }
                    .buttonStyle(PressableStyle())
                    Button { choose("/members.html#invite-code") } label: {
                        Text("Enter invite code")
                            .font(.system(size: 17, weight: .bold))
                            .foregroundStyle(Color(hex: 0x6D2735))
                            .frame(width: 280, height: 50)
                    }
                    .buttonStyle(PressableStyle())
                }
                .padding(.top, 18)
            }
            .padding(20)
        }
        .environment(\.colorScheme, .light)
        .task {
            withAnimation(.spring(duration: 0.9, bounce: 0.2)) { appeared = true }
            do {
                let value = try await api.memberCount()
                claimed = value
                withAnimation(.timingCurve(0.2, 0.75, 0.2, 1, duration: 1.7)) { shown = value }
            } catch {
                withAnimation { countFailed = true }
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
