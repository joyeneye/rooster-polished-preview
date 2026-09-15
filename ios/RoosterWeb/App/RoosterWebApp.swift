import AVFoundation
import Combine
import SwiftUI
import UIKit

@main
struct RoosterWebApp: App {
    @StateObject private var store = ShellStore()

    init() {
        Theme.applyAppearance()
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
    @State private var showsSplash = true

    var body: some View {
        ZStack {
            TabView(selection: tabSelection) {
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

            // Matches the launch screen, then fades once WYD has painted, so opening the app
            // never shows an empty frame between the two.
            if showsSplash {
                SplashView().transition(.opacity).zIndex(1)
            }
        }
        .onReceive(homeReady) { _ in dismissSplash() }
        .task {
            try? await Task.sleep(for: .seconds(8))
            dismissSplash()
        }
    }

    private var homeReady: AnyPublisher<Void, Never> {
        guard let home = store.page(.wyd) else { return Just(()).eraseToAnyPublisher() }
        // Hand over to the site's welcome screen as soon as it is up (it reports itself as an overlay),
        // or to the page itself when the welcome screen doesn't play.
        return Publishers.Merge3(
            home.$overlayOpen.filter { $0 }.map { _ in () },
            home.$hasPainted.filter { $0 }.map { _ in () },
            home.$failure.compactMap { $0 }.map { _ in () }
        )
        .eraseToAnyPublisher()
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

    private func dismissSplash() {
        guard showsSplash else { return }
        withAnimation(.easeOut(duration: 0.35)) { showsSplash = false }
    }
}

private struct SplashView: View {
    var body: some View {
        ZStack {
            Color("LaunchBackground")
            Image("LaunchLogo")
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }
}
