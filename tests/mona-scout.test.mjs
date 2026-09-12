import assert from 'node:assert/strict';
import test from 'node:test';
import { MemberError } from '../netlify/functions/_shared/member-auth.mts';
import { scoutLeads, scoutInput, parseScoutResponse, publicSourceURL, readScoutCache, readScoutLead } from '../netlify/functions/_shared/mona-lead-scout.mts';

const memberId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const now = new Date('2026-09-11T15:00:00.000Z');
const brief = { profession: 'Hair specialist and influencer', location: 'Dallas, Texas', offering: 'Hair tutorials and product demonstrations', goal: 'brand-deals' };
const url = 'https://hairbrand.com/creators/apply';
const lead = { title: 'Hair creator program', organization: 'Hair Brand', type: 'creator-program', location: 'United States',
  summary: 'The brand accepts creator applications for hair tutorials.', whyItFits: 'May fit your hair tutorial and product demonstration offer.',
  nextStep: 'Read the published requirements and use the application form on the source page.', sourceUrl: url, deadline: null, compensation: 'Not stated' };
const provider = (leads = [lead], resultURL = url) => ({ stop_reason: 'end_turn', content: [
  { type: 'server_tool_use', id: 'search-1', name: 'web_search', input: { query: 'hair creator program official applications' } },
  { type: 'web_search_tool_result', tool_use_id: 'search-1', content: [{ type: 'web_search_result', url: resultURL, title: 'Official creator applications', page_age: '2026-09-10' }] },
  { type: 'text', text: `<mona-results>${JSON.stringify({ leads })}</mona-results>` },
] });
function request(data = brief, headers = {}) { return new Request('https://jwhitedidit.net/api/mona/scout', { method: 'POST', headers: { origin: 'https://jwhitedidit.net', 'content-type': 'application/json', ...headers }, body: JSON.stringify(data) }); }
function dependencies(overrides = {}) {
  const calls = [], saved = [];
  return { calls, saved, resolveMember: async () => ({ id: memberId, name: 'Private member name' }), now: () => now,
    env: name => ({ ANTHROPIC_API_KEY: 'test-not-a-live-key', ANTHROPIC_BASE_URL: 'https://gateway.netlify.com/anthropic' }[name]),
    fetch: async (target, options) => { calls.push({ target, options }); return Response.json(provider()); },
    saveResults: async (id, result) => saved.push({ id, result }), ...overrides };
}

test('scouting makes one bounded provider request and saves only server-verified cards for the authenticated member', async () => {
  const deps = dependencies(), response = await scoutLeads(request(), deps), data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.status, 'ready'); assert.equal(data.memberId, memberId);
  assert.equal(deps.calls.length, 1); assert.equal(deps.calls[0].target, 'https://gateway.netlify.com/anthropic/v1/messages');
  const body = JSON.parse(deps.calls[0].options.body);
  assert.equal(body.model, 'claude-haiku-4-5-20251001'); assert.equal(body.tools[0].max_uses, 2); assert.equal(body.max_tokens, 2400);
  assert.equal(deps.calls[0].options.redirect, 'error'); assert.ok(deps.calls[0].options.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(body.messages[0].content), brief);
  assert.equal(JSON.stringify(body).includes(memberId), false); assert.equal(JSON.stringify(body).includes('Private member name'), false);
  assert.equal(data.leads[0].sourceTitle, 'Official creator applications'); assert.equal(data.leads[0].sourceUpdatedAt, '2026-09-10');
  assert.equal(data.leads[0].checkedAt, now.toISOString()); assert.equal(deps.saved[0].id, memberId);
  assert.deepEqual(deps.saved[0].result, { checkedAt: data.checkedAt, leads: data.leads });
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
});

test('authentication and origin checks happen before paid search or storage', async () => {
  const deps = dependencies({ resolveMember: async () => { throw new MemberError(401, 'Log in.'); } });
  assert.equal((await scoutLeads(request(), deps)).status, 401);
  assert.equal((await scoutLeads(request(brief, { origin: 'https://another-site.com' }), dependencies())).status, 403);
  assert.equal(deps.calls.length, 0); assert.equal(deps.saved.length, 0);
});

test('unknown keys, target member IDs, oversized inputs, private contact details and invalid goals are rejected', async () => {
  for (const invalid of [{ ...brief, memberId: 'somebody-else' }, { ...brief, offering: 'x'.repeat(241) }, { ...brief, offering: 'Email me at private@home.com' }, { ...brief, goal: 'send-messages' }, { ...brief, location: '' }]) {
    const deps = dependencies(); assert.equal((await scoutLeads(request(invalid), deps)).status, 400); assert.equal(deps.calls.length, 0);
  }
  assert.throws(() => scoutInput(null), MemberError);
  assert.equal((await scoutLeads(request({ ...brief, offering: 'x'.repeat(5000) }), dependencies())).status, 413);
});

test('missing gateway and provider outages never fabricate fallback leads or overwrite saved results', async () => {
  for (const override of [{ env: () => undefined }, { fetch: async () => new Response('provider error details', { status: 400 }) }, { fetch: async () => { throw new DOMException('Timed out', 'TimeoutError'); } }]) {
    const deps = dependencies(override), result = await scoutLeads(request(), deps), data = await result.json();
    assert.equal(result.status, 503); assert.equal(data.status, 'unavailable'); assert.deepEqual(data.leads, []); assert.equal(deps.saved.length, 0);
    assert.equal(JSON.stringify(data).includes('provider error details'), false);
  }
});

test('an unsearched answer and HTTP200 search tool errors cannot masquerade as a successful search', () => {
  const noSearch = provider(); noSearch.content = [noSearch.content[2]];
  const toolError = provider([]); toolError.content[1].content = { type: 'web_search_tool_result_error', error_code: 'unavailable' };
  const truncated = provider(); truncated.stop_reason = 'max_tokens';
  const paused = provider(); paused.stop_reason = 'pause_turn';
  for (const response of [noSearch, toolError, truncated, paused]) assert.throws(() => parseScoutResponse(response, now), MemberError);
});

test('generated URLs absent from provider results are rejected even if they look plausible', () => {
  assert.throws(() => parseScoutResponse(provider([{ ...lead, sourceUrl: 'https://hairbrand.com/unverified-campaign' }]), now), MemberError);
  const mixed = parseScoutResponse(provider([lead, { ...lead, sourceUrl: 'https://unverifiedbrand.com/apply' }]), now);
  assert.equal(mixed.leads.length, 1); assert.equal(mixed.leads[0].sourceUrl, url);
});

test('source titles and updated dates come from provider results, with stable IDs and duplicate suppression', () => {
  const data = parseScoutResponse(provider([lead, { ...lead, title: 'Duplicate campaign' }]), now);
  assert.equal(data.leads.length, 1); assert.match(data.leads[0].id, /^[a-f0-9]{24}$/);
  assert.equal(data.leads[0].id, parseScoutResponse(provider([{ ...lead, title: 'New title' }]), now).leads[0].id);
  assert.equal(data.leads[0].sourceTitle, 'Official creator applications');
});

test('expired, impossible and malformed deadlines are not returned', () => {
  for (const deadline of ['2026-09-10', '2026-02-30', 'tomorrow', '', undefined]) {
    assert.throws(() => parseScoutResponse(provider([{ ...lead, deadline }]), now), MemberError);
  }
  assert.equal(parseScoutResponse(provider([{ ...lead, deadline: '2026-09-11' }]), now).leads.length, 1);
});

test('unsafe and reserved source URLs are refused, including IP literals and credentials', () => {
  for (const bad of ['javascript:alert(1)', 'http://hairbrand.com', 'https://127.0.0.1/a', 'https://[::1]/a', 'https://user:pass@hairbrand.com/a', 'https://localhost/a', 'https://metadata.internal/a', 'https://example.com/a', 'https://site.test/a', 'https://hairbrand.com:8443/a']) assert.equal(publicSourceURL(bad), null, bad);
  assert.equal(publicSourceURL(`${url}#apply`), url);
});

test('successful searched zero matches has its own honest state and persists an empty search cache', async () => {
  const deps = dependencies({ fetch: async () => Response.json(provider([])) });
  const response = await scoutLeads(request(), deps), data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.status, 'no_matches'); assert.deepEqual(data.leads, []); assert.equal(deps.saved.length, 1);
});

test('malformed JSON, oversized provider output and unrecognized card schema fail closed', async () => {
  const invalid = provider(); invalid.content[2].text = '<mona-results>{"leads": broken}</mona-results>';
  assert.throws(() => parseScoutResponse(invalid, now), MemberError);
  assert.throws(() => parseScoutResponse(provider([{ ...lead, email: 'guessed@hairbrand.com' }]), now), MemberError);
  const deps = dependencies({ fetch: async () => new Response('x'.repeat(1_000_001)) });
  assert.equal((await scoutLeads(request(), deps)).status, 503); assert.equal(deps.saved.length, 0);
});

test('storage failure does not report a saveable successful search', async () => {
  const deps = dependencies({ saveResults: async () => { throw new Error('storage unavailable'); } });
  const response = await scoutLeads(request(), deps), data = await response.json();
  assert.equal(response.status, 503); assert.equal(data.status, 'unavailable'); assert.deepEqual(data.leads, []);
});

test('trusted cache projection verifies ID, dates and text while dropping unrelated stored fields', () => {
  const results = parseScoutResponse(provider(), now), cache = { checkedAt: results.checkedAt, leads: results.leads };
  assert.deepEqual(readScoutCache(cache), cache);
  assert.deepEqual(readScoutCache({ ...cache, private: 'never send', leads: [{ ...cache.leads[0], secret: 'never send' }] }), cache);
  assert.equal(readScoutCache({ ...cache, leads: [{ ...cache.leads[0], id: 'forged' }] }), null);
  assert.equal(readScoutCache({ ...cache, checkedAt: 'yesterday' }), null);
  assert.equal(readScoutCache({ ...cache, leads: [{ ...cache.leads[0], checkedAt: '2026-09-10T15:00:00.000Z' }] }), null);
  assert.deepEqual(readScoutLead({ ...cache.leads[0], status: 'saved', notes: 'Private', savedAt: now.toISOString() }), cache.leads[0]);
  assert.equal(readScoutLead(null), null);
});
