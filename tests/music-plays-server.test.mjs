import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { getMusicPlays, postMusicPlay, VIDEO_IDS, chicagoDay } from '../netlify/functions/_shared/music-plays.mts';
import { config as getConfig } from '../netlify/functions/music-plays-get.mts';
import { config as postConfig } from '../netlify/functions/music-plays-post.mts';

const NOW = Date.parse('2026-09-05T12:00:00Z');
const noPause = async () => {};
function memoryStore() {
  return {
    data: null, version: 0, writes: 0,
    async getWithMetadata() { return this.data ? { data: structuredClone(this.data), etag: String(this.version) } : null; },
    async setJSON(key, data, options) {
      this.writes++;
      if (options.onlyIfNew ? this.data !== null : options.onlyIfMatch !== String(this.version)) return { modified: false };
      this.data = structuredClone(data); this.version++;
      return { modified: true };
    },
  };
}
function request(input = {}, options = {}) {
  return new Request('https://jwhitedidit.net/api/music-plays/post', {
    method: 'POST', headers: { Origin: 'https://jwhitedidit.net', 'Content-Type': 'application/json', ...options.headers },
    body: options.body ?? JSON.stringify({ video_id: VIDEO_IDS[0], session_id: randomUUID(), ...input }),
  });
}
const read = (store, now = NOW) => getMusicPlays(new Request('https://jwhitedidit.net/api/music-plays'), store, now);
const write = (store, input = {}, now = NOW) => postMusicPlay(request(input), store, now, noPause);

test('new store starts at real zeros without writing and allowlist matches all music tracks', async () => {
  const store = memoryStore();
  const response = await read(store);
  const data = await response.json();
  assert.equal(data.total, 0); assert.equal(data.today, 0); assert.equal(store.writes, 0);
  assert.equal(Object.keys(data.counts).length, 26);
  assert.ok(Object.values(data.counts).every(value => value === 0));
  const source = await readFile(new URL('../music.js', import.meta.url), 'utf8');
  assert.deepEqual([...source.matchAll(/video:'([^']+)'/g)].map(match => match[1]), [...VIDEO_IDS]);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('concurrent CAS updates retain every distinct play and never expose receipts', async () => {
  const store = memoryStore();
  const responses = await Promise.all(Array.from({ length: 8 }, (_, n) => write(store, { video_id: VIDEO_IDS[n % 2] })));
  assert.ok(responses.every(response => response.status === 201));
  const counts = await (await read(store)).json();
  assert.equal(counts.total, 8); assert.equal(counts.today, 8);
  assert.equal(counts.counts[VIDEO_IDS[0]], 4); assert.equal(counts.counts[VIDEO_IDS[1]], 4);
  assert.deepEqual(Object.keys(counts).sort(), ['counts', 'today', 'total']);
});

test('same track and session count once across simultaneous retries while other tracks count independently', async () => {
  const store = memoryStore();
  const input = { session_id: randomUUID() };
  const responses = await Promise.all(Array.from({ length: 20 }, () => write(store, input)));
  assert.equal(responses.filter(response => response.status === 201).length, 1);
  assert.equal(responses.filter(response => response.status === 200).length, 19);
  assert.equal((await (await read(store)).json()).total, 1);
  assert.equal((await write(store, { ...input, video_id: VIDEO_IDS[1] })).status, 201);
  assert.equal((await (await read(store)).json()).total, 2);
});

test('CAS conflict exhaustion or failed write never reports a count that was not stored', async () => {
  const store = memoryStore();
  let attempts = 0;
  store.setJSON = async () => { attempts++; return { modified: false }; };
  assert.equal((await write(store)).status, 503);
  assert.equal(attempts, 10);
  assert.equal((await (await read(store)).json()).total, 0);
  store.setJSON = async () => { throw new Error('private backend failure'); };
  const response = await write(store);
  assert.equal(response.status, 503); assert.ok(!(await response.text()).includes('backend failure'));
  assert.equal((await (await read(store)).json()).total, 0);
});

test('malformed stored state fails closed without resetting totals or receipts', async () => {
  const store = memoryStore();
  await write(store);
  const original = structuredClone(store.data);
  for (const mutate of [data => { data.total = 99; }, data => { delete data.counts[VIDEO_IDS[0]]; }, data => { data.receipts = { malformed: 1 }; }, data => { data.day = '2026-02-31'; }]) {
    store.data = structuredClone(original); mutate(store.data);
    const saved = JSON.stringify(store.data), writesBefore = store.writes;
    assert.equal((await read(store)).status, 503);
    assert.equal((await write(store)).status, 503);
    assert.equal(store.writes, writesBefore); assert.equal(JSON.stringify(store.data), saved);
  }
});

test('today resets at Chicago midnight and expired receipts do not erase lifetime totals', async () => {
  const store = memoryStore();
  const before = Date.parse('2026-09-06T04:59:59Z'), after = Date.parse('2026-09-06T05:00:01Z');
  assert.equal(chicagoDay(before), '2026-09-05'); assert.equal(chicagoDay(after), '2026-09-06');
  const input = { session_id: randomUUID() };
  await write(store, input, before);
  const nextDay = await (await read(store, after)).json();
  assert.equal(nextDay.today, 0); assert.equal(nextDay.total, 1);
  assert.equal((await write(store, input, after)).status, 200);
  await write(store, {}, after);
  const updated = await (await read(store, after)).json();
  assert.equal(updated.today, 1); assert.equal(updated.total, 2);
  assert.equal((await write(store, input, before + 86400001)).status, 201);
  assert.equal((await (await read(store, before + 86400001)).json()).total, 3);
});

test('receipt capacity evicts oldest while always retaining the just-counted session', async () => {
  const store = memoryStore();
  await write(store);
  store.data.receipts = Object.fromEntries(Array.from({ length: 5000 }, (_, n) => [n.toString(16).padStart(64, '0'), NOW - 1000 - n]));
  const input = { session_id: randomUUID() };
  assert.equal((await write(store, input)).status, 201);
  assert.equal(Object.keys(store.data.receipts).length, 5000);
  assert.equal((await write(store, input)).status, 200);
  assert.equal((await (await read(store)).json()).total, 2);
});

test('unknown songs, invalid UUIDs, missing Origin and large bodies never write', async () => {
  const store = memoryStore();
  const cases = [
    [request({ video_id: 'unknown-song' }), 400], [request({ session_id: '../fake' }), 400],
    [request({}, { headers: { Origin: 'https://example.com' } }), 403],
    [request({}, { headers: { 'Sec-Fetch-Site': 'cross-site' } }), 403],
    [request({}, { headers: { 'Content-Type': 'text/plain' } }), 415],
    [request({}, { body: '{bad' }), 400], [request({}, { body: ' '.repeat(2049) }), 413],
  ];
  const missingOrigin = request(); missingOrigin.headers.delete('Origin'); cases.push([missingOrigin, 403]);
  for (const [req, status] of cases) assert.equal((await postMusicPlay(req, store, NOW, noPause)).status, status);
  assert.equal(store.writes, 0);
  assert.equal(getConfig.path, '/api/music-plays'); assert.equal(postConfig.path, '/api/music-plays/post');
  assert.equal(getConfig.rateLimit.windowLimit, 120); assert.equal(postConfig.rateLimit.windowLimit, 30);
});
