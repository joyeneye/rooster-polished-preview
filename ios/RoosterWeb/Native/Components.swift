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
                LinearGradient(colors: [Color(hex: 0xF2D3C4), Color(hex: 0xE9B7A4)], startPoint: .topLeading, endPoint: .bottomTrailing)
                Text(String(name.trimmingCharacters(in: .whitespaces).first ?? "R").uppercased())
                    .font(.rooster(size * 0.42))
                    .foregroundStyle(Color(hex: 0x7A2A33))
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(alignment: .bottomTrailing) {
            if online == true {
                Circle()
                    .fill(Color(hex: 0x2FB55D))
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
        Label(text, systemImage: symbol)
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 16)
            .padding(.vertical, 11)
            .background(Color(hex: 0x241A1C, opacity: 0.94), in: Capsule())
            .shadow(color: .black.opacity(0.2), radius: 12, y: 6)
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

/// Posting, requests and messages are refused by the preview for now (api/preview.js).
enum ComingSoon {
    static let text = "Coming soon to the ROOSTER app."
}
