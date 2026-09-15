import SafariServices
import SwiftUI
import WebKit

/// A web view with its loading bar, failure state and in-app browser sheet.
struct WebScreen: View {
    @ObservedObject var page: WebPage

    var body: some View {
        ZStack(alignment: .top) {
            // Hidden until the page has laid out, then faded in, so a screen never shows a page
            // assembling itself.
            WebViewHost(webView: page.webView)
                .opacity(page.contentReady ? 1 : 0)

            if !page.contentReady && page.failure == nil {
                DelayedSpinner().frame(maxWidth: .infinity, maxHeight: .infinity)
            }

            if page.contentReady && page.isLoading && page.progress < 1 && page.failure == nil {
                LoadingBar(progress: page.progress)
                    .transition(.opacity)
            }

            if let failure = page.failure {
                LoadFailureView(failure: failure, retry: page.reload)
            }
        }
        .background(Theme.background)
        .animation(.easeOut(duration: 0.2), value: page.isLoading)
        .navigationTitle(page.displayTitle)
        .navigationBarTitleDisplayMode(.inline)
        // The site's Inbox and MONA sheets carry their own header and Close button.
        .toolbar(page.overlayOpen ? .hidden : .visible, for: .navigationBar, .tabBar)
        .sheet(item: $page.browser) { destination in
            SafariView(url: destination.url).ignoresSafeArea()
        }
        .onAppear(perform: page.startIfNeeded)
    }
}

/// A web tab: WYD, People, Rooms or Me.
struct WebTabView: View {
    @ObservedObject var page: WebPage
    @EnvironmentObject private var store: ShellStore

    var body: some View {
        NavigationStack(path: store.path(for: page.stackTab)) {
            WebScreen(page: page)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        if page.canGoBack {
                            Button(action: page.goBack) {
                                Image(systemName: "chevron.backward").font(.system(size: 17, weight: .semibold))
                            }
                            .accessibilityLabel("Back")
                        }
                    }
                    if page.tab == .wyd && page.isAtRoot {
                        ToolbarItem(placement: .principal) { Wordmark() }
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        if page.isAtRoot, let tab = page.tab {
                            // The site header's search, on every page (rooster-polish.js:41).
                            Button { store.push(.search, in: tab) } label: {
                                Image(systemName: "magnifyingglass").font(.system(size: 16, weight: .semibold))
                            }
                            .accessibilityLabel("Search ROOSTER")
                        } else if let url = page.shareURL {
                            ShareLink(item: url) {
                                Image(systemName: "square.and.arrow.up").font(.system(size: 16, weight: .semibold))
                            }
                            .accessibilityLabel("Share")
                        }
                    }
                }
                .navigationDestination(for: WebRoute.self) { route in
                    PushedWebScreen(page: route.page)
                }
        }
    }
}

/// A page pushed onto a stack, or a More destination. Back walks the page's own history first
/// (pages that pushState), then pops the screen.
struct PushedWebScreen: View {
    @ObservedObject var page: WebPage

    var body: some View {
        WebScreen(page: page)
            .navigationBarBackButtonHidden(page.canGoBack)
            .toolbar {
                if page.canGoBack {
                    ToolbarItem(placement: .topBarLeading) {
                        Button(action: page.goBack) {
                            Image(systemName: "chevron.backward").font(.system(size: 17, weight: .semibold))
                        }
                        .accessibilityLabel("Back")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    if let url = page.shareURL {
                        ShareLink(item: url) {
                            Image(systemName: "square.and.arrow.up").font(.system(size: 16, weight: .semibold))
                        }
                        .accessibilityLabel("Share")
                    }
                }
            }
    }
}

/// Appears only if a page takes a moment, so quick loads don't flicker a spinner.
private struct DelayedSpinner: View {
    @State private var visible = false

    var body: some View {
        ProgressView()
            .controlSize(.large)
            .tint(Theme.red)
            .opacity(visible ? 1 : 0)
            .animation(.easeIn(duration: 0.2), value: visible)
            .task {
                try? await Task.sleep(for: .milliseconds(350))
                visible = true
            }
            .accessibilityLabel("Loading")
    }
}

/// The ROOSTER wordmark from the site header: the mark, then R, red OO, STER.
struct Wordmark: View {
    var body: some View {
        HStack(spacing: 7) {
            Image("LaunchLogo").resizable().frame(width: 24, height: 24)
            (Text("R").foregroundStyle(Theme.ink) + Text("OO").foregroundStyle(Theme.red) + Text("STER").foregroundStyle(Theme.ink))
                .font(.system(size: 19, weight: .heavy))
                .tracking(-0.5)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("ROOSTER")
    }
}

/// Hosts a long-lived web view. SwiftUI may rebuild this representable, so the web view is
/// re-parented rather than recreated — recreating it would reload the page.
struct WebViewHost: UIViewRepresentable {
    let webView: WKWebView

    func makeUIView(context: Context) -> UIView {
        let host = UIView()
        host.backgroundColor = Theme.uiBackground
        attach(to: host)
        return host
    }

    func updateUIView(_ host: UIView, context: Context) {
        if webView.superview !== host { attach(to: host) }
    }

    private func attach(to host: UIView) {
        webView.removeFromSuperview()
        webView.translatesAutoresizingMaskIntoConstraints = false
        host.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: host.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: host.trailingAnchor),
            webView.topAnchor.constraint(equalTo: host.topAnchor),
            webView.bottomAnchor.constraint(equalTo: host.bottomAnchor),
        ])
    }
}

private struct LoadingBar: View {
    let progress: Double

    var body: some View {
        GeometryReader { geometry in
            Capsule()
                .fill(LinearGradient(colors: [Theme.red, Theme.orange], startPoint: .leading, endPoint: .trailing))
                .frame(width: geometry.size.width * max(0.08, progress), height: 2.5)
                .animation(.easeOut(duration: 0.25), value: progress)
        }
        .frame(height: 2.5)
        .accessibilityHidden(true)
    }
}

struct LoadFailureView: View {
    let failure: LoadFailure
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 20) {
            Image("LaunchLogo").resizable().frame(width: 72, height: 72).accessibilityHidden(true)
            VStack(spacing: 8) {
                Text(failure.title).font(.title3.weight(.bold)).foregroundStyle(Theme.ink)
                Text(failure.message).font(.subheadline).foregroundStyle(Theme.muted).multilineTextAlignment(.center)
            }
            Button(action: retry) {
                Text("Try again")
                    .font(.headline)
                    .foregroundStyle(.white)
                    .frame(minWidth: 168, minHeight: 50)
                    .background(Theme.red, in: Capsule())
            }
            .buttonStyle(.plain)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.background)
    }
}

struct SafariView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        let controller = SFSafariViewController(url: url)
        controller.preferredControlTintColor = Theme.uiRed
        controller.dismissButtonStyle = .done
        return controller
    }

    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}
