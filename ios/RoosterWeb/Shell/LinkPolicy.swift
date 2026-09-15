import Foundation

enum LinkDecision: Equatable {
    /// Load it in the current web view.
    case allow
    /// A tap on another tab's root page: switch to that tab rather than stacking a second
    /// copy of it inside this one.
    case switchTab(ShellTab)
    /// Show it in the in-app browser sheet.
    case openInApp(URL)
    /// Hand it to iOS: phone, mail, maps, the App Store.
    case openExternally(URL)
    case cancel
}

/// Decides where every navigation goes. Free of WebKit so it can be unit tested.
struct LinkPolicy {
    let home: URL
    let siteHosts: Set<String>

    init(home: URL, siteHosts: Set<String> = ShellConfig.siteHosts) {
        self.home = home
        self.siteHosts = Set(siteHosts.map { $0.lowercased() })
    }

    private static let webSchemes: Set<String> = ["http", "https"]
    private static let passthroughSchemes: Set<String> = ["about", "blob", "data"]
    private static let systemSchemes: Set<String> = ["tel", "mailto", "sms", "facetime", "facetime-audio", "maps", "itms-apps"]

    /// - Parameters:
    ///   - currentTab: the tab whose web view is navigating, when that navigation is a
    ///     user's tap on a link. Pass nil for redirects and scripted navigations: the Me
    ///     tab's own `location.replace` must never be mistaken for a tab switch.
    func decide(url: URL?, isMainFrame: Bool, tappedIn currentTab: ShellTab? = nil) -> LinkDecision {
        guard let url, let scheme = url.scheme?.lowercased() else { return .cancel }

        if Self.passthroughSchemes.contains(scheme) { return .allow }

        // YouTube, Spotify, Apple Music, Live365 and Stripe run in iframes. Leave their own
        // navigation alone; intercepting it breaks playback and 3-D Secure.
        if !isMainFrame { return Self.webSchemes.contains(scheme) ? .allow : .cancel }

        if Self.webSchemes.contains(scheme) {
            guard isSameSite(url) else { return .openInApp(url) }
            if let currentTab, let owner = tabRoot(for: url), owner != currentTab {
                return .switchTab(owner)
            }
            return .allow
        }
        if Self.systemSchemes.contains(scheme) { return .openExternally(url) }

        // javascript:, file:, and app schemes a page could use to launch other apps.
        return .cancel
    }

    func isSameSite(_ url: URL) -> Bool {
        guard let host = url.host else { return false }
        return isSameSite(host: host, port: url.port, scheme: url.scheme)
    }

    /// `WKSecurityOrigin` reports the default port as 0, so 0 and nil both mean the scheme's default.
    func isSameSite(host: String, port: Int?, scheme: String?) -> Bool {
        let host = host.lowercased()
        if let homeHost = home.host?.lowercased(), host == homeHost {
            return Self.effectivePort(port, scheme: scheme ?? home.scheme)
                == Self.effectivePort(home.port, scheme: home.scheme)
        }
        return siteHosts.contains(host)
            && scheme?.lowercased() == "https"
            && Self.effectivePort(port, scheme: "https") == 443
    }

    /// Only an exact tab root switches tabs. `/#home`, `/#mona` and `/#board` are not the WYD
    /// root — community-home.js turns them into the owner profile, MONA and the Board — and
    /// a root with a query (`/people.html?q=`) is a search, so it stays where it was tapped.
    func tabRoot(for url: URL) -> ShellTab? {
        guard isSameSite(url), url.query == nil || url.query == "" else { return nil }
        if let fragment = url.fragment, !fragment.isEmpty { return nil }
        switch TitleFormatter.normalize(url.path) {
        case "/", "/index": return .wyd
        case "/people": return .people
        case "/live": return .rooms
        case "/my-profile": return .me
        default: return nil
        }
    }

    /// A fragment change or a reload of the page already showing. These stay in place; only a
    /// move to another document gets its own screen.
    static func isSameDocument(_ url: URL, as current: URL?) -> Bool {
        guard let current else { return false }
        func withoutFragment(_ url: URL) -> String? {
            var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
            components?.fragment = nil
            return components?.string
        }
        return withoutFragment(url) == withoutFragment(current)
    }

    static func effectivePort(_ port: Int?, scheme: String?) -> Int {
        if let port, port > 0 { return port }
        return scheme?.lowercased() == "http" ? 80 : 443
    }
}

enum TitleFormatter {
    /// A tab's first page shows the tab's name ("People", "Rooms"). Root is judged by an
    /// empty back list, not by URL: the Me tab immediately `location.replace`s itself to
    /// `/members.html?open=profile`, which is still its first page.
    static func display(documentTitle: String?, isAtRoot: Bool, rootTitle: String) -> String {
        if isAtRoot { return rootTitle }
        let cleaned = clean(documentTitle)
        return cleaned.isEmpty ? rootTitle : cleaned
    }

    /// Strips the site's branding: "ROOSTER — Home", "ROOSTER Booking — …" (em dash), and
    /// the " | ROOSTER" / " | Reviews" suffixes some pages set after load.
    static func clean(_ raw: String?) -> String {
        guard var title = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty else { return "" }
        for prefix in ["ROOSTER Booking — ", "ROOSTER — "] where title.hasPrefix(prefix) {
            title = String(title.dropFirst(prefix.count))
            break
        }
        for suffix in [" | ROOSTER", " | Reviews"] where title.hasSuffix(suffix) {
            title = String(title.dropLast(suffix.count))
            break
        }
        title = title.trimmingCharacters(in: .whitespaces)
        return title == "ROOSTER" ? "" : title
    }

    /// Pages whose document.title is filled from data, which makes a poor bar title:
    /// apply-client.js sets the opportunity's full headline ("New female music group — More Hits On
    /// The Way"), which the page's own h1 already shows in full.
    static let routeTitles: [String: String] = ["/apply": "Apply"]

    static func normalize(_ path: String) -> String {
        var path = path
        if path.hasSuffix(".html") { path = String(path.dropLast(5)) }
        while path.count > 1 && path.hasSuffix("/") { path.removeLast() }
        return path.isEmpty ? "/" : path
    }
}

struct LoadFailure: Equatable {
    let title: String
    let message: String

    init(_ error: Error) {
        let error = error as NSError
        let offline: Set<Int> = [
            NSURLErrorNotConnectedToInternet, NSURLErrorNetworkConnectionLost,
            NSURLErrorDataNotAllowed, NSURLErrorInternationalRoamingOff,
        ]
        if error.domain == NSURLErrorDomain && offline.contains(error.code) {
            title = "You're offline"
            message = "Check your connection, then try again."
        } else if error.domain == NSURLErrorDomain && error.code == NSURLErrorTimedOut {
            title = "ROOSTER is taking too long"
            message = "The connection timed out. Try again in a moment."
        } else {
            title = "Couldn't open ROOSTER"
            message = "Something went wrong loading this page. Try again in a moment."
        }
    }

    static func isIgnorable(_ error: Error) -> Bool {
        let error = error as NSError
        // A newer navigation replaced this one.
        if error.domain == NSURLErrorDomain && error.code == NSURLErrorCancelled { return true }
        // "Frame load interrupted": raised when a navigation is cancelled to become a
        // download, a tab switch or an in-app browser sheet. Not a failure.
        if error.domain == "WebKitErrorDomain" && error.code == 102 { return true }
        return false
    }
}
