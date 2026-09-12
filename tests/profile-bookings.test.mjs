import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { drizzle } from 'drizzle-orm/pg-proxy';
import { handleProfileBookings, listProfileBookingBusinesses, profileBookingLinks } from '../netlify/functions/_shared/profile-bookings.mts';
import { MemberError } from '../netlify/functions/_shared/member-auth.mts';

const alice = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const bob = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const request = (query = `id=${alice}`, method = 'GET') => new Request(`https://jwhitedidit.net/api/profile-bookings?${query}`, { method });
const business = { name: 'Williams Speaking & Logistics', slug: 'williams-speaking-logistics', servicesCount: 2 };

test('real query builder links only the exact profile owner and published active bookable businesses', async () => {
  let queries = 0;
  const database = drizzle(async (sql, parameters) => {
    queries += 1;
    assert.match(sql, /inner join "booking_platform_users" on "booking_platform_users"\."id" = "booking_businesses"\."owner_user_id"/);
    assert.match(sql, /inner join "booking_services" on "booking_services"\."business_id" = "booking_businesses"\."id"/);
    assert.match(sql, /"booking_platform_users"\."identity_user_id" = \$1/);
    assert.match(sql, /"booking_platform_users"\."status" = \$2/);
    assert.match(sql, /"booking_businesses"\."status" = \$3/);
    assert.match(sql, /"booking_businesses"\."published" = \$4/);
    assert.match(sql, /"booking_services"\."active" = \$5/);
    assert.match(sql, /"booking_services"\."online_booking_enabled" = \$6/);
    assert.deepEqual(parameters, [alice, 'active', 'active', true, true, true, 20]);
    assert.doesNotMatch(sql, /stripe_account_id|client_email|display_name|insert into|update /i);
    return { rows: [[business.name, business.slug, '2']] };
  });
  assert.deepEqual(await listProfileBookingBusinesses(alice.toUpperCase(), database), [business]);
  assert.equal(queries, 1);
  await assert.rejects(() => listProfileBookingBusinesses('MrWilliams', database));
  assert.equal(queries, 1);
});

test('booking access rejects unauthenticated and unapproved viewers before reading business data', async () => {
  for (const status of [401, 403]) {
    let queries = 0;
    const response = await handleProfileBookings(request(), {
      resolveMember: async () => { throw new MemberError(status, 'Member access required.'); },
      listBusinesses: async () => { queries += 1; return [business]; },
    });
    assert.equal(response.status, status);
    assert.equal(queries, 0);
    assert.match(response.headers.get('cache-control'), /no-store/);
  }
});

test('only one exact UUID can select profile bookings; body/name aliases cannot choose an account', async () => {
  for (const query of ['', 'id=owner', 'id=MrWilliams', `id=${alice}&id=${bob}`, 'name=Williams', 'id=../../other']) {
    let queries = 0;
    const response = await handleProfileBookings(request(query), {
      resolveMember: async () => ({ id: alice, name: 'Alice' }),
      listBusinesses: async () => { queries += 1; return [business]; },
    });
    assert.equal(response.status, 400);
    assert.equal(queries, 0);
  }
});

test('published business projection is private, minimal, and manage access comes only from verified viewer identity', async () => {
  for (const viewerId of [alice, bob]) {
    const queried = [];
    const response = await handleProfileBookings(request(`id=${alice.toUpperCase()}&canManage=true&viewerId=${alice}`), {
      resolveMember: async () => ({ id: viewerId, name: 'Member' }),
      listBusinesses: async id => {
        queried.push(id);
        return [{ ...business, ownerUserId: 47, stripeAccountId: 'private-account', customerEmail: 'private@example.test' }];
      },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(queried, [alice]);
    assert.deepEqual(await response.json(), {
      profileId: alice,
      businesses: [{ name: business.name, bookingUrl: `/book/${business.slug}`, servicesCount: 2 }],
      canManage: viewerId === alice,
    });
    assert.equal(response.headers.get('vary'), 'Cookie, Authorization');
    assert.match(response.headers.get('netlify-cdn-cache-control'), /no-store/);
  }
});

test('empty account has no fabricated booking links, and transient storage failure does not imply no businesses', async () => {
  const dependencies = { resolveMember: async () => ({ id: alice, name: 'Alice' }), listBusinesses: async () => [] };
  assert.deepEqual(await (await handleProfileBookings(request(), dependencies)).json(), { profileId: alice, businesses: [], canManage: true });
  const unavailable = await handleProfileBookings(request(), { ...dependencies, listBusinesses: async () => { throw new Error('Private database information'); } });
  assert.equal(unavailable.status, 503);
  assert.equal(JSON.stringify(await unavailable.json()).includes('Private database'), false);
});

test('projection rejects unsafe routes, duplicates, invalid service counts and blank businesses', () => {
  const rows = [
    business, { ...business, name: 'Duplicate' },
    { ...business, slug: '//evil.test' }, { ...business, slug: '../admin' },
    { ...business, slug: 'javascript:alert(1)' }, { ...business, slug: 'with?query' },
    { ...business, slug: 'empty', servicesCount: 0 },
    { ...business, slug: 'invalid', servicesCount: -3 },
    { ...business, slug: 'fractional', servicesCount: 1.2 },
    { ...business, slug: 'blank', name: '\n ' },
    { ...business, slug: 'other-business', servicesCount: '4' },
  ];
  assert.deepEqual(profileBookingLinks(rows), [
    { name: business.name, bookingUrl: `/book/${business.slug}`, servicesCount: 2 },
    { name: business.name, bookingUrl: '/book/other-business', servicesCount: 4 },
  ]);
});

test('booking endpoint cannot mutate or create businesses', async () => {
  let reads = 0;
  const response = await handleProfileBookings(request(`id=${alice}`, 'POST'), {
    resolveMember: async () => { reads += 1; return { id: alice, name: 'Alice' }; },
    listBusinesses: async () => { reads += 1; return []; },
  });
  assert.equal(response.status, 405);
  assert.equal(reads, 0);
});

const source = readFileSync(new URL('../profile-bookings.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
class Element {
  constructor(tag = 'section') { this.tag = tag; this.children = []; this.hidden = true; this.textContent = ''; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
}
async function environment() {
  const root = new Element(), calls = [], listeners = {};
  const document = { hidden: false, getElementById: id => id === 'profile-bookings' ? root : null, createElement: tag => new Element(tag) };
  const window = { addEventListener: (name, listener) => { listeners[name] = listener; } };
  vm.runInNewContext(source, {
    document, window, AbortController, setTimeout, clearTimeout,
    fetch: (url, options) => new Promise(resolve => { calls.push({ url, options, resolve }); }),
  });
  return {
    root, calls,
    async event(name, detail = {}) { listeners[name]({ detail }); await tick(); },
    async reply(index, data, status = 200) { calls[index].resolve({ ok: status >= 200 && status < 300, status, json: async () => data }); await tick(); },
  };
}
function descendants(root) { return root.children.flatMap(child => [child, ...descendants(child)]); }
const responseFor = (id, businesses = [], canManage = false) => ({ profileId: id, businesses, canManage });
const publicBusiness = { name: business.name, bookingUrl: `/book/${business.slug}`, servicesCount: 2 };

test('profile client shows actual service links and reserves setup access for server-verified owner', async () => {
  const state = await environment();
  await state.event('jwhite:profile-ready', { id: alice });
  await state.reply(0, responseFor(alice, [publicBusiness]));
  assert.equal(state.root.hidden, false);
  let links = descendants(state.root).filter(node => node.tag === 'a');
  assert.deepEqual(links.map(link => link.href), [publicBusiness.bookingUrl]);
  assert.equal(state.calls[0].options.credentials, 'same-origin');
  assert.equal(state.calls[0].options.cache, 'no-store');
  await state.event('jwhite:profile-ready', { id: alice });
  await state.reply(1, responseFor(alice, []));
  assert.equal(state.root.hidden, true);
  await state.event('jwhite:profile-ready', { id: alice });
  await state.reply(2, responseFor(alice, [], true));
  links = descendants(state.root).filter(node => node.tag === 'a');
  assert.deepEqual(links.map(link => [link.href, link.textContent]), [['/booking/dashboard', 'Add booking to my page']]);
  assert.equal(state.root.hidden, false);
});

test('stale profile responses cannot attach a different member booking business', async () => {
  const state = await environment();
  await state.event('jwhite:profile-ready', { id: alice });
  await state.event('jwhite:profile-ready', { id: bob });
  assert.equal(state.calls[0].options.signal.aborted, true);
  await state.reply(1, responseFor(bob, []));
  await state.reply(0, responseFor(alice, [publicBusiness], true));
  assert.equal(state.root.hidden, true);
  assert.equal(state.root.children.length, 0);
});

test('session changes clear owner actions immediately and old responses cannot restore them', async () => {
  const state = await environment();
  await state.event('jwhite:profile-ready', { id: alice });
  await state.reply(0, responseFor(alice, [], true));
  assert.equal(state.root.hidden, false);
  await state.event('jwhite:profile-ready', { id: alice });
  await state.event('jwhite:session-changed');
  assert.equal(state.root.hidden, true);
  assert.equal(state.calls[1].options.signal.aborted, true);
  await state.reply(2, { error: 'Log in' }, 401);
  await state.reply(1, responseFor(alice, [publicBusiness], true));
  assert.equal(state.root.hidden, true);
  assert.equal(state.root.children.length, 0);
});

test('client rejects mismatched profiles, external booking destinations and forged owner flags', async () => {
  const state = await environment();
  const invalidResponses = [
    responseFor(bob, [publicBusiness], true),
    responseFor(alice, [{ ...publicBusiness, bookingUrl: 'https://evil.test/book' }]),
    responseFor(alice, [{ ...publicBusiness, bookingUrl: '/book/../admin' }]),
    responseFor(alice, [publicBusiness], 'true'),
  ];
  for (let index = 0; index < invalidResponses.length; index += 1) {
    await state.event('jwhite:profile-ready', { id: alice });
    await state.reply(index, invalidResponses[index]);
    assert.equal(state.root.hidden, true);
    assert.equal(state.root.children.length, 0);
  }
});
