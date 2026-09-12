const TYPES = {'creator-program':'Creator program','brand-brief':'Brand brief',casting:'Casting',gig:'Gig / project','service-request':'Service request'};
export function leadType(value) { return TYPES[value] || 'Opportunity'; }
export function sourceURL(value) {
  if (typeof value !== 'string' || value.length > 2000 || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value), host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !/^[a-z0-9.-]+\.[a-z]{2,63}$/.test(host) || /(^|\.)(localhost|local|internal|test|invalid|example|onion)$/.test(host) || /(^|\.)example\.(com|net|org)$/.test(host)) return null;
    url.hostname = host;
    return url.href;
  } catch { return null; }
}
export function bookingURL(value, origin) {
  if (typeof value !== 'string' || !/^\/book\/[a-z0-9]+(?:-[a-z0-9]+)*\/?$/.test(value)) return null;
  return new URL(value, origin).href;
}
export function money(cents, currency = 'USD') {
  if (!Number.isSafeInteger(cents) || cents < 0 || !/^[A-Z]{3}$/.test(currency)) return 'Unavailable';
  try { return new Intl.NumberFormat(undefined, {style:'currency',currency,maximumFractionDigits:2}).format(cents / 100); }
  catch { return 'Unavailable'; }
}
export function moneyGroups(values) {
  if (!Array.isArray(values)) return 'Unavailable';
  if (!values.length) return 'None recorded';
  return values.map(value => money(value.amountCents, value.currency)).join(' · ');
}
export function dateLabel(value, options = {month:'short',day:'numeric',year:'numeric'}) {
  const date = new Date(value || '');
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, options) : 'Date not available';
}
export function replyDraft({preferences = {}, profile = {}, lead = {}, bookingLink = ''} = {}) {
  const name = typeof profile.name === 'string' ? profile.name.trim() : '';
  const offer = typeof preferences.offering === 'string' ? preferences.offering.trim() : '';
  const title = typeof lead.title === 'string' ? lead.title.trim() : 'your opportunity';
  const org = typeof lead.organization === 'string' ? lead.organization.trim() : '';
  return `Hi${org ? ` ${org} team` : ''},\n\n${name ? `I’m ${name}. ` : ''}I saw ${title} and would like to learn more.${offer ? `\n\nHere’s what I offer: ${offer}` : ''}\n\nCould you share the next steps and what you’re looking for?${bookingLink ? `\n\nIf an appointment would help, here’s my booking page: ${bookingLink}` : ''}\n\nThank you${name ? `,\n${name}` : '!'}`;
}
export function matchingLeads(leads, filter) {
  return (Array.isArray(leads) ? leads : []).filter(lead => filter === 'all' || (filter === 'active' ? lead.status !== 'archived' : lead.status === filter));
}
export function memberID(value) { return typeof value === 'string' && /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(value); }

export function paymentPreferences(value = {}) {
  const percentage = value?.taxReservePercent;
  return {
    payoutFrequency: ['daily','weekly'].includes(value?.payoutFrequency) ? value.payoutFrequency : null,
    weeklyPayoutDay: ['monday','tuesday','wednesday','thursday','friday'].includes(value?.weeklyPayoutDay) ? value.weeklyPayoutDay : 'monday',
    taxReservePercent: typeof percentage === 'number' && Number.isFinite(percentage) && percentage >= 0 && percentage <= 100 && Math.abs(percentage * 100 - Math.round(percentage * 100)) < 0.000001 ? percentage : null,
    taxReminder: ['monthly','quarterly'].includes(value?.taxReminder) ? value.taxReminder : 'off',
  };
}

// An estimate of a member-selected share of recorded charges, never a tax bill or bank balance.
export function reserveEstimate(values, percentage) {
  if (!Array.isArray(values) || typeof percentage !== 'number' || !Number.isFinite(percentage) || percentage < 0 || percentage > 100) return null;
  const result = [];
  for (const row of values) {
    if (!row || !Number.isSafeInteger(row.amountCents) || row.amountCents < 0 || !/^[A-Z]{3}$/.test(row.currency)) return null;
    const amountCents = Math.round(row.amountCents * (percentage / 100));
    if (!Number.isSafeInteger(amountCents)) return null;
    result.push({currency:row.currency,amountCents});
  }
  return result;
}

export function taxCheckIn({taxReviewedAt, paymentPreferences:preferences} = {}, now = new Date()) {
  const cadence = paymentPreferences(preferences).taxReminder;
  if (cadence === 'off') return null;
  const base = new Date(taxReviewedAt || '');
  if (!Number.isFinite(now.getTime())) return null;
  if (!Number.isFinite(base.getTime())) return {nextReviewAt:null,due:true,firstReview:true};
  const month = base.getUTCMonth() + (cadence === 'quarterly' ? 3 : 1);
  const lastDay = new Date(Date.UTC(base.getUTCFullYear(), month + 1, 0)).getUTCDate();
  const next = new Date(Date.UTC(base.getUTCFullYear(), month, Math.min(base.getUTCDate(), lastDay)));
  return {nextReviewAt:next.toISOString(),due:now.getTime() >= next.getTime()};
}

export function platformFeeLabel(info) {
  if (!info || typeof info.feeConfigured !== 'boolean') return 'ROOSTER platform fee information is unavailable.';
  if (!info.feeConfigured) return 'No ROOSTER platform fee is configured.';
  if (!Number.isSafeInteger(info.feeBasisPoints) || info.feeBasisPoints < 0 || info.feeBasisPoints > 10000 || info.feeAppliesTo !== 'connected_booking_charge') return 'ROOSTER platform fee information is unavailable.';
  return `ROOSTER platform fee: ${info.feeBasisPoints / 100}% of connected booking charges. Payment processing fees may also apply.`;
}

export function paymentStatusLabel(status) {
  return {not_connected:'Payment account not connected',setup_pending:'Payment account setup is pending',enabled_on_record:'Payments marked enabled in your account record'}[status] || 'Payment setup status unavailable';
}
