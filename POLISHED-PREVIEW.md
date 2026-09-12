# ROOSTER polished website preview

Client source: Netlify main at `7866f7d98378109051f99277756b4580d5c9652a`.
Feature branch: `codex/cohesive-client-site`.
Separate Vercel project: `rooster-polished` (joyeneyes-projects).

## Design scope

Preserve the client's current ROOSTER mark, squared display typography, WYD feed,
Top 8, member profiles, Rooms (video, audio, music reviews and chat), ORBIT radio,
Top Rosters, opportunities, booking marketplace, creator manager and MONA.

One original light cream / red / orange / gold system now wraps the original page controllers.
The shared header and mobile navigation are injected during the build. More
contains the secondary destinations, original theme control and account links.
Cards, forms, typography, dialogs, spacing and mobile layouts share one stylesheet.
No native iOS files are changed; website review comes before app alignment.

## Isolation

This deployment has no Netlify credentials or private data export. The API bridge
forwards anonymous GET/HEAD requests to the original site, strips account headers,
refuses POST/PUT/PATCH/DELETE/OPTIONS, refuses non-API paths and does not follow
upstream redirects. Requests time out after 15 seconds. No authentication cookies
are copied back. The original domain, source repository and Vercel comparisons
are not deployed over.

Approved-account content in the latest source is gated: the WYD feed and member
profiles cannot be visually verified with private data in this anonymous preview.
Account sign-in, posting, private conversations, bookings/payment, uploads and
broadcasting are not migrated. The original services remain the place to use
those features. No preview action was submitted to the live site during QA.

## Verification

- Public build succeeds; existing editor packaging check passes.
- Function syntax validation passes for 211 source files.
- Nine preview tests verify all 24 primary built pages receive the shared layer,
  mutation refusal, credential stripping, HEAD behavior, path boundaries and
  upstream error handling, nested Vercel routing and readable account-gate responses.
- Browser inspected desktop and 390px phone layouts; 15 primary routes had one
  shared header/navigation and no horizontal document overflow.
- Fixed duplicate legacy rail, white Top 8 heading, clipped room descriptions,
  overlapping mobile booking navigation and displaced profile columns.
- Original data gates remain visible. Live authenticated transactions and native
  app parity are deliberately outside this design preview's validation.

Client palette follow-up: retain #f6f5f1 backgrounds, white cards, #ce0633 red,
#ff7a3d orange and #ffbf46 gold. Dark mode remains an optional original control,
not the default design. Large profile/account/booking panels stay light.

The shareable comparison address is https://rooster-polished-preview.vercel.app/.
This isolated project has no Vercel sign-in wall. Original ROOSTER membership
checks still apply at the source. Nested API routes use an explicit Vercel rewrite
to the single read-only preview gateway.
