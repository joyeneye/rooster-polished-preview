import { createHash } from 'node:crypto';
import { getStore, getDeployStore } from '@netlify/blobs';
import type { Context } from '@netlify/functions';
import { boundedBytes } from './audio-transfers.mts';
import { assertSameOrigin, MEMBER_ID, MemberError, memberJSON } from './member-auth.mts';
import { resolveProfileMember, type ProfileMember, type ProfileStore } from './member-profiles.mts';
import { chicagoWeek } from './profile-visitors.mts';

export type NewsCategory = 'music' | 'culture' | 'events' | 'opportunities';
export type FeedSource = { source: string; url: string; category: NewsCategory; home: string };

/** Only these publisher feeds are ever read, and every story keeps the source
 * name it arrived under, so a headline can never be attributed elsewhere. */
export const NEWS_FEEDS: FeedSource[] = [
  { source: 'Billboard', url: 'https://www.billboard.com/feed/', category: 'music', home: 'https://www.billboard.com' },
  { source: 'Pitchfork', url: 'https://pitchfork.com/feed/feed-news/rss', category: 'music', home: 'https://pitchfork.com' },
  { source: 'Rolling Stone', url: 'https://www.rollingstone.com/music/music-news/feed/', category: 'music', home: 'https://www.rollingstone.com' },
  { source: 'NPR Music', url: 'https://feeds.npr.org/1039/rss.xml', category: 'music', home: 'https://www.npr.org/music' },
  { source: 'The Guardian Music', url: 'https://www.theguardian.com/music/rss', category: 'culture', home: 'https://www.theguardian.com/music' },
  { source: 'NPR Arts and Life', url: 'https://feeds.npr.org/1008/rss.xml', category: 'culture', home: 'https://www.npr.org/sections/arts' },
  { source: 'Hypebot', url: 'https://www.hypebot.com/feed', category: 'opportunities', home: 'https://www.hypebot.com' },
  { source: 'Music Ally', url: 'https://musically.com/feed/', category: 'opportunities', home: 'https://musically.com' },
  { source: 'MusicTech', url: 'https://musictech.com/feed/', category: 'music', home: 'https://musictech.com' },
];
export const NEWS_CATEGORIES: NewsCategory[] = ['music', 'culture', 'events', 'opportunities'];
export const NEWS_FILTERS = ['All News', 'Music', 'Culture', 'Events', 'Opportunities', 'J.White'] as const;
export const NEWS_HEADING = 'ROOSTER NEWS';
export const NEWS_DESCRIPTION = 'Music, culture, events and opportunities.';
/** The desk shows a selected front page, never an endless feed. */
export const NEWS_FRONT_PAGE = 6;
export const NEWS_MORE_LABEL = 'MORE ROOSTER NEWS';

/** Keyword sorting only moves a story between the four public categories. It
 * never adds a deadline, an amount or a claim the feed did not carry. */
const EVENT_WORDS = /\b(festivals?|tour dates?|tour announce|concerts?|showcase|conference|residency|live show|line-?up|sxsw|coachella|summit|panel)\b/i;
const OPPORTUNITY_WORDS = /\b(scholarships?|internships?|fellowships?|grants?|apply|applications?|open call|submissions?|hiring|jobs?|competition|contest|bootcamp|workshops?|mentorship|deadline)\b/i;
const CONTROL = /[\p{Cc}\p{Cf}]/gu;

const FRESH_WINDOW_MS = 21 * 86_400_000;
const KEEP_WINDOW_MS = 90 * 86_400_000;
const FEATURED_TARGET = 12;
const STORY_LIMIT = 60;
const HISTORY_LIMIT = 240;
const ANNOUNCEMENT_LIMIT = 25;
const REMOVED_LIMIT = 500;
const FEED_BYTES = 512 * 1024;
const FEED_TIMEOUT_MS = 8_000;
const BODY_LIMIT = 8 * 1024;
const ID = /^[a-f0-9]{40}$/;
const KINDS = ['announcement', 'release', 'career', 'opportunity'] as const;

/** J.White's casting call. Seeded active so it is live on the first request,
 * and held out of the weekly rotation until he turns it off. */
export const DEFAULT_PROMOTION = {
  heading: "I'm putting a group together.",
  body: '3 female rappers. 1 R&B singer.\n\nIf you can rap or sing and move a little, let me hear you. Make your ROOSTER page and add your music.',
  badges: ['18+', 'J.White Did It', 'More Hits On The Way', '@morehitsontheway'],
  button_label: 'Make your ROOSTER page',
  signed_in_label: 'Add your music',
  note: 'Joining does not guarantee selection.',
  active: true,
};

export interface NewsStore {
  get(key: string, options: { type: 'json' }): Promise<any>;
  setJSON(key: string, value: unknown, options?: { onlyIfNew?: boolean }): Promise<{ modified: boolean }>;
}

export function newsStore(context: Context): NewsStore {
  const options = { name: 'jspace-news', consistency: 'strong' as const };
  return context.deploy.context === 'production' ? getStore(options) : getDeployStore({ ...options, deployID: context.deploy.id });
}

export function newsFailure(error: unknown): Response {
  return error instanceof MemberError ? memberJSON({ error: error.message }, error.status)
    : memberJSON({ error: "What's Happening could not load. Please try again." }, 503);
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const storyId = (url: string) => createHash('sha1').update(url).digest('hex');
const iso = (value: unknown): string | null => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', mdash: '—', ndash: '–',
};
const safeCode = (code: number) => Number.isInteger(code) && code > 31 && code !== 127 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';

export function decodeText(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, hex) => safeCode(parseInt(hex, 16)))
    .replace(/&#(\d{1,7});/g, (_, digits) => safeCode(Number(digits)))
    .replace(/&([a-z0-9#]{2,8});/gi, (whole, name) => ENTITIES[String(name).toLowerCase()] ?? whole)
    .replace(CONTROL, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The publisher's own words, shortened. Nothing is written about a story here
 * that the feed did not supply. */
function shorten(value: string, limit = 220): string {
  const text = decodeText(value);
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit), stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(' '));
  return `${cut.slice(0, stop > 60 ? stop : limit).trim()}…`;
}

/** One or two short sentences, in the publisher's own words. Tags are already
 * gone by the time this runs, so no markup can reach a story card. */
export function briefSummary(value: string, limit = 170): string {
  const text = decodeText(value).replace(/\s*(?:read more|continue reading|the post .* appeared first on .*)\s*$/i, '').trim();
  if (!text) return '';
  const sentences = text.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) || [text];
  let brief = sentences[0].trim();
  if (brief.length < 90 && sentences[1] && `${brief} ${sentences[1].trim()}`.length <= limit) brief = `${brief} ${sentences[1].trim()}`;
  return brief.length <= limit ? brief : shorten(brief, limit);
}

/** A story picture has to be an ordinary public https image from the feed. */
export function safeImageLink(value: string | null | undefined): string | null {
  const link = safeStoryLink(value);
  if (!link) return null;
  const path = new URL(link).pathname.toLowerCase();
  return /\.(?:jpe?g|png|webp|avif|gif)$/.test(path) || /\/(?:image|photo|media|resize|thumb)/.test(path) ? link : null;
}

function tag(block: string, names: string[]): string | null {
  for (const name of names) {
    const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block);
    if (match) return match[1];
  }
  return null;
}

/** A story link has to be an ordinary public https page. */
export function safeStoryLink(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = decodeText(value);
  if (!trimmed || trimmed.length > 600) return null;
  let url: URL;
  try { url = new URL(trimmed); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.')) return null;
  url.hash = '';
  return url.toString();
}

function entryLink(block: string): string | null {
  const direct = safeStoryLink(tag(block, ['link', 'guid', 'id']));
  if (direct) return direct;
  const href = /<link\b[^>]*\bhref=["']([^"']+)["']/i.exec(block);
  return href ? safeStoryLink(href[1]) : null;
}

/** Only a real, parseable publication date is accepted. A story with no usable
 * date is dropped rather than shown under a guessed one. */
function entryDate(block: string, now: number): string | null {
  const raw = decodeText(tag(block, ['pubDate', 'published', 'updated', 'dc:date', 'date']) || '');
  const parsed = raw ? Date.parse(raw) : NaN;
  if (!Number.isFinite(parsed) || parsed < Date.parse('2000-01-01T00:00:00Z') || parsed > now + 86_400_000) return null;
  return new Date(parsed).toISOString();
}

export type Story = { id: string; url: string; title: string; source: string; category: NewsCategory; published_at: string; summary: string; image: string | null };

function classify(feed: FeedSource, title: string, summary: string): NewsCategory {
  const text = `${title} ${summary}`;
  if (OPPORTUNITY_WORDS.test(text)) return 'opportunities';
  if (EVENT_WORDS.test(text)) return 'events';
  return feed.category === 'opportunities' ? 'music' : feed.category;
}

/** The picture the publisher attached to the story, when there is one. */
function entryImage(block: string): string | null {
  const patterns = [
    /<media:content\b[^>]*\burl=["']([^"']+)["'][^>]*>/i,
    /<media:thumbnail\b[^>]*\burl=["']([^"']+)["']/i,
    /<enclosure\b[^>]*\btype=["']image\/[^"']*["'][^>]*\burl=["']([^"']+)["']/i,
    /<enclosure\b[^>]*\burl=["']([^"']+)["'][^>]*\btype=["']image\/[^"']*["']/i,
    /<img\b[^>]*\bsrc=["']([^"']+)["']/i,
  ];
  for (const pattern of patterns) {
    const found = pattern.exec(block);
    const image = found ? safeImageLink(found[1]) : null;
    if (image) return image;
  }
  return null;
}

export function parseFeed(feed: FeedSource, xml: string, now = Date.now()): Story[] {
  const stories: Story[] = [];
  for (const block of (xml.match(/<(item|entry)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi) || []).slice(0, 40)) {
    const url = entryLink(block), title = shorten(tag(block, ['title']) || '', 180), published = entryDate(block, now);
    if (!url || title.length < 4 || !published) continue;
    const summary = briefSummary(tag(block, ['description', 'summary', 'content:encoded', 'content']) || '');
    stories.push({ id: storyId(url), url, title, source: feed.source, category: classify(feed, title, summary), published_at: published, summary, image: entryImage(block) });
  }
  return stories;
}

export type Fetcher = (url: string) => Promise<Response>;

export const liveFetcher: Fetcher = async url => {
  const stop = new AbortController(), timer = setTimeout(() => stop.abort(), FEED_TIMEOUT_MS);
  try {
    return await fetch(url, { redirect: 'follow', signal: stop.signal, headers: {
      Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5',
      'User-Agent': "ROOSTER What's Happening (+https://jwhitedidit.net)",
    } });
  } finally { clearTimeout(timer); }
};

async function readFeed(feed: FeedSource, fetcher: Fetcher, now: number): Promise<Story[]> {
  const response = await fetcher(feed.url);
  if (!response.ok || !response.body) throw new MemberError(503, `${feed.source} was unavailable.`);
  const reader = response.body.getReader(), parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      parts.push(item.value);
      if ((size += item.value.byteLength) > FEED_BYTES) { await reader.cancel(); break; }
    }
  } finally { reader.releaseLock(); }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { data.set(part, offset); offset += part.byteLength; }
  return parseFeed(feed, new TextDecoder('utf-8', { fatal: false }).decode(data), now);
}

function readStory(value: unknown): Story | null {
  if (!isRecord(value)) return null;
  const url = safeStoryLink(typeof value.url === 'string' ? value.url : null), published = iso(value.published_at);
  if (!url || !published || typeof value.id !== 'string' || !ID.test(value.id) || storyId(url) !== value.id) return null;
  if (typeof value.title !== 'string' || typeof value.source !== 'string' || typeof value.summary !== 'string') return null;
  if (!value.title.trim() || value.title.length > 200 || value.source.length > 60 || value.summary.length > 400) return null;
  if (!NEWS_CATEGORIES.includes(value.category as NewsCategory)) return null;
  // Titles and summaries are re-cleaned on the way out, so a record written
  // before this shortening, or one carrying markup, can never reach a card.
  return { id: value.id, url, title: decodeText(value.title), source: decodeText(value.source),
    category: value.category as NewsCategory, published_at: published, summary: briefSummary(value.summary),
    image: safeImageLink(typeof value.image === 'string' ? value.image : null) };
}

/** Owner-authored copy saved before any of the renames still holds an old
 * brand. It is rewritten on the way out so nothing published under a retired
 * name is shown. Only the retired names are matched, because ROOSTER is also an
 * ordinary English word now and copy that already reads correctly has to be
 * left alone. One retired brand ended in a period the new one does not carry,
 * so that period is dropped unless it was doing double duty as a full stop. */
export const rebrand = (text: string): string =>
  text.replace(/JSPACE|KON-NEKT|kon-nekt\.(?!\s+[A-Z])|kon-nekt/g, 'ROOSTER');

export type Announcement = { id: string; kind: typeof KINDS[number]; title: string; body: string; url: string | null; published_at: string; closes_at: string | null };

function readAnnouncement(value: unknown): Announcement | null {
  if (!isRecord(value)) return null;
  const published = iso(value.published_at);
  if (!published || typeof value.id !== 'string' || !ID.test(value.id) || !KINDS.includes(value.kind as any)) return null;
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 160) return null;
  if (typeof value.body !== 'string' || !value.body.trim() || value.body.length > 1200) return null;
  return {
    id: value.id, kind: value.kind as Announcement['kind'], title: rebrand(value.title.trim()), body: rebrand(value.body),
    url: safeStoryLink(typeof value.url === 'string' ? value.url : null), published_at: published, closes_at: iso(value.closes_at),
  };
}

export type Promotion = { heading: string; body: string; badges: string[]; button_label: string; signed_in_label: string; note: string; active: boolean; updated_at: string | null };

function readPromotion(value: unknown): Promotion {
  const base: Promotion = { ...DEFAULT_PROMOTION, badges: [...DEFAULT_PROMOTION.badges], updated_at: null };
  if (!isRecord(value)) return base;
  const text = (key: 'heading' | 'body' | 'button_label' | 'signed_in_label' | 'note', limit: number) => {
    const given = value[key];
    return typeof given === 'string' && given.trim() && given.length <= limit ? rebrand(given) : base[key];
  };
  return {
    heading: text('heading', 120), body: text('body', 900),
    badges: Array.isArray(value.badges)
      ? value.badges.filter((badge): badge is string => typeof badge === 'string' && !!badge.trim() && badge.length <= 60).slice(0, 6).map(rebrand)
      : base.badges,
    button_label: text('button_label', 60), signed_in_label: text('signed_in_label', 60), note: text('note', 200),
    active: value.active !== false, updated_at: iso(value.updated_at),
  };
}

const readIdList = (value: unknown, key: string, limit: number): string[] =>
  isRecord(value) && Array.isArray(value[key])
    ? [...new Set((value[key] as unknown[]).filter((id): id is string => typeof id === 'string' && ID.test(id)))].slice(0, limit)
    : [];

export type RefreshResult = { week: string; stories: number; sources_ok: string[]; sources_failed: string[]; fetched_at: string | null; featured_built: boolean };

/**
 * Reads every allowed feed, keeps the newest stories and files this Chicago
 * week's featured selection once. When nothing is reachable the previous
 * successful content stays in place under its own real update time.
 */
export async function refreshNews(store: NewsStore, fetcher: Fetcher = liveFetcher, now = Date.now()): Promise<RefreshResult> {
  const week = chicagoWeek(now), ok: string[] = [], failed: string[] = [], collected = new Map<string, Story>();
  const results = await Promise.allSettled(NEWS_FEEDS.map(feed => readFeed(feed, fetcher, now)));
  results.forEach((result, index) => {
    const feed = NEWS_FEEDS[index];
    if (result.status !== 'fulfilled' || !result.value.length) { failed.push(feed.source); return; }
    ok.push(feed.source);
    for (const story of result.value) if (!collected.has(story.id)) collected.set(story.id, story);
  });
  const previous = await store.get('latest', { type: 'json' });
  const kept: Story[] = (Array.isArray(previous?.stories) ? previous.stories : []).map(readStory).filter((story: Story | null): story is Story => !!story);
  if (!ok.length) {
    const built = await ensureFeatured(store, kept, week, now);
    return { week, stories: kept.length, sources_ok: ok, sources_failed: failed, fetched_at: iso(previous?.fetched_at), featured_built: built };
  }
  for (const story of kept) if (!collected.has(story.id)) collected.set(story.id, story);
  const stories = [...collected.values()]
    .filter(story => Date.parse(story.published_at) > now - KEEP_WINDOW_MS)
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))
    .slice(0, STORY_LIMIT);
  const fetchedAt = new Date(now).toISOString();
  await store.setJSON('latest', { version: 1, fetched_at: fetchedAt, sources_ok: ok, sources_failed: failed, stories });
  const built = await ensureFeatured(store, stories, week, now);
  return { week, stories: stories.length, sources_ok: ok, sources_failed: failed, fetched_at: fetchedAt, featured_built: built };
}

/** A week's featured set is written once and never rewritten, so Monday's
 * selection holds all week instead of reshuffling on every request, and the
 * history list keeps last week's picks from coming back as this week's news. */
async function ensureFeatured(store: NewsStore, stories: Story[], week: string, now: number): Promise<boolean> {
  const existing = await store.get(`weeks/${week}`, { type: 'json' });
  if (isRecord(existing) && Array.isArray(existing.featured)) return false;
  const seen = new Set(readIdList(await store.get('history', { type: 'json' }), 'ids', HISTORY_LIMIT));
  const fresh = stories
    .filter(story => Date.parse(story.published_at) > now - FRESH_WINDOW_MS && !seen.has(story.id))
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
  const queues = NEWS_CATEGORIES.map(category => fresh.filter(story => story.category === category));
  const picked: Story[] = [];
  for (let round = 0; picked.length < FEATURED_TARGET; round++) {
    const before = picked.length;
    for (const queue of queues) if (queue[round] && picked.length < FEATURED_TARGET) picked.push(queue[round]);
    if (picked.length === before) break;
  }
  const written = await store.setJSON(`weeks/${week}`,
    { version: 1, week, built_at: new Date(now).toISOString(), featured: picked.map(story => story.id) }, { onlyIfNew: true });
  if (written.modified && picked.length) {
    await store.setJSON('history', { ids: [...picked.map(story => story.id), ...seen].slice(0, HISTORY_LIMIT) }).catch(() => {});
  }
  return written.modified;
}

export type NewsView = {
  heading: string; description: string; filters: readonly string[]; week_start: string;
  featured_built_at: string | null; last_updated_at: string | null; update_state: 'ok' | 'stale' | 'never';
  sources: { source: string; home: string }[]; promotion: Promotion | null;
  announcements: (Announcement & { open: boolean | null })[]; stories: (Story & { featured: boolean })[];
};

export async function newsView(store: NewsStore, now = Date.now()): Promise<NewsView> {
  const week = chicagoWeek(now);
  const [latest, current, promotionValue, announcementValue, removedValue] = await Promise.all([
    store.get('latest', { type: 'json' }),
    store.get(`weeks/${week}`, { type: 'json' }),
    store.get('owner/promotion', { type: 'json' }),
    store.get('owner/announcements', { type: 'json' }),
    store.get('owner/removed', { type: 'json' }),
  ]);
  const removed = new Set(readIdList(removedValue, 'ids', REMOVED_LIMIT));
  const featured = new Set(readIdList(current, 'featured', FEATURED_TARGET));
  const stories = (Array.isArray(latest?.stories) ? latest.stories : [])
    .map(readStory)
    .filter((story: Story | null): story is Story => !!story && !removed.has(story.id))
    .map((story: Story) => ({ ...story, featured: featured.has(story.id) }))
    .sort((a: Story & { featured: boolean }, b: Story & { featured: boolean }) =>
      Number(b.featured) - Number(a.featured) || Date.parse(b.published_at) - Date.parse(a.published_at));
  const lastUpdated = iso(latest?.fetched_at);
  const announcements = (Array.isArray(announcementValue?.items) ? announcementValue.items : [])
    .map(readAnnouncement)
    .filter((item: Announcement | null): item is Announcement => !!item)
    .sort((a: Announcement, b: Announcement) => Date.parse(b.published_at) - Date.parse(a.published_at))
    .slice(0, ANNOUNCEMENT_LIMIT)
    .map((item: Announcement) => ({ ...item, open: item.closes_at ? Date.parse(item.closes_at) > now : null }));
  const promotion = readPromotion(promotionValue);
  return {
    heading: NEWS_HEADING, description: NEWS_DESCRIPTION, filters: NEWS_FILTERS, week_start: week,
    featured_built_at: iso(current?.built_at), last_updated_at: lastUpdated,
    update_state: !lastUpdated ? 'never' : Date.parse(lastUpdated) > now - 10 * 86_400_000 ? 'ok' : 'stale',
    sources: NEWS_FEEDS.map(feed => ({ source: feed.source, home: feed.home })),
    promotion: promotion.active ? promotion : null, announcements, stories,
  };
}

export async function getNews(req: Request, store: NewsStore, now = Date.now()): Promise<Response> {
  try {
    if (req.method !== 'GET') return memberJSON({ error: 'Method not allowed.' }, 405);
    return memberJSON(await newsView(store, now));
  } catch (error) { return newsFailure(error); }
}

/** The owner controls are gated on the server's own record of the owner
 * account, never on a name, a username or anything a browser sends. */
async function requireOwner(profiles: ProfileStore, resolve: () => Promise<ProfileMember>): Promise<ProfileMember> {
  const member = await resolve();
  const binding = await profiles.get('owner-binding', { type: 'json' });
  const bound = isRecord(binding) && typeof binding.id === 'string' && MEMBER_ID.test(binding.id) ? binding.id.toLowerCase() : null;
  const denied = new MemberError(403, "Only the site owner can edit What's Happening.");
  if (!member.isOwner || (bound && bound !== member.id)) throw denied;
  if (!bound) {
    await profiles.setJSON('owner-binding', { id: member.id }, { onlyIfNew: true });
    const saved = await profiles.get('owner-binding', { type: 'json' });
    if (saved?.id !== member.id) throw denied;
  }
  return member;
}

async function ownerBody(req: Request): Promise<Record<string, unknown>> {
  if (!req.headers.get('content-type')?.startsWith('application/json')) throw new MemberError(415, 'This update format is not supported.');
  const bytes = await boundedBytes(req, BODY_LIMIT);
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!isRecord(value)) throw new Error('not an object');
    return value;
  } catch { throw new MemberError(400, 'This update could not be read.'); }
}

function clean(value: unknown, limit: number): string {
  if (typeof value !== 'string') throw new MemberError(400, 'Please fill in every field.');
  const text = value.replace(/\r\n?/g, '\n').split('\n').map(line => line.replace(CONTROL, '')).join('\n').trim();
  if (!text || text.length > limit) throw new MemberError(400, 'Please check the length of what you wrote.');
  return text;
}

async function savedAnnouncements(store: NewsStore): Promise<Announcement[]> {
  const saved = await store.get('owner/announcements', { type: 'json' });
  return (Array.isArray(saved?.items) ? saved.items : []).map(readAnnouncement).filter((item: Announcement | null): item is Announcement => !!item);
}

export type OwnerOptions = { resolveMember?: () => Promise<ProfileMember>; now?: number };

/** Owner only: write or drop a J.White announcement, keep or retire the pinned
 * promotion, and hide or restore a story. */
export async function postNewsOwnerAction(req: Request, store: NewsStore, profiles: ProfileStore, options: OwnerOptions = {}): Promise<Response> {
  const now = options.now ?? Date.now();
  try {
    if (req.method !== 'POST') return memberJSON({ error: 'Method not allowed.' }, 405);
    assertSameOrigin(req);
    await requireOwner(profiles, options.resolveMember ?? resolveProfileMember);
    const body = await ownerBody(req), action = String(body.action || '');

    if (action === 'announcement_save') {
      const title = clean(body.title, 160);
      const given = typeof body.closes_at === 'string' ? body.closes_at.trim() : '';
      if (given && !Number.isFinite(Date.parse(given))) throw new MemberError(400, 'Use a real closing date, or leave it blank.');
      const link = typeof body.url === 'string' && body.url.trim() ? safeStoryLink(body.url) : null;
      if (typeof body.url === 'string' && body.url.trim() && !link) throw new MemberError(400, 'Use a full https link, or leave it blank.');
      const item: Announcement = {
        id: typeof body.id === 'string' && ID.test(body.id) ? body.id : createHash('sha1').update(`${now}:${title}`).digest('hex'),
        kind: KINDS.includes(body.kind as any) ? body.kind as Announcement['kind'] : 'announcement',
        title, body: clean(body.body, 1200), url: link,
        published_at: new Date(now).toISOString(), closes_at: given ? new Date(given).toISOString() : null,
      };
      const items = await savedAnnouncements(store);
      await store.setJSON('owner/announcements', { version: 1, items: [item, ...items.filter(existing => existing.id !== item.id)].slice(0, ANNOUNCEMENT_LIMIT) });
      return memberJSON({ ok: true, action, announcement: item }, 201);
    }

    if (action === 'announcement_delete') {
      if (typeof body.id !== 'string' || !ID.test(body.id)) throw new MemberError(400, 'Choose an announcement to remove.');
      const items = await savedAnnouncements(store);
      await store.setJSON('owner/announcements', { version: 1, items: items.filter(item => item.id !== body.id) });
      return memberJSON({ ok: true, action });
    }

    if (action === 'promotion_save' || action === 'promotion_remove') {
      const current = readPromotion(await store.get('owner/promotion', { type: 'json' }));
      const keep = (key: 'heading' | 'body' | 'button_label' | 'signed_in_label' | 'note', limit: number) =>
        typeof body[key] === 'string' ? clean(body[key], limit) : current[key];
      const promotion: Promotion = action === 'promotion_remove'
        ? { ...current, active: false, updated_at: new Date(now).toISOString() }
        : {
          heading: keep('heading', 120), body: keep('body', 900),
          badges: Array.isArray(body.badges)
            ? (body.badges as unknown[]).filter((badge): badge is string => typeof badge === 'string' && !!badge.trim() && badge.length <= 60).slice(0, 6)
            : current.badges,
          button_label: keep('button_label', 60), signed_in_label: keep('signed_in_label', 60), note: keep('note', 200),
          active: true, updated_at: new Date(now).toISOString(),
        };
      await store.setJSON('owner/promotion', promotion);
      return memberJSON({ ok: true, action, promotion });
    }

    if (action === 'story_remove' || action === 'story_restore') {
      if (typeof body.id !== 'string' || !ID.test(body.id)) throw new MemberError(400, 'Choose a story.');
      const ids = new Set(readIdList(await store.get('owner/removed', { type: 'json' }), 'ids', REMOVED_LIMIT));
      if (action === 'story_remove') ids.add(body.id); else ids.delete(body.id);
      await store.setJSON('owner/removed', { ids: [...ids].slice(0, REMOVED_LIMIT) });
      return memberJSON({ ok: true, action, removed: ids.size });
    }

    throw new MemberError(400, 'That control is not available.');
  } catch (error) { return newsFailure(error); }
}
