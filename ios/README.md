# ROOSTER Web for iPhone

A native iPhone app around the ROOSTER polished website
(https://rooster-polished-preview.vercel.app). Native tab bar, navigation bar, More menu,
sharing, dialogs, downloads, printing and in-app browser; the pages are the live site, so the
app stays identical to it without a second codebase.

Bundle `com.joyeneye.rooster-polished`, home-screen name **ROOSTER Web**, so it can sit on the
same phone as the native `jwhitedidit-ios` app (`com.jwhitedidit.rooster`, "ROOSTER").

## Build

```sh
cd ios
xcodegen generate          # after editing project.yml
xcodebuild test -project RoosterWeb.xcodeproj -scheme RoosterWeb \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
```

Point a build somewhere else with the `ROOSTER_BASE_URL` build setting, e.g. the conformance
fixture:

```sh
(cd Fixtures && python3 -m http.server 8765 --bind 127.0.0.1) &
xcodebuild build -project RoosterWeb.xcodeproj -scheme RoosterWeb \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  ROOSTER_BASE_URL=http://127.0.0.1:8765
```

`Fixtures/index.html` reports whether the app's injection took effect and has a button for every
browser feature the shell has to supply: alert/confirm/prompt, `_blank` links, `data:` and
`blob:` downloads, `window.print()`, share, clipboard and the microphone.

## How the app fits the site

The site's repository is not connected to its Vercel deployment, so nothing here depends on a
website change. The app injects one script at document start
(`RoosterWeb/Shell/ShellInjection.swift`) that:

- hides the site's own header and bottom navigation (`.rp-header`, `.rp-mobile-nav`) at every width;
- removes the 100px bottom padding and lowers the Inbox/MONA dock, both sized for the hidden nav;
- keeps top margins inside `<body>` (otherwise dark mode shows a band under the navigation bar);
- sticks the profile tabs under the native bar instead of 64px below it;
- plays the site's welcome screen (spots claimed, Log in, invite code) once, on launch, and skips it
  in every other tab;
- sets the theme, since the site's own toggle lives in the More dialog the app replaces;
- keeps 88px at the end of pages with the Inbox/MONA dock, so footers aren't left under it;
- resizes the For You stage and moves toasts that were sized around the hidden web bars;
- hides brand-only bars (Review Room, Manager) that repeat the native title, the unstyled
  first-use tips, and the radio's "separate window" link;
- reports when the Inbox or MONA sheet opens, so the native bars step aside for it.

Every rule carries the polished layer's `html body.rooster-polished:not(#rooster-original)`
specificity plus `!important`, because that layer keeps its stylesheet last in `<head>`.

Tabs follow the site's phone navigation: **WYD** `/`, **People** `/people.html`, **Rooms**
`/live.html`, **Me** `/my-profile.html`, and **More**, a native list of the site's twelve More
destinations plus Search and the theme switch. Vercel serves no clean URLs here, so the `.html`
extensions are required. Tapping another tab's exact root page switches tabs; `/#home`, `/#mona`
and `/#board` are not the WYD root (the site turns them into the owner profile, MONA and the
Board) and stay where they were tapped.

## Verified

- 21 unit tests: link routing, tab switching, titles, the injected CSS and script.
- Simulator, against the fixture: every feature listed above.
- Headless Chrome, with the exact injected script, across all 27 routes in the site's navigation,
  in light and dark, against the plain site as a baseline. The web chrome is hidden on all of them,
  with no top gap and no horizontal overflow. Text contrast is identical to the site's own in both
  themes. Dark mode's contrast failures (up to 20 on a page, e.g. Opportunities and Photos) belong
  to the site's dark theme, not to the app.
- A screen-by-screen review of every route against the plain site, each finding checked by a
  second reviewer who tried to refute it: 12 confirmed, 8 rejected as the site's own. 11 are
  fixed; the Search page still says Google opens "in a new tab" (it opens in an in-app sheet),
  left alone because rewriting the site's copy from the app is fragile.

## Not yet

- Sign-in, posting, messages, bookings and uploads: the preview refuses them by design.
- Push notifications, universal links and a Now Playing card for ORBIT Radio.
- A physical-device install and App Store submission.
