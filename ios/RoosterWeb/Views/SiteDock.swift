import SwiftUI

/// What the site's create buttons open, wherever they are pressed from.
enum CreateKind: String, Identifiable {
    case post, photo, song
    var id: String { rawValue }
}

/// The unread count on the dock's Inbox. The site reads it on load, on focus and when the page
/// comes back into view (roster-utility.js:15, 27); the app does the same, plus once a minute.
@MainActor
final class UnreadCounter: ObservableObject {
    @Published private(set) var count = 0
    private let api: FeedAPI
    private var loop: Task<Void, Never>?

    init(api: FeedAPI) { self.api = api }

    func start() {
        guard loop == nil else { return }
        loop = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh()
                try? await Task.sleep(for: .seconds(60))
            }
        }
    }

    func refresh() async {
        #if DEBUG
        if NativeFixtures.enabled { count = 20; return }
        #endif
        struct Unread: Decodable { let unreadCount: Int? }
        if let read = try? await api.get("/api/member-messages/unread", as: Unread.self) {
            count = max(0, read.unreadCount ?? 0)
        }
    }
}

/// The site's dock, drawn the way jwhitedidit.net draws it at phone width: a white pill with
/// WYD · People · Rooms · Me (roster-home.css:1303), and the Inbox / MONA pill at the bottom right
/// (roster-utility.css:3-5). On the site the Inbox pill covers the Take Pic and More buttons;
/// here the tabs are narrower so nothing sits hidden underneath, and the red camera still
/// peeks out above the Inbox the way it does in the screenshot.
struct SiteDock: View {
    @EnvironmentObject private var store: ShellStore
    @ObservedObject var unread: UnreadCounter
    let inbox: () -> Void
    let mona: () -> Void
    let camera: () -> Void

    private static let tabs: [ShellTab] = [.wyd, .people, .rooms, .me]

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            HStack(spacing: 0) {
                ForEach(Self.tabs) { tab in
                    let selected = store.selection == tab
                    Button { select(tab) } label: {
                        Text(tab.title)
                            .font(.rooster(13, weight: selected ? .bold : .regular))
                            .foregroundStyle(selected ? Color(hex: 0xCE0633) : Theme.muted)
                            .frame(width: 56, height: 49)
                            .background(selected ? Color(hex: 0xF6F5F1) : .clear, in: Capsule())
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(selected ? .isSelected : [])
                }
                Spacer(minLength: 0)
            }
            .padding(6)
            .frame(maxWidth: .infinity, minHeight: 62)
            .background(Theme.surface, in: Capsule())
            .overlay(Capsule().stroke(Color(uiColor: Theme.uiLine)))
            .shadow(color: Color(hex: 0x171719, opacity: 0.12), radius: 14, y: 10)

            // Take Pic / Create, peeking out above the Inbox pill (slots.css:93-94).
            Button(action: camera) {
                Image(systemName: "camera")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 48, height: 48)
                    .background(Color(hex: 0xCE0633), in: Circle())
                    .overlay(Circle().stroke(Theme.surface, lineWidth: 3))
                    .shadow(color: Color(hex: 0xCE0633, opacity: 0.3), radius: 9, y: 7)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(store.selection == .wyd ? "Take a Pic" : "Create")
            .offset(x: -96, y: -40)

            HStack(spacing: 8) {
                Button(action: inbox) {
                    Text("Inbox")
                        .font(.rooster(14))
                        .foregroundStyle(Color(hex: 0x19181B))
                        .padding(.horizontal, 14).frame(minHeight: 44)
                        .background(Color(hex: 0xF2EEE8), in: RoundedRectangle(cornerRadius: 13, style: .continuous))
                        .overlay(alignment: .topTrailing) {
                            if unread.count > 0 {
                                Text(unread.count > 99 ? "99+" : "\(unread.count)")
                                    .font(.system(size: 10, weight: .heavy)).foregroundStyle(.white)
                                    .padding(.horizontal, 5).frame(minWidth: 20, minHeight: 20)
                                    .background(Color(hex: 0xE54B32), in: Capsule())
                                    .overlay(Capsule().stroke(Color(hex: 0xFFFDF9), lineWidth: 2))
                                    .offset(x: 4, y: -6)
                            }
                        }
                }
                .buttonStyle(.plain)
                .accessibilityLabel(unread.count > 0 ? "Inbox, \(unread.count) unread" : "Inbox")

                Button(action: mona) {
                    Text("MONA")
                        .font(.rooster(14)).foregroundStyle(.white)
                        .padding(.horizontal, 14).frame(minHeight: 44)
                        .background(Color(hex: 0xB51234), in: RoundedRectangle(cornerRadius: 13, style: .continuous))
                }
                .buttonStyle(.plain)
            }
            .padding(6)
            .background(Color(hex: 0xFFFDF9, opacity: 0.94), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Color(hex: 0xDED8D0)))
            .shadow(color: Color(hex: 0x291419, opacity: 0.15), radius: 17, y: 10)
            .padding(.trailing, -2)
            .padding(.bottom, 2)
        }
        .padding(.horizontal, 12)
        .padding(.bottom, 4)
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

/// The floating DARK / LIGHT switch (roster-theme.css:4-11, 89). Its label names the theme it
/// switches to, as on the site.
struct ThemeSwitch: View {
    @EnvironmentObject private var store: ShellStore

    var body: some View {
        let dark = store.theme == .dark
        Button {
            store.setTheme(dark ? .light : .dark)
        } label: {
            Text(dark ? "LIGHT" : "DARK")
                .font(.rooster(15, weight: .regular)).tracking(1.35)
                .foregroundStyle(dark ? .white : Color(hex: 0x171719))
                .padding(.horizontal, 11).frame(minWidth: 72, minHeight: 38)
                .background(dark ? Color(hex: 0x17171A) : .white, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .stroke(dark ? Color(hex: 0x4B4B52) : Color(hex: 0xC9C9CF)))
                .shadow(color: .black.opacity(dark ? 0.4 : 0.14), radius: 12, y: 8)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(dark ? "Switch to light" : "Switch to dark")
    }
}
