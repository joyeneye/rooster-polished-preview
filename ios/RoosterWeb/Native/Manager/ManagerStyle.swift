import SwiftUI

// Manager's own parts, built from DesignKit tokens. Sizes that DesignKit does not have yet live
// here in one place (not at call sites) so they can move into DesignKit when another screen
// needs them.

enum ManagerLayout {
    static let segmentHeight: CGFloat = 38
    static let sectionGap: CGFloat = 20
    static let rowGap: CGFloat = 10
    static let heroChartHeight: CGFloat = 68
    static let statIcon: CGFloat = 36
    static let dateBlock = CGSize(width: 46, height: 50)
    static let showTile = CGSize(width: 68, height: 50)
    static let sheetTile: CGFloat = 52
    static let splitBarHeight: CGFloat = 7
    static let fab: CGFloat = 60
    /// How far the Add button sits into the tab bar's clearance, so it floats just above the bar.
    static let fabDrop: CGFloat = 12
    static let rowRadius: CGFloat = 18
    static let fieldHeight: CGFloat = 46
}

/// Overview / Songs / Shows / Money: a glass track with the chosen segment raised.
struct ManagerSegmented<Value: Hashable>: View {
    let options: [Value]
    let title: (Value) -> String
    @Binding var selection: Value
    @Namespace private var pill

    var body: some View {
        HStack(spacing: 0) {
            ForEach(options, id: \.self) { option in
                let selected = option == selection
                Button {
                    UISelectionFeedbackGenerator().selectionChanged()
                    withAnimation(.snappy(duration: 0.25)) { selection = option }
                } label: {
                    Text(title(option))
                        .font(.system(size: 14, weight: selected ? .semibold : .medium))
                        .foregroundStyle(selected ? Theme.ink : Theme.muted)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .frame(maxWidth: .infinity, minHeight: ManagerLayout.segmentHeight - 8)
                        .background {
                            if selected {
                                Capsule().fill(Theme.raised)
                                    .overlay(Capsule().stroke(Color.white.opacity(0.08)))
                                    .matchedGeometryEffect(id: "pill", in: pill)
                            }
                        }
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
        .padding(4)
        .frame(height: ManagerLayout.segmentHeight)
        .designGlass(radius: ManagerLayout.segmentHeight / 2)
    }
}

/// The picture slot on a show or split-sheet row. Records carry no artwork, so this is a
/// drawn tile (seeded per record so rows differ) rather than a stock photo.
struct ManagerArtTile: View {
    let seed: Int
    let symbol: String
    var size: CGSize
    var radius: CGFloat = 12

    var body: some View {
        let angle = Double((seed &* 73) % 360)
        ZStack {
            LinearGradient(colors: [Theme.red.opacity(0.62), Theme.raised, Theme.background],
                           startPoint: UnitPoint(x: 0.5 + 0.5 * cos(angle * .pi / 180), y: 0),
                           endPoint: .bottomTrailing)
            RadialGradient(colors: [Color.white.opacity(0.16), .clear], center: UnitPoint(x: 0.28 + Double(seed % 5) * 0.1, y: 0.18),
                           startRadius: 0, endRadius: max(size.width, size.height) * 0.7)
            Image(systemName: symbol)
                .font(.system(size: min(size.width, size.height) * 0.38, weight: .semibold))
                .foregroundStyle(Theme.ink.opacity(0.88))
                .shadow(color: .black.opacity(0.5), radius: 6, y: 2)
        }
        .frame(width: size.width, height: size.height)
        .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).stroke(Color.white.opacity(0.06)))
        .accessibilityHidden(true)
    }
}

/// OCT / 04: the month small, the day big and red.
struct ManagerDateBlock: View {
    let date: Date?

    var body: some View {
        VStack(spacing: 1) {
            if let date {
                Text(date.formatted(.dateTime.month(.abbreviated)).uppercased())
                    .font(.system(size: 11, weight: .semibold)).tracking(0.8)
                    .foregroundStyle(Theme.muted)
                Text(date.formatted(.dateTime.day(.twoDigits)))
                    .font(.rooster(24, weight: .bold, relativeTo: .title2))
                    .foregroundStyle(Theme.red)
            } else {
                Text("TBC").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.muted)
            }
        }
        .frame(width: ManagerLayout.dateBlock.width, height: ManagerLayout.dateBlock.height)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityHidden(true)
    }
}

/// Each contributor's share as a segment: the first red, the rest greys, any shortfall left empty.
struct ManagerSplitBar: View {
    let shares: [Double]
    var height: CGFloat = ManagerLayout.splitBarHeight

    static func color(_ index: Int) -> Color {
        index == 0 ? Theme.red : Theme.muted.opacity(index.isMultiple(of: 2) ? 0.3 : 0.5)
    }

    var body: some View {
        GeometryReader { proxy in
            let total = max(100, shares.reduce(0, +))
            let gap: CGFloat = 2
            let usable = proxy.size.width - gap * CGFloat(max(0, shares.count - 1))
            HStack(spacing: gap) {
                ForEach(Array(shares.enumerated()), id: \.offset) { index, share in
                    if share > 0 {
                        Capsule()
                            .fill(Self.color(index))
                            .frame(width: max(2, usable * CGFloat(share / total)))
                    }
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Capsule().fill(Theme.raised))
        }
        .frame(height: height)
        .accessibilityHidden(true)
    }
}

/// The round red "+ Add" that floats above the tab bar.
struct ManagerAddButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 0) {
                Image(systemName: "plus").font(.system(size: 22, weight: .semibold))
                Text("Add").font(.system(size: 11, weight: .semibold))
            }
            .foregroundStyle(.white)
            .frame(width: ManagerLayout.fab, height: ManagerLayout.fab)
            .background(Theme.red, in: Circle())
            .shadow(color: Theme.red.opacity(0.5), radius: 16, y: 6)
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel("Add a song, show, person, split sheet or money")
    }
}

/// A chevron in the row's trailing edge.
struct ManagerChevron: View {
    var body: some View {
        Image(systemName: "chevron.right")
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(Theme.muted)
            .accessibilityHidden(true)
    }
}

/// A card that says honestly that a list is empty and what fills it.
struct ManagerEmptyCard: View {
    let title: String
    let detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.ink)
            Text(detail).font(.system(size: 13)).foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .designCard(padding: 14, radius: ManagerLayout.rowRadius)
    }
}

/// Rows that share one card, split by hairlines.
struct ManagerGroupedCard<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(spacing: 0) { content }
            .designCard(padding: 0, radius: ManagerLayout.rowRadius)
    }
}

struct ManagerHairline: View {
    var inset: CGFloat = 14
    var body: some View {
        Rectangle().fill(Theme.line).frame(height: 1).padding(.leading, inset)
    }
}

extension View {
    /// The ROOSTER wordmark beside the back button, and no centred title: the screen draws its
    /// own big "Manager" underneath. The system back button stays, so swipe-back keeps working.
    func managerChrome(_ title: String) -> some View {
        modifier(ManagerChrome(title: title))
    }
}

private struct ManagerChrome: ViewModifier {
    let title: String

    func body(content: Content) -> some View {
        let base = content
            .background(Theme.background)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.background, for: .navigationBar)
            .solidTopEdge()
        if #available(iOS 26.0, *) {
            base.toolbar {
                ToolbarItem(placement: .topBarLeading) { RoosterWordmark(size: 18).fixedSize() }
                    .sharedBackgroundVisibility(.hidden)
                ToolbarItem(placement: .principal) { Color.clear.frame(width: 1, height: 1).accessibilityHidden(true) }
            }
        } else {
            base.toolbar {
                ToolbarItem(placement: .topBarLeading) { RoosterWordmark(size: 18).fixedSize() }
                ToolbarItem(placement: .principal) { Color.clear.frame(width: 1, height: 1).accessibilityHidden(true) }
            }
        }
    }
}
