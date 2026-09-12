import test from 'node:test';
import assert from 'node:assert/strict';
import { PgDialect } from 'drizzle-orm/pg-core';
import { rcmRecords, rcmProfiles, rcmAiMessages } from '../db/schema.ts';
import { createRcmWorkspaceHandler } from '../netlify/functions/rcm-workspace.mts';
import { MemberError } from '../netlify/functions/_shared/member-auth.mts';
import { MONEY_CURRENCIES, INCOME_TYPES, currencyDigits, normalizeMoneyData, parseMoneyAmount, formatMoney, summarizeMoney } from '../rcm-money.mjs';

const data = (extra = {}) => ({ record_type: 'money-v1', source: 'Publisher One', song_title: 'My Song', income_type: 'Publishing', currency: 'USD', earned_cents: 125050, paid_cents: 50000, ...extra });
const record = (extra = {}, id = 1) => ({ id, title: 'Publishing payment', kind: 'royalty', data: data(extra) });

test('money input uses exact integer minor units and rejects silent rounding', () => {
  assert.equal(parseMoneyAmount('1,234.56', 'USD'), 123456);
  assert.equal(parseMoneyAmount(' 0.10 ', 'USD'), 10);
  assert.equal(parseMoneyAmount('0001.1', 'EUR'), 110);
  assert.equal(parseMoneyAmount('90,071,992,547,409.91', 'USD'), Number.MAX_SAFE_INTEGER);
  for (const value of ['1.001', '-1', '1e3', '1,23.45', '$1.00', 'NaN', 'Infinity', '', '90,071,992,547,409.92']) assert.throws(() => parseMoneyAmount(value, 'USD'), undefined, value);
  assert.throws(() => parseMoneyAmount(12, 'USD'), /text/);
});

test('JPY uses whole yen, and formatting keeps the final cent even at the safe maximum', () => {
  assert.equal(currencyDigits('JPY'), 0);
  assert.equal(parseMoneyAmount('1,234', 'JPY'), 1234);
  assert.throws(() => parseMoneyAmount('12.0', 'JPY'), /whole yen/);
  assert.equal(formatMoney(1234, 'JPY'), '¥1,234');
  assert.equal(formatMoney(1234, 'USD'), '$12.34');
  assert.equal(formatMoney(Number.MAX_SAFE_INTEGER, 'USD'), '$90,071,992,547,409.91');
  assert.throws(() => currencyDigits('BTC'), /currency/);
});

test('normalization is canonical, preserves source details and drops unsupported keys', () => {
  const normalized = normalizeMoneyData(data({ currency: 'usd', source: ' Publisher   One ', notes: ' Quarter one ', expected_date: '2028-02-29', unexpected: 'ignored' }));
  assert.equal(normalized.currency, 'USD');
  assert.equal(normalized.source, 'Publisher One');
  assert.equal(normalized.notes, 'Quarter one');
  assert.equal(normalized.expected_date, '2028-02-29');
  assert.equal(normalized.paid_date, '');
  assert.equal(normalized.statement_reference, '');
  assert.equal(Object.hasOwn(normalized, 'unexpected'), false);
  assert.equal(MONEY_CURRENCIES.length, 6);
  assert.equal(INCOME_TYPES.includes('Sync'), true);
});

test('invalid dates, amounts, schema, and unsafe text cannot enter the ledger', () => {
  for (const bad of [
    { earned_cents: -1 }, { earned_cents: 0.1 }, { earned_cents: '125050' }, { earned_cents: Number.MAX_SAFE_INTEGER + 1 },
    { paid_cents: 125051 }, { paid_cents: -2 }, { record_type: 'legacy' }, { currency: 'BTC' },
    { income_type: 'Imaginary' }, { source: '' }, { source: '<script>' }, { notes: 'a'.repeat(2001) },
    { expected_date: '2026-02-29' }, { paid_date: '2026-13-01' }, { expected_date: '2026-01-01T00:00:00Z' },
  ]) assert.throws(() => normalizeMoneyData(data(bad)), undefined, JSON.stringify(bad));
});

test('totals stay separate by currency and show outstanding money by payer and song', () => {
  const summary = summarizeMoney([
    record({ expected_date: '2026-09-01' }, 1),
    record({ earned_cents: 10000, paid_cents: 10000, source: 'Publisher Two' }, 2),
    record({ earned_cents: 5000, paid_cents: 0, source: 'Publisher One', song_title: 'Second Song', expected_date: '2026-10-01' }, 3),
    record({ earned_cents: 3000, paid_cents: 1000, currency: 'EUR', expected_date: '2026-09-11' }, 4),
    record({ earned_cents: 1400, paid_cents: 0, currency: 'JPY' }, 5),
  ], { today: '2026-09-11' });
  assert.deepEqual(summary.currencies.map(row => [row.currency, row.earned_cents, row.paid_cents, row.outstanding_cents, row.overdue_cents]), [
    ['USD', 140050, 60000, 80050, 75050], ['EUR', 3000, 1000, 2000, 0], ['JPY', 1400, 0, 1400, 0],
  ]);
  assert.deepEqual(summary.entries.map(entry => entry.status), ['overdue', 'paid', 'unpaid', 'part-paid', 'unpaid']);
  assert.deepEqual(summary.currencies[0].sources[0], { source: 'Publisher One', earned_cents: 130050, paid_cents: 50000, outstanding_cents: 80050 });
  assert.deepEqual(summary.currencies[0].songs[0], { song_title: 'My Song', earned_cents: 135050, paid_cents: 60000, outstanding_cents: 75050 });
  assert.equal(summary.entries[0].id, 1);
});

test('legacy and malformed royalties are counted, excluded, and never guessed into totals', () => {
  const summary = summarizeMoney([
    { kind: 'song', data: { amount: 500 } }, { kind: 'royalty', data: { amount: 500 } },
    record({ earned_cents: '500' }), record({ earned_cents: 0, paid_cents: 0 }),
  ]);
  assert.equal(summary.unrecognized_count, 2);
  assert.equal(summary.entries.length, 1);
  assert.equal(summary.entries[0].status, 'paid');
  assert.equal(summary.currencies[0].earned_cents, 0);
  assert.deepEqual(summarizeMoney([]), { currencies: [], entries: [], unrecognized_count: 0 });
});

test('aggregate overflow fails visibly rather than reporting inaccurate money', () => {
  assert.throws(() => summarizeMoney([record({ earned_cents: Number.MAX_SAFE_INTEGER, paid_cents: 0 }), record({ earned_cents: 1, paid_cents: 0 })]), /too large/);
  assert.throws(() => summarizeMoney([], { today: '2026-02-31' }), /real date/);
});

// Exercise the actual HTTP handler against an in-memory adapter. Its Drizzle
// predicates are rendered to SQL and applied, including member ownership.
const dialect = new PgDialect();
const dbFields = { member_id: 'memberId', updated_at: 'updatedAt' };
function matches(row, condition) {
  if (!condition) return true;
  const { sql, params } = dialect.sqlToQuery(condition);
  assert.doesNotMatch(sql, /\bor\b/i);
  const checks = [...sql.matchAll(/"[^"]+"\."([^"]+)" = \$(\d+)/g)];
  assert.ok(checks.length, 'The adapter must understand the production predicate');
  return checks.every(([, key, index]) => {
    const value = row[dbFields[key] || key], expected = params[Number(index) - 1];
    return value instanceof Date ? value.toISOString() === new Date(expected).toISOString() : value === expected;
  });
}
function memory(initial = []) {
  const rows = initial.map(row => ({ memberId: 'alice', status: 'draft', relationKey: '', dueAt: null, updatedAt: new Date('2026-09-10T00:00:00Z'), ...row }));
  let mutationCount = 0;
  const database = {
    select: () => ({ from(table) {
      let condition, cap = Infinity;
      const source = table === rcmRecords ? rows : table === rcmProfiles || table === rcmAiMessages ? [] : assert.fail('Unexpected table');
      const query = { where(value) { condition = value; return query; }, orderBy() { return query; }, limit(value) { cap = value; return query; }, then(resolve, reject) { return Promise.resolve(source.filter(row => matches(row, condition)).slice(0, cap).map(row => ({ ...row }))).then(resolve, reject); } };
      return query;
    } }),
    insert: () => ({ values(value) { return { async returning() { mutationCount++; const row = { id: rows.length + 1, ...value }; rows.push(row); return [row]; } }; } }),
    update: () => ({ set(value) { return { where(condition) { return { async returning() { const row = rows.find(row => matches(row, condition)); if (!row) return []; mutationCount++; Object.assign(row, value); return [row]; } }; } }; } }),
  };
  return { rows, database, get mutationCount() { return mutationCount; } };
}
const origin = 'https://jwhitedidit.net';
const get = suffix => new Request(`${origin}/api/rcm/workspace${suffix || ''}`);
const post = body => new Request(`${origin}/api/rcm/workspace`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'record', kind: 'royalty', title: 'Publishing income', data: data(), ...body }) });
const handler = (store, id = 'alice') => createRcmWorkspaceHandler({ database: store.database, resolveMember: async () => ({ id, name: id }) });

test('HTTP money view returns every owned royalty and standard workspace explicitly reports its cap', async () => {
  const store = memory([...Array.from({ length: 260 }, (_, i) => record({}, i + 1)), { ...record({}, 900), memberId: 'bob' }, { id: 901, kind: 'song', title: 'A song', data: {} }]);
  const own = handler(store);
  const money = await (await own(get('?view=money&member_id=bob'))).json();
  assert.equal(money.records.length, 260);
  assert.ok(money.records.every(row => row.kind === 'royalty' && row.id !== 900));
  const workspace = await (await own(get())).json();
  assert.equal(workspace.records.length, 250);
  assert.equal(workspace.truncated, true);
  assert.equal((await (await handler(memory([record()]))(get())).json()).truncated, false);
});

test('HTTP saves normalize money, reject invalid IDs and amounts, and preserve legacy entries', async () => {
  const store = memory(), own = handler(store);
  const created = await own(post({ data: data({ source: '  Publisher   One ' }) }));
  assert.equal(created.status, 201);
  assert.equal((await created.json()).record.data.source, 'Publisher One');
  for (const id of [0, -1, 0.5, '1.5', 'abc', '', null, true, Number.MAX_SAFE_INTEGER + 1]) assert.equal((await own(post({ id }))).status, 400, String(id));
  assert.equal((await own(post({ data: data({ paid_cents: 200000 }) }))).status, 400);
  assert.equal((await own(post({ kind: 'song' }))).status, 400);
  assert.equal(store.mutationCount, 1);
  const legacy = await own(post({ data: { old_royalty_amount: 'unknown format' } }));
  assert.equal(legacy.status, 201);
  assert.deepEqual((await legacy.json()).record.data, { old_royalty_amount: 'unknown format' });
});

test('HTTP member ownership and money schema cannot be bypassed when updating an entry', async () => {
  const store = memory([record(), { ...record({}, 2), memberId: 'bob' }]), own = handler(store);
  assert.equal((await own(post({ id: 2, member_id: 'bob' }))).status, 404);
  assert.equal((await own(post({ id: 1, kind: 'song', data: {} }))).status, 400);
  assert.equal((await own(post({ id: 1, data: { old_amount: 12 } }))).status, 400);
  assert.equal(store.mutationCount, 0);
  const updated = await own(post({ id: 1, data: data({ paid_cents: 125050, paid_date: '2026-09-11' }) }));
  assert.equal(updated.status, 200);
  assert.equal(store.rows.length, 2);
  assert.equal(store.rows[0].data.paid_cents, 125050);
  assert.equal(store.rows[1].data.paid_cents, 50000);
});

test('HTTP actions require membership and cross-origin writes are rejected', async () => {
  const store = memory(), own = handler(store);
  const denied = createRcmWorkspaceHandler({ database: store.database, resolveMember: async () => { throw new MemberError(401, 'Log in.'); } });
  assert.equal((await denied(get('?view=money'))).status, 401);
  assert.equal((await denied(post({}))).status, 401);
  const request = post({}); request.headers.set('Origin', 'https://unrelated.example');
  assert.equal((await own(request)).status, 403);
  assert.equal(store.mutationCount, 0);
});
