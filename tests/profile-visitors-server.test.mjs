import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  getProfileVisitors, postProfileVisit, getTopTwentyFive, getFeaturedProfile, getVisitorRecap,
  rolloverWeeks, chicagoWeek, previousWeek, rankTotals, CHART_SIZE,
} from '../netlify/functions/_shared/profile-visitors.mts';
import { POLICY_VERSION } from '../netlify/functions/_shared/comment-moderation.mts';
import { config as visitorsConfig } from '../netlify/functions/visitors-get.mts';
import { config as visitConfig } from '../netlify/functions/visitors-visit.mts';
import { config as chartConfig } from '../netlify/functions/visitors-top25.mts';
import { config as featuredConfig } from '../netlify/functions/visitors-featured.mts';
import { config as recapConfig } from '../netlify/functions/visitors-recap.mts';
import { config as rolloverConfig } from '../netlify/functions/visitors-rollover.mts';

const origin = 'https://jwhitedidit.net';
const AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
// Monday 2026-09-07 00:00 America/Chicago is 05:00Z: the start of week 2026-09-07.
const MONDAY = Date.parse('2026-09-07T05:00:00Z');
const TUESDAY = MONDAY + 86_400_000;
const NEXT_MONDAY = MONDAY + 7 * 86_400_000;
const LAST_WEEK = previousWeek(chicagoWeek(MONDAY));

const jwhite = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'J.White Did It' };
const alice = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Alice' };
const bob = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Bob' };
const cleo = { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', name: 'Cleo' };
const noPause = async () => {};

function memory() {
  const records = new Map(), etags = new Map();
  let revision = 0, writes = 0;
  return {
    records, etags, get writes() { return writes; },
    async get(key) { return structuredClone(records.get(key) ?? null); },
    async getWithMetadata(key) { return records.has(key) ? { data: structuredClone(records.get(key)), etag: etags.get(key) } : null; },
    async setJSON(key, value, options = {}) {
      if (options.onlyIfNew && records.has(key)) return { modified: false };
      if (options.onlyIfMatch && options.onlyIfMatch !== etags.get(key)) return { modified: false };
      records.set(key, structuredClone(value)); etags.set(key, String(++revision)); writes++;
      return { modified: true };
    },
    async set(key, value, options) { return this.setJSON(key, value, options); },
    async delete(key) { records.delete(key); etags.delete(key); },
    async *list({ prefix }) {
      const keys = [...records.keys()].filter(key => key.startsWith(prefix)).sort();
      for (let offset = 0; offset < keys.length; offset += 3) yield { blobs: keys.slice(offset, offset + 3).map(key => ({ key, etag: etags.get(key) })) };
    },
  };
}

async function setup(members = [jwhite, alice, bob, cleo]) {
  const profiles = memory(), visitors = memory();
  for (const member of members) {
    await profiles.setJSON(`profiles/${member.id}`, {
      id: member.id, name: member.name, status: 'MORE!', about_me: '', photo_id: null,
      updated_at: '2026-09-01T00:00:00Z', approved: true, policy_version: POLICY_VERSION,
    });
  }
  await profiles.setJSON('owner-binding', { id: jwhite.id });
  return { profiles, visitors, lookup: {} };
}

const identity = member => async () => member && ({ id: member.id, name: member.name, confirmedAt: '2026-01-01T00:00:00Z', email: `${member.name}@example.test` });
const guest = async () => null;

const visitRequest = (body, headers = {}) => new Request(`${origin}/api/visitors/visit`, {
  method: 'POST',
  headers: { Origin: origin, 'Content-Type': 'application/json', 'User-Agent': AGENT, ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
const visit = (stores, profile, { visitor = randomUUID(), as = null, now = MONDAY, dwell = 4000, headers, body } = {}) =>
  postProfileVisit(
    visitRequest(body ?? { profile_id: typeof profile === 'string' ? profile : profile.id, visitor_id: visitor, dwell_ms: dwell }, headers),
    stores.visitors, stores.profiles, stores.lookup, as ? identity(as) : guest, now, noPause);
const read = (stores, profile, now = MONDAY) =>
  getProfileVisitors(new Request(`${origin}/api/visitors?id=${typeof profile === 'string' ? profile : profile.id}`), stores.visitors, stores.profiles, stores.lookup, now);
const chart = (stores, now = MONDAY) =>
  getTopTwentyFive(new Request(`${origin}/api/top25`), stores.visitors, stores.profiles, stores.lookup, now);
const featured = (stores, now = MONDAY) =>
  getFeaturedProfile(new Request(`${origin}/api/visitors/featured`), stores.visitors, stores.profiles, stores.lookup, now);
const recap = (stores, member, now = MONDAY) =>
  getVisitorRecap(new Request(`${origin}/api/visitors/recap`), stores.visitors, stores.profiles, stores.lookup, async () => member, now);
const body = async response => response.json();
const clearCache = stores => stores.visitors.records.delete('weeks/current-cache');

test('a first visit counts once and a refresh by the same visitor never counts again', async () => {
  const stores = await setup(), visitor = randomUUID();
  let snapshot = await body(await read(stores, alice));
  assert.deepEqual([snapshot.today, snapshot.this_week, snapshot.all_time], [0, 0, 0]);
  assert.equal(snapshot.estimated, true);
  assert.equal(stores.visitors.writes, 0, 'reading a profile must not write a counter');

  let response = await visit(stores, alice, { visitor });
  assert.equal(response.status, 201);
  snapshot = await body(response);
  assert.deepEqual([snapshot.today, snapshot.this_week, snapshot.all_time], [1, 1, 1]);
  assert.equal(snapshot.counted, true);

  for (let refresh = 0; refresh < 4; refresh++) {
    response = await visit(stores, alice, { visitor });
    assert.equal(response.status, 200);
    snapshot = await body(response);
    assert.equal(snapshot.counted, false);
    assert.equal(snapshot.reason, 'already_counted');
    assert.deepEqual([snapshot.today, snapshot.this_week, snapshot.all_time], [1, 1, 1]);
  }
  const separate = await body(await visit(stores, alice, { visitor: randomUUID() }));
  assert.deepEqual([separate.today, separate.this_week, separate.all_time], [2, 2, 2]);
});

test('counts belong to one profile and never to the site as a whole', async () => {
  const stores = await setup(), visitor = randomUUID();
  await visit(stores, alice, { visitor });
  await visit(stores, bob, { visitor });
  await visit(stores, bob, { visitor: randomUUID() });
  assert.equal((await body(await read(stores, alice))).all_time, 1);
  assert.equal((await body(await read(stores, bob))).all_time, 2);
  assert.equal((await body(await read(stores, cleo))).all_time, 0);
});

test('Today resets each day and This Week is not the sum of the days', async () => {
  const stores = await setup(), monday = randomUUID(), tuesday = randomUUID();
  await visit(stores, alice, { visitor: monday, now: MONDAY });
  await visit(stores, alice, { visitor: monday, now: TUESDAY });
  let snapshot = await body(await read(stores, alice, TUESDAY));
  assert.deepEqual([snapshot.today, snapshot.this_week, snapshot.all_time], [1, 1, 1],
    'a returning visitor is new for Today but not for This Week or All Time');
  await visit(stores, alice, { visitor: tuesday, now: TUESDAY });
  snapshot = await body(await read(stores, alice, TUESDAY));
  assert.deepEqual([snapshot.today, snapshot.this_week, snapshot.all_time], [2, 2, 2]);
});

test('Monday starts a new week without deleting history or resetting All Time', async () => {
  const stores = await setup(), regular = randomUUID();
  await visit(stores, alice, { visitor: regular, now: MONDAY });
  await visit(stores, alice, { visitor: randomUUID(), now: MONDAY });
  const before = await body(await read(stores, alice, MONDAY));
  assert.deepEqual([before.today, before.this_week, before.all_time], [2, 2, 2]);
  assert.equal(before.week_start, '2026-09-07');

  const rolled = await body(await read(stores, alice, NEXT_MONDAY));
  assert.deepEqual([rolled.today, rolled.this_week, rolled.all_time], [0, 0, 2], 'All Time survives the reset');
  assert.equal(rolled.week_start, '2026-09-14');

  const returning = await body(await visit(stores, alice, { visitor: regular, now: NEXT_MONDAY }));
  assert.deepEqual([returning.today, returning.this_week, returning.all_time], [1, 1, 2],
    'a returning visitor counts again for the new week but not again for All Time');
  const stored = stores.visitors.records[`counts/${alice.id}`] ?? await stores.visitors.get(`counts/${alice.id}`);
  assert.equal(stored.history['2026-09-07'], 2, "the finished week is filed, not erased");
});

test("a signed in owner's own visits are excluded, on a member page and on J.White's page", async () => {
  const stores = await setup();
  let response = await visit(stores, alice, { as: alice });
  assert.equal(response.status, 200);
  let snapshot = await body(response);
  assert.equal(snapshot.counted, false);
  assert.equal(snapshot.reason, 'own_profile');
  assert.deepEqual([snapshot.today, snapshot.this_week, snapshot.all_time], [0, 0, 0]);

  for (const page of ['owner', jwhite.id]) {
    snapshot = await body(await visit(stores, page, { as: jwhite }));
    assert.equal(snapshot.reason, 'own_profile');
    assert.equal(snapshot.all_time, 0);
  }
  snapshot = await body(await visit(stores, 'owner', { as: alice }));
  assert.equal(snapshot.counted, true, 'another signed in member still counts on the owner page');
  assert.equal((await body(await read(stores, jwhite.id))).all_time, 1,
    "the owner page shares one counter whether it is opened as /#home or by member id");
});

test('a signed in member counts once per profile no matter how many browsers they use', async () => {
  const stores = await setup();
  await visit(stores, bob, { as: alice, visitor: randomUUID() });
  await visit(stores, bob, { as: alice, visitor: randomUUID() });
  assert.equal((await body(await read(stores, bob))).all_time, 1);
});

test('simultaneous visits stay correct under write contention', async () => {
  const stores = await setup(), shared = randomUUID();
  const responses = await Promise.all([
    visit(stores, alice, { visitor: shared }), visit(stores, alice, { visitor: shared }), visit(stores, alice, { visitor: shared }),
    visit(stores, alice, { visitor: randomUUID() }), visit(stores, alice, { visitor: randomUUID() }),
    visit(stores, bob, { visitor: shared }),
  ]);
  assert.ok(responses.every(response => response.ok));
  const snapshot = await body(await read(stores, alice));
  assert.deepEqual([snapshot.today, snapshot.this_week, snapshot.all_time], [3, 3, 3],
    'one visitor arriving three times at once is still one visitor');
  assert.equal((await body(await read(stores, bob))).all_time, 1);

  // A crowd arriving on one profile in the same instant: every visitor is
  // counted exactly once, so no visit is lost to a competing write.
  const crowd = await setup();
  const arrivals = await Promise.all(Array.from({ length: 14 }, () => visit(crowd, cleo, { visitor: randomUUID() })));
  assert.deepEqual(arrivals.map(response => response.status), Array(14).fill(201));
  const busy = await body(await read(crowd, cleo));
  assert.deepEqual([busy.today, busy.this_week, busy.all_time], [14, 14, 14]);
  assert.equal((await body(await chart(crowd))).entries[0].visitors, 14, 'the chart index agrees with the counter');
});

test('automated, cross-site, oversized and bounce traffic is refused without touching a counter', async () => {
  const stores = await setup();
  const valid = { profile_id: alice.id, visitor_id: randomUUID(), dwell_ms: 4000 };
  const cases = [
    ['crawler user agent', { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' } }, 403],
    ['headless browser', { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120.0.0.0 Safari/537.36' } }, 403],
    ['command line client', { headers: { 'User-Agent': 'curl/8.4.0 loading a profile page' } }, 403],
    ['missing user agent', { headers: { 'User-Agent': 'x' } }, 403],
    ['cross-site origin', { headers: { Origin: 'https://example.com' } }, 403],
    ['fetch marked cross-site', { headers: { 'Sec-Fetch-Site': 'cross-site' } }, 403],
    ['wrong content type', { headers: { 'Content-Type': 'text/plain' } }, 415],
    ['oversized body', { body: { ...valid, visitor_id: `${'a'.repeat(600)}` } }, 413],
    ['unparseable body', { body: '{oops' }, 400],
    ['bounced before reading', { body: { ...valid, dwell_ms: 200 } }, 400],
    ['negative dwell', { body: { ...valid, dwell_ms: -5 } }, 400],
    ['non v4 visitor id', { body: { ...valid, visitor_id: 'aaaaaaaa-aaaa-9aaa-8aaa-aaaaaaaaaaaa' } }, 400],
    ['extra fields', { body: { ...valid, referrer: 'https://example.com' } }, 400],
    ['made up profile', { body: { ...valid, profile_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' } }, 404],
  ];
  for (const [label, overrides, status] of cases) {
    const response = await visit(stores, alice, overrides);
    assert.equal(response.status, status, `${label} expected ${status}`);
  }
  assert.equal((await body(await read(stores, alice))).all_time, 0);
  assert.equal(stores.visitors.records.size, 0, 'refused traffic writes nothing at all');
  assert.equal((await visit(stores, alice, { body: { ...valid, dwell_ms: 4000 } })).status, 201);
});

test('visitor identities are stored only as keyed hashes, never as raw ids', async () => {
  const stores = await setup(), visitor = randomUUID();
  await visit(stores, alice, { visitor });
  await visit(stores, bob, { as: alice });
  const dump = JSON.stringify([...stores.visitors.records].map(([key, value]) => [key, value]));
  assert.ok(!dump.includes(visitor), 'a guest browser id is never stored');
  assert.ok(!dump.toLowerCase().includes(AGENT.toLowerCase()), 'user agents are never stored');
  assert.doesNotMatch(dump, /\b\d{1,3}(\.\d{1,3}){3}\b/, 'no IP-shaped value is stored');
  const marks = [...stores.visitors.records.keys()].filter(key => key.startsWith('marks/'));
  assert.equal(marks.length, 2);
  for (const key of marks) assert.match(key, /^marks\/[a-f0-9-]{36}\/[a-f0-9]{64}$/);
  assert.ok(!marks.some(key => key.includes(alice.id.slice(0, 8) + '-' + alice.id.slice(9, 13) + 'x')));
  const aliceMark = marks.find(key => key.startsWith(`marks/${bob.id}/`));
  assert.ok(!aliceMark.includes(alice.id), "a signed in member's id is hashed, not stored in the key");
  assert.deepEqual(Object.keys(await stores.visitors.get(marks[0])).sort(), ['day', 'version', 'week']);
});

test('the chart ranks the week, links to profiles and leaves J.White out of the running', async () => {
  const stores = await setup();
  const send = async (member, count) => { for (let index = 0; index < count; index++) await visit(stores, member, { visitor: randomUUID() }); };
  await send(alice, 5); await send(bob, 3); await send(cleo, 3); await send('owner', 40);

  const view = await body(await chart(stores));
  assert.equal(view.week_start, '2026-09-07');
  assert.equal(view.chart_size, CHART_SIZE);
  assert.deepEqual(view.entries.map(entry => [entry.position, entry.name, entry.visitors]),
    [[1, 'Alice', 5], [2, 'Bob', 3], [2, 'Cleo', 3]], 'ties share a position');
  assert.ok(!view.entries.some(entry => entry.subject === jwhite.id), 'J.White does not compete');
  assert.deepEqual(view.entries.map(entry => entry.profile_url),
    [`/profile.html?id=${alice.id}`, `/profile.html?id=${bob.id}`, `/profile.html?id=${cleo.id}`]);
  assert.ok(view.entries.every(entry => entry.movement.label === 'NEW'), 'the first week is all new entries');

  const box = await body(await read(stores, alice));
  assert.equal(box.position, 1);
  assert.equal(box.chart_url, '/top25.html');
  const owner = await body(await read(stores, 'owner'));
  assert.equal(owner.all_time, 40, "J.White's page still counts its own visitors");
  assert.equal(owner.position, null);
  assert.equal(owner.chart_eligible, false);
});

test('competition ranking is consistent and the chart never exceeds 25 places', async () => {
  const totals = [{ subject: 'b', visitors: 9 }, { subject: 'a', visitors: 9 }, { subject: 'c', visitors: 4 }, { subject: 'd', visitors: 1 }];
  assert.deepEqual(rankTotals(totals).map(row => [row.position, row.subject]), [[1, 'a'], [1, 'b'], [3, 'c'], [4, 'd']]);
  const many = Array.from({ length: 40 }, (_, index) => ({ subject: `p${String(index).padStart(2, '0')}`, visitors: 40 - index }));
  assert.equal(rankTotals(many).length, CHART_SIZE);
  assert.equal(rankTotals(many).at(-1).position, CHART_SIZE);
});

test('movement compares this week with the archived chart from last week', async () => {
  const stores = await setup();
  const send = async (member, count, now) => { for (let index = 0; index < count; index++) await visit(stores, member, { visitor: randomUUID(), now }); };
  // Week of 2026-09-07: Alice #1, Bob #2, Cleo #3.
  await send(alice, 5, MONDAY); await send(bob, 3, MONDAY); await send(cleo, 1, MONDAY);
  await chart(stores, MONDAY);
  // Week of 2026-09-14: Cleo climbs, Bob holds, Alice slips.
  await send(cleo, 9, NEXT_MONDAY); await send(bob, 4, NEXT_MONDAY); await send(alice, 2, NEXT_MONDAY);
  clearCache(stores);
  const view = await body(await chart(stores, NEXT_MONDAY));
  assert.deepEqual(view.entries.map(entry => [entry.position, entry.name, entry.visitors, entry.movement.label, entry.last_week_position]),
    [[1, 'Cleo', 9, '▲2', 3], [2, 'Bob', 4, 'SAME', 2], [3, 'Alice', 2, '▼2', 1]]);
  const archive = await stores.visitors.get('weeks/2026-09-07');
  assert.equal(archive.week, '2026-09-07');
  assert.deepEqual(archive.entries.map(entry => entry.position), [1, 2, 3]);
});

test("last week's number one is the Featured Profile for the whole following week", async () => {
  const stores = await setup();
  let empty = await body(await featured(stores, MONDAY));
  assert.equal(empty.featured, null, 'no invented winner before there is real activity');
  assert.equal(empty.featured_week_start, LAST_WEEK);

  const send = async (member, count, now) => { for (let index = 0; index < count; index++) await visit(stores, member, { visitor: randomUUID(), now }); };
  await send(bob, 7, MONDAY); await send(alice, 2, MONDAY); await send('owner', 99, MONDAY);

  for (const moment of [NEXT_MONDAY, NEXT_MONDAY + 86_400_000 * 3, NEXT_MONDAY + 86_400_000 * 6 + 3_600_000 * 20]) {
    const view = await body(await featured(stores, moment));
    assert.equal(view.featured_week_start, '2026-09-07');
    assert.equal(view.featured.name, 'Bob');
    assert.equal(view.featured.visitors, 7);
    assert.equal(view.featured.position, 1);
    assert.equal(view.featured.profile_url, `/profile.html?id=${bob.id}`);
  }
  await send(alice, 50, NEXT_MONDAY);
  const held = await body(await featured(stores, NEXT_MONDAY + 86_400_000 * 4));
  assert.equal(held.featured.name, 'Bob', 'a hot week does not take the feature away mid-week');
  const after = await body(await featured(stores, NEXT_MONDAY + 7 * 86_400_000));
  assert.equal(after.featured.name, 'Alice', 'the next week hands the feature to the new winner');
});

test('each member gets a private recap of the finished week and their final place', async () => {
  const stores = await setup();
  const send = async (member, count, now) => { for (let index = 0; index < count; index++) await visit(stores, member, { visitor: randomUUID(), now }); };
  await send(alice, 4, MONDAY); await send(bob, 2, MONDAY);

  const early = await body(await recap(stores, alice, MONDAY));
  assert.equal(early.visitors, 0, 'no finished week to report yet');
  assert.equal(early.made_chart, false);

  const view = await body(await recap(stores, alice, NEXT_MONDAY));
  assert.equal(view.week_start, '2026-09-07');
  assert.equal(view.visitors, 4);
  assert.equal(view.position, 1);
  assert.equal(view.made_chart, true);
  assert.deepEqual(view.current, { today: 0, this_week: 0, all_time: 4 });
  assert.equal(view.profile_url, `/profile.html?id=${alice.id}`);

  const quiet = await body(await recap(stores, cleo, NEXT_MONDAY));
  assert.equal(quiet.visitors, 0);
  assert.equal(quiet.position, null);
  assert.equal(quiet.made_chart, false);
  const owner = await body(await recap(stores, jwhite, NEXT_MONDAY));
  assert.equal(owner.profile_url, '/#home');
});

test('an empty space reports an empty chart rather than inventing results', async () => {
  const stores = await setup();
  const view = await body(await chart(stores));
  assert.deepEqual(view.entries, []);
  assert.equal(view.ranked, 0);
  assert.equal((await body(await featured(stores))).featured, null);
});

test('the scheduled rollover files finished weeks and is safe to run again', async () => {
  const stores = await setup();
  for (let index = 0; index < 3; index++) await visit(stores, alice, { visitor: randomUUID(), now: MONDAY });
  const request = new Request(`${origin}/api/visitors/rollover`);
  const filed = await rolloverWeeks(request, stores.visitors, stores.profiles, stores.lookup, NEXT_MONDAY);
  assert.ok(filed.includes('2026-09-07'));
  const archived = await stores.visitors.get('weeks/2026-09-07');
  assert.equal(archived.entries[0].visitors, 3);
  const generated = archived.generated_at;
  await rolloverWeeks(request, stores.visitors, stores.profiles, stores.lookup, NEXT_MONDAY + 3_600_000);
  assert.equal((await stores.visitors.get('weeks/2026-09-07')).generated_at, generated, 'a filed week is never rewritten');
  assert.equal(await stores.visitors.get(`weeks/${chicagoWeek(NEXT_MONDAY)}`), null, 'the live week is never archived');
});

test('every visitor route is bound to its path, method and rate limit', () => {
  assert.deepEqual(
    [visitorsConfig, visitConfig, chartConfig, featuredConfig, recapConfig].map(config => [config.path, config.method, config.rateLimit.windowLimit]),
    [['/api/visitors', 'GET', 120], ['/api/visitors/visit', 'POST', 30], ['/api/top25', 'GET', 60],
     ['/api/visitors/featured', 'GET', 120], ['/api/visitors/recap', 'GET', 60]]);
  for (const config of [visitorsConfig, visitConfig, chartConfig, featuredConfig, recapConfig]) {
    assert.deepEqual(config.rateLimit.aggregateBy, ['ip', 'domain']);
    assert.equal(config.rateLimit.windowSize, 60);
  }
  assert.equal(rolloverConfig.schedule, '23 * * * *');
});

test('preview and test traffic is kept in its own store, away from production counts', () => {
  const source = readFileSync(new URL('../netlify/functions/_shared/profile-visitors.mts', import.meta.url), 'utf8');
  const split = source.match(/export function visitorStore[\s\S]*?\n}/);
  assert.ok(split, 'the visitor store is created in one place');
  assert.match(split[0], /consistency: "strong"/, 'counts are read back consistently');
  assert.match(split[0], /context\.deploy\.context === "production" \? getStore\(options\)/,
    'production reads and writes the shared store');
  assert.match(split[0], /getDeployStore\(\{ \.\.\.options, deployID: context\.deploy\.id \}\)/,
    'every other deploy context, including previews, gets a store of its own');
});

test('responses stay private to the browser and out of shared caches', async () => {
  const stores = await setup();
  for (const response of [await read(stores, alice), await chart(stores), await featured(stores), await recap(stores, alice)]) {
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(response.headers.get('netlify-cdn-cache-control'), 'no-store');
  }
});

test('counting survives a host that answers a read without a version', async () => {
  // The local development blobs server omits the ETag on a read. The version
  // is taken from the listing instead, so counting still works and a stale
  // write is still refused.
  const stores = await setup();
  const plain = stores.visitors.getWithMetadata.bind(stores.visitors);
  stores.visitors.getWithMetadata = async (key, options) => {
    const saved = await plain(key, options);
    return saved && { data: saved.data, etag: undefined };
  };
  const visitor = randomUUID();
  assert.deepEqual((await body(await visit(stores, alice, { visitor }))).all_time, 1);
  assert.equal((await body(await visit(stores, alice, { visitor }))).counted, false);
  assert.deepEqual((await body(await visit(stores, alice, { visitor: randomUUID() }))).all_time, 2);
  assert.equal((await body(await read(stores, alice))).this_week, 2);

  // A listing taken mid write can come back without a usable version once.
  const listing = stores.visitors.list.bind(stores.visitors);
  let blanks = 1;
  stores.visitors.list = async function* (options) {
    for await (const page of listing(options)) {
      yield blanks-- > 0 ? { blobs: page.blobs.map(blob => ({ ...blob, etag: '' })) } : page;
    }
  };
  assert.equal((await body(await visit(stores, alice, { visitor: randomUUID() }))).all_time, 3,
    'a version that arrives blank once is asked for again rather than failing the visit');
  stores.visitors.list = listing;

  stores.visitors.setJSON = async () => ({ modified: false });
  const stuck = await visit(stores, alice, { visitor: randomUUID() });
  assert.equal(stuck.status, 503, 'a write that can never match the version it read reports a failure');
  assert.equal((await body(await read(stores, alice))).this_week, 3, 'and never invents a count');
});

test('a visit that could not be counted is not silently swallowed', async () => {
  const stores = await setup(), visitor = randomUUID();
  const working = stores.visitors.setJSON.bind(stores.visitors);
  stores.visitors.setJSON = async (key, value, options) =>
    key.startsWith('counts/') ? { modified: false } : working(key, value, options);

  const failed = await visit(stores, alice, { visitor });
  assert.equal(failed.status, 503, 'the visitor is told the count did not land');
  assert.equal((await body(await read(stores, alice))).all_time, 0);
  assert.equal([...stores.visitors.records.keys()].some(key => key.startsWith('marks/')), false,
    'the claim is handed back rather than marking an uncounted visitor as counted');

  stores.visitors.setJSON = working;
  assert.equal((await body(await visit(stores, alice, { visitor }))).all_time, 1,
    'so the same visitor is counted when the store is working again');
});
