import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { getChatMessages, postChatMessage } from '../netlify/functions/_shared/member-chat.mts';
import { requireMember } from '../netlify/functions/_shared/member-auth.mts';
import { POLICY_VERSION } from '../netlify/functions/_shared/comment-moderation.mts';
import { config as getConfig } from '../netlify/functions/chat-get.mts';
import { config as postConfig } from '../netlify/functions/chat-post.mts';

const alice = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Alice' };
const bob = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Bob' };
const auth = member => () => requireMember(async () => ({ ...member, confirmedAt: '2026-09-05', email: 'never-publish@example.test' }));
const decision = (status = 'approved', overrides = {}) => ({
  status, reason: status === 'approved' ? 'positive_or_respectful' : status === 'rejected' ? 'negative_or_abusive' : 'uncertain',
  policy_version: POLICY_VERSION, checked_at: '2026-09-05T00:00:00Z', ...overrides,
});
const approve = async () => decision();
function memoryStore() {
  const records = new Map();
  const reads = [];
  const prefixes = [];
  return {
    records, reads, prefixes,
    async *list({ prefix }) {
      prefixes.push(prefix);
      const keys = [...records.keys()].filter(key => key.startsWith(prefix)).reverse();
      for (let i = 0; i < keys.length; i += 7) yield { blobs: keys.slice(i, i + 7).map(key => ({ key })) };
    },
    async get(key) { reads.push(key); return structuredClone(records.get(key) ?? null); },
    async setJSON(key, value, options = {}) {
      if (options.onlyIfNew && records.has(key)) return { modified: false };
      records.set(key, structuredClone(value));
      return { modified: true };
    },
  };
}
const getRequest = (query = '', headers = {}) => new Request(`https://jwhitedidit.net/api/member-chat${query}`, { headers });
function postRequest(input = {}, options = {}) {
  return new Request('https://jwhitedidit.net/api/member-chat/send', {
    method: 'POST',
    headers: { Origin: 'https://jwhitedidit.net', 'Content-Type': 'application/json', ...options.headers },
    body: options.body ?? JSON.stringify({ body: 'Loving this music!', request_id: randomUUID(), ...input }),
  });
}
const list = async (store, query = '') => (await getChatMessages(getRequest(query), store, auth(alice))).json();

test('room access requires a confirmed Identity member and never reads or writes storage on denial', async () => {
  const store = memoryStore();
  for (const user of [null, alice, { ...alice, confirmedAt: 'invalid' }]) {
    const denied = () => requireMember(async () => user);
    assert.equal((await getChatMessages(getRequest(), store, denied)).status, user ? 403 : 401);
    assert.equal((await postChatMessage(postRequest(), store, denied, approve)).status, user ? 403 : 401);
  }
  assert.deepEqual(store.reads, []);
  assert.deepEqual(store.prefixes, []);
  assert.equal(store.records.size, 0);
});

test('cross-site and originless writes are rejected before any storage access', async () => {
  const store = memoryStore();
  const missing = postRequest();
  missing.headers.delete('Origin');
  for (const request of [missing, postRequest({}, { headers: { Origin: 'https://elsewhere.test' } }), postRequest({}, { headers: { 'Sec-Fetch-Site': 'cross-site' } })]) {
    assert.equal((await postChatMessage(request, store, auth(alice), approve)).status, 403);
  }
  assert.equal((await getChatMessages(getRequest('', { 'Sec-Fetch-Site': 'cross-site' }), store, auth(alice))).status, 403);
  assert.equal(store.records.size, 0);
  assert.deepEqual(store.reads, []);
});

test('published room messages use server identity, room and timestamps and whitelist public fields', async () => {
  const store = memoryStore();
  let reviewed;
  const response = await postChatMessage(postRequest({
    member_id: bob.id, name: 'Impersonated owner', room: 'Private', created_at: '1999-01-01',
    email: 'private@example.test', moderation: { status: 'approved' }, body: '  Great\r\nbeat!  ',
  }), store, auth(alice), async input => { reviewed = input; return decision(); });
  assert.equal(response.status, 201);
  const sent = await response.json();
  assert.deepEqual(reviewed, { name: 'Alice', message: 'Great\nbeat!' });
  assert.equal(sent.status, 'approved');
  assert.equal(sent.published, true);
  assert.equal(sent.message.member_id, alice.id);
  assert.equal(sent.message.name, 'Alice');
  assert.equal(sent.message.body, 'Great\nbeat!');
  assert.notEqual(sent.message.created_at, '1999-01-01');
  assert.deepEqual(Object.keys(sent.message).sort(), ['body', 'created_at', 'id', 'member_id', 'name']);
  const room = await list(store);
  assert.deepEqual(room, { room: 'The Listening Room', messages: [sent.message], next: null });
  assert.ok(!JSON.stringify(room).includes('example.test'));
  assert.ok(store.prefixes.every(prefix => prefix === 'room/'));
});

test('held and rejected messages never enter the room and no member can bypass moderation', async () => {
  const store = memoryStore();
  for (const status of ['pending', 'rejected']) {
    const response = await postChatMessage(postRequest({ roles: ['admin'], can_edit_owner: true, status: 'approved' }), store, auth(alice), async () => decision(status));
    assert.equal(response.status, status === 'pending' ? 202 : 422);
    assert.deepEqual(await response.json(), { status, published: false });
  }
  assert.equal(store.records.size, 2);
  assert.deepEqual((await list(store)).messages, []);
  assert.ok([...store.records.keys()].every(key => key.startsWith('messages/')));
});

test('moderator errors and malformed or contradictory approvals fail closed and remain durable holds', async () => {
  const store = memoryStore();
  const moderators = [
    async () => { throw new Error('private moderation detail'); },
    async () => null,
    async () => decision('approved', { policy_version: 'unknown' }),
    async () => decision('approved', { reason: 'uncertain' }),
    async () => decision('approved', { checked_at: 'invalid' }),
  ];
  for (const moderator of moderators) {
    const response = await postChatMessage(postRequest(), store, auth(alice), moderator);
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { status: 'pending', published: false });
  }
  assert.deepEqual((await list(store)).messages, []);
  assert.equal(store.records.size, moderators.length);
});

test('room reads recheck moderation even if an incorrect index points at a hold', async () => {
  const store = memoryStore();
  await postChatMessage(postRequest(), store, auth(alice), async () => decision('pending'));
  const record = [...store.records.values()][0];
  const suffix = `${String(9999999999999 - Date.parse(record.created_at)).padStart(13, '0')}-${record.id}`;
  await store.setJSON('room/' + suffix, { id: record.id });
  assert.deepEqual((await list(store)).messages, []);
  record.moderation = decision('approved', { policy_version: 'wrong-policy' });
  store.records.set('messages/' + record.id, record);
  assert.deepEqual((await list(store)).messages, []);
});

test('concurrent retries publish one immutable message and never re-moderate a saved decision', async () => {
  const store = memoryStore();
  const request_id = randomUUID();
  const replies = await Promise.all(Array.from({ length: 12 }, () => postChatMessage(postRequest({ request_id }), store, auth(alice), approve)));
  const payloads = await Promise.all(replies.map(response => response.json()));
  assert.equal(replies.filter(response => response.status === 201).length, 1);
  assert.ok(payloads.every(payload => JSON.stringify(payload) === JSON.stringify(payloads[0])));
  assert.equal((await list(store)).messages.length, 1);
  assert.equal(store.records.size, 2);
  let reviewed = false;
  const retry = await postChatMessage(postRequest({ request_id }), store, auth(alice), async () => { reviewed = true; return decision('rejected'); });
  assert.equal(retry.status, 200);
  assert.equal(reviewed, false);
  assert.equal((await postChatMessage(postRequest({ request_id, body: 'Replace the original' }), store, auth(alice), approve)).status, 409);
  assert.deepEqual((await list(store)).messages, [payloads[0].message]);
});

test('a pending retry cannot upgrade its moderation or overwrite its content', async () => {
  const store = memoryStore();
  const request_id = randomUUID();
  await postChatMessage(postRequest({ request_id }), store, auth(alice), async () => decision('pending'));
  const retry = await postChatMessage(postRequest({ request_id }), store, auth(alice), approve);
  assert.equal(retry.status, 202);
  assert.equal((await postChatMessage(postRequest({ request_id, body: 'A different message' }), store, auth(alice), approve)).status, 409);
  assert.deepEqual((await list(store)).messages, []);
});

test('two authenticated senders sharing a request UUID get independent messages', async () => {
  const store = memoryStore();
  const request_id = randomUUID();
  const a = await (await postChatMessage(postRequest({ request_id }), store, auth(alice), approve)).json();
  const b = await (await postChatMessage(postRequest({ request_id }), store, auth(bob), approve)).json();
  assert.notEqual(a.message.id, b.message.id);
  assert.equal((await list(store)).messages.length, 2);
});

test('failed durable writes never acknowledge or publish and index retries recover without duplication', async () => {
  const store = memoryStore();
  const write = store.setJSON.bind(store);
  store.setJSON = async () => { throw new Error('sensitive storage details'); };
  const failed = await postChatMessage(postRequest(), store, auth(alice), approve);
  assert.equal(failed.status, 503);
  assert.ok(!(await failed.text()).includes('sensitive'));
  assert.deepEqual((await list(store)).messages, []);
  const input = { request_id: randomUUID() };
  store.setJSON = async (key, ...rest) => {
    if (key.startsWith('room/')) throw new Error('index failure');
    return write(key, ...rest);
  };
  assert.equal((await postChatMessage(postRequest(input), store, auth(alice), approve)).status, 503);
  assert.equal(store.records.size, 1);
  assert.deepEqual((await list(store)).messages, []);
  store.setJSON = write;
  assert.equal((await postChatMessage(postRequest(input), store, auth(alice), approve)).status, 200);
  assert.equal(store.records.size, 2);
  assert.equal((await list(store)).messages.length, 1);
});

test('publication and send acknowledgement wait for the final durable room index', async () => {
  const store = memoryStore();
  const write = store.setJSON.bind(store);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  store.setJSON = async (key, ...rest) => { if (key.startsWith('room/')) await gate; return write(key, ...rest); };
  let acknowledged = false;
  const sending = postChatMessage(postRequest(), store, auth(alice), approve).then(response => { acknowledged = true; return response; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(acknowledged, false);
  assert.deepEqual((await list(store)).messages, []);
  release();
  assert.equal((await sending).status, 201);
  assert.equal((await list(store)).messages.length, 1);
});

test('bounded room pages are newest first across unordered storage listings with no duplicates', async () => {
  const store = memoryStore();
  await Promise.all(Array.from({ length: 56 }, (_, i) => postChatMessage(postRequest({ body: `Great music ${i}` }), store, auth(alice), approve)));
  store.reads.length = 0;
  const first = await list(store);
  assert.equal(first.messages.length, 50);
  assert.equal(store.reads.length, 50);
  const second = await list(store, '?before=' + first.next);
  assert.equal(second.messages.length, 6);
  assert.equal(second.next, null);
  const all = [...first.messages, ...second.messages];
  assert.equal(new Set(all.map(message => message.id)).size, 56);
  assert.ok(all.every((message, i) => i === 0 || all[i - 1].created_at >= message.created_at));
  for (const query of ['?limit=0', '?limit=51', '?limit=abc', '?before=../../private']) {
    assert.equal((await getChatMessages(getRequest(query), store, auth(alice))).status, 400);
  }
});

test('invalid and oversized bodies are refused without moderation or writes', async () => {
  const store = memoryStore();
  let moderated = false;
  const moderator = async () => { moderated = true; return decision(); };
  const cases = [
    [postRequest({ body: '' }), 400], [postRequest({ body: ' '.repeat(10) }), 400],
    [postRequest({ body: 'x'.repeat(501) }), 400], [postRequest({ body: '\u0000bad' }), 400],
    [postRequest({ request_id: '../../private' }), 400],
    [postRequest({}, { headers: { 'Content-Type': 'text/plain' } }), 415],
    [postRequest({}, { body: '{invalid' }), 400],
    [postRequest({}, { body: ' '.repeat(4097) }), 413],
    [postRequest({}, { headers: { 'Content-Length': '4097' } }), 413],
  ];
  for (const [request, status] of cases) assert.equal((await postChatMessage(request, store, auth(alice), moderator)).status, status);
  assert.equal(moderated, false);
  assert.equal(store.records.size, 0);
});

test('member room responses cannot be shared cached and reads and sends have distinct rate limits', async () => {
  const response = await getChatMessages(getRequest(), memoryStore(), auth(alice));
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('netlify-cdn-cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal(getConfig.path, '/api/member-chat');
  assert.equal(getConfig.rateLimit.windowLimit, 600);
  assert.equal(getConfig.rateLimit.windowSize, 60);
  assert.equal(postConfig.path, '/api/member-chat/send');
  assert.equal(postConfig.rateLimit.windowLimit, 10);
  assert.equal(postConfig.rateLimit.windowSize, 60);
});
