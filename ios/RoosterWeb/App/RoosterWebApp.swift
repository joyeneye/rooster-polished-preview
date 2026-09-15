import AVFoundation
import SwiftUI
import UIKit

@main
struct RoosterWebApp: App {
    @StateObject private var store = ShellStore()

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
            RootView()
                .environmentObject(store)
                .tint(Theme.red)
                .preferredColorScheme(store.theme == .dark ? .dark : .light)
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var store: ShellStore
    @State private var showsWelcome = true

    var body: some View {
        ZStack {
            TabView(selection: tabSelection) {
                FeedView(model: store.feed)
                    .tabItem { Label(ShellTab.wyd.title, systemImage: ShellTab.wyd.symbol) }
                    .tag(ShellTab.wyd)
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

            // The site's welcome screen, once per launch, over the feed as it loads behind it.
            if showsWelcome {
                WelcomeView(api: store.feed.api) { link in
                    dismissWelcome()
                    if let link {
                        store.selection = .wyd
                        store.open(link, from: .wyd)
                    }
                }
                .transition(.opacity)
                .zIndex(1)
            }
        }
        .task {
            store.feed.startIfNeeded()
            try? await Task.sleep(for: .seconds(2.7))
            dismissWelcome()
        }
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

    private func dismissWelcome() {
        guard showsWelcome else { return }
        withAnimation(.easeOut(duration: 0.3)) { showsWelcome = false }
    }
}
