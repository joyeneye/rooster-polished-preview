import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCESS_LAUNCHED_AT,
  resolveCutoverAccessRepair,
  shouldGrandfatherAtCutover,
} from '../netlify/functions/_shared/roster-access-policy.mts';

const launchedAt = new Date(ACCESS_LAUNCHED_AT);
assert.equal(ACCESS_LAUNCHED_AT, '2026-09-08T06:08:30.204Z');
const row = overrides => ({
  status:'pending', grandfathered:false, decidedAt:null,
  accountCreatedAt:new Date('2026-09-08T05:00:00.000Z'),
  ...overrides,
});

test('untouched pending account from before the actual launch is repairable', () => {
  assert.equal(shouldGrandfatherAtCutover(row({}), launchedAt), true);
});

test('pending account created after launch stays pending', () => {
  assert.equal(shouldGrandfatherAtCutover(row({accountCreatedAt:'2026-09-08T07:00:00.000Z'}), launchedAt), false);
});

test('pending account with a Founder decision is preserved', () => {
  assert.equal(shouldGrandfatherAtCutover(row({decidedAt:'2026-09-08T05:30:00.000Z'}), launchedAt), false);
});

test('declined account is preserved', () => {
  assert.equal(shouldGrandfatherAtCutover(row({status:'declined'}), launchedAt), false);
});

test('a concurrent cutover repair re-reads and honors the winning row', async () => {
  const winner = row({status:'declined', decidedAt:new Date('2026-09-08T06:10:00.000Z')});
  let rereads = 0;
  const result = await resolveCutoverAccessRepair(row({}), launchedAt,
    async () => null,
    async () => { rereads += 1; return winner; },
  );
  assert.equal(result, winner);
  assert.equal(rereads, 1);
});

test('ineligible rows never attempt a repair or reread', async () => {
  const existing = row({status:'declined'});
  let work = 0;
  const result = await resolveCutoverAccessRepair(existing, launchedAt,
    async () => { work += 1; return null; },
    async () => { work += 1; return null; },
  );
  assert.equal(result, existing);
  assert.equal(work, 0);
});
