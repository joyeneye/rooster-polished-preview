import {bookingPresetForCategory} from './booking-offerings.mjs?v=20260911-booking-options-v1';

const EVENT_CATEGORIES = new Set(['live-performances','podcast-interviews','speaking','hosting-panels','church-community','radio-media']);
const FORMATS = Object.freeze({'in-person':'In person',online:'Online',arrange:'To arrange'});
const FIELDS = ['name','email','phone','notes','eventName','eventFormat','eventLocation'];
export const BOOKING_NOTES_LIMIT = 1000;

export function bookingEventPreset(provider, service) {
  if (!provider || !service) return null;
  const category = service.categoryId == null
    ? provider.category
    : (Array.isArray(provider.serviceCategories) ? provider.serviceCategories : []).find(item => Number(item.id) === Number(service.categoryId));
  return category && EVENT_CATEGORIES.has(category.slug) ? bookingPresetForCategory(category.slug) : null;
}

// Keep a separate draft from the final API payload so going Back never puts
// the generated event summary into the client's notes a second time.
export function updateBookingDraft(previous = {}, values = {}) {
  return Object.fromEntries(FIELDS.map(key => [key, typeof values[key] === 'string' ? values[key] : typeof previous[key] === 'string' ? previous[key] : '']));
}

export function bookingClientPayload(draft, event = false) {
  const values = updateBookingDraft({}, draft);
  const notes = values.notes.trim();
  const parts = [];
  if (event) {
    if (values.eventName.trim().length > 100 || values.eventLocation.trim().length > 200) throw new Error('Keep the event name to 100 characters and the venue or call details to 200.');
    if (values.eventFormat && !Object.hasOwn(FORMATS, values.eventFormat)) throw new Error('Choose in person, online, or to arrange.');
    if (values.eventName.trim()) parts.push(`Event / show: ${values.eventName.trim()}`);
    if (values.eventFormat) parts.push(`Format: ${FORMATS[values.eventFormat]}`);
    if (values.eventLocation.trim()) parts.push(`Venue / call arrangements: ${values.eventLocation.trim()}`);
  }
  if (notes) parts.push(parts.length ? `Notes: ${notes}` : notes);
  const combined = parts.join('\n');
  if (combined.length > BOOKING_NOTES_LIMIT) throw new Error('Keep your event details and notes together to 1,000 characters. Shorten the notes and try again.');
  return {name:values.name.trim(),email:values.email.trim(),phone:values.phone.trim(),notes:combined};
}

export function bookingEventLocation(draft) {
  const values = updateBookingDraft({}, draft);
  const location = values.eventLocation.trim();
  return [FORMATS[values.eventFormat],location].filter(Boolean).join(' · ') || 'Venue or call details to arrange with the provider';
}
