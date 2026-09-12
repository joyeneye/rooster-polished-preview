import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  FEATURED_SLUG,
  GENRES,
  POSTER_ROLES,
  SEEKING_ROLES,
  WORK_MODES,
  opportunityVocabulary,
} from '../netlify/functions/_shared/opportunities.mts';
import { config as listConfig } from '../netlify/functions/opportunities-list.mts';
import { config as optionsConfig } from '../netlify/functions/opportunity-options.mts';
import { config as getConfig } from '../netlify/functions/opportunity-get.mts';
import { config as applyConfig } from '../netlify/functions/opportunity-apply.mts';
import { config as postConfig } from '../netlify/functions/opportunity-post.mts';
import { config as applicationsConfig } from '../netlify/functions/opportunity-applications.mts';
import { config as closeConfig } from '../netlify/functions/opportunity-close.mts';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = name => readFileSync(resolve(root, name), 'utf8');
const CONFIRMATION = 'Your application is in. If it’s a fit, we’ll connect. Welcome to the ROOSTER';

test('the opportunity vocabulary covers every collaboration the board is for', async () => {
  const response = opportunityVocabulary();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.featured_slug, FEATURED_SLUG);
  for (const role of ['artist', 'producer', 'songwriter', 'engineer', 'dj', 'manager_anr', 'videographer']) {
    assert.ok(POSTER_ROLES.some(entry => entry.value === role), `a ${role} must be able to post`);
  }
  // The ten collaborations J.White named all have to be expressible as a pair.
  for (const seeking of ['producer', 'artist', 'songwriter', 'engineer', 'dj', 'talent', 'placements', 'clients', 'remixes', 'videographer']) {
    assert.ok(SEEKING_ROLES.some(entry => entry.value === seeking), `looking for a ${seeking} must be expressible`);
  }
  assert.deepEqual(WORK_MODES.map(mode => mode.value), ['either', 'remote', 'in_person']);
  for (const genre of ['Hip-Hop', 'R&B', 'Any']) assert.ok(GENRES.includes(genre));
  assert.deepEqual(body.work_modes.map(mode => mode.value), ['either', 'remote', 'in_person']);
});

test('reading the board is public and only the private routes sit behind a member', () => {
  assert.deepEqual(
    [listConfig, optionsConfig, getConfig].map(config => [config.path, config.method]),
    [['/api/opportunities', 'GET'], ['/api/opportunities/options', 'GET'], ['/api/opportunity', 'GET']],
  );
  assert.equal(applyConfig.path, '/api/opportunity/apply');
  assert.equal(applyConfig.method, 'POST');
  // Applying takes no account and no invite code, so the rate limit is the gate.
  assert.ok(applyConfig.rateLimit.windowLimit <= 10, 'the open apply route needs a tight rate limit');
  assert.ok(applyConfig.rateLimit.windowSize >= 300, 'the open apply route needs a wide rate limit window');
  assert.deepEqual(applyConfig.rateLimit.aggregateBy, ['ip', 'domain']);
  for (const config of [postConfig, applicationsConfig, closeConfig]) {
    assert.ok(config.rateLimit.windowLimit > 0);
    assert.deepEqual(config.rateLimit.aggregateBy, ['ip', 'domain']);
  }
  assert.equal(applicationsConfig.path, '/api/opportunity/applications');
  assert.equal(closeConfig.path, '/api/opportunity/close');
  assert.equal(postConfig.path, '/api/opportunity/post');
  const source = read('netlify/functions/_shared/opportunities.mts');
  // Applications belong to the person who posted, never to the whole board.
  assert.match(source, /if \(!member\.isOwner && row\.postedByMemberId !== member\.id\)/);
  assert.match(source, /Applications are private to the person who posted this\./);
  assert.match(source, /assertSameOrigin\(req\)/);
});

test('the featured opportunity is seeded once with the group J.White is building', () => {
  const source = read('netlify/functions/_shared/opportunities.mts');
  assert.equal(FEATURED_SLUG, 'jspace-female-group-2026');
  assert.match(source, /I’m looking for 3 female rappers \+ 1 female R&B singer\./);
  assert.match(source, /lanes: \["Female Rapper", "Female R&B Singer"\]/);
  assert.match(source, /postedByName: "J\.White Did It"/);
  assert.match(source, /onConflictDoNothing\(\{ target: opportunities\.slug \}\)/);
  assert.ok(source.includes(CONFIRMATION), 'the server must answer with the exact confirmation sentence');
});

test('the signup page promotes the opportunity in J.White’s words and links to the application', () => {
  const html = read('members.html');
  const start = html.indexOf('class="creator-promo"');
  assert.ok(start > 0, 'the signup page needs the Creator Opportunity promo card');
  const promo = html.slice(start, html.indexOf('</section>', start));
  assert.match(promo, /(?:<span class="brand">)?ROOSTER(?:<\/span>)? Creator Opportunity/i);
  assert.match(promo, /I’m looking for 3 female rappers \+ 1 female R&amp;B singer\./);
  assert.match(promo, /Think you got what it takes\?/);
  assert.match(promo, /\[Apply through (?:<span class="brand">)?ROOSTER(?:<\/span>)?\]/i);
  assert.match(promo, /href="\/apply\.html\?opportunity=jspace-female-group-2026"/);
  assert.match(promo, /No invite code needed to apply/i);
  assert.match(html, /A social network built for the people who create music\./);
  assert.match(html, /Connect\. Collaborate\. Find opportunities\. Build\./);
  // The promo must not push the signup form itself further down the phone view.
  assert.ok(start < html.indexOf('id="member-signup"'), 'the promo belongs above the signup form, in the front door');
  assert.match(read('index.html'), /class="creator-promo"/);
});

test('the application asks everything J.White asked for and needs no invite code', () => {
  const html = read('apply.html');
  for (const field of [
    'name', 'artist_name', 'city', 'region', 'age_confirmed', 'instagram', 'tiktok',
    'contact_email', 'streaming_links', 'work_samples', 'performance_video',
    'can_perform', 'will_travel', 'pitch',
  ]) {
    assert.match(html, new RegExp(`name="${field}"`), `the application is missing ${field}`);
  }
  assert.match(html, /I confirm I am 18 or older\./);
  assert.match(html, /Can you dance or perform\?/);
  assert.match(html, /Are you willing to travel\?/);
  assert.match(html, /Why should you be part of this group\?/);
  assert.match(html, /Spotify, Apple Music or YouTube links/);
  assert.match(html, /You do not need an invite code to apply/i);
  assert.ok(html.includes(CONFIRMATION), 'the application page must show the exact confirmation sentence');
  assert.doesNotMatch(html, /invite[_-]?code"/, 'applying must not ask for an invite code');

  const client = read('apply-client.js');
  assert.match(client, /\/api\/opportunity\/apply/);
  assert.match(client, /opportunity=jspace-female-group-2026|jspace-female-group-2026/);
  // The confirmation the applicant reads is the server's, not a local guess.
  assert.match(client, /doneMessage.*result\.message/);
  assert.match(client, /Add an Instagram, a TikTok or an email so we can reach you\./);
  assert.match(client, /textContent/, 'opportunity copy has to be written as text, never as markup');
  assert.doesNotMatch(client, /innerHTML/);
});

test('the board filters by role, genre, location, remote or in person, and newest or trending', () => {
  const html = read('opportunities.html');
  for (const field of ['role', 'genre', 'place', 'mode']) {
    assert.match(html, new RegExp(`name="${field}"`), `the filter bar is missing ${field}`);
  }
  assert.match(html, /data-sort="newest"/);
  assert.match(html, /data-sort="trending"/);
  assert.match(html, /Connect\. Collaborate\. Find opportunities\. Build\./);

  const client = read('opportunities.js');
  assert.match(client, /\/api\/opportunities\/options/);
  assert.match(client, /params\.set\('sort', sort\)/);
  assert.match(client, /params\.set\('place'/);
  assert.doesNotMatch(client, /innerHTML/);

  const server = read('netlify/functions/_shared/opportunities.mts');
  assert.match(server, /eq\(opportunities\.seekingRole, pick\(role/);
  assert.match(server, /eq\(opportunities\.genre, pick\(genre/);
  assert.match(server, /ilike\(opportunities\.city, `%\$\{place\}%`\), ilike\(opportunities\.region, `%\$\{place\}%`\)/);
  // A remote-or-in-person posting has to answer both sides of that filter.
  assert.match(server, /if \(chosen !== "either"\) filters\.push\(or\(eq\(opportunities\.workMode, chosen\), eq\(opportunities\.workMode, "either"\)\)/);
  assert.match(server, /desc\(opportunities\.featured\)/);
  assert.match(server, /applicationCount\} \* 3 \+ \$\{opportunities\.viewCount\}/);
  assert.match(server, /eq\(opportunities\.status, "open"\)/);
});

test('members can post the collaborations J.White listed and keep their applications private', () => {
  const html = read('opportunities.html');
  const signedOut = html.slice(html.indexOf('data-opportunity-signed-out'), html.indexOf('data-opportunity-post'));
  for (const pair of [
    /Artist looking for a producer, or a producer looking for an artist/,
    /songwriter/i, /placements/i, /mixing or mastering engineer/i,
    /DJ looking for artists or remixes/, /Manager or A&amp;R looking for talent/,
    /Videographer or photographer looking for artists/,
  ]) assert.match(signedOut, pair);
  assert.match(html, /data-opportunity-post/);
  assert.match(html, /name="poster_role"/);
  assert.match(html, /name="seeking_role"/);
  const client = read('opportunities.js');
  assert.match(client, /\/api\/opportunity\/post/);
  assert.match(client, /\/api\/opportunity\/applications/);
  assert.match(client, /\/api\/opportunity\/close/);
  assert.match(client, /These are private to you\./);
  // The posting form and the applications panel only exist for a signed in member.
  assert.match(client, /\/api\/profile\/me/);
  assert.match(client, /postPanel\.hidden = !me/);
});

test('OPPORTUNITIES has a page, its own styles, and ships with the site', () => {
  const build = read('build.mjs');
  for (const file of ['opportunities.html', 'opportunities.css', 'opportunities.js', 'apply.html', 'apply-client.js']) {
    assert.ok(build.includes(`'${file}'`), `${file} has to ship with the site`);
  }
  for (const page of ['opportunities.html', 'apply.html']) {
    const html = read(page);
    assert.match(html, /opportunities\.css\?v=[\w.-]+/);
    assert.match(html, /class="site-nav"/);
    assert.match(html, /class="mobile-site-nav"/);
    assert.match(html, /class="site-footer"/);
  }
  const css = read('opportunities.css');
  assert.match(css, /\.creator-promo-apply\{[^}]*min-height:4[4-9]px/, 'the apply button needs a phone-safe touch target');
  assert.match(css, /\.apply-submit\{[^}]*min-height:4[4-9]px/);
  assert.match(css, /\.opportunity-apply-link\{[^}]*min-height:44px/);
  assert.match(read('style.css'), /\.site-nav \.nav-opportunities\{/);
});

test('J.White is Your Connector and still the automatic first name on every roster', () => {
  const wall = read('netlify/functions/_shared/member-wall.mts');
  assert.match(wall, /const message='You’re connected\. Let’s get it\.';/);
  // The earlier wording stays valid so an existing welcome is neither rejected
  // nor reposted to somebody who removed theirs.
  assert.match(wall, /const legacy='LET’S WORK!';/);
  assert.match(wall, /saved\.message===legacy&&saved\.input_digest===legacyDigest/);
  assert.match(wall, /jspace:owner-wall-welcome:v1:/);

  const friends = read('netlify/functions/_shared/friends.mts');
  assert.match(friends, /already the first name on your roster and Your Connector/);
  assert.doesNotMatch(friends, /your producer/);

  const messages = read('netlify/functions/_shared/member-messages.mts');
  assert.doesNotMatch(messages, /I’m Your Connector on here/);
  assert.doesNotMatch(messages, /I’m your producer/);
  assert.doesNotMatch(read('netlify/functions/_shared/member-welcome.mts'), /deliverMemberWelcome/);

  const widget = read('friend-widget.js');
  assert.match(widget, /Your Connector · View Profile »/);
  assert.match(widget, /J\.White Is Your Connector/);
  assert.doesNotMatch(widget, /Your Producer/);
  assert.doesNotMatch(read('profile.html'), /My producer: JWhite/);
});

test('the social features ROOSTER already had are all still in the navigation', () => {
  for (const page of ['index.html', 'members.html', 'opportunities.html']) {
    const html = read(page);
    for (const destination of [
      '/opportunities.html', '/top25.html', '/people.html', '/morespace.html',
      '/members.html#member-chat', '/members.html#member-mail', '/my-profile.html',
      '/my-profile.html?view=photos', '/members.html#friend-requests',
    ]) {
      assert.ok(html.includes(`href="${destination}"`), `${page} lost ${destination}`);
    }
    // The owner's own page links to its own sections, so the leading slash is
    // only there on the pages that have to travel back to it. The front page is
    // the For You feed now rather than his page, so it names the page his
    // sections are actually rendered on.
    for (const section of ['jwhite-friend-space', 'music', 'comments']) {
      assert.match(html, new RegExp(`href="(/?|/jwhite\\.html)#${section}"`), `${page} lost #${section}`);
    }
  }
});
