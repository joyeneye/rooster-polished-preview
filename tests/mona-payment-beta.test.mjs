import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultPaymentPreferences, parsePaymentPreferences } from '../netlify/functions/_shared/mona-payment-beta.mts';
import { MemberError } from '../netlify/functions/_shared/member-auth.mts';

const defaults = { payoutFrequency: null, weeklyPayoutDay: 'monday', taxReservePercent: null, taxReminder: 'off' };
function rejected(input) {
  assert.throws(() => parsePaymentPreferences(input), error => error instanceof MemberError && error.status === 400);
}

test('payment beta defaults do not imply a payout schedule, tax rate, or enabled reminder', () => {
  assert.deepEqual(defaultPaymentPreferences(), defaults);
  assert.deepEqual(parsePaymentPreferences({}), defaults);
  const first = defaultPaymentPreferences();
  first.payoutFrequency = 'daily';
  first.taxReservePercent = 100;
  assert.deepEqual(defaultPaymentPreferences(), defaults);
});

test('partial preference input receives defaults and returns a separate value without changing input', () => {
  const input = Object.freeze({ payoutFrequency: 'weekly', weeklyPayoutDay: 'friday' });
  const parsed = parsePaymentPreferences(input);
  assert.deepEqual(parsed, { ...defaults, payoutFrequency: 'weekly', weeklyPayoutDay: 'friday' });
  parsed.taxReminder = 'monthly';
  assert.deepEqual(input, { payoutFrequency: 'weekly', weeklyPayoutDay: 'friday' });
  assert.deepEqual(parsePaymentPreferences({ payoutFrequency: null, taxReservePercent: null }), defaults);
});

test('daily and weekly preferences accept every supported review cadence and weekday', () => {
  for (const payoutFrequency of ['daily', 'weekly']) {
    for (const weeklyPayoutDay of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']) {
      for (const taxReminder of ['off', 'monthly', 'quarterly']) {
        const input = { payoutFrequency, weeklyPayoutDay, taxReservePercent: 15.75, taxReminder };
        assert.deepEqual(parsePaymentPreferences(input), input);
      }
    }
  }
});

test('tax reserve remains a member-chosen percentage with exact two-decimal limits', () => {
  for (const taxReservePercent of [0, 0.01, 0.1, 1, 15.75, 29.99, 99.99, 100]) {
    assert.equal(parsePaymentPreferences({ taxReservePercent }).taxReservePercent, taxReservePercent);
  }
  assert.equal(Object.is(parsePaymentPreferences({ taxReservePercent: -0 }).taxReservePercent, -0), false);
  for (const taxReservePercent of [-0.01, 100.01, 0.001, 1.999, 25.00000000000001, NaN, Infinity, -Infinity, '25', '', true, {}, [], undefined]) {
    rejected({ taxReservePercent });
  }
});

test('schedule and review inputs reject unknown options without silent coercion', () => {
  for (const payoutFrequency of ['instant', 'monthly', 'Daily', '', false, 1, undefined]) rejected({ payoutFrequency });
  for (const weeklyPayoutDay of ['saturday', 'sunday', 'Monday', '', 1, null, undefined]) rejected({ weeklyPayoutDay });
  for (const taxReminder of ['annual', 'daily', 'Monthly', true, '', null, undefined]) rejected({ taxReminder });
});

test('preferences only accept plain objects and reject payment instructions and identity overrides', () => {
  for (const value of [null, undefined, [], 'daily', true, 100, new Date(), Object.create({ payoutFrequency: 'daily' })]) rejected(value);
  for (const key of ['memberId', 'businessId', 'bankAccount', 'taxId', 'payoutEnabled', 'platformFeeBasisPoints', 'taxPaid', 'constructor', '__proto__']) {
    rejected(JSON.parse(`{"${key}":"untrusted"}`));
  }
  rejected({ [Symbol('unknown')]: 'value' });
  assert.deepEqual(parsePaymentPreferences(Object.assign(Object.create(null), { taxReminder: 'quarterly' })), { ...defaults, taxReminder: 'quarterly' });
});
