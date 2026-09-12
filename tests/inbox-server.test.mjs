import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { getMemberMessages, getMemberUnreadMessages, markMemberMessageRead, sendMemberMessage } from '../netlify/functions/_shared/member-messages.mts';
import { requireMember } from '../netlify/functions/_shared/member-auth.mts';
import { config as getConfig } from '../netlify/functions/inbox-get.mts';
import { config as sendConfig } from '../netlify/functions/inbox-send.mts';
import { config as unreadConfig } from '../netlify/functions/inbox-unread.mts';
import { config as readConfig } from '../netlify/functions/inbox-read.mts';

const alice = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Alice' };
const bob = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Bob' };
const chris = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Chris' };
const auth = member => () => requireMember(async () => ({ ...member, email: 'private@example.test', confirmedAt: '2026-09-05T00:00:00Z' }));

function memoryStore() {
  const records = new Map();
  const reads = [];
  const prefixes = [];
  return {
    records, reads, prefixes,
    async *list({ prefix }) {
      prefixes.push(prefix);
      // Deliberately reverse insertion order and use multiple pages.
      const keys = [...records.keys()].filter(key => key.startsWith(prefix)).reverse();
      for (let i = 0; i < keys.length; i += 7) yield { blobs: keys.slice(i, i + 7).map(key => ({ key })) };
    },
    async get(key) { reads.push(key); return structuredClone(records.get(key) ?? null); },
    async setJSON(key, value, options = {}) {
      if (options.onlyIfNew && records.has(key)) return { modified: false };
      records.set(key, structuredClone(value));
      return { modified: true };
    },
    async delete(key) { records.delete(key); },
  };
}

function stores() { return { directory: memoryStore(), messages: memoryStore() }; }
function getRequest(query = '', headers = {}) { return new Request(`https://jwhitedidit.net/api/member-messages${query}`, { headers }); }
function sendRequest(input = {}, options = {}) {
  return new Request('https://jwhitedidit.net/api/member-messages/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://jwhitedidit.net', ...options.headers },
    body: options.body ?? JSON.stringify({ recipient_id: bob.id, subject: 'Hello Bob', body: 'A private message.', request_id: randomUUID(), ...input }),
  });
}
function unreadRequest(headers = {}) {
  return new Request('https://jwhitedidit.net/api/member-messages/unread', { headers });
}
function readRequest(message_id, options = {}) {
  return new Request('https://jwhitedidit.net/api/member-messages/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://jwhitedidit.net', ...options.headers },
    body: options.body ?? JSON.stringify({ message_id }),
  });
}
async function register(store, ...members) {
  for (const member of members) assert.equal((await getMemberMessages(getRequest(), store, auth(member))).status, 200);
}
const list = async (store, member, query = '') => (await getMemberMessages(getRequest(query), store, auth(member))).json();

test('Identity guard requires a confirmed full API user and strips account metadata', async () => {
  await assert.rejects(requireMember(async () => null), { status: 401 });
  await assert.rejects(requireMember(async () => ({ ...alice, emailVerified: true })), { status: 403 });
  await assert.rejects(requireMember(async () => ({ ...alice, confirmedAt: 'invalid' })), { status: 403 });
  await assert.rejects(requireMember(async () => ({ ...alice, id: '../../another-user', confirmedAt: '2026-09-05' })), { status: 401 });
  const member = await requireMember(async () => ({ ...alice, confirmedAt: '2026-09-05', email: 'private@example.test', roles: ['admin'] }));
  assert.deepEqual(member, alice);
  const namedByEmail = await requireMember(async () => ({ ...alice, confirmedAt: '2026-09-05', name: 'private@example.test' }));
  assert.equal(namedByEmail.name, 'Member aaaaaaaa');
});

test('the real Identity SDK refuses a forged cookie and its claims-only fallback cannot authorize an inbox', {
  skip: process.execArgv.some(value => value.includes('offline-platform-loader.mjs')) ? 'requires the real Identity SDK' : false,
}, async () => {
  const originalFetch = globalThis.fetch;
  const originalNetlify = globalThis.Netlify;
  const originalIdentity = globalThis.netlifyIdentityContext;
  let verificationCalls = 0;
  try {
    globalThis.Netlify = { context: {
      url: new URL('https://jwhitedidit.net/api/member-messages'),
      cookies: { get: name => name === 'nf_jwt' ? 'forged.jwt.value' : null },
    } };
    delete globalThis.netlifyIdentityContext;
    globalThis.fetch = async (url, options) => {
      verificationCalls++;
      assert.equal(String(url), 'https://jwhitedidit.net/.netlify/identity/user');
      assert.equal(options.headers.Authorization, 'Bearer forged.jwt.value');
      return new Response('{}', { status: 401 });
    };
    await assert.rejects(requireMember(), { status: 401 });
    assert.equal(verificationCalls, 1);
    globalThis.netlifyIdentityContext = {
      url: 'https://jwhitedidit.net/.netlify/identity', token: 'forged.jwt.value',
      user: { sub: alice.id, email: 'hidden@example.test', confirmed_at: '2026-09-05', user_metadata: { full_name: alice.name } },
    };
    await assert.rejects(requireMember(), { status: 403 });
    assert.equal(verificationCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalNetlify === undefined) delete globalThis.Netlify; else globalThis.Netlify = originalNetlify;
    if (originalIdentity === undefined) delete globalThis.netlifyIdentityContext; else globalThis.netlifyIdentityContext = originalIdentity;
  }
});

test('unauthenticated and unconfirmed users cannot read, send, or register a directory entry', async () => {
  const store = stores();
  for (const user of [null, alice]) {
    const rejected = () => requireMember(async () => user);
    const expected = user ? 403 : 401;
    assert.equal((await getMemberMessages(getRequest('?user_id=' + bob.id), store, rejected)).status, expected);
    assert.equal((await sendMemberMessage(sendRequest({ sender_id: bob.id }), store, rejected)).status, expected);
  }
  assert.equal(store.directory.records.size, 0);
  assert.equal(store.messages.records.size, 0);
});

test('successful send is visible only to its two authenticated participants', async () => {
  const store = stores();
  await register(store, alice, bob, chris);
  const response = await sendMemberMessage(sendRequest({ sender_id: chris.id, sender_name: 'Forged sender', email: 'secret@example.test', body: '  Hello\r\nBob  ' }), store, auth(alice));
  assert.equal(response.status, 201);
  const { message } = await response.json();
  assert.equal(message.sender_id, alice.id);
  assert.equal(message.sender_name, 'Alice');
  assert.equal(message.body, 'Hello\nBob');
  assert.deepEqual(Object.keys(message).sort(), ['body', 'created_at', 'id', 'recipient_id', 'recipient_name', 'sender_id', 'sender_name', 'subject']);
  const a = await list(store, alice);
  const b = await list(store, bob);
  const c = await list(store, chris, '?user_id=' + bob.id + '&prefix=inbox/' + bob.id);
  assert.deepEqual(a.sent, [message]);
  assert.deepEqual(a.inbox, []);
  assert.equal(a.unread_count, 0);
  assert.deepEqual(b.inbox, [message]);
  assert.equal(b.unread_count, 1);
  assert.deepEqual(b.unread_ids, [message.id]);
  assert.deepEqual(b.sent, []);
  assert.deepEqual(c.inbox, []);
  assert.equal(c.unread_count, 0);
  assert.deepEqual(c.sent, []);
  assert.ok(a.members.every(member => Object.keys(member).sort().join(',') === 'id,name' && member.id !== alice.id));
  assert.ok(!JSON.stringify([a, b, c, [...store.directory.records.values()]]).includes('example.test'));
  assert.ok(store.messages.prefixes.every(prefix => /^(?:inbox|sent|unread)\/[a-f0-9-]+\/$/.test(prefix)));
});

test('new mail has an exact recipient-only count and opening it clears the red notification once', async () => {
  const store = stores();
  await register(store, alice, bob, chris);
  const first = await (await sendMemberMessage(sendRequest({subject:'First new message'}), store, auth(alice))).json();
  const second = await (await sendMemberMessage(sendRequest({subject:'Second new message'}), store, auth(alice))).json();
  assert.equal((await (await getMemberUnreadMessages(unreadRequest(), store, auth(bob))).json()).unread_count, 2);
  assert.equal((await (await getMemberUnreadMessages(unreadRequest(), store, auth(alice))).json()).unread_count, 0);
  assert.equal((await (await getMemberUnreadMessages(unreadRequest(), store, auth(chris))).json()).unread_count, 0);

  const opened = await markMemberMessageRead(readRequest(first.message.id), store, auth(bob));
  assert.equal(opened.status, 200);
  assert.deepEqual(await opened.json(), {message_id:first.message.id,read:true,unread_count:1});
  const repeated = await markMemberMessageRead(readRequest(first.message.id), store, auth(bob));
  assert.equal(repeated.status, 200);
  assert.equal((await repeated.json()).unread_count, 1);
  const inbox = await list(store, bob);
  assert.equal(inbox.unread_count, 1);
  assert.deepEqual(inbox.unread_ids, [second.message.id]);
  assert.equal((await markMemberMessageRead(readRequest(second.message.id), store, auth(alice))).status, 404);
  assert.equal((await markMemberMessageRead(readRequest(second.message.id), store, auth(chris))).status, 404);
});

test('old delivered mail stays quiet and a send retry cannot recreate its unread marker', async () => {
  const store = stores();
  await register(store, alice, bob);
  const input = {request_id:randomUUID(),subject:'Existing conversation'};
  const sent = await (await sendMemberMessage(sendRequest(input), store, auth(alice))).json();
  await store.messages.delete(`unread/${bob.id}/${sent.message.id}`);
  assert.equal((await list(store, bob)).unread_count, 0);
  assert.equal((await sendMemberMessage(sendRequest(input), store, auth(alice))).status, 200);
  assert.equal((await list(store, bob)).unread_count, 0);
});

test('mark read validates the recipient, message ID, body format, origin and session', async () => {
  const store = stores();
  await register(store, alice, bob);
  const sent = await (await sendMemberMessage(sendRequest(), store, auth(alice))).json();
  assert.equal((await markMemberMessageRead(readRequest('not-a-message'), store, auth(bob))).status, 400);
  assert.equal((await markMemberMessageRead(readRequest(sent.message.id, {body:'{"message_id":"' + sent.message.id + '","extra":true}'}), store, auth(bob))).status, 400);
  assert.equal((await markMemberMessageRead(readRequest(sent.message.id, {headers:{Origin:'https://unrelated.example'}}), store, auth(bob))).status, 403);
  assert.equal((await markMemberMessageRead(readRequest(sent.message.id, {headers:{'Content-Type':'text/plain'}}), store, auth(bob))).status, 415);
  assert.equal((await markMemberMessageRead(readRequest(sent.message.id), store, () => requireMember(async () => null))).status, 401);
  assert.equal((await markMemberMessageRead(readRequest('f'.repeat(64)), store, auth(bob))).status, 404);
  assert.equal((await list(store, bob)).unread_count, 1);
});

test('even an incorrect private index cannot reveal a nonparticipant message', async () => {
  const store = stores();
  await register(store, alice, bob, chris);
  await sendMemberMessage(sendRequest(), store, auth(alice));
  const bobIndex = [...store.messages.records.keys()].find(key => key.startsWith('inbox/' + bob.id));
  await store.messages.setJSON(bobIndex.replace(bob.id, chris.id), { id: 'ignored' });
  assert.deepEqual((await list(store, chris)).inbox, []);
});

test('concurrent unique sends preserve all messages and retries return the original only once', async () => {
  const store = stores();
  await register(store, alice, bob);
  const responses = await Promise.all(Array.from({ length: 18 }, (_, i) => sendMemberMessage(sendRequest({ subject: 'Unique ' + i }), store, auth(alice))));
  assert.ok(responses.every(response => response.status === 201));
  assert.equal((await list(store, bob)).inbox.length, 18);
  const input = { request_id: randomUUID(), subject: 'Retry test', body: 'Same durable message.' };
  const retryResponses = await Promise.all(Array.from({ length: 12 }, () => sendMemberMessage(sendRequest(input), store, auth(alice))));
  const payloads = await Promise.all(retryResponses.map(response => response.json()));
  assert.equal(retryResponses.filter(response => response.status === 201).length, 1);
  assert.ok(payloads.every(payload => JSON.stringify(payload) === JSON.stringify(payloads[0])));
  assert.equal((await list(store, bob)).inbox.length, 19);
  assert.equal((await sendMemberMessage(sendRequest({ ...input, body: 'Cannot replace the original.' }), store, auth(alice))).status, 409);
  assert.equal((await list(store, bob)).inbox.length, 19);
});

test('same request ID from different users cannot collide with or overwrite another sender', async () => {
  const store = stores();
  await register(store, alice, bob, chris);
  const request_id = randomUUID();
  const first = await (await sendMemberMessage(sendRequest({ request_id }), store, auth(alice))).json();
  const second = await (await sendMemberMessage(sendRequest({ request_id }), store, auth(chris))).json();
  assert.notEqual(first.message.id, second.message.id);
  assert.equal((await list(store, bob)).inbox.length, 2);
});

test('a partial index failure returns no success and retry repairs both indexes without duplicate delivery', async () => {
  const store = stores();
  await register(store, alice, bob);
  const savedWrite = store.messages.setJSON.bind(store.messages);
  let failRecipientIndex = true;
  store.messages.setJSON = async (key, ...rest) => {
    if (failRecipientIndex && key.startsWith('inbox/')) throw new Error('private infrastructure details');
    return savedWrite(key, ...rest);
  };
  const input = { request_id: randomUUID() };
  const failed = await sendMemberMessage(sendRequest(input), store, auth(alice));
  assert.equal(failed.status, 503);
  assert.ok(!(await failed.text()).includes('infrastructure'));
  assert.equal([...store.messages.records.keys()].filter(key => key.startsWith('messages/')).length, 1);
  assert.equal((await list(store, alice)).sent.length, 0);
  assert.equal((await list(store, bob)).inbox.length, 0);
  failRecipientIndex = false;
  assert.equal((await sendMemberMessage(sendRequest(input), store, auth(alice))).status, 200);
  assert.equal((await list(store, bob)).inbox.length, 1);
  assert.equal((await list(store, alice)).sent.length, 1);
  assert.equal([...store.messages.records.keys()].filter(key => key.startsWith('messages/')).length, 1);
});

test('send acknowledgement waits for both durable indexes', async () => {
  const store = stores();
  await register(store, alice, bob);
  const write = store.messages.setJSON.bind(store.messages);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  store.messages.setJSON = async (key, ...rest) => {
    if (key.startsWith('inbox/')) await gate;
    return write(key, ...rest);
  };
  let completed = false;
  const pending = sendMemberMessage(sendRequest(), store, auth(alice)).then(response => { completed = true; return response; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(completed, false);
  release();
  assert.equal((await pending).status, 201);
});

test('pagination stays newest first across unordered storage pages without duplicate rows', async () => {
  const store = stores();
  await register(store, alice, bob);
  for (let i = 0; i < 13; i++) await sendMemberMessage(sendRequest({ subject: 'Page test ' + i }), store, auth(alice));
  const all = (await list(store, bob)).inbox;
  const page1 = await list(store, bob, '?limit=5');
  const page2 = await list(store, bob, '?limit=5&inbox_before=' + page1.next.inbox_before);
  const page3 = await list(store, bob, '?limit=5&inbox_before=' + page2.next.inbox_before);
  assert.deepEqual([...page1.inbox, ...page2.inbox, ...page3.inbox], all);
  assert.equal(page3.next.inbox_before, null);
  assert.equal(page1.unread_count, 13);
  assert.equal(page2.unread_count, 13);
  assert.equal(page3.unread_count, 13);
  assert.equal(page1.unread_ids.length, 5);
  assert.equal(page2.unread_ids.length, 5);
  assert.equal(page3.unread_ids.length, 3);
  assert.ok(all.every((message, i) => i === 0 || all[i - 1].created_at >= message.created_at));
  assert.equal((await getMemberMessages(getRequest('?inbox_before=../../other'), store, auth(bob))).status, 400);
  assert.equal((await getMemberMessages(getRequest('?limit=101'), store, auth(bob))).status, 400);
});

test('invalid, cross-site, unknown and self recipients cannot write messages', async () => {
  const store = stores();
  await register(store, alice, bob);
  const cases = [
    [sendRequest({ recipient_id: '../' + bob.id }), 400],
    [sendRequest({ recipient_id: chris.id }), 404],
    [sendRequest({ recipient_id: alice.id }), 400],
    [sendRequest({ subject: 'x'.repeat(101) }), 400],
    [sendRequest({ subject: ' ' }), 400],
    [sendRequest({ body: 'x'.repeat(3001) }), 400],
    [sendRequest({ body: '\u0000secret' }), 400],
    [sendRequest({ request_id: '../../overwrite' }), 400],
    [sendRequest({}, { headers: { Origin: 'https://unrelated.example' } }), 403],
    [sendRequest({}, { headers: { 'Sec-Fetch-Site': 'cross-site' } }), 403],
    [sendRequest({}, { headers: { 'Content-Type': 'text/plain' } }), 415],
    [sendRequest({}, { body: '{invalid' }), 400],
    [sendRequest({}, { body: ' '.repeat(20001) }), 413],
  ];
  for (const [request, status] of cases) assert.equal((await sendMemberMessage(request, store, auth(alice))).status, status);
  const missingOrigin = sendRequest();
  missingOrigin.headers.delete('Origin');
  assert.equal((await sendMemberMessage(missingOrigin, store, auth(alice))).status, 403);
  assert.equal(store.messages.records.size, 0);
});

test('private responses cannot be cached and deployed limits separate reads from writes', async () => {
  const store = stores();
  const response = await getMemberMessages(getRequest(), store, auth(alice));
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('netlify-cdn-cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal(getConfig.path, '/api/member-messages');
  assert.equal(sendConfig.path, '/api/member-messages/send');
  assert.equal(unreadConfig.path, '/api/member-messages/unread');
  assert.equal(readConfig.path, '/api/member-messages/read');
  assert.equal(getConfig.rateLimit.windowLimit, 60);
  assert.equal(sendConfig.rateLimit.windowLimit, 60);
  assert.equal(unreadConfig.rateLimit.windowLimit, 120);
  assert.equal(readConfig.rateLimit.windowLimit, 60);
  assert.equal(sendConfig.rateLimit.windowSize, 60);
});
