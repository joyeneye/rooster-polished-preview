import SwiftUI
import UIKit
import WebKit

struct BrowserDestination: Identifiable {
    let id = UUID()
    let url: URL
}

/// One web view and the state its native chrome needs. Tab pages live for the life of the
/// app, so switching tabs never reloads a page or stops a live room (a reload fires
/// pagehide, which leaves the room — roster-live.js:1953-1960).
@MainActor
final class WebPage: NSObject, ObservableObject {
    let startURL: URL
    let rootTitle: String
    /// The tab this page belongs to, when it is a tab root page; nil for More destinations.
    let tab: ShellTab?
    let webView: WKWebView

    @Published private(set) var documentTitle = ""
    @Published private(set) var currentURL: URL?
    @Published private(set) var canGoBack = false
    @Published private(set) var isLoading = false
    @Published private(set) var progress: Double = 0
    @Published private(set) var hasPainted = false
    @Published var failure: LoadFailure?
    /// True while the site's Inbox or MONA sheet is open; the native bars step aside for it.
    @Published var overlayOpen = false
    @Published var browser: BrowserDestination?

    var onSwitchTab: ((ShellTab) -> Void)?

    private let policy: LinkPolicy
    private var hasStarted = false
    private var observations: [NSKeyValueObservation] = []
    private let refreshControl = UIRefreshControl()
    private var downloadDestinations: [ObjectIdentifier: URL] = [:]

    init(startURL: URL, rootTitle: String, tab: ShellTab?, baseURL: URL, configuration: WKWebViewConfiguration) {
        self.startURL = startURL
        self.rootTitle = rootTitle
        self.tab = tab
        self.policy = LinkPolicy(home: baseURL)
        self.webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()

        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.allowsLinkPreview = false
        webView.isOpaque = false
        webView.backgroundColor = Theme.uiBackground
        webView.scrollView.backgroundColor = Theme.uiBackground
        webView.underPageBackgroundColor = Theme.uiBackground
        #if DEBUG
        webView.isInspectable = true
        #endif

        refreshControl.tintColor = Theme.uiRed
        refreshControl.addTarget(self, action: #selector(pulledToRefresh), for: .valueChanged)
        webView.scrollView.refreshControl = refreshControl

        observeWebView()
    }

    var displayTitle: String {
        if !isAtRoot, let path = currentURL?.path, let fixed = TitleFormatter.routeTitles[TitleFormatter.normalize(path)] {
            return fixed
        }
        return TitleFormatter.display(documentTitle: documentTitle, isAtRoot: isAtRoot, rootTitle: rootTitle)
    }

    /// First page of this web view. Judged by history, not URL, because several pages replace
    /// themselves on arrival (my-profile.js:9-13, community-home.js:5-6).
    var isAtRoot: Bool { !canGoBack }

    var shareURL: URL? { currentURL ?? (hasStarted ? startURL : nil) }

    func startIfNeeded() {
        guard !hasStarted else { return }
        hasStarted = true
        load(startURL)
    }

    func load(_ url: URL) {
        hasStarted = true
        failure = nil
        webView.load(URLRequest(url: url))
    }

    func reload() {
        failure = nil
        if webView.url == nil { load(startURL) } else { webView.reload() }
    }

    func goBack() {
        guard webView.canGoBack else { return }
        webView.goBack()
    }

    /// Re-tapping the selected tab: back to the tab's first page, or if already there, to the top.
    func popToRootOrScrollToTop() {
        if let first = webView.backForwardList.backList.first {
            webView.go(to: first)
        } else {
            let top = CGPoint(x: 0, y: -webView.scrollView.adjustedContentInset.top)
            webView.scrollView.setContentOffset(top, animated: true)
        }
    }

    func evaluate(_ script: String) {
        webView.evaluateJavaScript(script, completionHandler: nil)
    }

    @objc private func pulledToRefresh() { reload() }

    private func observeWebView() {
        observations = [
            webView.observe(\.title, options: [.initial, .new]) { [weak self] webView, _ in
                MainActor.assumeIsolated { self?.documentTitle = webView.title ?? "" }
            },
            // Also catches pushState soft navigation, which never reaches decidePolicyFor.
            webView.observe(\.url, options: [.initial, .new]) { [weak self] webView, _ in
                MainActor.assumeIsolated { self?.currentURL = webView.url }
            },
            webView.observe(\.canGoBack, options: [.initial, .new]) { [weak self] webView, _ in
                MainActor.assumeIsolated { self?.canGoBack = webView.canGoBack }
            },
            webView.observe(\.isLoading, options: [.initial, .new]) { [weak self] webView, _ in
                MainActor.assumeIsolated { self?.isLoading = webView.isLoading }
            },
            webView.observe(\.estimatedProgress, options: [.initial, .new]) { [weak self] webView, _ in
                MainActor.assumeIsolated { self?.progress = webView.estimatedProgress }
            },
        ]
    }

    private func handle(_ error: Error) {
        refreshControl.endRefreshing()
        guard !LoadFailure.isIgnorable(error) else { return }
        failure = LoadFailure(error)
    }

    private func route(_ decision: LinkDecision, url: URL?) {
        switch decision {
        case .allow:
            if let url { webView.load(URLRequest(url: url)) }
        case .switchTab(let target):
            onSwitchTab?(target)
        case .openInApp(let destination):
            browser = BrowserDestination(url: destination)
        case .openExternally(let destination):
            UIApplication.shared.open(destination)
        case .cancel:
            break
        }
    }

    fileprivate var presenter: UIViewController? {
        var top = webView.window?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }

    fileprivate func present(_ controller: UIViewController, orElse fallback: () -> Void) {
        guard let presenter else { return fallback() }
        if let popover = controller.popoverPresentationController {
            popover.sourceView = webView
            popover.sourceRect = CGRect(x: webView.bounds.midX, y: webView.bounds.midY, width: 1, height: 1)
        }
        presenter.present(controller, animated: true)
    }
}

extension WebPage: WKNavigationDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
        if navigationAction.shouldPerformDownload { return .download }
        let isMainFrame = navigationAction.targetFrame?.isMainFrame ?? true
        // Only a user's tap may switch tabs; redirects and location.replace stay put.
        let tapped = navigationAction.navigationType == .linkActivated ? (tab ?? .more) : nil
        let decision = policy.decide(url: navigationAction.request.url, isMainFrame: isMainFrame, tappedIn: tapped)
        if decision == .allow { return .allow }
        route(decision, url: nil)
        return .cancel
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse) async -> WKNavigationResponsePolicy {
        navigationResponse.canShowMIMEType ? .allow : .download
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        failure = nil
        overlayOpen = false
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        refreshControl.endRefreshing()
        hasPainted = true
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        handle(error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        handle(error)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }
}

/// `<a download>` exports — the booking QR code (a data: PNG) and the ROOSTER Manager CSV
/// (a blob:) — are saved to a temporary folder and handed to the share sheet, so they can go
/// to Files, Messages or AirDrop. Without a download delegate WebKit drops them silently.
extension WebPage: WKDownloadDelegate {
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String) async -> URL? {
        let folder = FileManager.default.temporaryDirectory
            .appendingPathComponent("Downloads", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        } catch {
            return nil
        }
        let name = suggestedFilename.isEmpty ? "ROOSTER download" : suggestedFilename
        let destination = folder.appendingPathComponent(name)
        downloadDestinations[ObjectIdentifier(download)] = destination
        return destination
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let file = downloadDestinations.removeValue(forKey: ObjectIdentifier(download)) else { return }
        let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
        present(sheet, orElse: {})
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloadDestinations.removeValue(forKey: ObjectIdentifier(download))
        let alert = UIAlertController(title: "Download failed", message: error.localizedDescription, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, orElse: {})
    }
}

extension WebPage: WKUIDelegate {
    /// `target="_blank"` and `window.open`: ROOSTER pages load here, everything else goes to
    /// the in-app browser. Without this, WebKit drops those taps.
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        let url = navigationAction.request.url
        route(policy.decide(url: url, isMainFrame: true, tappedIn: tab ?? .more), url: url)
        return nil
    }

    // The async name differs from the Objective-C selector
    // (WK_SWIFT_ASYNC_NAME in WKUIDelegate.h); a near-miss compiles and is never called.
    func webView(
        _ webView: WKWebView,
        decideMediaCapturePermissionsFor origin: WKSecurityOrigin,
        initiatedBy frame: WKFrameInfo,
        type: WKMediaCaptureType
    ) async -> WKPermissionDecision {
        policy.isSameSite(host: origin.host, port: origin.port, scheme: origin.protocol) ? .prompt : .deny
    }

    // WebKit answers alert(), confirm() and prompt() with nothing unless the app presents them:
    // confirm() returns false and prompt() returns null. The site has 11 call sites, including
    // delete and cancel-appointment confirmations and the photo text tool's prompt('…','🔥').

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo) async {
        await withCheckedContinuation { continuation in
            let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in continuation.resume() })
            present(alert, orElse: { continuation.resume() })
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo) async -> Bool {
        await withCheckedContinuation { continuation in
            let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in continuation.resume(returning: false) })
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in continuation.resume(returning: true) })
            present(alert, orElse: { continuation.resume(returning: false) })
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo) async -> String? {
        await withCheckedContinuation { continuation in
            let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
            alert.addTextField { $0.text = defaultText }
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in continuation.resume(returning: nil) })
            alert.addAction(UIAlertAction(title: "OK", style: .default) { [weak alert] _ in
                continuation.resume(returning: alert?.textFields?.first?.text ?? "")
            })
            present(alert, orElse: { continuation.resume(returning: nil) })
        }
    }
}
