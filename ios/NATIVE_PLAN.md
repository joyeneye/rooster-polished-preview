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

## Next, in order
| Screen | Data | Verdict | Size |
|---|---|---|---|
| Messages | /api/member-messages?directory=0 (threads built client-side), private media via authenticated fetch | Native read; send coming soon | M |
| Opportunities + Apply | /api/opportunities, /options, /opportunity | Native; post/apply coming soon | M |
| Booking marketplace + provider | /api/booking/public (categories, discover, profile, availability) | Native; confirm and Stripe payment later | M |
| Account home, About, music guide | /api/access/state, visitors recap; static copy | Native | S |
| ORBIT Radio | static station table (radio.js) | Native chrome; Live365 player stays embedded until a direct stream is confirmed | S |
| ROOSTER Manager | /api/rcm/workspace (+ view=money) | Native My Money, My Stuff, CSV and split-sheet PDF; saving and MONA coming soon | M |
| My photos, My music, clips viewer | /api/member-album, /api/member-songs/me, /api/clips + /api/clip-community | Native read | M |
| Review Room | /api/review-room/dashboard, /audio (download first: no Range) | Native read | M |

## Stays web
Joined live rooms, booking dashboard and admin, Stripe Connect, founder announcements,
verification and access admin (owner tools that are all writes).

## Server issues found
- Public booking API returns full rows (owner email, staff phone, Stripe account id).
- Clip JSON doesn't say MP4 or WebM; AVPlayer can't play WebM.
- Photos are served no-store with no resized variants (the app caches and downsamples itself:
  Native/ImagePipeline.swift).
- Several member GETs write (access check, announcement delivery, inbox welcome).
