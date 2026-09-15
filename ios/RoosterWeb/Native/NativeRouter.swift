import SwiftUI

/// Site screens the app draws natively. A link to one of these opens the native screen, from a
/// native view or from a web page alike; every other link opens the web page.
enum NativeScreen: Hashable {
    /// A member's profile; nil is the signed-in member's own.
    case profile(id: String?, tab: ProfileModel.Tab)
    case topRosters
    case requests
    case search(query: String)
    case about
}

enum NativeRouter {
    static func screen(for url: URL, policy: LinkPolicy) -> NativeScreen? {
        guard policy.isSameSite(url) else { return nil }
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let query = Dictionary((components?.queryItems ?? []).compactMap { item in item.value.map { (item.name, $0) } },
                               uniquingKeysWith: { first, _ in first })
        let tab = profileTab(query["view"])
        switch TitleFormatter.normalize(url.path) {
        case "/profile":
            guard let id = query["id"], id == "owner" || Connections.isMemberID(id) else { return nil }
            return .profile(id: id, tab: tab)
        case "/member-photos":
            guard let id = query["id"], Connections.isMemberID(id) else { return nil }
            return .profile(id: id, tab: .photos)
        case "/my-profile":
            return .profile(id: nil, tab: tab)
        case "/top25":
            return .topRosters
        case "/about":
            return .about
        case "/morespace":
            return .search(query: query["q"] ?? "")
        case "/members":
            return url.fragment == "friend-requests" ? .requests : nil
        case "/", "/index":
            // community-home.js turns /#home into J.White's profile.
            return url.fragment == "home" ? .profile(id: "owner", tab: .posts) : nil
        default:
            return nil
        }
    }

    /// profile-experience.js ?view= values.
    static func profileTab(_ view: String?) -> ProfileModel.Tab {
        switch view {
        case "songs": .music
        case "photos": .photos
        case "about": .about
        default: .posts
        }
    }
}

/// The destination view for a pushed route.
struct AppRouteView: View {
    let route: AppRoute
    let stack: ShellTab

    var body: some View {
        switch route {
        case .web(let web):
            PushedWebScreen(page: web.page)
        case .native(let screen):
            NativeScreenView(screen: screen, stack: stack)
        }
    }
}

struct NativeScreenView: View {
    let screen: NativeScreen
    let stack: ShellTab
    @EnvironmentObject private var store: ShellStore

    var body: some View {
        switch screen {
        case .profile(let id, let tab):
            ProfileView(id: id, initialTab: tab, stack: stack, api: FeedAPI(base: store.baseURL))
        case .topRosters:
            TopRostersView(stack: stack, api: FeedAPI(base: store.baseURL))
        case .requests:
            RequestsView(stack: stack, api: FeedAPI(base: store.baseURL))
        case .search(let query):
            SearchView(query: query, stack: stack, api: FeedAPI(base: store.baseURL))
        case .about:
            AboutView(stack: stack)
        }
    }
}

/// The Me tab: the signed-in member's own profile.
struct MeView: View {
    @EnvironmentObject private var store: ShellStore

    var body: some View {
        NavigationStack(path: store.path(for: .me)) {
            ProfileView(id: nil, stack: .me, api: FeedAPI(base: store.baseURL))
                .navigationDestination(for: AppRoute.self) { route in
                    AppRouteView(route: route, stack: .me)
                }
        }
    }
}
