import test from 'node:test';
import assert from 'node:assert/strict';
import { drizzle } from 'drizzle-orm/pg-proxy';
import { combineMonaAmounts, createMonaBookingRepository, getMonaBookings } from '../netlify/functions/_shared/mona-booking-summary.mts';
import { MemberError } from '../netlify/functions/_shared/member-auth.mts';
import { BookingError } from '../netlify/functions/_shared/booking-auth.mts';
import { config } from '../netlify/functions/mona-bookings.mts';

const origin = 'https://jwhitedidit.net';
const alice = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Alice' };
const bob = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Bob' };
const now = new Date('2026-09-11T14:20:00Z');
const business = { id: 9, name: 'Alice Studio', slug: 'alice-studio', published: true, status: 'active', currency: 'usd', paymentStatus: 'setup_pending', stripeAccountId: 'private-stripe-id', email: 'private@example.com' };
const appointment = { id: 13, businessId: 9, businessName: business.name, serviceName: 'Studio session', startsAt: '2026-09-12T10:00:00Z', status: 'confirmed', priceCents: 20000, currency: 'usd', clientName: 'Private client', clientEmail: 'client@example.com', confirmationCode: 'PRIVATE', privateNotes: 'Private' };
const request = (path = '', options) => new Request(origin + '/api/mona/bookings' + path, options);
function dependencies(overrides = {}) {
  const calls = [];
  const repo = {
    businesses: async id => { calls.push(['businesses', id]); return [business]; },
    paymentSettings: async () => { calls.push(['paymentSettings']); return { platformFeeBasisPoints: 100, privateSetting: 'private-setting-value' }; },
    services: async id => { calls.push(['services', id]); return [{ businessId: 9, value: 2 }]; },
    upcoming: async (id, period) => { calls.push(['upcoming', id, period]); return [appointment]; },
    booked: async (id, period) => { calls.push(['booked', id, period]); return [{ currency: 'usd', amountCents: '20000', value: 1 }]; },
    payments: async (id, period) => { calls.push(['payments', id, period]); return [{ currency: 'usd', amountCents: '5000' }]; },
    pending: async (id, period) => { calls.push(['pending', id, period]); return 2; },
  };
  return { calls, resolveMember: async () => alice, resolveBookingUser: async () => ({ id: 41, identityUserId: alice.id }), now: () => now, repository: repo, ...overrides };
}

test('Mona bookings is a private GET route and authentication gates run before all reads', async () => {
  assert.equal(config.path, '/api/mona/bookings');
  assert.equal(config.method, 'GET');
  for (const failure of [new MemberError(401, 'Log in.'), new MemberError(403, 'Approval is required.')]) {
    const d = dependencies({ resolveMember: async () => { throw failure; }, resolveBookingUser: async () => { assert.fail('booking identity must not run first'); } });
    const response = await getMonaBookings(request(), d);
    assert.equal(response.status, failure.status);
    assert.deepEqual(d.calls, []);
  }
  const bookingDenied = dependencies({ resolveBookingUser: async () => { throw new BookingError(403, 'Inactive booking account.'); } });
  assert.equal((await getMonaBookings(request(), bookingDenied)).status, 403);
  assert.deepEqual(bookingDenied.calls, []);
  const mixedIdentity = dependencies({ resolveBookingUser: async () => ({ id: 41, identityUserId: bob.id }) });
  assert.equal((await getMonaBookings(request(), mixedIdentity)).status, 403);
  assert.deepEqual(mixedIdentity.calls, []);
});

test('query member/business IDs and administrator roles cannot change the authenticated owner scope', async () => {
  const d = dependencies({ resolveBookingUser: async () => ({ id: 41, identityUserId: alice.id, platformRole: 'admin' }) });
  const response = await getMonaBookings(request('?memberId=' + bob.id + '&businessId=999&ownerUserId=999'), d);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).memberId, alice.id);
  assert.equal(d.calls.length, 7);
  assert.ok(d.calls.filter(([name]) => name !== 'paymentSettings').every(([, id]) => id === 41));
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('netlify-cdn-cache-control'), 'no-store');
  assert.equal(response.headers.get('vary'), 'Cookie, Authorization');
});

test('summary distinguishes quoted bookings from payments and exposes no client or payment credentials', async () => {
  const d = dependencies();
  const response = await getMonaBookings(request(), d);
  const data = await response.json();
  assert.deepEqual(data.recordedPayments, [{ currency: 'USD', amountCents: 5000 }]);
  assert.deepEqual(data.bookedValue, [{ currency: 'USD', amountCents: 20000 }]);
  assert.equal(data.pendingCount, 2);
  assert.equal(data.upcomingCount, 1);
  assert.deepEqual(data.businesses, [{ id: 9, name: business.name, slug: business.slug, published: true, paymentStatus: 'setup_pending', bookingUrl: '/book/alice-studio', servicesCount: 2 }]);
  assert.deepEqual(data.paymentInfo, { feeBasisPoints: 100, feeConfigured: true, feeAppliesTo: 'connected_booking_charge' });
  assert.deepEqual(Object.keys(data.upcoming[0]).sort(), ['id', 'businessId', 'businessName', 'serviceName', 'startsAt', 'status', 'priceCents', 'currency'].sort());
  assert.doesNotMatch(JSON.stringify(data), /private@example|private-stripe|private-setting|Private client|client@example|PRIVATE|Private/);
  assert.match(data.summaryNote, /not money received/);
  assert.match(data.summaryNote, /not profit or a bank balance/);
  assert.equal(data.period.from, '2026-09-11T14:20:00.000Z');
  assert.equal(data.period.to, '2026-10-11T14:20:00.000Z');
  assert.equal(data.paymentPeriod.from, '2026-09-01T00:00:00.000Z');
  assert.equal(data.paymentPeriod.to, now.toISOString());
  assert.equal(data.paymentPeriod.endExclusive, true);
});

test('no businesses is an honest empty state and does not query anybody else’s appointments', async () => {
  const d = dependencies();
  d.repository.businesses = async id => { d.calls.push(['businesses', id]); return []; };
  const data = await (await getMonaBookings(request(), d)).json();
  for (const key of ['businesses', 'upcoming', 'recordedPayments', 'bookedValue']) assert.deepEqual(data[key], []);
  assert.equal(data.pendingCount, 0);
  assert.equal(data.upcomingCount, 0);
  assert.deepEqual(d.calls, [['businesses', 41], ['paymentSettings']]);
});

test('unpublished or inactive businesses have no public booking link and upcoming excludes invalid states', async () => {
  const d = dependencies();
  d.repository.businesses = async () => [{ ...business, published: false }, { ...business, id: 10, status: 'suspended' }];
  d.repository.upcoming = async () => [appointment, ...['pending_payment', 'no_show', 'completed', 'cancelled'].map(status => ({ ...appointment, status })), { ...appointment, businessId: 999 }, { ...appointment, startsAt: '2026-09-01T10:00:00Z' }, { ...appointment, startsAt: '2026-10-11T14:20:00Z' }];
  const data = await (await getMonaBookings(request(), d)).json();
  assert.ok(data.businesses.every(row => row.bookingUrl === null));
  assert.equal(data.upcoming.length, 1);
  assert.equal(data.upcoming[0].status, 'confirmed');
});

test('currency totals stay separate and are not undercounted by the displayed upcoming limit', async () => {
  assert.deepEqual(combineMonaAmounts([{ currency: 'usd', amountCents: '125' }, { currency: 'USD', amountCents: 75 }, { currency: 'gbp', amountCents: '330' }]), [{ currency: 'GBP', amountCents: 330 }, { currency: 'USD', amountCents: 200 }]);
  const d = dependencies();
  d.repository.upcoming = async () => Array.from({ length: 20 }, (_, index) => ({ ...appointment, id: index + 1 }));
  d.repository.booked = async () => [{ currency: 'usd', amountCents: '400000', value: 20 }, { currency: 'gbp', amountCents: '7000', value: 1 }];
  const data = await (await getMonaBookings(request(), d)).json();
  assert.equal(data.upcoming.length, data.upcomingLimit);
  assert.equal(data.upcomingCount, 21);
  assert.deepEqual(data.bookedValue, [{ currency: 'GBP', amountCents: 7000 }, { currency: 'USD', amountCents: 400000 }]);
});

test('read failures remain visible instead of pretending revenue is zero', async () => {
  const d = dependencies();
  d.repository.payments = async () => { throw new Error('Database unavailable'); };
  const response = await getMonaBookings(request(), d);
  assert.equal(response.status, 503);
  assert.deepEqual(Object.keys(await response.json()), ['error']);
  assert.equal((await getMonaBookings(request('', { method: 'POST' }), d)).status, 405);
  assert.equal((await getMonaBookings(request('', { headers: { Origin: 'https://other.example' } }), d)).status, 403);
});

test('generated SQL scopes every query to ownership, limits only display rows, and counts succeeded charges', async () => {
  const queries = [];
  const database = drizzle(async (sql, params) => { queries.push({ sql, params }); return { rows: [] }; });
  const repository = createMonaBookingRepository(database);
  const period = { from: now, to: new Date('2026-10-11T14:20:00Z') };
  await repository.businesses(41);
  await repository.services(41);
  await repository.upcoming(41, period);
  await repository.booked(41, period);
  await repository.payments(41, period);
  await repository.pending(41, period);
  assert.equal(queries.length, 6);
  for (const query of queries) {
    assert.match(query.sql, /where .*"booking_businesses"\."owner_user_id" = \$1/);
    assert.equal(query.params[0], 41);
    assert.doesNotMatch(query.sql, /booking_clients|booking_business_members|email|private_notes|confirmation_code/);
  }
  assert.match(queries[0].sql, /case when length\(trim\("stripe_account_id"\)\) = 0 then 'not_connected' when "stripe_charges_enabled" = true then 'enabled_on_record' else 'setup_pending' end/);
  assert.ok(queries.slice(1).every(query => !query.sql.includes('stripe')));
  assert.match(queries[2].sql, / limit /);
  assert.doesNotMatch(queries[3].sql, / limit /);
  assert.deepEqual(queries[3].params, [41, 'confirmed', 'checked_in', now.toISOString(), period.to.toISOString()]);
  assert.match(queries[3].sql, /sum\("booking_appointments"\."price_cents"\)/);
  assert.deepEqual(queries[4].params, [41, 'succeeded', 'charge', now.toISOString(), period.to.toISOString()]);
  assert.match(queries[4].sql, /sum\("booking_payments"\."amount_cents"\)/);
  assert.doesNotMatch(queries[4].sql, /provider_net_cents/);
  assert.match(queries[4].sql, /"created_at" >=/);
  assert.match(queries[4].sql, /"created_at" </);
  assert.deepEqual(queries[5].params, [41, 'pending_payment', now.toISOString(), period.to.toISOString()]);
  await repository.paymentSettings();
  assert.match(queries[6].sql, /select "value" from "booking_platform_settings" where "booking_platform_settings"\."key" = \$1 limit \$2/);
  assert.deepEqual(queries[6].params, ['payments', 1]);
});

test('payment fee disclosure matches the existing charge clamp and distinguishes an unset fee from explicit zero', async () => {
  for (const [settings, feeBasisPoints, feeConfigured] of [
    [null, 0, false], [{}, 0, false], [{ platformFeeBasisPoints: null }, 0, false],
    [{ platformFeeBasisPoints: 0 }, 0, true], [{ platformFeeBasisPoints: 75 }, 75, true],
    [{ platformFeeBasisPoints: '125' }, 125, true], [{ platformFeeBasisPoints: 125.5 }, 125.5, true],
    [{ platformFeeBasisPoints: -100 }, 0, true], [{ platformFeeBasisPoints: 9000 }, 5000, true],
  ]) {
    const d = dependencies();
    d.repository.paymentSettings = async () => settings;
    const response = await getMonaBookings(request(), d);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).paymentInfo, { feeBasisPoints, feeConfigured, feeAppliesTo: 'connected_booking_charge' });
  }
});

test('an unavailable or malformed fee cannot be presented as a zero-fee configuration', async () => {
  for (const read of [async () => { throw new Error('Settings unavailable'); }, async () => ({ platformFeeBasisPoints: 'invalid' })]) {
    const d = dependencies();
    d.repository.paymentSettings = read;
    const response = await getMonaBookings(request(), d);
    assert.equal(response.status, 503);
    assert.deepEqual(Object.keys(await response.json()), ['error']);
  }
});

test('business payment disclosure only reports setup state and never claims payouts or a balance', async () => {
  const d = dependencies();
  d.repository.businesses = async () => ['not_connected', 'setup_pending', 'enabled_on_record'].map((paymentStatus, index) => ({ ...business, id: index + 1, paymentStatus }));
  const data = await (await getMonaBookings(request(), d)).json();
  assert.deepEqual(data.businesses.map(row => row.paymentStatus), ['not_connected', 'setup_pending', 'enabled_on_record']);
  assert.doesNotMatch(JSON.stringify(data), /stripeAccountId|stripeChargesEnabled|private-stripe|payoutStatus|bankBalance|receivedIncome|providerNetCents/);
});
