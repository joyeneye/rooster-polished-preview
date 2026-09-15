import AVFoundation
import SwiftUI
import UIKit

@main
struct RoosterWebApp: App {
    @StateObject private var session = SessionModel()

    init() {
        Theme.applyAppearance()
        // Feed posters run to 2 MB (the casting call is a 1122×1402 PNG). The default cache is too
        // small to keep them, so every scroll back would download them again.
        URLCache.shared = URLCache(memoryCapacity: 64 << 20, diskCapacity: 512 << 20)
        // ORBIT Radio and live rooms are audio: keep them playing with the screen locked or the
        // app in the background (UIBackgroundModes: audio). WebKit switches the session to
        // play-and-record itself when a room opens the microphone.
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
    }

    var body: some Scene {
        WindowGroup {
            GateView()
                .environmentObject(session)
                .tint(Theme.red)
        }
    }
}

/// Signed out, nothing of the app exists: no tabs, no bars, no web views. Signing in builds it.
struct GateView: View {
    @EnvironmentObject private var session: SessionModel
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            switch session.state {
            case .checking:
                SessionCheckView().transition(.opacity)
            case .signedOut, .pending:
                SignInView(api: FeedAPI(base: session.base)).transition(.opacity)
            case .signedIn:
                SignedInView()
                    // A fresh app per sign-in: no web view keeps the previous member's pages.
                    .id(session.generation)
                    .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.3), value: session.state)
        .task { await session.restore() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { session.appBecameActive() } else if phase == .background { session.appResignedActive() }
        }
    }
}

private struct SignedInView: View {
    @StateObject private var store = ShellStore()

    var body: some View {
        RootView()
            .environmentObject(store)
            .preferredColorScheme(store.theme == .dark ? .dark : .light)
    }
}

struct RootView: View {
    @EnvironmentObject private var store: ShellStore

    var body: some View {
        TabView(selection: tabSelection) {
            FeedView(model: store.feed)
                .tabItem { Label(ShellTab.wyd.title, systemImage: ShellTab.wyd.symbol) }
                .tag(ShellTab.wyd)
            PeopleView(model: store.people)
                .tabItem { Label(ShellTab.people.title, systemImage: ShellTab.people.symbol) }
                .tag(ShellTab.people)
            ForEach(ShellTab.webTabs) { tab in
                if let page = store.page(tab) {
                    WebTabView(page: page)
                        .tabItem { Label(tab.title, systemImage: tab.symbol) }
                        .tag(tab)
                }
            }
            MoreView()
                .tabItem { Label(ShellTab.more.title, systemImage: ShellTab.more.symbol) }
                .tag(ShellTab.more)
        }
        .task { store.feed.startIfNeeded() }
    }

    /// Re-selecting the current tab returns it to its first page, like the system apps.
    private var tabSelection: Binding<ShellTab> {
        Binding(
            get: { store.selection },
            set: { newValue in
                if newValue == store.selection {
                    store.popToRoot(newValue)
                } else {
                    UISelectionFeedbackGenerator().selectionChanged()
                }
                store.selection = newValue
            }
        )
    }
}
