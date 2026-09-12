import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { transform } from 'esbuild';
import * as orm from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pg-proxy';
import * as schema from '../db/schema.ts';
import * as auth from '../netlify/functions/_shared/booking-auth.mts';

// Exercise the actual handlers and real Drizzle SQL, with only database results
// and identity/access resolution replaced. No production credentials or writes.
const source = readFileSync(new URL('../netlify/functions/_shared/booking-api.mts', import.meta.url), 'utf8');
const { code } = await transform(source, { loader: 'ts', format: 'cjs', target: 'node22' });
const service = { id: 71, businessId: 23, categoryId: 42, name: 'Podcast interview', priceCents: 12500, durationMinutes: 45, active: true, onlineBookingEnabled: true };
const business = { id: 23, ownerUserId: 5, slug: 'multi-role-creator', name: 'Creator', categoryId: 8, status: 'active', published: true };
const category = { id: 42, slug: 'podcast-interviews', name: 'Podcast interviews', active: true };
const row = (table, values) => Object.keys(orm.getTableColumns(table)).map(key => values[key] ?? null);
const request = (method, data, endpoint = 'services') => new Request(`https://jwhitedidit.net/api/booking/${endpoint}`, {
  method, headers: { origin: 'https://jwhitedidit.net', 'content-type': 'application/json' }, body: JSON.stringify(data),
});

function environment({ categoryExists = true, serviceExists = true, deny = false, visibleServices = [service], queryRunner } = {}) {
  const queries = [], access = [];
  const database = drizzle(async (sql, params) => {
    queries.push({ sql, params });
    if (queryRunner) return queryRunner(sql, params);
    if (sql.startsWith('select') && sql.includes('from "booking_subscriptions"')) return { rows: [] };
    if (sql.startsWith('select') && sql.includes('from "booking_categories"')) {
      return { rows: categoryExists ? [sql.includes('"slug"') ? [category.id, category.slug, category.name] : [category.id]] : [] };
    }
    if (sql.startsWith('select') && sql.includes('from "booking_services"')) return { rows: (serviceExists ? visibleServices : []).map(value => row(schema.bookingServices, value)) };
    if (sql.startsWith('insert into "booking_services"') || sql.startsWith('update "booking_services"')) return { rows: [row(schema.bookingServices, service)] };
    if (sql.startsWith('select') && sql.includes('from "booking_businesses"')) return { rows: [[...row(schema.bookingBusinesses, business), ...row(schema.bookingCategories, { id: 8, slug: 'professional-services', name: 'Professional Services' })]] };
    if (sql.startsWith('update "booking_businesses"')) return { rows: [row(schema.bookingBusinesses, business)] };
    if (sql.startsWith('select') && /from "booking_(staff|staff_services|business_hours|reviews)"/.test(sql)) return { rows: [] };
    throw new Error(`Unexpected offline query: ${sql}`);
  });
  const dependencies = {
    'node:crypto': crypto, 'drizzle-orm': orm,
    '../../../db/index.js': { db: database }, '../../../db/schema.js': schema,
    './booking-availability.mts': { availableSlots: () => { throw new Error('Availability is outside these tests.'); } },
    './booking-auth.mts': {
      ...auth,
      requireBookingUser: async () => ({ id: 5, email: 'creator@example.test' }),
      requireBusinessAccess: async (id, roles) => {
        access.push({ id, roles });
        if (deny) throw new auth.BookingError(403, 'Access denied.');
        return { business, role: 'owner' };
      },
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports, Request, Response, URL, Date, console,
    require: name => { if (!(name in dependencies)) throw new Error(`Unexpected import ${name}`); return dependencies[name]; },
  });
  return { ...module.exports, queries, access };
}

const lookup = state => state.queries.find(query => query.sql.includes('from "booking_categories"'));
const write = (state, table = 'booking_services') => state.queries.find(query => query.sql.startsWith(`insert into "${table}"`) || query.sql.startsWith(`update "${table}"`));

test('service creation stores its own active category without changing quoted price or duration', async () => {
  const state = environment();
  const response = await state.servicesAPI(request('POST', { businessId: 23, categoryId: '42', name: service.name, priceCents: 12500, durationMinutes: 45 }));
  assert.equal(response.status, 201);
  assert.deepEqual(state.access, [{ id: 23, roles: undefined }]);
  assert.match(lookup(state).sql, /"booking_categories"\."active" = \$2/);
  assert.deepEqual(lookup(state).params, [42, true, 1]);
  const mutation = write(state);
  assert.match(mutation.sql, /"business_id", "category_id", "name"/);
  assert.deepEqual(mutation.params.slice(0, 6), [23, 42, service.name, '', 12500, 45]);
});

test('service PATCH preserves an omitted category, clears null, and stores a valid replacement', async () => {
  for (const [fields, expected] of [[{ name: 'New title' }, undefined], [{ categoryId: null }, null], [{ categoryId: 42 }, 42]]) {
    const state = environment();
    const response = await state.servicesAPI(request('PATCH', { businessId: 23, serviceId: 71, ...fields }));
    assert.equal(response.status, 200);
    const mutation = write(state);
    assert.match(mutation.sql, /where \(\("booking_services"\."id" = \$\d+\) and \("booking_services"\."business_id" = \$\d+\)\)/);
    assert.deepEqual(mutation.params.slice(-2), [71, 23]);
    assert.doesNotMatch(mutation.sql.split(' where ')[0], /"price_cents" =|"duration_minutes" =/);
    if (expected === undefined) {
      assert.doesNotMatch(mutation.sql.split(' where ')[0], /"category_id" =/);
      assert.equal(lookup(state), undefined);
    } else {
      assert.match(mutation.sql, /set "category_id" = \$1/);
      assert.equal(mutation.params[0], expected);
      assert.equal(Boolean(lookup(state)), expected !== null);
    }
  }
});

test('missing or inactive categories cannot be assigned to services or businesses', async () => {
  for (const [handler, endpoint, fields] of [
    ['servicesAPI', 'services', { businessId: 23, serviceId: 71 }],
    ['businessesAPI', 'businesses', { businessId: 23 }],
  ]) {
    const state = environment({ categoryExists: false });
    const response = await state[handler](request('PATCH', { ...fields, categoryId: 9000 }, endpoint));
    assert.equal(response.status, 400);
    assert.deepEqual(lookup(state).params, [9000, true, 1]);
    assert.equal(state.queries.some(query => /^(insert|update) /.test(query.sql)), false);
  }
});

test('invalid category types cannot silently clear a category or become another category ID', async () => {
  for (const categoryId of [true, false, {}, [], [42], '', 0, -1, 1.5, '42x', Number.MAX_SAFE_INTEGER + 1]) {
    const state = environment();
    const response = await state.servicesAPI(request('PATCH', { businessId: 23, serviceId: 71, categoryId }));
    assert.equal(response.status, 400, JSON.stringify(categoryId));
    assert.equal(lookup(state), undefined);
    assert.equal(write(state), undefined);
  }
});

test('service category changes remain behind business authorization and scoped service lookup', async () => {
  const denied = environment({ deny: true });
  assert.equal((await denied.servicesAPI(request('PATCH', { businessId: 23, serviceId: 71, categoryId: 42 }))).status, 403);
  assert.equal(denied.queries.length, 0);
  const otherTenant = environment({ serviceExists: false });
  assert.equal((await otherTenant.servicesAPI(request('PATCH', { businessId: 23, serviceId: 999, categoryId: 42 }))).status, 404);
  assert.deepEqual(otherTenant.queries[0].params, [999, 23, 1]);
  assert.match(otherTenant.queries[0].sql, /"booking_services"\."business_id" = \$2/);
  assert.equal(lookup(otherTenant), undefined);
  assert.equal(write(otherTenant), undefined);
});

test('business PATCH uses the same active category rules and preserves owner/manager authorization', async () => {
  for (const [fields, expected] of [[{ name: 'New name' }, undefined], [{ categoryId: null }, null], [{ categoryId: 42 }, 42]]) {
    const state = environment();
    const response = await state.businessesAPI(request('PATCH', { businessId: 23, ...fields }, 'businesses'));
    assert.equal(response.status, 200);
    assert.deepEqual(Array.from(state.access[0].roles), ['owner', 'manager']);
    const mutation = write(state, 'booking_businesses');
    assert.equal(mutation.params.at(-1), 23);
    if (expected === undefined) assert.doesNotMatch(mutation.sql.split(' where ')[0], /"category_id" =/);
    else assert.equal(mutation.params[0], expected);
  }
});

test('public service category lookup contains only active categories referenced by visible services', async () => {
  const state = environment({ visibleServices: [service, { ...service, id: 72 }, { ...service, id: 73, categoryId: null }] });
  const response = await state.publicAPI(new Request('https://jwhitedidit.net/api/booking/public?action=profile&slug=multi-role-creator'));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).serviceCategories, [{ id: 42, slug: 'podcast-interviews', name: 'Podcast interviews' }]);
  assert.match(lookup(state).sql, /"booking_categories"\."id" in \(\$1\)\) and \("booking_categories"\."active" = \$2/);
  assert.deepEqual(lookup(state).params, [42, true]);
  const services = state.queries.find(query => query.sql.includes('from "booking_services"'));
  assert.deepEqual(services.params, [23, true, true]);
});

test('uncategorized existing services continue to render without a category database query', async () => {
  const state = environment({ visibleServices: [{ ...service, categoryId: null }] });
  const response = await state.publicAPI(new Request('https://jwhitedidit.net/api/booking/public?action=profile&slug=multi-role-creator'));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).serviceCategories, []);
  assert.equal(lookup(state), undefined);
});

test('category discovery finds mixed-role providers once and excludes unavailable services and unpublished businesses', async () => {
  // The generated SELECT uses SQL shared by PostgreSQL and SQLite. Execute it
  // against isolated fixture tables to verify OR/EXISTS grouping and visibility.
  const sqlite = new DatabaseSync(':memory:');
  const tables = [schema.bookingCategories, schema.bookingBusinesses, schema.bookingServices];
  for (const table of tables) {
    const columns = Object.values(orm.getTableColumns(table));
    sqlite.exec(`CREATE TABLE "${orm.getTableName(table)}" (${columns.map(column => `"${column.name}" ${/serial|int|numeric|real|double|boolean/i.test(column.getSQLType()) ? 'NUMERIC' : 'TEXT'}`).join(', ')})`);
  }
  const bind = value => typeof value === 'boolean' ? Number(value) : value;
  function insert(table, values) {
    const columns = orm.getTableColumns(table), keys = Object.keys(values);
    sqlite.prepare(`INSERT INTO "${orm.getTableName(table)}" (${keys.map(key => `"${columns[key].name}"`).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map(key => bind(values[key])));
  }
  insert(schema.bookingCategories, category);
  insert(schema.bookingCategories, { id: 8, slug: 'speaking', name: 'Speaking engagements', active: true });
  insert(schema.bookingCategories, { id: 43, slug: 'inactive-type', name: 'Retired category', active: false });
  const cases = [
    { id: 23, name: 'Speaker with podcast interviews', categoryId: 8, status: 'active', published: true },
    { id: 24, name: 'Primary podcast category', categoryId: 42, status: 'active', published: true },
    { id: 25, name: 'Hidden service', categoryId: 8, status: 'active', published: true },
    { id: 26, name: 'Inactive service', categoryId: 8, status: 'active', published: true },
    { id: 27, name: 'Draft business', categoryId: 8, status: 'active', published: false },
    { id: 28, name: 'Inactive business', categoryId: 8, status: 'suspended', published: true },
    { id: 29, name: 'Draft primary category', categoryId: 42, status: 'active', published: false },
    { id: 30, name: 'Inactive primary category business', categoryId: 42, status: 'suspended', published: true },
    { id: 31, name: 'Retired service category', categoryId: 8, status: 'active', published: true },
    { id: 32, name: 'Retired primary category', categoryId: 43, status: 'active', published: true },
    { id: 33, name: 'No matching services', categoryId: 8, status: 'active', published: true },
  ];
  for (const value of cases) insert(schema.bookingBusinesses, value);
  const services = [
    { id: 71, businessId: 23 }, { id: 72, businessId: 23 },
    { id: 73, businessId: 25, onlineBookingEnabled: false },
    { id: 74, businessId: 26, active: false },
    { id: 75, businessId: 27 }, { id: 76, businessId: 28 },
    { id: 77, businessId: 31, categoryId: 43 },
  ];
  for (const value of services) insert(schema.bookingServices, { categoryId: 42, active: true, onlineBookingEnabled: true, ...value });
  const state = environment({ queryRunner: (sql, params) => {
    const statement = sqlite.prepare(sql);
    statement.setReturnArrays(true);
    return { rows: statement.all(Object.fromEntries(params.map((value, index) => [`$${index + 1}`, bind(value)]))) };
  } });
  try {
    const response = await state.publicAPI(new Request('https://jwhitedidit.net/api/booking/public?action=discover&category=podcast-interviews'));
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).providers.map(provider => provider.business.id).sort((a, b) => a - b), [23, 24]);
    assert.match(state.queries[0].sql, /exists \(select/);
    assert.equal(state.queries[0].params.at(-1), 50);
    const inactive = await state.publicAPI(new Request('https://jwhitedidit.net/api/booking/public?action=discover&category=inactive-type'));
    assert.equal(inactive.status, 200);
    assert.deepEqual((await inactive.json()).providers, []);
    const unknown = await state.publicAPI(new Request('https://jwhitedidit.net/api/booking/public?action=discover&category=unknown-type'));
    assert.deepEqual((await unknown.json()).providers, []);
  } finally {
    sqlite.close();
  }
});
