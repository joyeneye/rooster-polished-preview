// Shared by the private workspace and its AI assistant. Amounts are always
// integer minor units; different currencies are never added to each other.
export const MONEY_CURRENCIES = Object.freeze(['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY']);
export const INCOME_TYPES = Object.freeze(['Publishing', 'Streaming', 'Sync', 'Performance', 'Sales', 'Shows', 'Other']);
const UNSAFE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]/;

export function currencyDigits(currency) {
  if (!MONEY_CURRENCIES.includes(currency)) throw new Error('Choose a supported currency.');
  return currency === 'JPY' ? 0 : 2;
}

function integerAmount(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a nonnegative, safe whole number of minor currency units.`);
  return value;
}

function cleanText(value, max, label, required = false) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') throw new Error(`${label} must be text.`);
  const result = value.trim().replace(/\s+/g, ' ');
  if ((required && !result) || result.length > max || UNSAFE.test(result)) throw new Error(`${label} is invalid${max ? ` (maximum ${max} characters)` : ''}.`);
  return result;
}

function calendarDate(value, label, required = false) {
  const result = cleanText(value, 10, label, required);
  if (!result) return '';
  const date = new Date(`${result}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || result.startsWith('0000') || Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== result) {
    throw new Error(`${label} must be a real date in YYYY-MM-DD format.`);
  }
  return result;
}

export function normalizeMoneyData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.record_type !== 'money-v1') throw new Error('Choose a valid money record.');
  const currency = cleanText(data.currency, 3, 'Currency', true).toUpperCase();
  currencyDigits(currency);
  const income_type = cleanText(data.income_type, 30, 'Income type', true);
  if (!INCOME_TYPES.includes(income_type)) throw new Error('Choose a supported income type.');
  const earned_cents = integerAmount(data.earned_cents, 'Earned amount');
  const paid_cents = integerAmount(data.paid_cents, 'Paid amount');
  if (paid_cents > earned_cents) throw new Error('Paid amount cannot be higher than earned amount.');
  return {
    record_type: 'money-v1',
    song_title: cleanText(data.song_title, 180, 'Song title'),
    source: cleanText(data.source, 120, 'Source or payer', true),
    income_type, currency, earned_cents, paid_cents,
    expected_date: calendarDate(data.expected_date, 'Expected date'),
    paid_date: calendarDate(data.paid_date, 'Paid date'),
    period: cleanText(data.period, 80, 'Statement period'),
    territory: cleanText(data.territory, 100, 'Territory'),
    statement_reference: cleanText(data.statement_reference, 180, 'Statement reference'),
    notes: cleanText(data.notes, 2000, 'Notes'),
  };
}

export function parseMoneyAmount(value, currency) {
  const digits = currencyDigits(currency);
  if (typeof value !== 'string') throw new Error('Enter an amount as text.');
  const input = value.trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(input)) throw new Error('Enter a nonnegative amount, such as 125 or 125.50.');
  const [whole, fraction = ''] = input.replaceAll(',', '').split('.');
  if (fraction.length > digits) throw new Error(digits ? `Use no more than ${digits} decimal places.` : 'JPY amounts must be whole yen.');
  const amount = BigInt(whole) * (10n ** BigInt(digits)) + BigInt(fraction.padEnd(digits, '0') || '0');
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('That amount is too large to track accurately.');
  return Number(amount);
}

export function formatMoney(value, currency) {
  const digits = currencyDigits(currency);
  integerAmount(value, 'Amount');
  const units = BigInt(value), scale = 10n ** BigInt(digits);
  // Formatting the integer part as BigInt avoids loss of cents near MAX_SAFE_INTEGER.
  const parts = new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).formatToParts(units / scale);
  const fraction = (units % scale).toString().padStart(digits, '0');
  return parts.map(part => part.type === 'fraction' ? fraction : part.value).join('');
}

function addAmounts(a, b) {
  const result = a + b;
  if (!Number.isSafeInteger(result)) throw new Error('These totals are too large to calculate accurately. Review the individual entries.');
  return result;
}

function accumulate(target, data) {
  target.earned_cents = addAmounts(target.earned_cents, data.earned_cents);
  target.paid_cents = addAmounts(target.paid_cents, data.paid_cents);
  target.outstanding_cents = addAmounts(target.outstanding_cents, data.earned_cents - data.paid_cents);
}

function groupBy(map, key, label, data) {
  let group = map.get(key);
  if (!group) { group = { [label]: key, earned_cents: 0, paid_cents: 0, outstanding_cents: 0 }; map.set(key, group); }
  accumulate(group, data);
}

export function summarizeMoney(records, { today = new Date().toISOString().slice(0, 10) } = {}) {
  calendarDate(today, 'Today', true);
  if (!Array.isArray(records)) throw new Error('Money records must be a list.');
  const groups = new Map(), entries = [];
  let unrecognized_count = 0;
  for (const record of records) {
    if (!record || record.kind !== 'royalty') continue;
    let data;
    try { data = normalizeMoneyData(record.data); } catch { unrecognized_count++; continue; }
    const outstanding = data.earned_cents - data.paid_cents;
    const overdue = outstanding > 0 && Boolean(data.expected_date) && data.expected_date < today;
    const status = !outstanding ? 'paid' : overdue ? 'overdue' : data.paid_cents ? 'part-paid' : 'unpaid';
    entries.push({ ...data, id: record.id, title: typeof record.title === 'string' ? record.title : '', status });
    let group = groups.get(data.currency);
    if (!group) {
      group = { currency: data.currency, earned_cents: 0, paid_cents: 0, outstanding_cents: 0, overdue_cents: 0, count: 0, sources: new Map(), songs: new Map() };
      groups.set(data.currency, group);
    }
    accumulate(group, data);
    if (overdue) group.overdue_cents = addAmounts(group.overdue_cents, outstanding);
    group.count++;
    groupBy(group.sources, data.source, 'source', data);
    groupBy(group.songs, data.song_title, 'song_title', data);
  }
  const currencies = MONEY_CURRENCIES.filter(currency => groups.has(currency)).map(currency => {
    const group = groups.get(currency);
    return { ...group, sources: [...group.sources.values()], songs: [...group.songs.values()] };
  });
  return { currencies, entries, unrecognized_count };
}
