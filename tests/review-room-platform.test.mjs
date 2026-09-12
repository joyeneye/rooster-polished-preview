import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Review Room is published in primary navigation, the member back office, and release pipeline', async () => {
  const [home, members, build] = await Promise.all([read('index.html'), read('members.html'), read('build.mjs')]);
  // The front page runs the app shell now: a desktop rail, the five-item phone
  // bar, and the All of ROOSTER sheet that phones reach from the header. Review
  // Room is published in the rail and in the sheet, and both keep the
  // .nav-review-room hook the styling and the release check look for.
  const homeRail = home.match(/<aside class="community-rail[\s\S]*?<\/aside>/)?.[0] || '';
  const homeSheet = home.match(/<dialog id="mobile-more-sheet"[\s\S]*?<\/dialog>/)?.[0] || '';
  assert.match(homeRail, /<a class="nav-review-room" href="\/review-room\.html">Review Room<\/a>/);
  assert.match(homeSheet, /<a class="nav-review-room" href="\/review-room\.html">REVIEW ROOM<\/a>/);
  assert.match(members, /Review Room Back Office/);
  assert.match(members, /href="\/review-room\.html"/);
  assert.match(build, /review-room\.html/);
  assert.match(build, /review-room\.js/);
});

test('Review Room persists tenant queues, reviews, pricing, and transactions', async () => {
  const [schema, migration] = await Promise.all([
    read('db/schema.ts'),
    read('netlify/database/migrations/20260909041212_create_review_room_platform/migration.sql'),
  ]);
  for (const table of ['review_workspaces','review_reviewers','review_pricing_tiers','review_submissions','review_queue_entries','review_reviews','review_transactions']) {
    assert.match(schema, new RegExp(table.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()).replace(/^review/, 'review'), 'i'));
    assert.match(migration, new RegExp(`CREATE TABLE "${table}"`));
  }
});

test('Queue ordering is data-driven and artist audio stays protected', async () => {
  const source = await read('netlify/functions/_shared/review-room.mts');
  assert.match(source, /priorityWeight/);
  assert.match(source, /orderBy\(desc\(reviewQueueEntries\.priorityScore\)/);
  assert.match(source, /reviewerId/);
  assert.match(source, /This audio is private to the artist and reviewer/);
  assert.match(source, /visibility === "public"/);
});

test('Revenue stays in the private back office and broadcasting points at ROOSTER LIVE', async () => {
  const [page, client, styles] = await Promise.all([
    read('review-room.html'),
    read('review-room.js'),
    read('review-room.css'),
  ]);
  const room = page.match(/data-panel="room"[\s\S]*?data-panel="submit"/)?.[0] || '';
  const office = page.match(/data-panel="office"[\s\S]*$/)?.[0] || '';
  assert.doesNotMatch(room, /ROOM REVENUE|rr-stat-revenue|rr-stat-pending/);
  assert.match(office, /REVENUE REPORT/);
  assert.match(office, /rr-office-revenue/);

  // Video LIVE and audio Rooms are their own experiences. The Review Room
  // links to them instead of pretending to broadcast, so there is no camera
  // request anywhere in this page's script.
  assert.match(page, /href="\/live\.html"/);
  assert.doesNotMatch(page, /data-panel="live"|PHONE OR WEBCAM|OBS \+ STREAMLABS|Available after provider connection/);
  assert.doesNotMatch(client, /getUserMedia|getDisplayMedia|RTCPeerConnection/);

  // The listening space itself: one player with real progress, one queue
  // with an honest empty state, and the feedback tools in compact tabs.
  for (const id of ['rr-art','rr-now-title','rr-seek','rr-duration','rr-play','rr-audio-player','rr-queue-list','rr-tab-review','rr-tab-results']) {
    assert.match(page, new RegExp(`id="${id}"`));
  }
  assert.match(page, /No tracks in the queue yet\./);
  assert.match(client, /audio\.duration/);
  assert.match(client, /permissions\?\.admin/);

  // Light tokens, not the old dark shell, and primary targets stay tappable.
  assert.match(styles, /var\(--r-surface/);
  assert.match(styles, /min-height: 44px/);
  assert.doesNotMatch(styles, /font-family:Arial,Helvetica,sans-serif/);
});
