import Foundation

/// Where the app finds the ROOSTER polished site, and how the site is laid out.
enum ShellConfig {
    static let productionBaseURL = URL(string: "https://rooster-polished.vercel.app")!

    /// Both Vercel domains serve the same deployment (identical bytes, checked 15 Sep 2026).
    /// The -preview host is the documented shareable address, so it is the one loaded.
    static let siteHosts: Set<String> = ["rooster-polished-preview.vercel.app", "rooster-polished.vercel.app"]

    /// Read from the `ROOSTERBaseURL` Info.plist key, which carries the `ROOSTER_BASE_URL`
    /// build setting, so a build can point at a local server or a test fixture.
    static var baseURL: URL {
        guard
            let raw = Bundle.main.object(forInfoDictionaryKey: "ROOSTERBaseURL") as? String,
            let url = URL(string: raw),
            let scheme = url.scheme?.lowercased(),
            scheme == "https" || scheme == "http",
            url.host != nil
        else { return productionBaseURL }
        return url
    }

    static let userAgentToken = "RoosterWebiOS/1.0"
    static let shellClassName = "rooster-shell"
}

/// The site's own phone navigation, in its order: WYD, People, Rooms, Me, More
/// (rooster-polish.js:16, :37-42). More is native here; the others are web tabs.
enum ShellTab: String, CaseIterable, Identifiable, Hashable {
    case wyd, people, rooms, me, more

    var id: String { rawValue }

    var title: String {
        switch self {
        case .wyd: "WYD"
        case .people: "People"
        case .rooms: "Rooms"
        case .me: "Me"
        case .more: "More"
        }
    }

    var symbol: String {
        switch self {
        case .wyd: "house.fill"
        case .people: "person.2.fill"
        case .rooms: "waveform"
        case .me: "person.crop.circle.fill"
        case .more: "ellipsis.circle.fill"
        }
    }

    /// The root page of each web tab. The site has no clean URLs on Vercel, so the
    /// `.html` extension is required (live `/people` is a 404).
    var path: String? {
        switch self {
        case .wyd: "/"
        case .people: "/people.html"
        case .rooms: "/live.html"
        case .me: "/my-profile.html"
        case .more: nil
        }
    }

    static var webTabs: [ShellTab] { allCases.filter { $0.path != nil } }

    func url(base: URL) -> URL? {
        guard let path else { return nil }
        return ShellURL.resolve(path, base: base)
    }
}

/// Everything in the site's More dialog, in its order, with its own taglines
/// (rooster-polish.js:17-30), plus Search from the site header.
enum ShellDestination: String, CaseIterable, Identifiable, Hashable {
    case topRosters, radio, opportunities, booking, manager, messages, chat, music, photos, requests, about, account, search

    var id: String { rawValue }

    static var explore: [ShellDestination] { [.topRosters, .radio, .opportunities, .booking, .manager] }
    static var yours: [ShellDestination] { [.messages, .chat, .music, .photos, .requests] }
    static var site: [ShellDestination] { [.search, .about, .account] }

    var title: String {
        switch self {
        case .topRosters: "Top Rosters"
        case .radio: "ORBIT Radio"
        case .opportunities: "Opportunities"
        case .booking: "Booking"
        case .manager: "ROOSTER Manager"
        case .messages: "Messages"
        case .chat: "Chat Room"
        case .music: "My music"
        case .photos: "My photos"
        case .requests: "Roster requests"
        case .about: "About ROOSTER"
        case .account: "Account"
        case .search: "Search"
        }
    }

    var tagline: String {
        switch self {
        case .topRosters: "The people making connections"
        case .radio: "Find your next frequency"
        case .opportunities: "Make your next move"
        case .booking: "Find your next collaborator"
        case .manager: "The business behind your work"
        case .messages: "Keep the conversation going"
        case .chat: "Pull up and talk"
        case .music: "The soundtrack to your page"
        case .photos: "Your creative world"
        case .requests: "Build your roster"
        case .about: "A place for people"
        case .account: "Your membership and settings"
        case .search: "People, songs and walls"
        }
    }

    var symbol: String {
        switch self {
        case .topRosters: "trophy.fill"
        case .radio: "dot.radiowaves.left.and.right"
        case .opportunities: "sparkles"
        case .booking: "calendar"
        case .manager: "briefcase.fill"
        case .messages: "envelope.fill"
        case .chat: "bubble.left.and.bubble.right.fill"
        case .music: "music.note"
        case .photos: "photo.on.rectangle"
        case .requests: "person.badge.plus"
        case .about: "info.circle.fill"
        case .account: "person.crop.circle"
        case .search: "magnifyingglass"
        }
    }

    var path: String {
        switch self {
        case .topRosters: "/top25.html"
        case .radio: "/radio.html"
        case .opportunities: "/opportunities.html"
        case .booking: "/booking"
        case .manager: "/rcm.html"
        case .messages: "/members.html#member-mail"
        case .chat: "/members.html#member-chat"
        case .music: "/my-profile.html?view=songs"
        case .photos: "/my-profile.html?view=photos"
        case .requests: "/members.html#friend-requests"
        case .about: "/about.html"
        case .account: "/members.html"
        case .search: "/morespace.html"
        }
    }

    func url(base: URL) -> URL {
        ShellURL.resolve(path, base: base) ?? base
    }
}

enum ShellURL {
    /// Resolves a site path (which may carry a query and fragment) against the base,
    /// keeping the base's scheme, host and port.
    static func resolve(_ path: String, base: URL) -> URL? {
        guard var components = URLComponents(url: base, resolvingAgainstBaseURL: false) else { return nil }
        var rest = Substring(path)
        var fragment: String?
        var query: String?
        if let hash = rest.firstIndex(of: "#") {
            fragment = String(rest[rest.index(after: hash)...])
            rest = rest[..<hash]
        }
        if let mark = rest.firstIndex(of: "?") {
            query = String(rest[rest.index(after: mark)...])
            rest = rest[..<mark]
        }
        components.path = rest.isEmpty ? "/" : String(rest)
        components.percentEncodedQuery = query
        components.fragment = fragment
        return components.url
    }
}
