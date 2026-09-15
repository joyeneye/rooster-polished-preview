import SwiftUI
import UIKit
import WebKit

/// A ROOSTER page pushed onto a tab's navigation stack.
struct WebRoute: Hashable {
    let page: WebPage
    static func == (lhs: WebRoute, rhs: WebRoute) -> Bool { lhs.page === rhs.page }
    func hash(into hasher: inout Hasher) { hasher.combine(ObjectIdentifier(page)) }
}

enum MoreRoute: Hashable {
    case destination(ShellDestination)
    case web(WebRoute)
}

/// Owns every web view, the shared configuration and the app-wide theme.
@MainActor
final class ShellStore: ObservableObject {
    @Published var selection: ShellTab = .wyd
    @Published var paths: [ShellTab: [WebRoute]] = [:]
    @Published var morePath: [MoreRoute] = []
    @Published private(set) var theme: ShellInjection.Theme

    let baseURL: URL
    private let configuration: WKWebViewConfiguration
    private var tabPages: [ShellTab: WebPage] = [:]
    /// The most recently opened More destination stays alive after it is popped, so ORBIT Radio
    /// keeps playing while you look at the list or another tab. Opening a different destination
    /// replaces it.
    private(set) var moreDestination: ShellDestination?
    private var morePage: WebPage?
    /// Every live page, pushed ones included; a page leaves when its screen is popped.
    private let livePages = NSHashTable<WebPage>.weakObjects()
    private let printHandler = PrintHandler()
    private let pageHandler = PageMessageHandler()

    private static let themeKey = "rooster.theme"

    init(baseURL: URL = ShellConfig.baseURL) {
        self.baseURL = baseURL
        let stored = UserDefaults.standard.string(forKey: Self.themeKey).flatMap(ShellInjection.Theme.init(rawValue:))
        theme = stored ?? .light

        configuration = WKWebViewConfiguration()
        // One data store for every web view, so localStorage (theme, first-use state) and
        // cookies are shared. sessionStorage stays per web view, which is why the splash key is
        // seeded in each one by the injected script.
        configuration.websiteDataStore = .default()
        configuration.applicationNameForUserAgent = ShellConfig.userAgentToken
        configuration.allowsInlineMediaPlayback = true
        configuration.allowsPictureInPictureMediaPlayback = true
        // WYD autoplays muted inline clips; live rooms play remote streams after a tap.
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.userContentController.add(WeakScriptHandler(printHandler), name: "roosterPrint")
        for name in PageMessageHandler.names {
            configuration.userContentController.add(WeakScriptHandler(pageHandler), name: name)
        }
        installScript()

        pageHandler.store = self
        for tab in ShellTab.webTabs {
            guard let url = tab.url(base: baseURL) else { continue }
            tabPages[tab] = makePage(url: url, title: tab.title, tab: tab, stack: tab, prefersDocumentTitle: false)
        }
    }

    func page(_ tab: ShellTab) -> WebPage? { tabPages[tab] }

    var allPages: [WebPage] { livePages.allObjects }

    func switchTo(_ tab: ShellTab) {
        UISelectionFeedbackGenerator().selectionChanged()
        paths[tab] = []
        selection = tab
    }

    func path(for tab: ShellTab) -> Binding<[WebRoute]> {
        Binding(get: { self.paths[tab] ?? [] }, set: { self.paths[tab] = $0 })
    }

    func page(for destination: ShellDestination) -> WebPage {
        if let morePage, moreDestination == destination { return morePage }
        let page = makePage(url: destination.url(base: baseURL), title: destination.title, tab: nil, stack: .more, prefersDocumentTitle: false)
        morePage = page
        moreDestination = destination
        return page
    }

    /// Opens a ROOSTER page on top of a tab's stack, with the system push transition and swipe back.
    func push(_ url: URL, title: String = "", in stack: ShellTab) {
        let route = WebRoute(page: makePage(url: url, title: title, tab: nil, stack: stack, prefersDocumentTitle: title.isEmpty))
        if stack == .more {
            morePath.append(.web(route))
        } else {
            paths[stack, default: []].append(route)
        }
    }

    func push(_ destination: ShellDestination, in stack: ShellTab) {
        push(destination.url(base: baseURL), title: destination.title, in: stack)
    }

    /// Re-tapping a tab, or a link to the tab's own first page: back to that page, or to its top.
    func popToRoot(_ tab: ShellTab) {
        if tab == .more {
            morePath = []
        } else if paths[tab]?.isEmpty == false {
            paths[tab] = []
        } else {
            tabPages[tab]?.popToRootOrScrollToTop()
        }
    }

    private func makePage(url: URL, title: String, tab: ShellTab?, stack: ShellTab, prefersDocumentTitle: Bool) -> WebPage {
        let page = WebPage(startURL: url, rootTitle: title, tab: tab, stackTab: stack,
                           prefersDocumentTitle: prefersDocumentTitle, baseURL: baseURL, configuration: configuration)
        page.onSwitchTab = { [weak self] target in self?.switchTo(target) }
        page.onPush = { [weak self] url in self?.push(url, in: stack) }
        page.onPopToRoot = { [weak self] in self?.popToRoot(stack) }
        livePages.add(page)
        return page
    }

    func setTheme(_ newTheme: ShellInjection.Theme) {
        guard newTheme != theme else { return }
        theme = newTheme
        UserDefaults.standard.set(newTheme.rawValue, forKey: Self.themeKey)
        installScript()
        let apply = ShellInjection.applyTheme(newTheme)
        allPages.forEach { $0.evaluate(apply) }
    }

    /// The configuration's user content controller is shared by every web view made from it,
    /// so replacing the script here changes what all future page loads receive.
    private func installScript() {
        let controller = configuration.userContentController
        controller.removeAllUserScripts()
        controller.addUserScript(WKUserScript(
            source: ShellInjection.script(theme: theme),
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
    }
}

/// window.print() from rcm.js, routed to the system print sheet.
@MainActor
final class PrintHandler: NSObject, WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let webView = message.webView else { return }
        let controller = UIPrintInteractionController.shared
        let info = UIPrintInfo(dictionary: nil)
        info.outputType = .general
        info.jobName = webView.title ?? "ROOSTER"
        controller.printInfo = info
        controller.printFormatter = webView.viewPrintFormatter()
        controller.present(animated: true)
    }
}

/// Reports from the injected script: an overlay opened or closed, the page tapped, the page laid out.
@MainActor
final class PageMessageHandler: NSObject, WKScriptMessageHandler {
    static let names = ["roosterOverlay", "roosterTap", "roosterReady"]
    weak var store: ShellStore?

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame,
              let page = store?.allPages.first(where: { $0.webView === message.webView }) else { return }
        switch message.name {
        case "roosterOverlay":
            guard let open = message.body as? Bool else { return }
            withAnimation(.easeInOut(duration: 0.2)) { page.overlayOpen = open }
        case "roosterTap":
            page.lastTap = Date()
        case "roosterReady":
            page.markContentReady()
        default:
            break
        }
    }
}

/// WKUserContentController retains its message handlers strongly; this breaks the cycle.
@MainActor
final class WeakScriptHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?

    init(_ target: WKScriptMessageHandler) {
        self.target = target
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}
