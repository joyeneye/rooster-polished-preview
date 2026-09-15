import SwiftUI

/// Site screens the app draws natively. A link to one of these opens the native screen, from a
/// native view or from a web page alike; every other link opens the web page.
enum NativeScreen: Hashable {
}

enum NativeRouter {
    static func screen(for url: URL, policy: LinkPolicy) -> NativeScreen? {
        guard policy.isSameSite(url) else { return nil }
        return nil
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

    var body: some View {
        EmptyView()
    }
}
