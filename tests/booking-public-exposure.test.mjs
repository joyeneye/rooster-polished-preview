import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// /api/booking/public answers anyone, signed in or not. It once returned whole database
// rows, which put every staff member's phone number and the business's Stripe account id
// in public view. These guards are static on purpose: they need no database, so they run
// anywhere and fail loudly if a query goes back to selecting everything.

const source = await readFile(new URL('../netlify/functions/_shared/booking-api.mts', import.meta.url), 'utf8');
const publicApi = source.slice(source.indexOf('export async function publicAPI'));
const columnMaps = source.slice(source.indexOf('const publicBusiness = {'), source.indexOf('export async function publicAPI'));

test('the public booking payload names its columns instead of taking whole rows', () => {
  assert.match(columnMaps, /const publicBusiness = \{/);
  assert.match(columnMaps, /const publicStaff = \{/);
  // A bare select() over these tables returns every column, including the private ones.
  assert.doesNotMatch(publicApi, /db\.select\(\)\.from\(bookingStaff\)/,
    'public staff must be selected column by column');
  assert.doesNotMatch(publicApi, /select\(\{\s*business:\s*bookingBusinesses/,
    'the business row must not be spread into a public response');
});

test('nothing about the owner account is public', () => {
  for (const field of ['ownerUserId', 'stripeAccountId', 'stripeChargesEnabled']) {
    assert.doesNotMatch(columnMaps, new RegExp(`bookingBusinesses\\.${field}\\b`),
      `${field} must never reach a public booking page`);
  }
});

test('staff are introduced, not exposed', () => {
  for (const field of ['email', 'phone', 'userId']) {
    assert.doesNotMatch(columnMaps, new RegExp(`bookingStaff\\.${field}\\b`),
      `a staff member's ${field} is the business's own`);
  }
});

test('the booking page still gets everything it renders', () => {
  // Read by the app (BookingBusiness/BookingStaff) and by public/booking-*.js.
  const business = ['id', 'slug', 'name', 'description', 'logoUrl', 'coverUrl', 'city', 'region',
    'addressLine1', 'phone', 'email', 'timezone', 'currency', 'theme', 'gallery', 'socialLinks',
    'policies', 'averageRating', 'reviewCount', 'featured'];
  for (const field of business) {
    assert.match(columnMaps, new RegExp(`\\b${field}: bookingBusinesses\\.${field}\\b`), `business.${field} is rendered`);
  }
  for (const field of ['id', 'name', 'role', 'bio', 'photoUrl']) {
    assert.match(columnMaps, new RegExp(`\\b${field}: bookingStaff\\.${field}\\b`), `staff.${field} is rendered`);
  }
});
