import { createHash } from 'node:crypto';

export type DiscoverCategory = 'music' | 'sports';
export type DiscoverStory = {
  id: string; title: string; url: string; source: string;
  category: DiscoverCategory; published_at: string;
};
export type DiscoverResult = { stories: DiscoverStory[]; updated_at: string | null; stale: boolean };
export type DiscoverFeed = {
  source: string; category: DiscoverCategory; url: string; hosts: readonly string[];
};

/** Public publisher feeds, verified September 11, 2026. Fetch targets cannot be
 * supplied by a caller. Stories retain publisher attribution and original URLs.
 * ESPN requires unmodified headlines/links and no advertising inside its content. */
export const DISCOVER_FEEDS: readonly DiscoverFeed[] = [
  { source: 'Billboard', category: 'music', url: 'https://www.billboard.com/feed/', hosts: ['www.billboard.com', 'billboard.com'] },
  { source: 'Pitchfork', category: 'music', url: 'https://pitchfork.com/feed/feed-news/rss', hosts: ['pitchfork.com', 'www.pitchfork.com'] },
  { source: 'ESPN', category: 'sports', url: 'https://www.espn.com/espn/rss/news', hosts: ['www.espn.com', 'espn.com'] },
  { source: 'ESPN', category: 'sports', url: 'https://www.espn.com/espn/rss/nba/news', hosts: ['www.espn.com', 'espn.com'] },
  { source: 'ESPN', category: 'sports', url: 'https://www.espn.com/espn/rss/nfl/news', hosts: ['www.espn.com', 'espn.com'] },
];
export const DISCOVER_MAX_AGE_MS = 7 * 86_400_000;
export const DISCOVER_CACHE_MS = 30 * 60_000;
export const DISCOVER_MAX_FEED_BYTES = 512 * 1024;
const CACHE_KEY = 'headlines-v2';
const FEED_TIMEOUT_MS = 10_000;
const CONTROL = /[\p{Cc}\p{Cf}]/gu;
const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', mdash: '—', ndash: '–', hellip: '…',
};
export interface DiscoverCache {
  get(key: string, options: { type: 'json' }): Promise<unknown>;
  setJSON(key: string, value: unknown): Promise<unknown>;
}
export type DiscoverFetcher = (url: string, options: RequestInit) => Promise<Response>;
type CachedResult = { checked_at: string; result: DiscoverResult };

function decodeXML(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(x[0-9a-f]{1,6}|\d{1,7});/gi, (_, digits: string) => {
      const code = /^x/i.test(digits) ? parseInt(digits.slice(1), 16) : Number(digits);
      return code > 31 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : ' ';
    })
    .replace(/&([a-z]{2,8});/gi, (whole: string, name: string) => ENTITIES[name.toLowerCase()] ?? whole);
}

export function headlineText(value: string): string {
  return decodeXML(value).replace(/<[^>]*>/g, '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
}

/** Exact host checks prevent deceptive suffixes, credentials, ports and links
 * into unrelated sites. Preserve the publisher's URL, including query string. */
export function safeDiscoverURL(value: unknown, feed: DiscoverFeed): string | null {
  if (typeof value !== 'string') return null;
  const text = decodeXML(value).trim();
  if (!text || text.length > 2048 || /[\s<>\\\p{Cc}\p{Cf}]/u.test(text)) return null;
  try {
    const url = new URL(text);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      feed.hosts.includes(url.hostname) && url.pathname !== '/' ? text : null;
  } catch { return null; }
}

function publicationDate(value: unknown, now: number): string | null {
  if (typeof value !== 'string') return null;
  const date = Date.parse(value);
  if (!Number.isFinite(date) || date < now - DISCOVER_MAX_AGE_MS || date > now + 5 * 60_000) return null;
  return new Date(date).toISOString();
}

function tag(block: string, names: string[]): string {
  for (const name of names) {
    const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}\\s*>`, 'i').exec(block);
    if (match) return match[1];
  }
  return '';
}

export function parseDiscoverFeed(feed: DiscoverFeed, xml: string, now = Date.now()): DiscoverStory[] {
  if (new TextEncoder().encode(xml).length > DISCOVER_MAX_FEED_BYTES || /<!DOCTYPE|<!ENTITY/i.test(xml)) return [];
  const stories: DiscoverStory[] = [];
  const entries = xml.match(/<(item|entry)(?:\s[^>]*)?>[\s\S]*?<\/\1\s*>/gi) || [];
  for (const entry of entries.slice(0, 60)) {
    const title = headlineText(tag(entry, ['title']));
    let url = safeDiscoverURL(tag(entry, ['link']), feed);
    if (!url) {
      for (const atomLink of entry.match(/<link\b[^>]*>/gi) || []) {
        const relation = /\brel=["']([^"']+)["']/i.exec(atomLink)?.[1];
        if (relation && relation !== 'alternate') continue;
        url = safeDiscoverURL(/\bhref=["']([^"']+)["']/i.exec(atomLink)?.[1], feed);
        if (url) break;
      }
    }
    const published_at = publicationDate(headlineText(tag(entry, ['pubDate', 'published', 'dc:date'])), now);
    // Never invent a date, change a headline, or retain summaries or media.
    if (!url || title.length < 4 || title.length > 350 || !published_at) continue;
    stories.push({ id: createHash('sha256').update(url).digest('hex').slice(0, 24), title, url,
      source: feed.source, category: feed.category, published_at });
  }
  return selectDiscoverStories(stories, now);
}

/** Rank the supplied headline only. This is a light editorial mix for discovery,
 * not a claim about importance, a rewritten headline, or a fabricated story. */
export function editorialScore(story: Pick<DiscoverStory, 'title' | 'category'>): number {
  const text = story.title;
  let score = 0;
  if (story.category === 'music') {
    if (/\b(new (?:music|song|album|single|record|video)|releas(?:e|es|ed|ing)|debut(?:s)?|premier(?:e|es)|drop(?:s|ped)?|listen|shares?)\b/i.test(text)) score += 35;
    if (/\b(album|single|song|music video|remix|collab(?:oration)?|ep)\b/i.test(text)) score += 20;
    if (/\b(chart(?:s)?|hot 100|no\.? ?1|number one|platinum|grammy|award(?:s)?|festival(?:s)?|tour|concert|performance|performs?|residency)\b/i.test(text)) score += 20;
  } else {
    if (/\b(win(?:s)?|beat(?:s)?|victor(?:y|ies)|score(?:s)?|touchdown|kickoff|tipoff|playoff(?:s)?|season|preview|matchup|highlight(?:s)?|champion(?:ship)?|record|debut)\b/i.test(text)) score += 25;
    if (/\b(live|tonight|opener|return(?:s)?|comeback)\b/i.test(text)) score += 10;
  }
  if (/\b(kill(?:s|ed|ing)?|murder|dead|death|dies|died|sexual|assault|arrest(?:ed)?|lawsuit|sued|sues|charges|prison|shooting|abuse)\b/i.test(text)) score -= 100;
  if (/\b(trump|biden|harris|election|senator|governor|democrat(?:s)?|republican(?:s)?|politic(?:s|al)?|controversy|scandal|investigation|investigates?|punishment|penalt(?:y|ies))\b/i.test(text)) score -= 60;
  return score;
}

const SPORT_TOPICS: readonly [string, RegExp][] = [
  ['clippers', /\b(clippers|kawhi|ballmer|aspiration)\b/i],
  ['lakers', /\b(lakers|lebron)\b/i], ['warriors', /\b(warriors|curry)\b/i],
  ['chiefs', /\b(chiefs|mahomes|kelce)\b/i], ['49ers', /\b(49ers|niners|purdy|shanahan)\b/i],
  ['rams', /\b(rams|mcvay|stafford)\b/i], ['cowboys', /\b(cowboys|prescott)\b/i],
  ['eagles', /\b(eagles|jalen hurts)\b/i], ['ravens', /\b(ravens|lamar jackson)\b/i],
  ['bills', /\b(bills|josh allen)\b/i], ['bengals', /\b(bengals|joe burrow)\b/i],
  ['celtics', /\b(celtics|tatum|jaylen brown)\b/i], ['bucks', /\b(bucks|giannis)\b/i],
  ['thunder', /\b(thunder|gilgeous-alexander)\b/i], ['nuggets', /\b(nuggets|jokic)\b/i],
  ['mavericks', /\b(mavericks|mavs|cooper flagg)\b/i], ['spurs', /\b(spurs|wembanyama)\b/i],
  ['knicks', /\b(knicks|brunson)\b/i], ['rockets', /\b(rockets|sengun)\b/i],
];

export function storyTopic(story: Pick<DiscoverStory, 'title' | 'url'>): string {
  const text = `${story.title} ${new URL(story.url).pathname.replace(/-/g, ' ')}`;
  for (const [topic, pattern] of SPORT_TOPICS) if (pattern.test(text)) return topic;
  const team = /\b(patriots|jets|dolphins|steelers|browns|texans|colts|jaguars|titans|broncos|raiders|chargers|giants|commanders|packers|bears|lions|vikings|falcons|panthers|saints|buccaneers|seahawks|cardinals|nets|76ers|sixers|raptors|bulls|cavaliers|pistons|pacers|hawks|hornets|heat|magic|wizards|timberwolves|blazers|jazz|suns|kings|grizzlies|pelicans|yankees|mets|dodgers|padres|astros|orioles)\b/i.exec(text);
  return team ? team[1].toLowerCase() : story.url;
}

function sportKind(story: DiscoverStory): string {
  const path = new URL(story.url).pathname;
  if (/\/(?:nfl|college-football)\//i.test(path) || /\b(nfl|football|quarterback|touchdown|super bowl)\b/i.test(story.title)) return 'football';
  return /^\/([^/]+)\//.exec(path)?.[1] || 'sports';
}

/** Revalidate cached data as well as fresh stories; stale storage cannot revive
 * expired headlines or supply a URL outside the publisher allowlist. */
export function selectDiscoverStories(input: unknown, now = Date.now()): DiscoverStory[] {
  if (!Array.isArray(input)) return [];
  const valid: DiscoverStory[] = [];
  const seenURLs = new Set<string>();
  const seenTitles = new Set<string>();
  for (const item of input.slice(0, 400)) {
    if (!item || typeof item !== 'object') continue;
    const feed = DISCOVER_FEEDS.find(feed => feed.source === item.source && feed.category === item.category);
    if (!feed || typeof item.title !== 'string') continue;
    const title = headlineText(item.title), url = safeDiscoverURL(item.url, feed);
    const published_at = publicationDate(item.published_at, now);
    const titleKey = title.toLowerCase();
    if (!url || !published_at || title.length < 4 || title.length > 350 || seenURLs.has(url) || seenTitles.has(titleKey)) continue;
    seenURLs.add(url); seenTitles.add(titleKey);
    valid.push({ id: createHash('sha256').update(url).digest('hex').slice(0, 24), title, url,
      source: feed.source, category: feed.category, published_at });
  }
  valid.sort((a, b) => editorialScore(b) - editorialScore(a) || Date.parse(b.published_at) - Date.parse(a.published_at));
  const byCategory = (category: DiscoverCategory) => {
    const pool = valid.filter(story => story.category === category);
    if (category === 'sports') {
      const chosen: DiscoverStory[] = [], topics = new Set<string>();
      const add = (story?: DiscoverStory) => {
        if (!story || chosen.length >= 4 || topics.has(storyTopic(story))) return;
        chosen.push(story); topics.add(storyTopic(story));
      };
      add(pool[0]);
      add(pool.find(story => sportKind(story) === 'football'));
      const firstSport = chosen[0] && sportKind(chosen[0]);
      add(pool.find(story => sportKind(story) !== firstSport && editorialScore(story) >= 0));
      for (const story of pool) add(story);
      return chosen;
    }
    const sourceNames = new Set<string>();
    const first = pool.filter(story => {
      if (editorialScore(story) < 0 || sourceNames.has(story.source)) return false;
      sourceNames.add(story.source); return true;
    });
    return [...first, ...pool.filter(story => !first.includes(story))].slice(0, 4);
  };
  const music = byCategory('music'), sports = byCategory('sports'), result: DiscoverStory[] = [];
  for (let i = 0; i < 4; i++) {
    if (music[i]) result.push(music[i]);
    if (sports[i]) result.push(sports[i]);
  }
  return result;
}

export async function fetchDiscoverFeed(feed: DiscoverFeed, fetcher: DiscoverFetcher = fetch, now = Date.now(), timeoutMs = FEED_TIMEOUT_MS): Promise<DiscoverStory[]> {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      if (reader) void reader.cancel().catch(() => {});
      reject(new Error('Publisher feed timed out'));
    }, timeoutMs);
  });
  const work = async () => {
    const response = await fetcher(feed.url, {
      signal: controller.signal, redirect: 'error',
      headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
        'User-Agent': 'ROOSTER WYD Headlines (+https://jwhitedidit.net)' },
    });
    if (!response.ok || !response.body) throw new Error('Publisher feed unavailable');
    if (response.url && response.url !== feed.url) throw new Error('Unexpected feed destination');
    if (Number(response.headers.get('content-length')) > DISCOVER_MAX_FEED_BYTES) throw new Error('Publisher feed too large');
    reader = response.body.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > DISCOVER_MAX_FEED_BYTES) throw new Error('Publisher feed too large');
        chunks.push(part.value);
      }
    } catch (error) {
      void reader.cancel().catch(() => {});
      throw error;
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const xml = new TextDecoder().decode(bytes);
    if (!/<(?:rss|feed)\b/i.test(xml) || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Publisher feed was not RSS or Atom');
    return parseDiscoverFeed(feed, xml, now);
  };
  try { return await Promise.race([work(), timeout]); }
  finally { clearTimeout(timer!); }
}

async function cacheCall<T>(work: () => Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([work(), new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 800); })]);
  } catch { return null; }
  finally { clearTimeout(timer!); }
}

export async function loadDiscover(options: { cache?: DiscoverCache; fetcher?: DiscoverFetcher; now?: number; timeoutMs?: number } = {}): Promise<DiscoverResult> {
  const now = options.now ?? Date.now();
  const stored = options.cache ? await cacheCall(() => options.cache!.get(CACHE_KEY, { type: 'json' })) : null;
  const cached = stored && typeof stored === 'object' ? stored as Partial<CachedResult> : null;
  const oldStories = selectDiscoverStories(cached?.result?.stories, now);
  const updated = cached?.result?.updated_at;
  const updatedAt = typeof updated === 'string' && Number.isFinite(Date.parse(updated)) && Date.parse(updated) <= now + 5 * 60_000 ? updated : null;
  const checkedAt = typeof cached?.checked_at === 'string' ? Date.parse(cached.checked_at) : NaN;
  const cacheLifetime = oldStories.length ? DISCOVER_CACHE_MS : 60_000;
  if (Number.isFinite(checkedAt) && checkedAt <= now && now - checkedAt < cacheLifetime && cached?.result &&
    (updatedAt || (cached.result.updated_at === null && cached.result.stale === true))) {
    return { stories: oldStories, updated_at: updatedAt, stale: !!cached.result.stale };
  }
  const feeds = await Promise.allSettled(DISCOVER_FEEDS.map(feed => fetchDiscoverFeed(feed, options.fetcher, now, options.timeoutMs)));
  const fresh: DiscoverStory[] = [];
  const failedSources = new Set<string>();
  let success = false;
  feeds.forEach((result, index) => {
    if (result.status === 'fulfilled') { fresh.push(...result.value); success = true; }
    else failedSources.add(DISCOVER_FEEDS[index].source);
  });
  const fallback = oldStories.filter(story => failedSources.has(story.source) && !fresh.some(item => item.url === story.url));
  const result: DiscoverResult = {
    stories: selectDiscoverStories([...fresh, ...fallback], now),
    updated_at: success ? new Date(now).toISOString() : updatedAt,
    stale: !success || fallback.length > 0,
  };
  if (options.cache) await cacheCall(() => options.cache!.setJSON(CACHE_KEY, { checked_at: new Date(now).toISOString(), result }));
  return result;
}

export async function getDiscover(req: Request, options: Parameters<typeof loadDiscover>[0] = {}): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET' } });
  const result = await loadDiscover(options);
  const now = options.now ?? Date.now();
  const expiresIn = result.stories.length ? Math.min(...result.stories.map(story => (Date.parse(story.published_at) + DISCOVER_MAX_AGE_MS - now) / 1000)) : 60;
  const ttl = Math.max(0, Math.min(result.stale ? 60 : 900, Math.floor(expiresIn)));
  return Response.json(result, { headers: {
    'Cache-Control': `public, max-age=${Math.min(60, ttl)}`,
    'Netlify-CDN-Cache-Control': `public, max-age=${ttl}`,
    'X-Content-Type-Options': 'nosniff',
  } });
}
