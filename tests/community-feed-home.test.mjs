import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('the front page is the community hub and preserves core platform routes', async () => {
  const html = await read('index.html');
  assert.match(html, /id="community-feed"/);
  // For You and Following are the top-level feed tabs now; the remaining
  // primary filters stay in the Board sort menu.
  assert.match(html, /data-feed-view="for_you"/);
  assert.match(html, /data-feed-view="following"/);
  assert.match(html, /data-feed-filter="trending"/);
  assert.match(html, /data-connection-filter="businesses"/);
  assert.match(html, /data-open-composer/);
  assert.match(html, /\/live\.html/);
  assert.match(html, /Rooms — LIVE, audio, review \+ chat/);
  assert.match(html, /\/booking/);
  assert.match(html, /roster-live\.css/);
  assert.match(html, /roster-live\.js/);
});

test('the browser uses the protected cursor feed endpoint', async () => {
  const client = await read('community-home.js');
  assert.match(client, /\/api\/community\/feed/);
  assert.match(client, /next_cursor/);
  assert.match(client, /method: 'PATCH'/);
  assert.match(client, /method: 'POST'/);
  assert.match(client, /method: 'DELETE'/);
  assert.match(client, /data-post-action="delete"/);
  assert.doesNotMatch(client, /localStorage/);
});

test('the social schema is migration-backed and connected to booking and rooms', async () => {
  const schema = await read('db/schema.ts');
  const migration = await read('netlify/database/migrations/20260909170001_create_social_community_feed/migration.sql');
  for (const table of ['social_posts', 'social_post_media', 'social_comments', 'social_likes', 'social_reposts', 'social_follows', 'social_connections', 'social_notifications', 'social_reports']) {
    assert.match(migration, new RegExp(`CREATE TABLE "${table}"`));
  }
  assert.match(migration, /booking_business_id/);
  assert.match(migration, /room_id/);
  assert.match(schema, /export const socialPosts/);
  assert.match(schema, /references\(\(\) => bookingBusinesses\.id\)/);
});

test('the feed endpoint enforces membership and server-side visibility', async () => {
  const endpoint = await read('netlify/functions/community-feed.mts');
  const feed = await read('netlify/functions/_shared/social-feed.mts');
  assert.match(endpoint, /resolveCommunityProfileMember/);
  assert.match(endpoint, /assertSameOrigin/);
  assert.match(feed, /socialPosts\.visibility/);
  assert.match(feed, /socialBlocks/);
  assert.match(feed, /socialMutes/);
  assert.match(feed, /strictFollowing/);
  assert.match(feed, /notInArray\(socialPosts\.authorId/);
  assert.match(endpoint, /deleteSocialPost/);
  assert.match(feed, /can_delete/);
  assert.match(feed, /status: "deleted"/);
  assert.match(feed, /row\.authorId === member\.id\)/);
  assert.match(feed, /if \(post\.authorId !== member\.id\) throw new MemberError\(403/);
  assert.doesNotMatch(feed, /post\.authorId !== member\.id && member\.isOwner/);
});

test('WYD reads hydrate every visible author and new posts use the same profile resolver', async () => {
  const endpoint = await read('netlify/functions/community-feed.mts');
  const feed = await read('netlify/functions/_shared/social-feed.mts');
  assert.match(endpoint, /getSocialFeed\(req, member, \{ profiles: profileStore\(context\) \}, clipsStore\(context\)\)/);
  assert.match(endpoint, /hydrateFeedAuthors\(req,/);
  assert.match(feed, /hydrateFeedAuthors\(req, visibleRows\.map/);
  assert.doesNotMatch(feed, /authorPhotoUrl: currentPhotoUrl/, 'reading WYD no longer repairs only the viewer posts');
});

test('the FYP lets an author delete only their own post', async () => {
  const client = await read('community-home.js');
  const stage = client.slice(client.indexOf('function stagePanelMarkup'), client.indexOf('function stagePause'));
  assert.match(stage, /post\.viewer\.can_delete/);
  assert.match(stage, /data-post-action="delete"/);
});

test('posting keeps the form reference across the async save and shows a clean success state', async () => {
  const client = await read('community-home.js');
  const submit = client.slice(client.indexOf("document.querySelector('#post-form').addEventListener"), client.indexOf("document.querySelector('#comment-form').addEventListener"));
  assert.match(submit, /const form = event\.currentTarget/);
  assert.match(submit, /form\.reset\(\)/);
  assert.doesNotMatch(submit, /event\.currentTarget\.reset/);
  assert.match(submit, /Posted ✓/);
  assert.match(submit, /stageColumn\.insertAdjacentHTML\('afterbegin'/);
});

test('For You learns from viewing and stronger interactions while preserving discovery', async () => {
  const client = await read('community-home.js');
  const feed = await read('netlify/functions/_shared/social-feed.mts');
  assert.match(client, /action: 'view', watch_ms: 2500/);
  assert.match(client, /stage\.learned\.has/);
  assert.match(feed, /function learnInterest/);
  assert.match(feed, /personalizeFeedRows/);
  assert.match(feed, /result\.length % 5 === 4/);
  assert.match(feed, /action === "bookmark" \|\| action === "repost" \? 3 : 2/);
});

test('ROOSTER PULSE creates an honest fresh-drop catch-up loop', async () => {
  const [html, client, css] = await Promise.all([read('index.html'), read('community-home.js'), read('slots.css')]);
  assert.match(html, /id="rooster-pulse"/);
  assert.match(html, /role="progressbar"/);
  assert.match(client, /function paintPulse/);
  assert.match(client, /Math\.min\(8, stage\.panels\.length\)/);
  assert.match(client, /stage\.caught\?\.add/);
  assert.match(css, /\.rooster-pulse\{/);
});
