import Foundation

/// The script every page receives at document start. The site's repo is not connected to
/// its Vercel deployment, so a website-side change would not reach the live preview; the
/// app carries its own chrome rules instead, which work against the site as deployed.
enum ShellInjection {
    enum Theme: String {
        case light, dark
    }

    /// The polished layer scopes its rules as `html body.rooster-polished:not(#rooster-original)`
    /// (ID-level specificity) and its MutationObserver keeps its stylesheet last in <head>
    /// (rooster-polish.js:73). These rules sit earlier in the document, so each one carries that
    /// same prefix plus `html.rooster-shell` to outrank it, and `!important`.
    static let css: String = {
        let polished = "html.rooster-shell body.rooster-polished:not(#rooster-original)"
        return [
            // Native bars replace the site's header and bottom navigation, at every width:
            // above 760px the desktop header shows instead of the bottom nav.
            "\(polished) :is(.rp-header,.rp-mobile-nav){display:none!important}",
            // The legacy navs the polished layer already hides (rooster-polish.css:16), repeated in
            // case that stylesheet fails to load.
            "\(polished) :is(.site-header,.site-nav,.mobile-site-nav,.mobile-community-nav,.profile-topbar,.profile-desktop-nav,.profile-mobile-nav){display:none!important}",
            // Pages open with a top margin (.community-shell has 26px) that collapses through
            // <body>, so the root background shows above it. In dark mode the site paints <html>
            // #09090b and the body #1c1b1a, which left a band under the navigation bar. A block
            // formatting context keeps the margin inside the body.
            "\(polished){display:flow-root!important}",
            // 100px of bottom padding reserved for the hidden web tab bar (rooster-polish.css:4).
            // Where the Inbox/MONA dock exists it sits over the last 70px of the view, so the page
            // keeps 88px (58 dock + 12 offset + 18 air) or its final footer links stay under it.
            // Pages in a joined live room keep theirs: #roster-live-bar is fixed at bottom 0 and
            // relies on body[data-live-joined] padding (roster-live.css:542).
            "\(polished):not([data-live-joined=\"true\"]){padding-bottom:24px!important}",
            "\(polished):not([data-live-joined=\"true\"]):has(.roster-utility-dock){padding-bottom:88px!important}",
            // The Inbox and MONA dock is lifted 82px to clear the hidden web tab bar (rooster-polish.css:186).
            "\(polished) .roster-utility-dock{bottom:12px!important}",
            // Toasts that were lifted to clear the web tab bar now either float mid-content
            // (Manager, 150px: rcm.css:314-317) or sit under the lowered dock (Review Room, 16px).
            "\(polished) .manager-toast{bottom:calc(80px + env(safe-area-inset-bottom))!important}",
            "\(polished) .rr-toast{bottom:84px!important}",
            // The business dashboard's own section bar (.mobile-appbar, fixed at bottom 0) was hidden
            // behind the web tab bar; with that gone the lowered dock lands on its buttons.
            "@media (max-width:900px){\(polished) .mobile-appbar{padding-bottom:6px!important}\(polished):has(#app-view:not(.hidden)) .roster-utility-dock{bottom:74px!important}\(polished):has(#app-view:not(.hidden)) .app-main{padding-bottom:150px!important}}",
            // For You stage below 680px is sized as 100dvh minus the hidden header and nav, and its
            // controls scroll to 118px for the header (slots.css:150). In the app that left a 380px
            // stage with neighbouring cards showing; these give it the site's proportions.
            "@media (max-width:680px){\(polished) .slots-stage-controls{scroll-margin-top:48px!important}\(polished) .roster-fyp-column{height:calc(100dvh - 180px)!important}}",
            // Brand-only bars (a logo linking to "/" and an empty nav) that repeat the native title.
            // Review Room's is sticky, so without the web header above it, it pins permanently.
            "\(polished) :is(.rr-bar,.rr-public-nav,.manager-header){display:none!important}",
            // First-use coach tips (roster-first-use.mjs) render unstyled on every page: their only
            // stylesheet, roster-guide.css, is linked by no page. Their copy also points at the web
            // navigation the app replaces.
            "\(polished) .roster-first-use{display:none!important}",
            // "Keep listening in a separate window" opens an in-app sheet that stops when closed.
            "\(polished) .radio-popout{display:none!important}",
            // Profile section tabs stick at 64-65px to sit under the hidden 70px header
            // (profile-experience.css:15, :29), which would leave a strip of scrolling content
            // above them. The .community-rail/.community-context offsets only apply above 760px.
            "\(polished) .profile-content-tabs{top:0!important}",
            // Nobody reaches the app without signing in with an approved account (SessionModel), so
            // join, invite and log-in prompts that pages show regardless of the session don't belong:
            // the Rooms "invite-only" lines (rooster-polish.js:56, live.html:70); the Account page's
            // invite flag, join panel, sign-in tabs and "No invite code needed" note (members.html:39-59,
            // :95); Me's "Log In or Open My Account" (my-profile.html); a profile's "Log in to write on
            // the wall" (profile.html:89); About's and Top Rosters' "Make your ROOSTER page"
            // (about.html:36, top25.html:42); Opportunities' "Join or log in to post" (only that row: the board's
            // Search / Clear filters buttons share .opportunity-filter-actions, opportunities.html:51); the footers' "Get on
            // the Roster" (data-roster-join); Apply's invite-code note.
            "\(polished) :is(.rp-private,#live-audience,.roster-invite-flag,.roster-door-actions,.roster-banner-actions,.creator-promo-note,.portal-join-panel,.portal-auth-tabs,.roster-gate-switch,#member-wall-login,.about-roster-actions,.top25-fill-make,.opportunity-filter-actions:has(.opportunity-apply-link),.apply-no-code,a[data-roster-join]){display:none!important}",
            "\(polished) :is(#my-profile-status ~ p:has(a[href=\"/members.html\"])){display:none!important}",
            // The Account page renders its log-in form until the Identity SDK resolves the session
            // (members.js:715-735), then switches to the account view. Keep the forms out of sight
            // meanwhile; its "Getting your spot ready…" status stays.
            "\(polished):not([data-member-state=\"account\"]) :is([data-member-view]:not([data-member-view=\"account\"]),.member-card-heading){display:none!important}",
            // Anchor offsets sized for the hidden 70px sticky header (style.css:2, :206).
            "html.rooster-shell{scroll-padding-top:12px!important}",
            // App feel: no grey flash on tap, no Safari link/image callout on long press, and page
            // text isn't selectable. Fields and editable areas still are.
            "html.rooster-shell{-webkit-tap-highlight-color:transparent;-webkit-touch-callout:none;-webkit-text-size-adjust:100%}",
            "html.rooster-shell body{-webkit-user-select:none;user-select:none}",
            // Hover and focus rings on buttons and links stick after a tap on touch screens (the site
            // draws 3px outlines, e.g. .directory-access-actions a:hover), and stay on after going back.
            "\(polished) :is(a,button,summary,[role=\"button\"],[role=\"tab\"]):is(:hover,:focus){outline:none!important}",
            "html.rooster-shell :is(input,textarea,select,[contenteditable],[contenteditable] *){-webkit-user-select:text!important;user-select:text!important;-webkit-touch-callout:default}",
        ].joined(separator: "\n")
    }()

    static func script(theme: Theme) -> String {
        """
        (function(){
          // roster-startup.js shows its welcome screen for at least 2.7s on the first load of each web
          // view unless this per-session key is set (roster-startup.js:305-334, :403). The app shows
          // its own native version at launch (WelcomeView), so web pages never play it.
          try{sessionStorage.setItem('roster-startup-shown','1');}catch(e){}
          // One theme across every tab from first paint. The site's own toggle lives in the More
          // dialog, which the app replaces.
          try{localStorage.setItem('roster-theme','\(theme.rawValue)');}catch(e){}
          // rcm.js calls window.print(), which WebKit ignores in an app.
          window.print=function(){try{window.webkit.messageHandlers.roosterPrint.postMessage(null);}catch(e){}};
          function install(root){
            root.classList.add('\(ShellConfig.shellClassName)');
            root.setAttribute('data-roster-theme','\(theme.rawValue)');
            if(document.getElementById('rooster-shell-style'))return;
            // <head> may not exist yet, so the rules go on <html>. Live-room soft navigation swaps
            // body children only (roster-live.js), so they survive it.
            var style=document.createElement('style');
            style.id='rooster-shell-style';
            style.textContent=\(jsString(css));
            root.appendChild(style);
          }
          // The Inbox and MONA sheets are full-height web overlays. Tell the app when one opens so it
          // can hide its own bars, which would otherwise stack a second header above the sheet's.
          var overlayOpen=null;
          function reportOverlay(){
            var open=!!document.querySelector('.roster-utility-scrim[data-open]');
            if(open===overlayOpen)return;
            overlayOpen=open;
            try{window.webkit.messageHandlers.roosterOverlay.postMessage(open);}catch(e){}
          }
          new MutationObserver(reportOverlay).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['data-open']});
          function post(name,body){try{window.webkit.messageHandlers[name].postMessage(body);}catch(e){}}
          // A tap just before a scripted navigation (cards that set location.href) makes it a user's
          // navigation, so it gets its own screen like a link tap does.
          window.addEventListener('click',function(){post('roosterTap',true);},true);
          document.addEventListener('DOMContentLoaded',function(){
            // Booking's header link reads "Business login"; members are already signed in.
            var business=document.querySelector('.booking-nav a[href="/booking/dashboard"].secondary');
            if(business&&/login/i.test(business.textContent)){business.textContent='Your business';}
            // Pages don't pinch-zoom in an app. WKWebView honours user-scalable=no.
            var viewport=document.querySelector('meta[name="viewport"]');
            if(!viewport){viewport=document.createElement('meta');viewport.name='viewport';viewport.content='width=device-width, initial-scale=1';(document.head||document.documentElement).appendChild(viewport);}
            if(!/user-scalable/.test(viewport.content)){viewport.content+=', maximum-scale=1, user-scalable=no';}
            // The page has laid out: the app fades it in instead of showing it assemble.
            requestAnimationFrame(function(){post('roosterReady',true);});
          });
          // WebKit creates <html> before document-start scripts run; other engines may not, and
          // an unguarded document.documentElement would throw and skip everything above.
          if(document.documentElement){install(document.documentElement);}
          else{new MutationObserver(function(_,observer){if(document.documentElement){observer.disconnect();install(document.documentElement);}}).observe(document,{childList:true});}
        })();
        """
    }

    /// Applied to pages already open when the theme changes in the app.
    static func applyTheme(_ theme: Theme) -> String {
        """
        (function(){
          try{localStorage.setItem('roster-theme','\(theme.rawValue)');}catch(e){}
          document.documentElement.setAttribute('data-roster-theme','\(theme.rawValue)');
          var meta=document.querySelector('meta[name="theme-color"]');
          if(meta){meta.setAttribute('content','\(theme == .dark ? "#09090b" : "#f6f5f1")');}
        })();
        """
    }

    static func jsString(_ value: String) -> String {
        let data = try? JSONSerialization.data(withJSONObject: [value], options: [])
        let array = data.flatMap { String(data: $0, encoding: .utf8) } ?? "[\"\"]"
        return String(array.dropFirst().dropLast())
    }
}
