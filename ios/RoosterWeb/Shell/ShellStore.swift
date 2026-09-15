import SwiftUI
import UIKit
import WebKit

/// Owns every web view, the shared configuration and the app-wide theme.
@MainActor
final class ShellStore: ObservableObject {
    @Published var selection: ShellTab = .wyd
    @Published var morePath: [ShellDestination] = []
    @Published private(set) var theme: ShellInjection.Theme

    let baseURL: URL
    private let configuration: WKWebViewConfiguration
    private var tabPages: [ShellTab: WebPage] = [:]
    /// The most recently opened More destination stays alive after it is popped, so ORBIT Radio
    /// keeps playing while you look at the list or another tab. Opening a different destination
    /// replaces it.
    private(set) var moreDestination: ShellDestination?
    private var morePage: WebPage?
    private let printHandler = PrintHandler()
    private let overlayHandler = OverlayHandler()

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
        configuration.userContentController.add(WeakScriptHandler(overlayHandler), name: "roosterOverlay")
        installScript()

        overlayHandler.store = self
        for tab in ShellTab.webTabs {
            guard let url = tab.url(base: baseURL) else { continue }
            let page = WebPage(startURL: url, rootTitle: tab.title, tab: tab, baseURL: baseURL, configuration: configuration)
            page.onSwitchTab = { [weak self] target in self?.switchTo(target) }
            tabPages[tab] = page
        }
    }

    func page(_ tab: ShellTab) -> WebPage? { tabPages[tab] }

    var allPages: [WebPage] { Array(tabPages.values) + [morePage].compactMap { $0 } }

    func switchTo(_ tab: ShellTab) {
        UISelectionFeedbackGenerator().selectionChanged()
        selection = tab
    }

    func page(for destination: ShellDestination) -> WebPage {
        if let morePage, moreDestination == destination { return morePage }
        let page = WebPage(
            startURL: destination.url(base: baseURL),
            rootTitle: destination.title,
            tab: nil,
            baseURL: baseURL,
            configuration: configuration
        )
        page.onSwitchTab = { [weak self] target in self?.switchTo(target) }
        morePage = page
        moreDestination = destination
        return page
    }

    /// Loads a destination inside a web tab (Search from a tab's navigation bar).
    func load(_ destination: ShellDestination, in tab: ShellTab) {
        tabPages[tab]?.load(destination.url(base: baseURL))
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

/// The injected script's report that the site's Inbox or MONA sheet opened or closed.
@MainActor
final class OverlayHandler: NSObject, WKScriptMessageHandler {
    weak var store: ShellStore?

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let open = message.body as? Bool,
              let page = store?.allPages.first(where: { $0.webView === message.webView }) else { return }
        withAnimation(.easeInOut(duration: 0.2)) { page.overlayOpen = open }
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
