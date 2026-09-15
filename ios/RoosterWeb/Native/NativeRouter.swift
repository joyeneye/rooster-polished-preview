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
    case messages
    case conversation(memberID: String, name: String)
    case opportunities
    case opportunity(slug: String)
    case booking
    case bookingProvider(slug: String)
    case account
    case radio
    case manager
    case managerMoney
    case managerRecord(id: Int)
    case reviewRoom
    case chatRoom
    case liveRoom(key: String)
}

enum NativeRouter {
    static func screen(for url: URL, policy: LinkPolicy) -> NativeScreen? {
        guard policy.isSameSite(url) else { return nil }
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let query = Dictionary((components?.queryItems ?? []).compactMap { item in item.value.map { (item.name, $0) } },
                               uniquingKeysWith: { first, _ in first })
        let tab = profileTab(query["view"])
        // /book/<slug> is a business's booking page (booking-provider.js:2).
        let parts = url.path.split(separator: "/").map(String.init)
        if parts.count == 2, parts[0] == "book", !parts[1].isEmpty { return .bookingProvider(slug: parts[1]) }
        if TitleFormatter.normalize(url.path) == "/live", let key = query["room"], !key.isEmpty {
            return .liveRoom(key: key)
        }
        switch TitleFormatter.normalize(url.path) {
        case "/profile":
            guard let id = query["id"], id == "owner" || Connections.isMemberID(id) else { return nil }
            return .profile(id: id, tab: tab)
        case "/member-photos":
            guard let id = query["id"], Connections.isMemberID(id) else { return nil }
            return .profile(id: id, tab: .photos)
        case "/my-profile":
            return .profile(id: nil, tab: tab)
        case "/radio":
            return .radio
        case "/rcm":
            return url.fragment == "money" ? .managerMoney : .manager
        case "/review-room":
            return .reviewRoom
        case "/opportunities":
            return .opportunities
        case "/apply":
            return query["opportunity"].map { .opportunity(slug: $0) } ?? .opportunities
        case "/booking":
            return .booking
        case "/top25":
            return .topRosters
        case "/about":
            return .about
        case "/morespace":
            return .search(query: query["q"] ?? "")
        case "/members":
            if let to = query["to"], Connections.isMemberID(to) { return .conversation(memberID: to, name: "") }
            switch url.fragment {
            case "friend-requests": return .requests
            case "member-mail": return .messages
            case "member-chat": return .chatRoom
            case nil, "": return .account
            default: return nil
            }
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
        case .messages:
            MessagesView(stack: stack)
        case .conversation(let memberID, let name):
            ConversationView(memberID: memberID, name: name, stack: stack)
        case .opportunities:
            OpportunitiesView(stack: stack, api: FeedAPI(base: store.baseURL))
        case .opportunity(let slug):
            OpportunityView(slug: slug, stack: stack, api: FeedAPI(base: store.baseURL))
        case .booking:
            BookingMarketplaceView(stack: stack, api: FeedAPI(base: store.baseURL))
        case .bookingProvider(let slug):
            BookingProviderView(slug: slug, stack: stack, api: FeedAPI(base: store.baseURL))
        case .account:
            AccountView(stack: stack, api: FeedAPI(base: store.baseURL))
        case .radio:
            RadioView(stack: stack)
        case .manager:
            ManagerView(stack: stack, api: FeedAPI(base: store.baseURL))
        case .managerMoney:
            ManagerMoneyView(stack: stack, api: FeedAPI(base: store.baseURL))
        case .managerRecord(let id):
            ManagerRecordView(id: id, stack: stack, api: FeedAPI(base: store.baseURL))
        case .reviewRoom:
            ReviewRoomView(stack: stack, api: FeedAPI(base: store.baseURL))
        case .chatRoom:
            ChatRoomView(stack: stack, api: FeedAPI(base: store.baseURL))
        case .liveRoom(let key):
            LiveRoomView(key: key, stack: stack, api: FeedAPI(base: store.baseURL))
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
