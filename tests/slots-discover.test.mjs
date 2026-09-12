import test from 'node:test';
import assert from 'node:assert/strict';
import { DISCOVER_FEEDS, DISCOVER_MAX_AGE_MS, DISCOVER_MAX_FEED_BYTES, DISCOVER_CACHE_MS,
  parseDiscoverFeed, selectDiscoverStories, safeDiscoverURL, fetchDiscoverFeed, loadDiscover, getDiscover,
  editorialScore, storyTopic,
} from '../netlify/functions/_shared/slots-discover.mts';

const now = Date.parse('2026-09-11T03:00:00Z');
const music = DISCOVER_FEEDS[0], sports = DISCOVER_FEEDS[2];
const item = (title = 'A new album arrives', link = 'https://www.billboard.com/music/news/test-123/', date = new Date(now - 3600000).toUTCString()) =>
  `<item><title>${title}</title><link>${link}</link><pubDate>${date}</pubDate><description>Never copy this article body</description><media:content url="https://example.com/image.jpg" /></item>`;
const rss = (...items) => `<rss><channel>${items.join('')}</channel></rss>`;
const store = value => ({ value, reads: 0, writes: 0,
  async get() { this.reads++; return this.value; },
  async setJSON(key, value) { this.writes++; this.value = value; },
});
const outage = async () => { throw new Error('publisher offline'); };

test('RSS returns only attributed exact headlines, safe original links and real dates', () => {
  const [story] = parseDiscoverFeed(music, rss(item('Jay &amp; Kori’s new song', 'https://www.billboard.com/music/news/test-123/?one=1&amp;two=2')), now);
  assert.equal(story.title, 'Jay & Kori’s new song');
  assert.equal(story.url, 'https://www.billboard.com/music/news/test-123/?one=1&two=2');
  assert.equal(story.source, 'Billboard');
  assert.equal(story.category, 'music');
  assert.deepEqual(Object.keys(story).sort(), ['category', 'id', 'published_at', 'source', 'title', 'url']);
  assert.match(story.id, /^[a-f0-9]{24}$/);
});

test('HTML, XML entities, and hidden controls never create active title markup', () => {
  const [story] = parseDiscoverFeed(music, rss(item('<![CDATA[<b>New</b> &#x1f3b5; &lt;img src=x&gt; Song\u202e]]>')), now);
  assert.equal(story.title, 'New 🎵 Song');
  assert.equal(parseDiscoverFeed(music, '<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + rss(item()), now).length, 0);
});

test('links reject protocols, credentials, ports, deceptive hosts and off-publisher destinations', () => {
  for (const url of ['http://www.billboard.com/a', 'https://www.billboard.com.evil.test/a', 'https://www.billboard.com@evil.test/a',
    'https://user:pass@www.billboard.com/a', 'https://www.billboard.com:8080/a', 'javascript:alert(1)',
    'https://127.0.0.1/a', 'https://www.espn.com/story', 'https://www.billboard.com/']) {
    assert.equal(safeDiscoverURL(url, music), null, url);
  }
});

test('undated, expired and future stories are dropped without replacing their dates', () => {
  for (const date of ['', 'invalid', new Date(now - DISCOVER_MAX_AGE_MS - 1000).toUTCString(), new Date(now + 301000).toUTCString()]) {
    assert.equal(parseDiscoverFeed(music, rss(item('A headline', undefined, date)), now).length, 0, date);
  }
  assert.equal(parseDiscoverFeed(music, rss(item('A headline', undefined, new Date(now - DISCOVER_MAX_AGE_MS).toUTCString())), now).length, 1);
});

test('Atom only uses alternate article links and publication dates', () => {
  const xml = `<feed><entry><title>A record release</title><link rel="self" href="https://www.billboard.com/feed/entry"/><link rel="alternate" href="https://www.billboard.com/music/news/record/"/><published>${new Date(now).toISOString()}</published></entry></feed>`;
  assert.equal(parseDiscoverFeed(music, xml, now)[0].url, 'https://www.billboard.com/music/news/record/');
});

test('selection balances categories, keeps publisher variety and removes duplicates', () => {
  const input = [];
  for (let n = 0; n < 12; n++) input.push({ title: `New record number ${n}`, url: `https://www.billboard.com/music/${n}/`, source: 'Billboard', category: 'music', published_at: new Date(now - n * 1000).toISOString() });
  input.push({ title: 'Another publisher report', url: 'https://pitchfork.com/news/other/', source: 'Pitchfork', category: 'music', published_at: new Date(now - 20000).toISOString() });
  for (let n = 0; n < 12; n++) input.push({ title: `Sports result number ${n}`, url: `https://www.espn.com/nba/${n}/`, source: 'ESPN', category: 'sports', published_at: new Date(now - n * 1000).toISOString() });
  const selected = selectDiscoverStories([...input, ...input], now);
  assert.equal(selected.length, 8);
  assert.equal(selected.filter(x => x.category === 'music').length, 4);
  assert.equal(selected.filter(x => x.category === 'sports').length, 4);
  assert.ok(selected.some(x => x.source === 'Pitchfork'));
  assert.deepEqual(selected.slice(0, 4).map(x => x.category), ['music', 'sports', 'music', 'sports']);
});

test('release and performance headlines lead ahead of newer crime, lawsuits and political stories', () => {
  const headline = (title, seconds) => ({ title, url: `https://www.billboard.com/music/story-${seconds}/`, source: 'Billboard', category: 'music', published_at: new Date(now - seconds * 1000).toISOString() });
  const records = [headline('Singer sued over sexual assault allegations', 1), headline('Artist cancels political tour after Trump controversy', 2),
    headline('Artist shares a new single ahead of album release', 60), headline('Band announces festival performance and world tour', 120),
    headline('A new remix climbs the charts', 180), headline('Singer debuts a new music video', 200)];
  const selected = selectDiscoverStories(records, now);
  assert.equal(selected.length, 4);
  assert.ok(selected.every(story => editorialScore(story) > 0));
  assert.ok(selected.every(story => records.some(original => original.title === story.title)));
  assert.equal(selectDiscoverStories(records.slice(0, 2), now).length, 2, 'Other current news remains an honest fallback');
});

test('sports keeps football and different teams instead of repeating one controversy', () => {
  const headline = (title, slug, n) => ({ title, url: `https://www.espn.com/${slug}`, source: 'ESPN', category: 'sports', published_at: new Date(now - n * 1000).toISOString() });
  const records = [headline('Clippers investigation enters next phase', 'nba/story/clippers', 1),
    headline('Kawhi could face penalties after report', 'nba/story/kawhi', 2),
    headline('Ballmer responds to controversy', 'nba/story/ballmer', 3),
    headline('Pistons season preview: a new beginning', 'nba/story/pistons', 4),
    headline('Celtics prepare for season opener', 'nba/story/celtics', 5),
    headline('Chiefs preview football season opener', 'nfl/story/chiefs', 6),
    headline('Dodgers win another game', 'mlb/story/dodgers', 7)];
  const selected = selectDiscoverStories(records, now);
  assert.equal(selected.length, 4);
  assert.ok(selected.some(story => story.url.includes('/nfl/')));
  assert.ok(selected.some(story => story.url.includes('/nba/')));
  assert.equal(new Set(selected.map(storyTopic)).size, 4);
  assert.ok(selected.filter(story => storyTopic(story) === 'clippers').length <= 1);
  assert.equal(storyTopic(records[0]), storyTopic(records[1]));
});

test('feed fetch caps advertised and streamed body bytes', async () => {
  await assert.rejects(fetchDiscoverFeed(music, async () => new Response('x', { headers: { 'content-length': String(DISCOVER_MAX_FEED_BYTES + 1) } }), now), /too large/);
  await assert.rejects(fetchDiscoverFeed(music, async () => new Response('x'.repeat(DISCOVER_MAX_FEED_BYTES + 1)), now), /too large/);
  await assert.rejects(fetchDiscoverFeed(music, async () => new Response('<html>Publisher temporarily down</html>'), now), /not RSS or Atom/);
});

test('timeout covers stalled body reads as well as connection setup', async () => {
  let cancelled = false;
  const stalled = () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('<rss>')); }, cancel() { cancelled = true; } }));
  await assert.rejects(fetchDiscoverFeed(music, async () => stalled(), now, 20), /timed out/);
  assert.equal(cancelled, true);
  await assert.rejects(fetchDiscoverFeed(music, () => new Promise(() => {}), now, 20), /timed out/);
});

test('cache avoids publisher refetches but expired cached stories are still removed', async () => {
  const [story] = parseDiscoverFeed(music, rss(item()), now);
  const cache = store({ checked_at: new Date(now - 1000).toISOString(), result: { stories: [story], updated_at: new Date(now - 1000).toISOString(), stale: false } });
  let calls = 0;
  const result = await loadDiscover({ cache, now, fetcher: async () => { calls++; throw new Error('must use cache'); } });
  assert.equal(calls, 0); assert.equal(result.stories.length, 1);
  cache.value.result.stories[0].published_at = new Date(now - DISCOVER_MAX_AGE_MS - 1000).toISOString();
  assert.equal((await loadDiscover({ cache, now, fetcher: outage })).stories.length, 0);
});

test('one publisher outage does not block fresh headlines from other publishers', async () => {
  const result = await loadDiscover({ now, fetcher: async url => {
    if (url === music.url) return new Response(rss(item()));
    if (url === sports.url) return new Response(rss(item('A basketball result', 'https://www.espn.com/nba/story/123')));
    throw new Error('offline');
  } });
  assert.deepEqual(result.stories.map(x => x.category), ['music', 'sports']);
  assert.equal(result.stale, false);
});

test('outage returns only still-valid cached stories with stale flag and original update date', async () => {
  const [story] = parseDiscoverFeed(music, rss(item()), now);
  const previous = new Date(now - DISCOVER_CACHE_MS - 1000).toISOString();
  const cache = store({ checked_at: previous, result: { stories: [story], updated_at: previous, stale: false } });
  const result = await loadDiscover({ cache, fetcher: outage, now });
  assert.equal(result.stale, true); assert.equal(result.updated_at, previous);
  assert.deepEqual(result.stories, [story]);
  const empty = await loadDiscover({ fetcher: outage, now });
  assert.deepEqual(empty, { stories: [], updated_at: null, stale: true });
});

test('empty outage cache prevents every visitor from retrying unavailable publishers', async () => {
  const cache = store(null);
  await loadDiscover({ cache, fetcher: outage, now });
  let calls = 0;
  await loadDiscover({ cache, now: now + 1000, fetcher: async () => { calls++; throw new Error('offline'); } });
  assert.equal(calls, 0);
  await loadDiscover({ cache, now: now + 61000, fetcher: async () => { calls++; throw new Error('offline'); } });
  assert.equal(calls, DISCOVER_FEEDS.length);
});

test('endpoint serves public JSON, sets bounded cache TTL and rejects writes', async () => {
  const response = await getDiscover(new Request('https://jwhitedidit.net/api/slots/discover'), { now, fetcher: outage });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.equal(response.headers.get('Netlify-CDN-Cache-Control'), 'public, max-age=60');
  assert.deepEqual(await response.json(), { stories: [], updated_at: null, stale: true });
  assert.equal((await getDiscover(new Request('https://jwhitedidit.net/api/slots/discover', { method: 'POST' }))).status, 405);
});
