import SwiftUI

/// A member's photo in a circle, with their initial while it loads or when there is none, and
/// the green online dot.
struct MemberAvatar: View {
    let name: String
    let photoPath: String?
    var size: CGFloat = 52
    var online: Bool? = nil
    @EnvironmentObject private var store: ShellStore

    var body: some View {
        RemoteImage(url: photoPath.flatMap { store.siteURL($0) }, size: size) {
            ZStack {
                LinearGradient(colors: [Theme.raised, Theme.surface], startPoint: .topLeading, endPoint: .bottomTrailing)
                RadialGradient(colors: [Theme.red.opacity(0.18), .clear], center: .topLeading, startRadius: 0, endRadius: size)
                Text(String(name.trimmingCharacters(in: .whitespaces).first ?? "R").uppercased())
                    .font(.rooster(size * 0.42))
                    .foregroundStyle(Theme.red)
            }
            .overlay(Circle().stroke(Theme.line, lineWidth: 1))
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(alignment: .bottomTrailing) {
            if online == true {
                Circle()
                    .fill(Theme.green)
                    .frame(width: size * 0.26, height: size * 0.26)
                    .overlay(Circle().stroke(Theme.surface, lineWidth: max(2, size * 0.05)))
                    .accessibilityLabel("Online")
            }
        }
        .accessibilityHidden(online != true)
    }
}

/// "YOUR NEXT CONNECTION" over a Chakra Petch title: the site's section heading.
struct SectionHeading: View {
    let eyebrow: String?
    let title: String
    var trailing: String? = nil

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 3) {
                if let eyebrow {
                    Text(eyebrow).font(.roosterMono(10)).tracking(1.4).foregroundStyle(Theme.red)
                }
                Text(title).font(.rooster(22)).foregroundStyle(Theme.ink)
            }
            Spacer()
            if let trailing {
                Text(trailing).font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.muted)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

struct LoadingRows: View {
    var count = 6

    var body: some View {
        VStack(spacing: 0) {
            ForEach(0..<count, id: \.self) { _ in
                HStack(spacing: 14) {
                    Circle().fill(Theme.muted.opacity(0.15)).frame(width: 52, height: 52)
                    VStack(alignment: .leading, spacing: 8) {
                        RoundedRectangle(cornerRadius: 4).fill(Theme.muted.opacity(0.18)).frame(width: 150, height: 13)
                        RoundedRectangle(cornerRadius: 4).fill(Theme.muted.opacity(0.12)).frame(width: 100, height: 11)
                    }
                    Spacer()
                }
                .padding(.vertical, 11)
            }
        }
        .accessibilityLabel("Loading")
    }
}

struct ErrorState: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "wifi.exclamationmark").font(.system(size: 30, weight: .semibold)).foregroundStyle(Theme.muted)
            Text(message).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.ink).multilineTextAlignment(.center)
            Button("Try again", action: retry)
                .font(.system(size: 15, weight: .bold))
                .buttonStyle(.borderedProminent)
                .tint(Theme.red)
        }
        .padding(32)
        .frame(maxWidth: .infinity)
    }
}

/// A brief message when something didn't go through (the preview refuses writes, for one).
struct NoticeBanner: View {
    let text: String
    var symbol = "exclamationmark.circle.fill"

    var body: some View {
        Label {
            Text(text).foregroundStyle(Theme.ink)
        } icon: {
            Image(systemName: symbol).foregroundStyle(Theme.red)
        }
            .font(.system(size: 14, weight: .semibold))
            .padding(.horizontal, 16)
            .padding(.vertical, 11)
            .background(Theme.raised, in: Capsule())
            .overlay(Capsule().stroke(Theme.line))
            .shadow(color: .black.opacity(0.5), radius: 16, y: 8)
            .padding(.horizontal, 20)
    }
}

extension View {
    /// Shows `text` as a banner at the top for a moment, then clears it.
    func notice(_ text: Binding<String?>, topPadding: CGFloat = 8) -> some View {
        overlay(alignment: .top) {
            if let value = text.wrappedValue {
                NoticeBanner(text: value)
                    .padding(.top, topPadding)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .task(id: value) {
                        try? await Task.sleep(for: .seconds(2.6))
                        withAnimation(.snappy) { text.wrappedValue = nil }
                    }
            }
        }
    }
}

extension View {
    /// A tab root without a navigation bar: scrolled content slides under the status bar, so the
    /// strip behind the clock stays near-black.
    func statusBarScrim() -> some View {
        overlay(alignment: .top) {
            Color.clear
                .frame(height: 0)
                .background(Theme.background.opacity(0.94).ignoresSafeArea(edges: .top))
                .allowsHitTesting(false)
        }
    }

    /// Debug builds launched with `-RoosterScrollBottom` open this scroll view at its end, so the
    /// bottom of a screen can be captured headless. Release builds are untouched.
    @ViewBuilder func debugScrollToBottom() -> some View {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-RoosterScrollBottom") {
            defaultScrollAnchor(.bottom)
        } else {
            self
        }
        #else
        self
        #endif
    }
}

/// Posting, requests and messages are refused by the preview for now (api/preview.js).
enum ComingSoon {
    static let text = "Coming soon to the ROOSTER app."
}

extension View {
    /// iOS 26 blurs and darkens scroll content passing under the navigation bar, which smears
    /// clips and photos under the bar. Native screens keep a plain edge instead.
    @ViewBuilder func solidTopEdge() -> some View {
        if #available(iOS 26.0, *) {
            scrollEdgeEffectHidden(true, for: .top)
        } else {
            self
        }
    }
}
