import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GOOGLE_ENGINE_LOCATION, GOOGLE_ENGINE_VARIABLE, GOOGLE_UNAVAILABLE, SEARCH_NAME, SEARCH_NAV_LABEL,
  SEARCH_SECTIONS, getGoogleSearch, getRosterSearch, googleEngineId, googleSearchLink,
} from '../netlify/functions/_shared/morespace-search.mts';
import { POLICY_VERSION } from '../netlify/functions/_shared/comment-moderation.mts';
import { MUSIC_LINK_POLICY_VERSION } from '../netlify/functions/_shared/member-songs.mts';
import { config as rosterConfig } from '../netlify/functions/search-roster.mts';
import { config as googleConfig } from '../netlify/functions/search-google.mts';

const origin = 'https://jwhitedidit.net';
const alice = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Alice Rivers' };
const bob = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Bobby Keys' };
const owner = { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', name: 'J.White Did It' };

const song = (extra = {}) => ({
  member_id: alice.id, slot: 1, status: 'approved', source: 'link', title: 'Riverside Nights',
  name: alice.name, provider: 'spotify', external_url: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC',
  revision: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac',
  input_digest: 'a'.repeat(64), policy_version: MUSIC_LINK_POLICY_VERSION, reason: 'Approved link.',
  created_at: '2026-09-05T00:00:00Z', duration: null, asset_id: null, digest: null, size: null, ...extra,
});

function memory() {
  const records = new Map(), etags = new Map();
  let revision = 0;
  return {
    records,
    async *list({ prefix }) {
      const keys = [...records.keys()].filter(key => key.startsWith(prefix));
      for (let i = 0; i < keys.length; i += 8) yield { blobs: keys.slice(i, i + 8).map(key => ({ key })) };
    },
    async get(key) { return structuredClone(records.get(key) ?? null); },
    async getWithMetadata(key) { return records.has(key) ? { data: structuredClone(records.get(key)), etag: etags.get(key) } : null; },
    async setJSON(key, value, options = {}) {
      if (options.onlyIfNew && records.has(key)) return { modified: false };
      records.set(key, structuredClone(value));
      etags.set(key, String(++revision));
      return { modified: true };
    },
    async set(key, value, options = {}) { return this.setJSON(key, value, options); },
  };
}

async function stores() {
  const value = { songs: memory(), profiles: memory() };
  const profile = (member, extra) => value.profiles.setJSON(`profiles/${member.id}`, {
    id: member.id, name: member.name, status: 'MORE!', about_me: '', title_lines: '', credentials: '', location: '',
    photo_id: null, updated_at: '2026-09-05T00:00:00Z', approved: true, policy_version: POLICY_VERSION, ...extra,
  });
  await profile(alice, { about_me: 'Kansas City singer looking for a producer.', location: 'Kansas City, Missouri', title_lines: 'Singer.' });
  await profile(bob, { about_me: 'Drummer for hire.', location: 'Chicago, Illinois' });
  await profile(owner, {});
  for (const member of [alice, bob, owner]) {
    await value.profiles.setJSON(`public-members/${member.id}`, { id: member.id, name: member.name, joined_at: '2026-09-01T00:00:00Z' });
  }
  await value.profiles.setJSON('owner-binding', { id: owner.id });
  await value.songs.setJSON(`slots/${alice.id}/1`, song());
  return value;
}

const search = async (query, s) => (await getRosterSearch(new Request(`${origin}/api/morespace/roster?q=${encodeURIComponent(query)}`), s)).json();
const google = (query, options) => getGoogleSearch(new Request(`${origin}/api/morespace/google?q=${encodeURIComponent(query)}`), options);
const noKeys = () => undefined;

test('the feature keeps its own name, sections and routes inside the app', () => {
  assert.equal(SEARCH_NAME, 'ROOSTER Search');
  assert.equal(SEARCH_NAV_LABEL, 'ROOSTER Search');
  assert.deepEqual([...SEARCH_SECTIONS], ['ROOSTER', 'Google']);
  assert.equal(rosterConfig.path, '/api/morespace/roster');
  assert.equal(googleConfig.path, '/api/morespace/google');
  for (const config of [rosterConfig, googleConfig]) assert.equal(config.method, 'GET');
});

test('ROOSTER search finds members by name and by their own public profile text', async () => {
  const s = await stores();
  const byName = await search('bobby', s);
  assert.deepEqual(byName.results.map(result => result.title), ['Bobby Keys']);
  assert.equal(byName.results[0].open_url, `/profile.html?id=${bob.id}`);
  assert.equal(byName.results[0].open_label, 'Open in ROOSTER');
  assert.equal(byName.results[0].description, 'Drummer for hire.');

  const byText = await search('kansas city', s);
  assert.deepEqual(byText.results.map(result => result.title), ['Alice Rivers']);
  assert.equal(byText.results[0].description.includes('Kansas City'), true, 'the matching public line is the description');
});

test('a published song is searchable and opens inside ROOSTER', async () => {
  const s = await stores();
  const results = (await search('riverside', s)).results;
  const song = results.find(result => result.kind === 'song');
  assert.ok(song, 'the published song should be found');
  assert.equal(song.title, 'Riverside Nights');
  assert.equal(song.subtitle, "Song on Alice Rivers's page");
  assert.equal(song.description, 'Plays on their ROOSTER profile through Spotify.');
  assert.equal(song.open_url, `/profile.html?id=${alice.id}#music`);
});

test('an unpublished profile and an unapproved song stay out of the results', async () => {
  const s = await stores();
  s.profiles.records.delete(`profiles/${bob.id}`);
  s.profiles.records.set(`public-members/${bob.id}`, { id: bob.id, name: bob.name, deleted: true });
  s.songs.records.set(`slots/${alice.id}/1`, song({ status: 'pending' }));
  const everything = await search('', s);
  assert.equal(everything.results.some(result => result.title === 'Bobby Keys'), false, 'a withdrawn member is not searchable');
  assert.equal((await search('riverside', s)).results.some(result => result.kind === 'song'), false, 'an unapproved song is not searchable');
});

test('search never reaches private messages, emails, private uploads or owner controls', async () => {
  const s = await stores();
  s.profiles.records.set(`messages/${alice.id}/1`, { body: 'PRIVATE-MESSAGE-BODY', email: 'alice@example.test' });
  s.profiles.records.set(`private/${alice.id}`, { email: 'alice@example.test' });
  const response = await getRosterSearch(new Request(`${origin}/api/morespace/roster?q=alice`), s);
  const serialised = JSON.stringify(await response.json());
  for (const secret of ['PRIVATE-MESSAGE-BODY', 'alice@example.test', 'owner-binding', 'photo_id']) {
    assert.equal(serialised.includes(secret), false, `${secret} must never appear in search results`);
  }
  assert.equal(response.headers.get('cache-control')?.includes('no-store'), true);
});

test('the owner result points at the owner page the app already uses', async () => {
  const s = await stores();
  const result = (await search('j.white', s)).results[0];
  assert.equal(result.title, 'J.White Did It');
  assert.equal(result.subtitle, 'On the ROOSTER · Site owner');
  assert.equal(result.open_url, '/#home');
});

test('an oversized query is refused instead of being run', async () => {
  const s = await stores();
  const response = await getRosterSearch(new Request(`${origin}/api/morespace/roster?q=${'x'.repeat(81)}`), s);
  assert.equal(response.status, 400);
  assert.equal((await getRosterSearch(new Request(`${origin}/api/morespace/roster`, { method: 'POST' }), s)).status, 405);
});
test('Search Google opens the exact typed words on Google itself, with no API key', async () => {
  assert.equal(googleSearchLink('kansas city studios'), 'https://www.google.com/search?q=kansas%20city%20studios');
  assert.equal(googleSearchLink('r&b singer "wanted"'), 'https://www.google.com/search?q=r%26b%20singer%20%22wanted%22');
  const body = await (await google('kansas city studios', { env: noKeys })).json();
  assert.equal(body.google_url, 'https://www.google.com/search?q=kansas%20city%20studios');
});

test('with no engine ID the page is told only the one public sentence', async () => {
  const response = await google('kansas city studios', { env: noKeys });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.configured, false);
  assert.equal(body.message, GOOGLE_UNAVAILABLE);
  assert.equal(body.message, 'Google results are not available inside ROOSTER yet. Use Search Google to see your results.');
  // Nothing about the setting, the provider or an API reaches the page.
  assert.equal('engine_id' in body, false);
  const payload = JSON.stringify(body);
  for (const leak of [GOOGLE_ENGINE_VARIABLE, 'API', 'key', 'environment', 'Netlify']) {
    assert.equal(payload.includes(leak), false, `${leak} must never reach a visitor`);
  }
  assert.equal(googleEngineId(noKeys), null);
});

test('a blank, malformed or placeholder engine ID counts as not connected', async () => {
  for (const value of ['', '   ', 'ab', 'has spaces', 'your-engine-id', 'CHANGEME', 'x'.repeat(80), 'bad/slash']) {
    assert.equal(googleEngineId(() => value), null, value || '(blank)');
    assert.equal((await (await google('anything', { env: () => value })).json()).configured, false, value || '(blank)');
  }
});

test('a real engine ID switches on Programmable Search Engine results inside ROOSTER', async () => {
  const env = key => (key === GOOGLE_ENGINE_VARIABLE ? ' a1b2c3d4e5f6g7h8i ' : undefined);
  assert.equal(googleEngineId(env), 'a1b2c3d4e5f6g7h8i');
  const body = await (await google('kansas city studios', { env })).json();
  assert.equal(body.configured, true);
  assert.equal(body.engine_id, 'a1b2c3d4e5f6g7h8i');
  assert.equal(body.message, undefined, 'the fallback sentence is not shown when results are connected');
  assert.equal(googleEngineId(key => (key === GOOGLE_ENGINE_VARIABLE ? 'partner-pub-1234567890123456:abcd1234' : undefined)),
    'partner-pub-1234567890123456:abcd1234');
});

test('the app never calls the Google Custom Search JSON API and never frames Google', () => {
  const server = readFileSync(new URL('../netlify/functions/_shared/morespace-search.mts', import.meta.url), 'utf8');
  const client = readFileSync(new URL('../morespace-search.js', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../morespace.html', import.meta.url), 'utf8');
  for (const [label, source] of [['server', server], ['client', client], ['page', page]]) {
    assert.doesNotMatch(source, /googleapis\.com\/customsearch/, `${label} must not use the Custom Search JSON API`);
    assert.doesNotMatch(source, /GOOGLE_SEARCH_API_KEY/, `${label} must not expect a search API key`);
  }
  assert.doesNotMatch(page, /<iframe/, 'nothing on this page is framed, least of all google.com');
  assert.doesNotMatch(client, /iframe|previewFrame/, 'the in-page frame preview is gone');
  // In-page Google results come from Google's own Programmable Search Engine script.
  assert.match(client, /cse\.google\.com\/cse\.js\?cx=/);
  assert.match(client, /gcse-searchresults-only/);
});

test('the page offers exactly two choices and keeps the Brave message out of sight', () => {
  const page = readFileSync(new URL('../morespace.html', import.meta.url), 'utf8');
  const client = readFileSync(new URL('../morespace-search.js', import.meta.url), 'utf8');
  assert.match(page, /ROOSTER SEARCH/);
  assert.match(page, /GOOGLE SEARCH/);
  assert.match(page, /id="morespace-google-button"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
  assert.match(page, /Google results are not available inside ROOSTER yet\. Use Search Google to see your results\./);
  assert.match(page, />Search Google</);
  for (const [label, source] of [['page', page], ['client', client]]) {
    assert.doesNotMatch(source, /Brave|BRAVE_SEARCH_API_KEY|X-Subscription-Token/, `${label} must not mention the Brave Search API`);
    assert.doesNotMatch(source, /Bing|Tavily/, `${label} must not mention other providers`);
    assert.doesNotMatch(source, /environment variable|Netlify site settings/, `${label} must not show developer instructions`);
  }
  assert.match(client, /Google results are not available inside ROOSTER yet\. Use Search Google to see your results\./);
});

test('the documentation names the one setting to add and where it goes', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(readme, /## ROOSTER Search/);
  assert.match(readme, new RegExp(GOOGLE_ENGINE_VARIABLE));
  assert.match(readme, /Programmable Search Engine/);
  assert.equal(GOOGLE_ENGINE_LOCATION, 'Netlify site settings, Environment variables');
  assert.doesNotMatch(readme, /BRAVE_SEARCH_API_KEY/, 'the removed provider is out of the documentation too');
  assert.doesNotMatch(readme, /Custom Search JSON API is used|customsearch/, 'the JSON API stays unused');
});
