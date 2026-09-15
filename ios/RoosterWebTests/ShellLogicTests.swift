import XCTest
@testable import RoosterWeb

final class LinkPolicyTests: XCTestCase {
    private let policy = LinkPolicy(home: URL(string: "https://rooster-polished-preview.vercel.app")!)

    private func decide(_ string: String, mainFrame: Bool = true, tappedIn tab: ShellTab? = nil) -> LinkDecision {
        policy.decide(url: URL(string: string), isMainFrame: mainFrame, tappedIn: tab)
    }

    func testBothVercelDomainsAreTheSite() {
        XCTAssertEqual(decide("https://rooster-polished-preview.vercel.app/top25.html"), .allow)
        XCTAssertEqual(decide("https://rooster-polished.vercel.app/radio.html"), .allow)
        XCTAssertEqual(decide("https://ROOSTER-polished.vercel.app/about.html"), .allow)
    }

    func testTheOriginalSiteAndOtherHostsOpenInTheInAppBrowser() {
        for string in ["https://jwhitedidit.net/members.html", "https://www.youtube.com/watch?v=abc", "https://calendar.google.com/"] {
            let url = URL(string: string)!
            XCTAssertEqual(decide(string), .openInApp(url), string)
        }
    }

    func testLookalikeAndDowngradedHostsAreNotTheSite() {
        let lookalike = URL(string: "https://rooster-polished.vercel.app.evil.example/")!
        XCTAssertEqual(decide(lookalike.absoluteString), .openInApp(lookalike))
        let http = URL(string: "http://rooster-polished.vercel.app/")!
        XCTAssertEqual(decide(http.absoluteString), .openInApp(http))
    }

    func testEmbedsNavigateInsideTheirFrames() {
        for string in ["https://open.spotify.com/embed/track/1", "https://live365.com/embeds/v1/player/a1", "https://js.stripe.com/v3/three-ds-2"] {
            XCTAssertEqual(decide(string, mainFrame: false), .allow, string)
        }
        XCTAssertEqual(decide("spotify:track:1", mainFrame: false), .cancel)
    }

    func testSystemAndUnsafeSchemes() {
        let tel = URL(string: "tel:+15555550100")!
        XCTAssertEqual(decide(tel.absoluteString), .openExternally(tel))
        XCTAssertEqual(decide("javascript:alert(1)"), .cancel)
        XCTAssertEqual(decide("file:///etc/hosts"), .cancel)
        XCTAssertEqual(decide("blob:https://rooster-polished-preview.vercel.app/1"), .allow)
        XCTAssertEqual(decide("data:image/png;base64,AAAA"), .allow)
    }

    func testTappingAnotherTabsRootSwitchesTabs() {
        XCTAssertEqual(decide("https://rooster-polished-preview.vercel.app/people.html", tappedIn: .wyd), .switchTab(.people))
        XCTAssertEqual(decide("https://rooster-polished-preview.vercel.app/live.html", tappedIn: .more), .switchTab(.rooms))
        XCTAssertEqual(decide("https://rooster-polished-preview.vercel.app/", tappedIn: .me), .switchTab(.wyd))
        XCTAssertEqual(decide("https://rooster-polished-preview.vercel.app/index.html", tappedIn: .people), .switchTab(.wyd))
    }

    func testOnlyExactRootsSwitchTabs() {
        // community-home.js turns these into the owner profile, MONA and the Board, not WYD.
        for hash in ["home", "mona", "board", "comments"] {
            XCTAssertEqual(decide("https://rooster-polished-preview.vercel.app/#\(hash)", tappedIn: .people), .allow, hash)
        }
        XCTAssertEqual(decide("https://rooster-polished-preview.vercel.app/people.html?q=ink", tappedIn: .wyd), .allow)
        XCTAssertEqual(decide("https://rooster-polished-preview.vercel.app/profile.html?id=owner", tappedIn: .wyd), .allow)
    }

    func testSameTabRootAndRedirectsStayPut() {
        XCTAssertEqual(decide("https://rooster-polished-preview.vercel.app/people.html", tappedIn: .people), .allow)
        // Not a tap: the Me tab's own location.replace must never switch tabs.
        XCTAssertEqual(decide("https://rooster-polished-preview.vercel.app/", tappedIn: nil), .allow)
    }

    func testLocalServerOverride() {
        let local = LinkPolicy(home: URL(string: "http://127.0.0.1:8765")!)
        XCTAssertEqual(local.decide(url: URL(string: "http://127.0.0.1:8765/people.html"), isMainFrame: true, tappedIn: .wyd), .switchTab(.people))
        let other = URL(string: "http://127.0.0.1:3000/")!
        XCTAssertEqual(local.decide(url: other, isMainFrame: true), .openInApp(other))
    }

    func testSecurityOriginDefaultPort() {
        XCTAssertTrue(policy.isSameSite(host: "rooster-polished.vercel.app", port: 0, scheme: "https"))
        XCTAssertFalse(policy.isSameSite(host: "live365.com", port: 0, scheme: "https"))
    }
}

final class ShellURLTests: XCTestCase {
    private let base = URL(string: "https://rooster-polished-preview.vercel.app")!

    func testTabRoots() {
        XCTAssertEqual(ShellTab.wyd.url(base: base)?.absoluteString, "https://rooster-polished-preview.vercel.app/")
        XCTAssertEqual(ShellTab.people.url(base: base)?.absoluteString, "https://rooster-polished-preview.vercel.app/people.html")
        XCTAssertEqual(ShellTab.rooms.url(base: base)?.absoluteString, "https://rooster-polished-preview.vercel.app/live.html")
        XCTAssertEqual(ShellTab.me.url(base: base)?.absoluteString, "https://rooster-polished-preview.vercel.app/my-profile.html")
        XCTAssertNil(ShellTab.more.url(base: base))
    }

    func testDestinationsKeepQueriesAndFragments() {
        XCTAssertEqual(ShellDestination.messages.url(base: base).absoluteString, "https://rooster-polished-preview.vercel.app/members.html#member-mail")
        XCTAssertEqual(ShellDestination.music.url(base: base).absoluteString, "https://rooster-polished-preview.vercel.app/my-profile.html?view=songs")
        XCTAssertEqual(ShellDestination.booking.url(base: base).absoluteString, "https://rooster-polished-preview.vercel.app/booking")
    }

    func testTheMenuMatchesTheSite() {
        // rooster-polish.js:17-30, in order, plus Search.
        let site = ["Top Rosters", "ORBIT Radio", "Opportunities", "Booking", "ROOSTER Manager", "Messages", "Chat Room",
                    "My music", "My photos", "Roster requests", "About ROOSTER", "Account"]
        let app = (ShellDestination.explore + ShellDestination.yours + ShellDestination.site).map(\.title).filter { $0 != "Search" }
        XCTAssertEqual(app, site)
    }

    func testLocalBaseKeepsPort() {
        let local = URL(string: "http://127.0.0.1:8765")!
        XCTAssertEqual(ShellTab.rooms.url(base: local)?.absoluteString, "http://127.0.0.1:8765/live.html")
    }
}

final class TitleFormatterTests: XCTestCase {
    func testStripsSiteBranding() {
        XCTAssertEqual(TitleFormatter.clean("ROOSTER — Top Rosters"), "Top Rosters")
        XCTAssertEqual(TitleFormatter.clean("ROOSTER Booking — Marketplace"), "Marketplace")
        XCTAssertEqual(TitleFormatter.clean("J.White Did It | ROOSTER"), "J.White Did It")
        XCTAssertEqual(TitleFormatter.clean("Behind the record | Reviews"), "Behind the record")
        XCTAssertEqual(TitleFormatter.clean("ROOSTER"), "")
        XCTAssertEqual(TitleFormatter.clean(nil), "")
    }

    func testDataDrivenTitlesUseAFixedName() {
        XCTAssertEqual(TitleFormatter.routeTitles[TitleFormatter.normalize("/apply.html")], "Apply")
    }

    func testRootsUseTheTabName() {
        XCTAssertEqual(TitleFormatter.display(documentTitle: "ROOSTER — Account", isAtRoot: true, rootTitle: "Me"), "Me")
        XCTAssertEqual(TitleFormatter.display(documentTitle: "ROOSTER — Account", isAtRoot: false, rootTitle: "Me"), "Account")
        XCTAssertEqual(TitleFormatter.display(documentTitle: "ROOSTER", isAtRoot: false, rootTitle: "People"), "People")
    }
}

final class ShellInjectionTests: XCTestCase {
    func testHidesTheWebChromeWithEnoughSpecificity() {
        let css = ShellInjection.css
        let prefix = "html.rooster-shell body.rooster-polished:not(#rooster-original)"
        XCTAssertTrue(css.contains("\(prefix) :is(.rp-header,.rp-mobile-nav){display:none!important}"))
        XCTAssertTrue(css.contains("\(prefix) .roster-utility-dock{bottom:12px!important}"))
        XCTAssertTrue(css.contains(":not([data-live-joined=\"true\"]){padding-bottom:24px!important}"),
                      "a joined live room keeps its own bottom padding for #roster-live-bar")
        XCTAssertFalse(css.contains(".rp-menu"), "hiding the More <dialog> would leave an invisible modal if anything opened it")
        XCTAssertTrue(css.contains("\(prefix){display:flow-root!important}"), "top margins must not collapse through <body> and expose the root background")
        XCTAssertTrue(css.contains("\(prefix) .profile-content-tabs{top:0!important}"), "profile tabs must stick under the native bar, not 64px below it")
        XCTAssertTrue(css.contains(":has(.roster-utility-dock){padding-bottom:88px!important}"), "pages with the dock must leave room for it at the end")
        XCTAssertTrue(css.contains("\(prefix) :is(.rr-bar,.rr-public-nav,.manager-header){display:none!important}"))
    }

    func testScriptSkipsTheSplashAndSetsTheTheme() {
        let script = ShellInjection.script(theme: .dark)
        XCTAssertTrue(script.contains("sessionStorage.setItem('roster-startup-shown','1')"))
        XCTAssertTrue(script.contains("location.pathname==='/'"), "the welcome screen plays on the WYD root and nowhere else")
        XCTAssertTrue(script.contains(".roster-startup:not([data-leaving"), "the native bars step aside for the welcome screen")
        XCTAssertTrue(script.contains("localStorage.setItem('roster-theme','dark')"))
        XCTAssertTrue(script.contains("classList.add('rooster-shell')"))
        XCTAssertTrue(script.contains("if(document.documentElement)"), "the script must not assume <html> exists at document start")
        XCTAssertTrue(script.contains("messageHandlers.roosterOverlay"), "the app must hear when the Inbox or MONA sheet opens")
        XCTAssertTrue(script.contains("messageHandlers.roosterPrint"))
    }

    func testCSSIsEmbeddedAsAValidJavaScriptString() {
        let literal = ShellInjection.jsString(ShellInjection.css)
        XCTAssertTrue(literal.hasPrefix("\"") && literal.hasSuffix("\""))
        let decoded = try? JSONSerialization.jsonObject(with: Data("[\(literal)]".utf8)) as? [String]
        XCTAssertEqual(decoded?.first, ShellInjection.css)
    }
}

final class LoadFailureTests: XCTestCase {
    func testClassification() {
        XCTAssertEqual(LoadFailure(NSError(domain: NSURLErrorDomain, code: NSURLErrorNotConnectedToInternet)).title, "You're offline")
        XCTAssertEqual(LoadFailure(NSError(domain: NSURLErrorDomain, code: NSURLErrorTimedOut)).title, "ROOSTER is taking too long")
        XCTAssertTrue(LoadFailure.isIgnorable(NSError(domain: NSURLErrorDomain, code: NSURLErrorCancelled)))
        XCTAssertTrue(LoadFailure.isIgnorable(NSError(domain: "WebKitErrorDomain", code: 102)))
    }
}
