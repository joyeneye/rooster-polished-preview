import SwiftUI
import UIKit

// The world-class concept's parts (design/world-class-concept/board.png). Every screen builds
// from these, so the six screens read as one app: near-black ground, 20pt cards with a hairline,
// Orbitron headings in caps, red only for what is live or what you can press.

enum Design {
    static let gutter: CGFloat = 16
    static let cardRadius: CGFloat = 20
    static let tileRadius: CGFloat = 14
    /// The floating tab bar's height plus its bottom gap; scroll views pad by this so the last
    /// row can clear the bar.
    static let tabBarClearance: CGFloat = 96
}

extension View {
    /// A surface card: dark fill, 20pt continuous corners, hairline edge.
    func designCard(padding: CGFloat = 16, radius: CGFloat = Design.cardRadius, fill: Color = Theme.surface) -> some View {
        self.padding(padding)
            .background(fill, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).stroke(Theme.line, lineWidth: 1))
    }

    /// Frosted glass, for anything that floats over photos or the tab bar.
    func designGlass(radius: CGFloat = Design.cardRadius) -> some View {
        self.background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .background(Color.black.opacity(0.25), in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).stroke(Color.white.opacity(0.10), lineWidth: 1))
    }
}

/// "ROOSTER" in Orbitron, the concept's wordmark.
struct RoosterWordmark: View {
    var size: CGFloat = 22
    var color: Color = Theme.red

    var body: some View {
        Text("ROOSTER")
            .font(.roosterDisplay(size, relativeTo: .headline))
            .tracking(size * 0.06)
            .foregroundStyle(color)
            .accessibilityLabel("Rooster")
    }
}

/// A big Orbitron screen title ("WYD", "Manager").
struct ScreenTitle: View {
    let text: String
    var size: CGFloat = 34

    var body: some View {
        Text(text)
            .font(.roosterDisplay(size))
            .foregroundStyle(Theme.ink)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .accessibilityAddTraits(.isHeader)
    }
}

/// A section heading: Orbitron caps on the left, an optional "See all ›" on the right.
struct DesignSectionHeader: View {
    let title: String
    var dot = false
    var action: String? = nil
    var onAction: (() -> Void)? = nil

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            HStack(spacing: 7) {
                if dot { Circle().fill(Theme.red).frame(width: 7, height: 7).alignmentGuide(.firstTextBaseline) { $0[.bottom] - 1 } }
                Text(title.uppercased())
                    .font(.roosterDisplay(15, relativeTo: .headline))
                    .tracking(1)
                    .foregroundStyle(Theme.ink)
            }
            Spacer()
            if let action {
                Button { onAction?() } label: {
                    HStack(spacing: 3) {
                        Text(action)
                        Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold))
                    }
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Theme.muted)
                }
                .buttonStyle(.plain)
                .disabled(onAction == nil)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

/// Small grey caps label ("EARNED THIS MONTH", "SCORES").
struct Eyebrow: View {
    let text: String
    var color: Color = Theme.muted

    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 12, weight: .semibold))
            .tracking(1.2)
            .foregroundStyle(color)
    }
}

/// The red pill with a dot: "LIVE", "LIVE NOW".
struct LivePill: View {
    var text = "LIVE"
    var filled = true

    var body: some View {
        HStack(spacing: 5) {
            Circle().fill(filled ? .white : Theme.red).frame(width: 6, height: 6)
            Text(text).font(.system(size: 11, weight: .heavy)).tracking(0.6)
        }
        .foregroundStyle(filled ? .white : Theme.red)
        .padding(.horizontal, 9).padding(.vertical, 5)
        .background(filled ? Theme.red : Theme.red.opacity(0.16), in: Capsule())
        .accessibilityLabel(text.capitalized)
    }
}

/// A status chip with a coloured dot ("In the studio").
struct StatusPill: View {
    let text: String
    var dot: Color = Theme.red

    var body: some View {
        HStack(spacing: 7) {
            Circle().fill(dot).frame(width: 8, height: 8)
            Text(text).font(.system(size: 14, weight: .medium)).foregroundStyle(Theme.ink).lineLimit(1)
        }
        .padding(.horizontal, 12).padding(.vertical, 6)
        .background(Theme.raised, in: Capsule())
        .overlay(Capsule().stroke(Theme.line))
    }
}

/// A grey chip ("R&B", "Late-night").
struct TagChip: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(Theme.ink.opacity(0.85))
            .padding(.horizontal, 12).padding(.vertical, 6)
            .background(Theme.raised, in: Capsule())
            .overlay(Capsule().stroke(Theme.line))
    }
}

/// The primary button: solid red, 16pt corners, full width unless the caller frames it.
struct DesignPrimaryButtonStyle: ButtonStyle {
    var height: CGFloat = 50

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: height)
            .background(Theme.red.opacity(configuration.isPressed ? 0.8 : 1), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .shadow(color: Theme.red.opacity(0.35), radius: 14, y: 6)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
    }
}

/// The secondary button: dark glass with a hairline.
struct DesignGlassButtonStyle: ButtonStyle {
    var height: CGFloat = 50

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(Theme.ink)
            .frame(maxWidth: .infinity, minHeight: height)
            .background(Theme.raised.opacity(configuration.isPressed ? 0.7 : 1), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Color.white.opacity(0.12)))
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
    }
}

extension ButtonStyle where Self == DesignPrimaryButtonStyle {
    static var designPrimary: DesignPrimaryButtonStyle { DesignPrimaryButtonStyle() }
}

extension ButtonStyle where Self == DesignGlassButtonStyle {
    static var designGlass: DesignGlassButtonStyle { DesignGlassButtonStyle() }
}

/// A round red icon button (play, send).
struct RedCircleButton: View {
    let symbol: String
    var size: CGFloat = 44
    var label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: size * 0.4, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: size, height: size)
                .background(Theme.red, in: Circle())
                .shadow(color: Theme.red.opacity(0.45), radius: 12, y: 4)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

/// A circular photo with the concept's red ring and an optional LIVE tab under it.
struct RingAvatar: View {
    let name: String
    let photoPath: String?
    var size: CGFloat = 64
    var ring = true
    var live = false

    var body: some View {
        MemberAvatar(name: name, photoPath: photoPath, size: size)
            .padding(3)
            .overlay(Circle().stroke(ring ? Theme.red : Theme.line, lineWidth: 2.5))
            .shadow(color: ring ? Theme.red.opacity(0.35) : .clear, radius: 8)
            .overlay(alignment: .bottom) {
                if live {
                    Text("LIVE")
                        .font(.system(size: 9, weight: .heavy))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Theme.red, in: Capsule())
                        .offset(y: 6)
                }
            }
    }
}

/// A row of overlapping avatars ("3 stacked avatars and 212 listening").
struct AvatarStack: View {
    let people: [(name: String, photo: String?)]
    var size: CGFloat = 28

    var body: some View {
        HStack(spacing: -size * 0.32) {
            ForEach(Array(people.prefix(4).enumerated()), id: \.offset) { _, person in
                MemberAvatar(name: person.name, photoPath: person.photo, size: size)
                    .overlay(Circle().stroke(Theme.surface, lineWidth: 2))
            }
        }
        .accessibilityHidden(true)
    }
}

/// A decorative waveform: red up to `progress`, grey after. Bars are seeded from `seed` so a
/// track always draws the same shape.
struct WaveformBars: View {
    var seed: Int = 7
    var progress: Double = 0.45
    var bars: Int = 48
    var height: CGFloat = 36

    var body: some View {
        GeometryReader { proxy in
            let gap: CGFloat = 2
            let width = max(1.5, (proxy.size.width - gap * CGFloat(bars - 1)) / CGFloat(bars))
            HStack(alignment: .center, spacing: gap) {
                ForEach(0..<bars, id: \.self) { index in
                    Capsule()
                        .fill(Double(index) / Double(bars) < progress ? Theme.red : Theme.muted.opacity(0.45))
                        .frame(width: width, height: max(3, height * level(index)))
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .frame(height: height)
        .accessibilityHidden(true)
    }

    private func level(_ index: Int) -> CGFloat {
        var x = UInt64(truncatingIfNeeded: seed &* 2_654_435_761 &+ index &* 40_503)
        x ^= x >> 13; x = x &* 0x5bd1e995; x ^= x >> 15
        let noise = CGFloat(x % 1000) / 1000
        let envelope = 0.45 + 0.55 * sin(CGFloat(index) / CGFloat(bars) * .pi)
        return 0.18 + 0.82 * noise * envelope
    }
}

// MARK: - Tab bar

/// The concept's floating glass tab bar: Home · Discover · (+) · Rooms · Profile.
struct GlassTabBar: View {
    @EnvironmentObject private var store: ShellStore
    let create: () -> Void

    private struct Item: Identifiable {
        let tab: ShellTab
        let title: String
        let symbol: String
        var id: ShellTab { tab }
    }

    private static let leading = [Item(tab: .wyd, title: "Home", symbol: "house"),
                                  Item(tab: .people, title: "Discover", symbol: "safari")]
    private static let trailing = [Item(tab: .rooms, title: "Rooms", symbol: "person.3"),
                                   Item(tab: .me, title: "Profile", symbol: "person")]

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Self.leading) { tabButton($0) }
            Button(action: create) {
                Image(systemName: "plus")
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 58, height: 58)
                    .background(Theme.red, in: Circle())
                    .shadow(color: Theme.red.opacity(0.55), radius: 16, y: 4)
            }
            .buttonStyle(.plain)
            .frame(maxWidth: .infinity)
            .offset(y: -8)
            .accessibilityLabel("Create")
            ForEach(Self.trailing) { tabButton($0) }
        }
        .padding(.horizontal, 6)
        .frame(height: 70)
        .designGlass(radius: 26)
        .shadow(color: .black.opacity(0.5), radius: 20, y: 8)
        .padding(.horizontal, 14)
        .padding(.bottom, 2)
    }

    private func tabButton(_ item: Item) -> some View {
        let selected = store.selection == item.tab
        return Button { select(item.tab) } label: {
            VStack(spacing: 4) {
                Image(systemName: selected ? "\(item.symbol).fill" : item.symbol)
                    .font(.system(size: 21, weight: selected ? .semibold : .regular))
                    .frame(height: 26)
                Text(item.title).font(.system(size: 11, weight: selected ? .semibold : .medium))
            }
            .foregroundStyle(selected ? Theme.red : Theme.muted)
            .frame(maxWidth: .infinity, minHeight: 56)
            .overlay(alignment: .bottom) {
                if selected {
                    Capsule().fill(Theme.red).frame(width: 22, height: 3).offset(y: 6)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(item.title)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func select(_ tab: ShellTab) {
        if store.selection == tab {
            store.popToRoot(tab)
        } else {
            UISelectionFeedbackGenerator().selectionChanged()
            store.selection = tab
        }
    }
}

/// What the + opens: the four ways to put something on ROOSTER.
struct CreateMenu: View {
    let choose: (CreateMenu.Choice) -> Void
    @Environment(\.dismiss) private var dismiss

    enum Choice: CaseIterable, Identifiable {
        case post, photo, song, live
        var id: Self { self }
        var title: String {
            switch self {
            case .post: "Post"
            case .photo: "Take a Pic"
            case .song: "Share a Song"
            case .live: "Go Live"
            }
        }
        var detail: String {
            switch self {
            case .post: "Say what you're working on"
            case .photo: "Straight to your album and the feed"
            case .song: "Drop a link in one of your slots"
            case .live: "Open a room, voice or video"
            }
        }
        var symbol: String {
            switch self {
            case .post: "square.and.pencil"
            case .photo: "camera"
            case .song: "music.note"
            case .live: "dot.radiowaves.left.and.right"
            }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("CREATE").font(.roosterDisplay(18)).tracking(1).foregroundStyle(Theme.ink)
                .padding(.top, 22)
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                ForEach(Choice.allCases) { choice in
                    Button {
                        dismiss()
                        choose(choice)
                    } label: {
                        VStack(alignment: .leading, spacing: 10) {
                            Image(systemName: choice.symbol)
                                .font(.system(size: 20, weight: .semibold))
                                .foregroundStyle(choice == .live ? .white : Theme.red)
                                .frame(width: 42, height: 42)
                                .background(choice == .live ? Theme.red : Theme.red.opacity(0.14), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            Text(choice.title).font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.ink)
                            Text(choice.detail).font(.system(size: 12)).foregroundStyle(Theme.muted)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .designCard(padding: 14, radius: 18)
                    }
                    .buttonStyle(.plain)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, Design.gutter)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Theme.background)
        .presentationDetents([.height(380)])
        .presentationDragIndicator(.visible)
        .presentationBackground(Theme.background)
    }
}
