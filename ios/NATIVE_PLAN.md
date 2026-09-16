# ROOSTER Web → native screens

Audit of every screen the app shows (15 Sep 2026): what it reads, what it writes, and what keeps
it on the web. Reads are GET /api/* with the member session; writes are refused by
api/preview.js for now, so native screens show them as coming soon.

## Done
- **WYD** (Feed/): swipe feed, promos, headlines, posts.
- **Sign-in gate** (Session/, Views/SignInView.swift).
- **People** (Native/People/): /api/members search and paging, people to build with
  (people-connections.js rank() ported), relationship state. Add and accept are coming soon.
- **Profile and Me tab** (Native/Profile/): hero, badges, stats, live banner, booking pages,
  Top 8, Posts (clip grid, full-screen player, comment wall), Music (uploads play in the app,
  YouTube/Spotify/Apple links open in their player), Photos (grid, viewer), About, roster, activity.
  Every profile link in the app routes here (NativeRouter), including /#home and My music/photos.
- **Rooms tab** (Native/Rooms/): live rooms with video/audio filter, host, counts; joining and
  going live are coming soon (POSTs). Review Room and Chat Room shortcuts.
- **Top Rosters, Roster requests, Search, About** (Native/Discover/).
- **Messages** (Native/Messages/): conversation list and thread built from the mailbox, private
  photos and video through an authenticated fetch; replying is coming soon.
- **Opportunities and one opening** (Native/Opportunities/): filters, sort, detail; applying is
  coming soon.
- **Booking** (Native/Booking/): marketplace search by craft, and a business page with services,
  team, hours and reviews; booking and payment are coming soon.
- **Account and ORBIT Radio** (Native/Account/): account rows with sign out; eight stations with
  the Live365 player in a sheet.
- **ROOSTER Manager** (Native/Manager/): My Money (rcm-money.mjs summarizeMoney ported, per
  currency, by payer and by song), My Stuff, record details, the CSV export and a split-sheet PDF.
  Saving records and asking MONA are coming soon.
- **Review Room** (Native/ReviewRoom/): the queue, your submissions and their reviews; audio is
  downloaded first because that route has no byte ranges. Submitting and reviewing are coming soon.
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

## Stays web
The booking platform admin, and deposits, buffers and staff rosters on a service.
Opening hours are seeded when a business is created and no endpoint edits them
(booking-api.mts:158), so neither the site nor the app can change them.

## Writes
api/preview.js refuses writes except the allowlist in WRITABLE: live rooms and the chat room
(join, sync, leave, hand, mute, say, host actions, WebRTC signalling, chat send and presence), and
the owner's tools (access admin, verification, announcements, membership, and a business's booking
pages, services, staff and photo uploads). Everything else — posting, likes, comments, uploads, messages, account changes — still
stops at the bridge. Writes must be same-origin, and the bridge replaces the origin with the live
site's, which the member API requires.

## Server issues found
- Public booking API returns full rows (owner email, staff phone, Stripe account id).
- Clip JSON doesn't say MP4 or WebM; AVPlayer can't play WebM.
- Photos are served no-store with no resized variants (the app caches and downsamples itself:
  Native/ImagePipeline.swift).
- Several member GETs write (access check, announcement delivery, inbox welcome).
