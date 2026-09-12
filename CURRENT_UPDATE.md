# ROOSTER text messages — September 11, 2026

Profile conversations and the main Messages tab now share an iPhone-inspired
blue/gray conversation UI with a system font, grouped bubbles, compact status,
and a pill composer. The main inbox groups both directions by person and opens
the conversation in place. Photo/video sending remains in the existing New
message attachment tools; existing private attachments open in conversations.

Outgoing text appears immediately as Sending, and is marked Sent only after a
validated server acknowledgement. Members can type their next draft while a send
is in flight. An uncertain send has a Retry action using the same exact payload
and request ID; polling can confirm it by its deterministic ID without duplicates.
Drafts and private data clear on account/session changes. Retired automatic
welcomes remain hidden. Unchanged bubbles, media and scroll position survive polls.

Open/visible conversations poll every five seconds and skip the unused member
directory. Opening a thread from Messages can show its already verified mailbox
snapshot immediately, while still rechecking the current server session. Server
message and commit reads are shared within each authenticated request. The text
send storage critical path uses six sequential waits versus eight previously in
an equal-round-trip harness; this is not a measured production latency percentage.
The per-IP/domain send limit is now 60 per minute, with auth and content limits
unchanged. Durable indexes/unread markers still precede the delivery commit.

Validation: 55 client tests passed; focused server/media tests passed 61 checks
with one expected real-SDK skip, and the final send-limit inbox suite passed 14
with one expected skip. Full build gate passed 188 checks with one expected skip;
final browser bundles were regenerated after the remaining tested UI changes.
Both page templates have exactly one shared dialog and updated asset versions.
The browser could not access the local preview server, and the production browser
is signed out; no real messages were sent and physical iPhone/Android keyboard or
latency testing was not available. The preview contained sample data only.

Earlier project notes follow.

---

# ROOSTER Messages update — September 11, 2026

The legacy automatic private welcome is retired. Messages now returns the exact
retired message IDs after checking the authenticated participant, delivery commit,
original system marker and deterministic message key. Both the inbox and inline
profile chat use those IDs to clear old messages already held in browser memory.
Polling, Refresh and loading older messages cannot add them back during the same
session. Selected welcome details and unread markers clear with the conversation;
real messages, older history and unfinished replies remain available.

The member inbox bundle and profile chat script have new versioned URLs. A page
opened before this release must load the new script once; subsequent message
refreshes reconcile retired items without reloading the whole page. New automatic
welcome DMs remain disabled. Public wall welcomes and the Your Connector friend
relationship keep their existing behavior.

Validation: 37 server tests passed with one expected optional SDK skip; all 43
inbox/profile-chat client tests passed. The production build passed with 186
checks and one expected skip. No private live messages were read or sent during
verification; the available live browser remained signed out.

Earlier project notes follow.

---

# ROOSTER member player and counter update — September 6, 2026

## Live status

The member player update is complete and published at
https://jwhitedidit.net in deploy `6a9d03ef8bf68d7612113f8d`.

The live release is `jspace-member-player-counters-20260906-v2`. The desktop
profile design remains intact, including Friends, Discover and the existing
navigation.

## Matching member players and counters

- Every public member profile now uses the same silver-and-black `ROOSTER PLAYER`
  design as J.White's player.
- The three-song limit and Apple Music, Spotify and YouTube link playback remain.
- Songs keep the visible `01`, `02` and `03` position numbers.
- Each song now shows its own ROOSTER play count.
- The player footer shows the real song total, Plays today and Total plays.
- A play is counted only from an intentional ROOSTER play or service action, never
  from page load or automatic iframe loading.
- Server receipts prevent the same song from being counted repeatedly by one
  browser session.
- Replacing a song gives the replacement a fresh zero count, so it cannot inherit
  the old song's plays.

## Music link repair

- The player is now named `ROOSTER PLAYER` with the modern dark ROOSTER treatment.
- Each member still gets no more than three song links and new audio uploads remain off.
- Spotify song links, official short share links and copied Spotify embeds are supported.
- Apple Music song links and copied Apple Music embeds are supported.
- YouTube watch, short, live and copied privacy-enhanced embed links are supported.
- Older directory-only and friend-only member profiles now use the same music rules as edited profiles.
- One malformed old song slot no longer hides the other songs and can be replaced normally.
- The selected player loads immediately without autoplay and always keeps an external service button.
- YouTube players stay at least 200 pixels tall on phones and desktop.

## Automatic J.White connection

- J.White automatically becomes every verified member's first friend, labeled Your Connector.
- Each member receives one automatic public wall welcome. Earlier saved wall wording remains valid.
- Automatic private welcome messages are retired, including older KON-NEKT wording. They no longer appear in inboxes, sent messages, or unread counts; onboarding creates no new welcome DM.
- Members may remove the automatic wall post, and a deletion tombstone prevents it from returning.
- Existing verified members receive the same setup lazily on their next authenticated profile, inbox or profile-save request.
- Friendships between ordinary members still require a request and acceptance.
- The automatic relationship does not grant private profile, message or account access.

## Simple member experience

- Phone navigation keeps Home, Discover, Friends, Messages, Chat and More immediately available.
- More contains My Profile, Music, My Photos, Wall, Friend Requests, Invite People, My Account and Booking.
- The signed-in phone account shows one tool at a time with a Back to My Account action.
- New members see a focused Start Here path for their profile, music, photos and discovery.
- Signup clearly explains the automatic J.White producer relationship and removable wall welcome.
- Member login keeps the accessible Show password and Hide password control.
- Friends, Discover, Invite People and the full desktop navigation remain available.

## Preserved features

- Modern ROOSTER PLAYER with at most three Apple Music, Spotify or YouTube track links
- Up to 10 optimized member photos with captions, filters, lightbox and navigation
- Existing video and 30-second clip behavior
- Private messages, member profiles, verification and presence
- Chat Room messages that disappear after 60 seconds
- Consent-based friend requests between members

## Validation

- Full local suite: 574 passed, 0 product failures, 1 optional fixture test skipped
- Focused music suite: 52 passed, 0 failed
- Production prebuild gate: 72 passed, 0 failed
- Production build: passed
- Netlify production deploy: passed with all 65 functions
- Live release script: passed
- Live public profile check: ROOSTER PLAYER, all three numbered songs, each song's
  play count, Plays today and Total plays rendered correctly

Signed-in production mutations and physical phone uploads still require ordinary
real-member use. Automated verification did not create accounts or alter live member data.
