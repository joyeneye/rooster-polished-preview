/** Read-only post-deploy check. Passing is not a member upload/playback test. */
import assert from 'node:assert/strict';
const origin = 'https://jwhitedidit.net';
const response = await fetch(`${origin}/release.json?verification=${Date.now()}`, {
  cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000),
});
assert.ok(response.ok, `Release metadata returned ${response.status}`);
const release = await response.json();
assert.equal(release.release, 'roster-rebrand-20260908-v1', 'An older release is still being served');
assert.equal(release.limits.song_links_per_member, 3);
assert.equal(release.limits.new_profile_song_uploads, false);
assert.equal(release.limits.album_photos, 10);
assert.equal(release.video_upload_bytes, 104857600);
assert.equal(release.chat_ttl_ms, 60000);
assert.equal(release.limits.opportunity_applications_per_ip_per_5_minutes, 6);
for (const feature of [
  'creator-opportunities-board',
  'opportunities-in-main-navigation',
  'featured-female-group-opportunity',
  'no-invite-code-creator-applications',
  'member-posted-opportunities',
  'opportunity-role-genre-location-mode-and-trending-filters',
  'poster-only-private-applications',
  'jwhite-your-connector',
  'automatic-jwhite-connector-and-first-roster-name',
  'automatic-removable-youre-connected-wall-welcome',
  'seven-choice-mobile-navigation',
  'mobile-one-tool-account',
  'desktop-profile-design-preserved',
  'roster-player-name',
  'owner-style-member-roster-player',
  'member-song-play-counters',
  'member-player-daily-and-lifetime-totals',
  'spotify-short-share-links',
  'copied-provider-embed-links',
  'legacy-member-music-link-repair',
  'corrupt-slot-recovery',
  'provider-player-fallback-links',
  'youtube-200px-player',
  'orange-unread-message-count-badges',
  'recipient-only-message-read-receipts',
  'unread-inbox-row-highlights',
  'place-for-people-header',
  'roster-name-and-connected-lineup-o-logo',
  'roster-red-gold-white-and-charcoal-palette',
  'ff6b00-orange-accents-on-ranks-dots-hover-active-and-badges',
  'the-roster-my-roster-and-top-rosters-vocabulary',
  'who-got-the-top-roster-chart-headline',
  'everybody-cant-be-on-the-roster-front-door',
]) assert.ok(release.features.includes(feature), `Missing published feature: ${feature}`);
const members = await fetch(`${origin}/members.html?verification=${Date.now()}`, {
  cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000),
});
assert.ok(members.ok, `Member page returned ${members.status}`);
const memberPage = await members.text();
assert.match(memberPage, /class="mobile-site-nav"/);
assert.match(memberPage, /data-my-friends/);
assert.match(memberPage, /J\.White becomes Your Connector and the first name on your roster/);
assert.match(memberPage, /You’re connected\. Let’s get it\./);
assert.match(memberPage, /TOP ROSTERS\. Who got the top roster this week\?/);
assert.match(memberPage, /Music profiles\. My Roster\. Top Rosters\. Live Chat\./);
assert.match(memberPage, /class="creator-promo"/);
assert.match(memberPage, /I’m looking for 3 female rappers \+ 1 female R&amp;B singer\./);
assert.match(memberPage, /Think you got what it takes\?/);
assert.match(memberPage, /\[Apply through (?:<span class="brand">)?ROOSTER(?:<\/span>)?\]/);
assert.match(memberPage, /href=["']\/apply(?:\.html)?\?opportunity=jspace-female-group-2026["']/);
assert.match(memberPage, /nav-opportunities/);
assert.match(memberPage, /opportunities\.css\?v=20260908-roster-v1/);
assert.match(memberPage, /songs\.css\?v=20260908-roster-v1/);
assert.match(memberPage, /members\.js\?v=20260908-roster-v1/);
assert.match(memberPage, /data-message-inbox/);
const profilePageResponse = await fetch(`${origin}/profile.html?verification=${Date.now()}`, {
  cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000),
});
assert.ok(profilePageResponse.ok, `Profile page returned ${profilePageResponse.status}`);
const profilePage = await profilePageResponse.text();
assert.match(profilePage, /music\.css\?v=20260908-roster-v1/);
assert.match(profilePage, /songs\.css\?v=20260908-roster-v1/);
assert.match(profilePage, /profile-songs\.js\?v=20260908-roster-v1/);
assert.match(profilePage, /a place for people\./);
// The rebrand only counts as shipped if the mark, the icons and the brand
// stylesheet are actually served, and if no music note survives anywhere.
assert.match(memberPage, /roster-brand\.css\?v=20260908-roster-v1/);
assert.match(memberPage, /class="wordmark-mark" src="\/roster-mark\.svg/);
assert.match(memberPage, /<span class="wordmark-text">R<span class="wordmark-o">O<\/span>STER<\/span>/);
assert.match(memberPage, /EVERYBODY CAN’T BE<\/span> <span>ON THE ROOSTER\./);
assert.match(memberPage, /Build your roster\. Find your people\. Make something happen\./);
assert.match(memberPage, /rel="icon" href="\/favicon\.svg/);
assert.match(memberPage, /rel="manifest" href="\/site\.webmanifest/);
assert.match(memberPage, /<meta name="theme-color" content="#E31837">/);
assert.doesNotMatch(memberPage, /\u266a|\u266b|\u266c/, 'the music note must be gone from the member page');
assert.doesNotMatch(profilePage, /\u266a|\u266b|\u266c/, 'the music note must be gone from the profile page');
// No retired brand may survive on a served page. The internal slugs and hash
// seeds that keep existing member data addressable are lowercase `jspace-` and
// `jspace:`, so only the display spellings are checked here.
const chartResponse = await fetch(`${origin}/top25.html?verification=${Date.now()}`, {
  cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000),
});
assert.ok(chartResponse.ok, `Top Rosters page returned ${chartResponse.status}`);
const chartPage = await chartResponse.text();
assert.match(chartPage, /<h1 id="top25-heading">WHO GOT THE TOP ROOSTER\?<\/h1>/);
assert.match(chartPage, /TOP ROSTERS &middot; THE 25 MOST VISITED PAGES THIS WEEK/);
for (const [label, page] of [['member page', memberPage], ['profile page', profilePage], ['Top Rosters page', chartPage]]) {
  assert.doesNotMatch(page, /JSPACE|KON-NEKT|kon-nekt\./, `a retired brand is still on the ${label}`);
}
for (const [label, path] of [
  ['brand stylesheet', '/roster-brand.css'],
  ['brand mark', '/roster-mark.svg'],
  ['favicon', '/favicon.svg'],
  ['app icon', '/roster-icon-192.png'],
  ['home screen icon', '/apple-touch-icon.png'],
  ['web manifest', '/site.webmanifest'],
]) {
  const asset = await fetch(`${origin}${path}?verification=${Date.now()}`, {
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000),
  });
  assert.ok(asset.ok, `The ${label} returned ${asset.status}`);
}
const manifest = await (await fetch(`${origin}/site.webmanifest?verification=${Date.now()}`, {
  cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000),
})).json();
assert.equal(manifest.name, 'ROOSTER');
assert.match(manifest.description, /Everybody can't be on the ROOSTER\./);
assert.equal(manifest.theme_color, '#E31837');
assert.equal(manifest.background_color, '#FFF8E6');
await Promise.all([
  ['profile player', '/profile-songs.js', [/ROOSTER PLAYER/, /READY TO PLAY/, /enablejsapi=1/, /Open in /, /member-music-plays/, /retro-track-plays/, /Plays today:/]],
  ['member music editor', '/members.js', [/spotify\.link/, /embed\.music\.apple\.com/, /youtube-nocookie\.com/, /ROOSTER PLAYER/]],
  ['music styles', '/songs.css', [/min-height:200px/, /member-profile-player/, /member-profile-track/]],
  ['message badges', '/community.js', [/member-messages\/unread/, /message-unread-badge/, /jwhite:messages-changed/, /99\+/]],
  ['message badge styles', '/style.css', [/message-unread-badge/, /#e5092f/, /prefers-reduced-motion:reduce/]],
  ['member inbox read state', '/members.js', [/member-messages\/read/, /mail-new-badge/, /is-unread/]],
].map(async ([name, path, expected]) => {
  const asset = await fetch(`${origin}${path}?verification=${Date.now()}`, {
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000),
  });
  assert.ok(asset.ok, `${name} returned ${asset.status}`);
  const source = await asset.text();
  for (const pattern of expected) assert.match(source, pattern, `${name} is older than this release`);
  if (name === 'profile player') assert.doesNotMatch(source, /MYSPACE PLAYER/);
}));
const directoryResponse = await fetch(`${origin}/api/members?offset=0&limit=1&q=`, {
  cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000),
});
assert.equal(directoryResponse.status, 401, 'Anonymous member directory must require a signed-in approved member');
assert.match(directoryResponse.headers.get('content-type') || '', /application\/json/);
const ownerProfileResponse = await fetch(`${origin}/api/profile?id=owner&verification=${Date.now()}`, {
  cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000),
});
assert.ok(ownerProfileResponse.ok, `Public owner profile returned ${ownerProfileResponse.status}`);
const ownerProfile = await ownerProfileResponse.json();
assert.equal(ownerProfile.profile?.verified_owner, true, 'Public owner profile returned invalid JSON');
for (const path of ['/profile?id=owner', '/profile.html?id=owner']) {
  const pageResponse = await fetch(`${origin}${path}&verification=${Date.now()}`, {
    cache: 'no-store', redirect: 'follow', signal: AbortSignal.timeout(20000),
  });
  assert.ok(pageResponse.ok, `${path} returned ${pageResponse.status}`);
  assert.match(pageResponse.headers.get('content-type') || '', /text\/html/);
}
const publishedOwnerId = ownerProfile.profile?.id;
assert.match(publishedOwnerId || '', /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i, 'Owner profile is missing its member binding');
const musicResponse = await fetch(`${origin}/api/member-songs?id=${encodeURIComponent(publishedOwnerId)}`, {
  cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000),
});
assert.ok(musicResponse.ok, `Published owner music returned ${musicResponse.status}`);
const music = await musicResponse.json();
assert.equal(music.max_songs, 3);
assert.ok(Array.isArray(music.songs), 'Published owner music returned an invalid list');
const countsResponse = await fetch(`${origin}/api/member-music-plays?id=${encodeURIComponent(publishedOwnerId)}`, {
  cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000),
});
assert.ok(countsResponse.ok, `Published owner play counts returned ${countsResponse.status}`);
const counts = await countsResponse.json();
assert.equal(counts.max_songs, 3);
assert.ok(counts.counts && typeof counts.counts === 'object' && !Array.isArray(counts.counts), 'Owner play counts returned an invalid map');
assert.ok(Number.isSafeInteger(counts.total) && counts.total >= 0, 'Owner total plays are invalid');
assert.ok(Number.isSafeInteger(counts.today) && counts.today >= 0, 'Owner daily plays are invalid');
for (const [label, path] of [
  ['member profile', '/api/profile?id=00000000-0000-4000-8000-000000000000'],
  ['own profile', '/api/profile/me'],
]) {
  const gated = await fetch(`${origin}${path}`, {
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: {Accept:'application/json'},
  });
  assert.equal(gated.status, 401, `Anonymous ${label} must require a signed-in approved member`);
  assert.match(gated.headers.get('content-type') || '', /application\/json/);
}
const route = await fetch(`${origin}/api/media-jobs/${'0'.repeat(64)}`, {
  redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000),
});
assert.equal(route.status, 401, 'The job route must be deployed and require a signed in member');
assert.match(route.headers.get('content-type') || '', /application\/json/);
const unreadRoute = await fetch(`${origin}/api/member-messages/unread?verification=${Date.now()}`, {
  redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000),
});
assert.equal(unreadRoute.status, 401, 'The unread count route must require a signed in member');
assert.equal(unreadRoute.headers.get('cache-control'), 'private, no-store');
const readRoute = await fetch(`${origin}/api/member-messages/read`, {
  method:'POST', redirect:'error', cache:'no-store', signal:AbortSignal.timeout(20000),
  headers:{Origin:origin,'Content-Type':'application/json'}, body:JSON.stringify({message_id:'0'.repeat(64)}),
});
assert.equal(readRoute.status, 401, 'The mark read route must require a signed in member');
const opportunitiesPageResponse = await fetch(`${origin}/opportunities.html?verification=${Date.now()}`, {
  cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000),
});
assert.ok(opportunitiesPageResponse.ok, `Opportunities page returned ${opportunitiesPageResponse.status}`);
const opportunitiesPage = await opportunitiesPageResponse.text();
for (const pattern of [
  /Connect\. Collaborate\. Find opportunities\. Build\./, /data-opportunity-board/,
  /name="role"/, /name="genre"/, /name="place"/, /name="mode"/,
  /data-sort="newest"/, /data-sort="trending"/, /data-opportunity-post/,
  /opportunities\.js\?v=20260908-roster-v1/, /class="site-footer"/,
]) assert.match(opportunitiesPage, pattern, 'The published opportunities board is older than this release');
const applyPageResponse = await fetch(`${origin}/apply.html?verification=${Date.now()}`, {
  cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000),
});
assert.ok(applyPageResponse.ok, `Creator Application returned ${applyPageResponse.status}`);
const applyPage = await applyPageResponse.text();
for (const pattern of [
  /You do not need an invite code to apply/, /name="age_confirmed"/, /name="artist_name"/,
  /name="can_perform"/, /name="will_travel"/, /name="pitch"/, /name="performance_video"/,
  /Your application is in\. If it’s a fit, we’ll connect\. Welcome to the ROOSTER/,
  /apply-client\.js\?v=20260908-roster-v1/,
]) assert.match(applyPage, pattern, 'The published Creator Application is older than this release');
const optionsRoute = await fetch(`${origin}/api/opportunities/options?verification=${Date.now()}`, {
  cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000),
});
assert.ok(optionsRoute.ok, `Opportunity options returned ${optionsRoute.status}`);
const vocabulary = await optionsRoute.json();
assert.equal(vocabulary.featured_slug, 'jspace-female-group-2026');
assert.ok(vocabulary.poster_roles.some(role => role.value === 'producer'), 'The published board is missing the producer role');
assert.ok(vocabulary.seeking_roles.some(role => role.value === 'placements'), 'The published board is missing songwriter placements');
const boardRoute = await fetch(`${origin}/api/opportunities?sort=trending`, {
  cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000),
});
assert.ok(boardRoute.ok, `The opportunity board returned ${boardRoute.status}`);
const board = await boardRoute.json();
assert.ok(Array.isArray(board.opportunities), 'The opportunity board returned an invalid list');
const featuredRoute = await fetch(`${origin}/api/opportunity?slug=jspace-female-group-2026`, {
  cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000),
});
assert.ok(featuredRoute.ok, `The featured opportunity returned ${featuredRoute.status}`);
const featured = await featuredRoute.json();
assert.equal(featured.opportunity.status, 'open', 'The featured opportunity is not open');
assert.equal(featured.opportunity.headline, 'I’m looking for 3 female rappers + 1 female R&B singer.');
assert.deepEqual(featured.opportunity.lanes, ['Female Rapper', 'Female R&B Singer']);
// Applying has to stay open to somebody without an account or an invite code,
// so this rejected body must come back as a validation error, never as a 401.
const applyRoute = await fetch(`${origin}/api/opportunity/apply`, {
  method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000),
  headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({}),
});
assert.equal(applyRoute.status, 400, 'Applying must be open to visitors and reject an incomplete application');
for (const [name, path] of [
  ['post', '/api/opportunity/post'],
  ['close', '/api/opportunity/close'],
]) {
  const memberOnly = await fetch(`${origin}${path}`, {
    method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000),
    headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({}),
  });
  assert.equal(memberOnly.status, 401, `The opportunity ${name} route must require a signed in member`);
}
const applicationsRoute = await fetch(`${origin}/api/opportunity/applications?slug=jspace-female-group-2026`, {
  redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000),
});
assert.equal(applicationsRoute.status, 401, 'Applications must never be readable without a signed in member');
console.log('The ROOSTER Creator Opportunities board, the featured female group opportunity and the no-invite-code application are published.');
console.log('J.White is published as Your Connector and the automatic first name on every roster.');
console.log('The orange #FF6B00 accents, the ROOSTER wordmark with the connected O and the place-for-people header are published.');
console.log('Real signed-in link saves, provider playback, phone video processing and member mutations still need live verification.');
