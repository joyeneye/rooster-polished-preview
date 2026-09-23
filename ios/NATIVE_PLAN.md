# ROOSTER Web → native screens

Audit of every screen the app shows (15 Sep 2026): what it reads, what it writes, and what keeps
it on the web. Reads are GET /api/* with the member session; writes are refused by
api/preview.js for now, so native screens show them as coming soon.

## Matches jwhitedidit.net (23 Sep 2026)
The client asked for the app to match the site, so WYD, the profile and the dock follow
jwhitedidit.net's own pages at phone width (the repo-root HTML, not the restyled public/ copy),
measured against a 402pt render: every WYD section sits within 1pt of the site.
- **Dock** (Views/SiteDock.swift): the system tab bar is hidden; WYD · People · Rooms · Me, the red
  camera, Inbox with its unread count and MONA, and the floating DARK/LIGHT switch. More is a
  hidden tab reached from the menu button on your own profile, so ORBIT Radio keeps playing.
- **WYD** (Views/Feed/WYDHome.swift): ROOSTER bar with Search, "What's happening?", the Top 8 inner
  circle, Post / Song / Take a Pic / Room, then the pill lanes and Pause motion / sound pinned over
  full-bleed posts with the five-button bar and Delete my post. One scroll: the top rests anywhere,
  the posts snap one per flick under the pinned lanes (StageSnap).
- **Profile** (Native/Profile/ProfileCard.swift): Open Home, the dark ROOSTER PROFILE card with
  status and live presence, your composer, the Top 8 "Your circle". The site paints the name
  near-black on the black card (a stylesheet-order bug, roster-light.css:1079); the app paints it
  white, as intended. The site's "•••" is the connection count still loading, not a menu.
- **MONA** (Native/Mona/): /api/mona/chat, NDJSON, history kept on the phone (the site keeps none)
  and trimmed to the server's 1,600 characters a turn.
- **Create and edit** (Native/Create/): Post, Take a Pic (album upload then photo post; albums
  hold 10), Song (a link in one of three slots), Delete my post, Edit Top 8 (PUT), Edit photo &
  status (moderated: can come back held for review), and a 45-second presence heartbeat.
- Fonts: Chakra Petch Regular and Orbitron 800 converted from the site's own woff2 files.

**Known limit:** the site rate-limits by IP (MONA: 12 questions an hour). Every app user reaches
it from Vercel's addresses, so app users can share one allowance. The bridge now reports a 429
as "Too many requests right now" instead of "unavailable".

## Done
- **WYD** (Feed/): swipe feed, promos, headlines, posts.
- **Sign-in gate** (Session/, Views/SignInView.swift).
- **People** (Native/People/): /api/members search and paging, people to build with
  (people-connections.js rank() ported), relationship state, and asking to be on someone's roster.
- **Profile and Me tab** (Native/Profile/): hero, badges, stats, live banner, booking pages,
  Top 8, Posts (clip grid, full-screen player, comment wall), Music (uploads play in the app,
  YouTube/Spotify/Apple links open in their player), Photos (grid, viewer), About, roster, activity.
  Every profile link in the app routes here (NativeRouter), including /#home and My music/photos.
- **Rooms tab** (Native/Rooms/): live rooms with video/audio filter, host, counts, joining, and
  starting one of your own (GoLiveSheet). Review Room and Chat Room shortcuts.
- **Top Rosters, Roster requests, Search, About** (Native/Discover/).
- **Messages** (Native/Messages/): conversation list and thread built from the mailbox, private
  photos and video through an authenticated fetch, replying, and opening a thread marks it read.
- **Opportunities and one opening** (Native/Opportunities/): filters, sort, detail; applying is
  coming soon.
- **Booking** (Native/Booking/): marketplace search by craft, and a business page with services,
  team, hours and reviews; booking and payment are coming soon.
- **Account and ORBIT Radio** (Native/Account/): account rows with sign out; eight stations with
  the Live365 player in a sheet.
- **ROOSTER Manager** (Native/Manager/): My Money (rcm-money.mjs summarizeMoney ported, per
  currency, by payer and by song), My Stuff, record details, the CSV export and a split-sheet PDF,
  and saving a song, show, person, split sheet or money record (AddRecordSheet). Asking MONA is
  still web-only: it spends on an AI call per question, which is the owner's to turn on.
- **Review Room** (Native/ReviewRoom/): the queue, your submissions and their reviews; audio is
  downloaded first because that route has no byte ranges. Sending a track in (a file from the
  phone or a link) and, for a room's owner, scoring and writing the review.
- **Chat Room** (Native/Rooms/ChatRoomView.swift): the last minute of the Listening Room, polled
  while on screen, the head count, and talking (moderated before it appears).
- **Live rooms** (Native/Live/): join, the 2.5s heartbeat, the comment feed, raise a hand, mute,
  and the host's people sheet. Audio and video are WebRTC peer to peer through the same rules the
  browser uses (LivePeers.swift), so a phone and a browser can share a room.

## Next, in order
| Screen | Data | Verdict | Size |
|---|---|---|---|
| My photos, My music, clips viewer | /api/member-album, /api/member-songs/me, /api/clips + /api/clip-community | Native read | M |

- **Owner tools** (Native/Owner/): invitations and approvals (the access overview is a POST),
  verification, founder announcements (write, check, then confirm before sending), and the booking
  dashboard (numbers, appointments with status changes, clients, services, published toggle,
  booking link, Stripe Connect through the in-app browser).
- **Business setup** (Native/Owner/BookingSetupView.swift): the business's details (name, what it
  does, craft, contact, shop link, address, time zone, cancellation policy), its pictures (logo,
  cover and a gallery of up to six, picked from the phone and re-encoded to JPEG because the site
  refuses HEIC), its services and its staff.
- **Opening hours** (Native/Owner/BookingHoursView.swift): the whole week, each day open or closed
  with the times clients can book inside. Hours had no write endpoint anywhere until
  /api/booking/hours was added for this; the app is the only place that edits them.

## Stays web
The booking platform admin, and deposits, buffers and staff rosters on a service.

## Writes
api/preview.js refuses writes except the allowlist in WRITABLE: live rooms and the chat room
(create, join, sync, leave, hand, mute, say, host actions, WebRTC signalling, chat send and
presence), the owner's tools (access admin, verification, announcements, membership, and a
business's booking pages, hours, services, staff and photo uploads), and a member acting for
themselves — roster requests out and answered, replies and read receipts, clip reactions and
comments, wall comments, and PATCH on the feed, which is like, save, repost and comment.
It also passes a track for the Review Room, a room owner's review, and a saved Manager record.
Writing a new post, other uploads, asking MONA and account changes still stop at the bridge.
Uploads get 4 MB through the bridge and everything else 256 KB, because Vercel refuses a request
body over 4.5 MB before the function runs — the site's own 12 MB track limit cannot be reached
from the app, so the Review Room offers a link for anything bigger. POST and DELETE on
/api/community/feed stay closed, so reacting is open and publishing is not. Writes must be same-origin, and the bridge replaces the origin with the live
site's, which the member API requires.

## Server issues found
- Public booking API returns full rows (owner email, staff phone, Stripe account id).
- Clip JSON doesn't say MP4 or WebM; AVPlayer can't play WebM.
- Photos are served no-store with no resized variants (the app caches and downsamples itself:
  Native/ImagePipeline.swift).
- Several member GETs write (access check, announcement delivery, inbox welcome).
