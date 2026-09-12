import { MemberError } from './member-auth.mts';

/** Saved planning preferences only. These do not move money, change a connected
 * account's payout schedule, calculate tax liability, or file/pay taxes. */
export type PaymentPreferences = {
  payoutFrequency: null | 'daily' | 'weekly';
  weeklyPayoutDay: 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday';
  taxReservePercent: null | number;
  taxReminder: 'off' | 'monthly' | 'quarterly';
};

export function defaultPaymentPreferences(): PaymentPreferences {
  return { payoutFrequency: null, weeklyPayoutDay: 'monday', taxReservePercent: null, taxReminder: 'off' };
}

/** Omitted keys use defaults; supplied keys must be valid, with no extra data. */
export function parsePaymentPreferences(value: unknown): PaymentPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new MemberError(400, 'Please check your payment preferences.');
  }
  const input = value as Record<string, unknown>;
  const result = defaultPaymentPreferences();
  if (Reflect.ownKeys(input).some(key => typeof key !== 'string' || !Object.hasOwn(result, key))) {
    throw new MemberError(400, 'That payment preference is not supported.');
  }
  if (Object.hasOwn(input, 'payoutFrequency')) {
    if (input.payoutFrequency !== null && input.payoutFrequency !== 'daily' && input.payoutFrequency !== 'weekly') {
      throw new MemberError(400, 'Choose daily or weekly for your preferred payout schedule, or leave it unset.');
    }
    result.payoutFrequency = input.payoutFrequency;
  }
  if (Object.hasOwn(input, 'weeklyPayoutDay')) {
    if (typeof input.weeklyPayoutDay !== 'string' || !['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].includes(input.weeklyPayoutDay)) {
      throw new MemberError(400, 'Choose Monday through Friday for your preferred weekly payout day.');
    }
    result.weeklyPayoutDay = input.weeklyPayoutDay as PaymentPreferences['weeklyPayoutDay'];
  }
  if (Object.hasOwn(input, 'taxReservePercent')) {
    const percent = input.taxReservePercent;
    if (percent !== null && (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100 || !/^\d+(?:\.\d{1,2})?$/.test(String(percent)))) {
      throw new MemberError(400, 'Choose a tax reserve percentage from 0 to 100 with up to two decimal places, or leave it unset.');
    }
    result.taxReservePercent = percent === 0 ? 0 : percent as number | null;
  }
  if (Object.hasOwn(input, 'taxReminder')) {
    if (input.taxReminder !== 'off' && input.taxReminder !== 'monthly' && input.taxReminder !== 'quarterly') {
      throw new MemberError(400, 'Choose off, monthly, or quarterly for your tax review reminder.');
    }
    result.taxReminder = input.taxReminder;
  }
  return result;
}
