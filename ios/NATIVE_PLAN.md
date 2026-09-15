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
  while on screen, with the head count. Talking is a write, so it is coming soon.

## Next, in order
| Screen | Data | Verdict | Size |
|---|---|---|---|
| My photos, My music, clips viewer | /api/member-album, /api/member-songs/me, /api/clips + /api/clip-community | Native read | M |

## Stays web
Joined live rooms, booking dashboard and admin, Stripe Connect, founder announcements,
verification and access admin (owner tools that are all writes).

## Server issues found
- Public booking API returns full rows (owner email, staff phone, Stripe account id).
- Clip JSON doesn't say MP4 or WebM; AVPlayer can't play WebM.
- Photos are served no-store with no resized variants (the app caches and downsamples itself:
  Native/ImagePipeline.swift).
- Several member GETs write (access check, announcement delivery, inbox welcome).
