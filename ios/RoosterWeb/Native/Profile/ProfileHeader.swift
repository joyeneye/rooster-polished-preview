import SwiftUI

// The top of a profile as the world-class concept draws it (design/world-class-concept/profile.png):
// a cinematic cover fading into the ground, the round photo with its presence dot, the name in
// Orbitron caps, a status pill, three counts split by hairlines and two actions.

/// Profile-only measurements, kept together so the screen is tuned in one place.
enum ProfileMetrics {
    /// The cover's height under the status bar.
    static let coverHeight: CGFloat = 250
    static let avatar: CGFloat = 104
    static let topBar: CGFloat = 44
    static let nameSize: CGFloat = 30
    /// Top 8 tiles are a touch wider than tall (145 × 135 in the mockup).
    static let tileAspect: CGFloat = 1.07
    static let songArt: CGFloat = 56
}

/// A photo or, while it loads or when there is none, the member's initial on a dark tile.
struct ProfilePhoto: View {
    let name: String
    let path: String?
    var size: CGFloat = 300
    @EnvironmentObject private var store: ShellStore

    var body: some View {
        Color.clear
            .overlay {
                RemoteImage(url: path.flatMap { store.siteURL($0) }, size: size) { ProfileMonogram(name: name) }
            }
            .clipped()
    }
}

/// The initial on the raised surface, for anyone without a photo.
struct ProfileMonogram: View {
    let name: String

    var body: some View {
        ZStack {
            LinearGradient(colors: [Theme.raised, Theme.surface], startPoint: .topLeading, endPoint: .bottomTrailing)
            GeometryReader { proxy in
                Text(String(name.trimmingCharacters(in: .whitespaces).first ?? "R").uppercased())
                    .font(.roosterDisplay(min(proxy.size.width, proxy.size.height) * 0.4))
                    .foregroundStyle(Theme.muted)
                    .frame(width: proxy.size.width, height: proxy.size.height)
            }
        }
        .accessibilityHidden(true)
    }
}

/// The cover: a photo of the member under a fade to the ground. With no photo it is a red
/// atmosphere, so a new member's page still reads as a cover rather than a gap.
struct ProfileCover: View {
    let path: String?
    let height: CGFloat
    @EnvironmentObject private var store: ShellStore

    var body: some View {
        ZStack {
            Theme.background
            RadialGradient(colors: [Theme.red.opacity(0.38), Theme.red.opacity(0.08), .clear],
                           center: UnitPoint(x: 0.78, y: 0.25), startRadius: 0, endRadius: 320)
            if let url = path.flatMap({ store.siteURL($0) }) {
                Color.clear
                    .overlay { RemoteImage(url: url, size: 900) { Color.clear } }
                    .clipped()
                    .opacity(0.82)
            }
            LinearGradient(stops: [.init(color: .black.opacity(0.55), location: 0),
                                   .init(color: .black.opacity(0), location: 0.28),
                                   .init(color: Theme.background.opacity(0.55), location: 0.62),
                                   .init(color: Theme.background, location: 1)],
                           startPoint: .top, endPoint: .bottom)
        }
        .frame(height: height)
        .frame(maxWidth: .infinity)
        .clipped()
        .accessibilityHidden(true)
    }
}

/// Photo, name, the membership line, status and role · city.
struct ProfileIdentity: View {
    let profile: MemberProfile
    let presence: Presence

    private var status: String {
        profile.status?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty ?? presence.pillLabel
    }

    private var roleLine: String? {
        let parts = [profile.roleLabel, profile.locationLine].compactMap { $0?.nilIfEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: "  ·  ")
    }

    var body: some View {
        HStack(alignment: .center, spacing: 16) {
            ProfilePhoto(name: profile.name, path: profile.photoUrl, size: ProfileMetrics.avatar)
                .frame(width: ProfileMetrics.avatar, height: ProfileMetrics.avatar)
                .clipShape(Circle())
                .overlay(Circle().stroke(Color.white.opacity(0.28), lineWidth: 1.5))
                .shadow(color: .black.opacity(0.5), radius: 14, y: 6)
                .overlay(alignment: .bottomTrailing) {
                    if presence == .online {
                        Circle().fill(Theme.red)
                            .frame(width: 18, height: 18)
                            .overlay(Circle().stroke(Theme.background, lineWidth: 3))
                            .offset(x: -4, y: -4)
                    }
                }
                .accessibilityLabel("\(profile.name)'s photo")

            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .center, spacing: 8) {
                    Text(profile.name.uppercased())
                        .font(.roosterDisplay(ProfileMetrics.nameSize))
                        .foregroundStyle(Theme.ink)
                        .lineLimit(2)
                        .minimumScaleFactor(0.55)
                        .accessibilityAddTraits(.isHeader)
                    if profile.verified == true || profile.verifiedOwner == true {
                        Image(systemName: "checkmark.seal.fill")
                            .font(.system(size: 18))
                            .foregroundStyle(.white, profile.verifiedOwner == true ? Theme.gold : Theme.red)
                            .accessibilityLabel(profile.verifiedOwner == true ? "Official" : "Verified")
                    }
                }
                if !profile.badges.isEmpty {
                    Text(profile.badges.joined(separator: " · "))
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
                StatusPill(text: status, dot: presence == .online ? Theme.red : Theme.muted)
                    .accessibilityLabel("\(presence.accessibilityLabel). \(status)")
                if let roleLine {
                    Text(roleLine)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(Theme.ink.opacity(0.75))
                        .lineLimit(2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// Three counts split by hairlines.
struct ProfileStats: View {
    struct Item: Identifiable {
        let value: String
        let label: String
        var id: String { label }
    }
    let items: [Item]

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                if index > 0 { Theme.line.frame(width: 1, height: 34) }
                VStack(spacing: 3) {
                    Text(item.value)
                        .font(.roosterDisplay(20, relativeTo: .title3))
                        .foregroundStyle(Theme.ink)
                        .contentTransition(.numericText())
                    Text(item.label)
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
                .frame(maxWidth: .infinity)
                .accessibilityElement(children: .combine)
            }
        }
    }
}

/// The glass circle the concept puts over the cover (•••, back).
struct ProfileGlassCircle: View {
    let symbol: String
    var size: CGFloat = 38

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: 15, weight: .bold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(.ultraThinMaterial, in: Circle())
            .background(Color.black.opacity(0.3), in: Circle())
            .overlay(Circle().stroke(Color.white.opacity(0.12)))
            .contentShape(Circle())
    }
}

extension Presence {
    /// What the status pill says when the member has written no status.
    var pillLabel: String {
        switch self {
        case .checking: "Checking status…"
        case .online: "Online now"
        case .offline: "Offline"
        case .unavailable: "Status unavailable"
        }
    }

    var accessibilityLabel: String {
        switch self {
        case .online: "Online now"
        case .offline: "Offline"
        case .checking, .unavailable: "Status unknown"
        }
    }
}

extension MemberProfile {
    var firstName: String {
        name.split(separator: " ").first.map(String.init) ?? name
    }
}
