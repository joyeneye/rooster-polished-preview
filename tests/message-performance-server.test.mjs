import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { getMemberMessages, sendMemberMessage } from '../netlify/functions/_shared/member-messages.mts';
import { MemberError } from '../netlify/functions/_shared/member-auth.mts';

const alice = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Alice' };
const bob = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Bob' };
const origin = 'https://jwhitedidit.net';
const turn = () => new Promise(resolve => setImmediate(resolve));
const auth = member => async () => member;
const getRequest = (query = '') => new Request(origin + '/api/member-messages' + query);
const sendRequest = (input = {}) => new Request(origin + '/api/member-messages/send', {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
  body: JSON.stringify({ recipient_id: bob.id, request_id: randomUUID(), subject: 'Hello', body: 'Private hello.', ...input }),
});

function store(name, schedule = async (_name, work) => work()) {
  const records = new Map(), reads = [], lists = [];
  return {
    records, reads, lists,
    async *list({ prefix }) {
      lists.push(prefix);
      yield await schedule(name + ':list:' + prefix, () => ({ blobs: [...records.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })) }));
    },
    async get(key) {
      reads.push(key);
      return schedule(name + ':get:' + key, () => structuredClone(records.get(key) ?? null));
    },
    async setJSON(key, value, options = {}) {
      return schedule(name + ':set:' + key, () => {
        if (options.onlyIfNew && records.has(key)) return { modified: false };
        records.set(key, structuredClone(value)); return { modified: true };
      });
    },
  };
}

function stores(schedule) {
  const result = { directory: store('directory', schedule), messages: store('messages', schedule) };
  for (const member of [alice, bob]) result.directory.records.set('members/' + member.id, member);
  return result;
}

// Every queued storage operation has one equal, manually released network
// round trip. Count dependent waves without relying on machine timing.
async function measuredSend({ missingSender = false } = {}) {
  const waiting = [], waves = [];
  const storage = stores((name, work) => new Promise((resolve, reject) => waiting.push({ name, work, resolve, reject })));
  if (missingSender) storage.directory.records.delete('members/' + alice.id);
  let complete = false;
  const sending = sendMemberMessage(sendRequest(), storage, auth(alice)).finally(() => { complete = true; });
  for (let safety = 0; !complete && safety < 30; safety++) {
    await turn();
    if (!waiting.length) continue;
    const batch = waiting.splice(0);
    waves.push(batch.map(item => item.name));
    for (const item of batch) {
      try { item.resolve(item.work()); } catch (error) { item.reject(error); }
    }
  }
  assert.equal(complete, true, 'storage operation must settle without deadlocking');
  return { response: await sending, waves };
}

test('text sending uses six storage round trips while acknowledging only verified delivery', async t => {
  const { response, waves } = await measuredSend();
  assert.equal(response.status, 201);
  t.diagnostic(`dependent storage round trips: ${waves.length}`);
  assert.equal(waves.length, 6);
  assert.equal(waves[0].filter(name => name.startsWith('directory:get:')).length, 2);
  const preparation = waves.find(wave => wave.some(name => name.startsWith('messages:set:inbox/')));
  assert.equal(preparation.filter(name => /^messages:set:(sent|inbox|unread)\//.test(name)).length, 3);
  assert.ok(waves.at(-1).every(name => name.startsWith('messages:get:')));
});

test('a new sender directory entry adds only its required write and is present on success', async () => {
  const { response, waves } = await measuredSend({ missingSender: true });
  assert.equal(response.status, 201);
  assert.equal(waves.length, 7);
  assert.deepEqual(waves[1], ['directory:set:members/' + alice.id]);
});

test('parallel index preparation cannot commit or acknowledge until the unread marker is durable', async () => {
  let release, reached;
  const held = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { reached = resolve; });
  const storage = stores(async (name, work) => {
    if (name.startsWith('messages:set:unread/')) { reached(); await held; }
    return work();
  });
  let complete = false;
  const pending = sendMemberMessage(sendRequest(), storage, auth(alice)).then(value => { complete = true; return value; });
  await started; await turn();
  assert.equal(complete, false);
  assert.equal([...storage.messages.records.keys()].filter(key => key.startsWith('sent/') || key.startsWith('inbox/')).length, 2);
  assert.ok(![...storage.messages.records.keys()].some(key => key.startsWith('delivered/')));
  release();
  assert.equal((await pending).status, 201);
});

test('failed unread preparation stays invisible and retry repairs it without duplicating the message', async () => {
  let failing = true;
  const storage = stores(async (name, work) => {
    if (failing && name.startsWith('messages:set:unread/')) throw new Error('storage unavailable');
    return work();
  });
  const input = { request_id: randomUUID() };
  assert.equal((await sendMemberMessage(sendRequest(input), storage, auth(alice))).status, 503);
  assert.ok(![...storage.messages.records.keys()].some(key => key.startsWith('delivered/')));
  const hidden = await (await getMemberMessages(getRequest('?directory=0'), storage, auth(bob))).json();
  assert.deepEqual(hidden.inbox, []); assert.equal(hidden.unread_count, 0);
  failing = false;
  assert.equal((await sendMemberMessage(sendRequest(input), storage, auth(alice))).status, 200);
  const visible = await (await getMemberMessages(getRequest('?directory=0'), storage, auth(bob))).json();
  assert.equal(visible.inbox.length, 1); assert.equal(visible.unread_count, 1);
  assert.equal([...storage.messages.records.keys()].filter(key => key.startsWith('messages/')).length, 1);
});

test('the compact conversation response skips the directory and shares message reads with its unread count', async () => {
  const storage = stores();
  const { message } = await (await sendMemberMessage(sendRequest(), storage, auth(alice))).json();
  storage.messages.reads.length = 0; storage.directory.reads.length = 0; storage.directory.lists.length = 0;
  const result = await (await getMemberMessages(getRequest('?directory=0'), storage, auth(bob))).json();
  assert.deepEqual(result.inbox, [message]); assert.deepEqual(result.members, []);
  assert.equal(result.next.members_after, null); assert.equal(result.unread_count, 1);
  assert.deepEqual(result.unread_ids, [message.id]);
  assert.deepEqual(storage.directory.lists, []);
  assert.deepEqual(storage.directory.reads, ['members/' + bob.id]);
  assert.equal(storage.messages.reads.filter(key => key === 'messages/' + message.id).length, 1);
  assert.equal(storage.messages.reads.filter(key => key === 'delivered/' + message.id).length, 1);
  // A later request must read current private storage again, never a shared cache.
  await getMemberMessages(getRequest('?directory=0'), storage, auth(bob));
  assert.equal(storage.messages.reads.filter(key => key === 'messages/' + message.id).length, 2);
  const full = await (await getMemberMessages(getRequest(), storage, auth(bob))).json();
  assert.deepEqual(full.members, [alice]);
});

test('compact reads preserve exact system welcome retirement and the normal quoted conversation', async () => {
  const storage = stores();
  const id = createHash('sha256').update('jwhite:member-welcome:v1:' + bob.id).digest('hex');
  const old = { id, sender_id: alice.id, recipient_id: bob.id, sender_name: alice.name, recipient_name: bob.name,
    subject: 'You’re connected. Let’s get it.', body: 'Welcome to KON-NEKT.', created_at: '2026-09-07T18:09:00.000Z', request_id: 'member-welcome:v1' };
  const suffix = `${String(9999999999999 - Date.parse(old.created_at)).padStart(13, '0')}-${id}`;
  storage.messages.records.set('messages/' + id, old);
  storage.messages.records.set('delivered/' + id, { id });
  storage.messages.records.set('inbox/' + bob.id + '/' + suffix, { id });
  storage.messages.records.set('unread/' + bob.id + '/' + id, { id, recipient_id: bob.id, created_at: old.created_at });
  const { message: real } = await (await sendMemberMessage(sendRequest({ subject: old.subject, body: old.body }), storage, auth(alice))).json();
  const result = await (await getMemberMessages(getRequest('?directory=0'), storage, auth(bob))).json();
  assert.deepEqual(result.inbox, [real]); assert.deepEqual(result.retired_message_ids, [id]);
  assert.equal(result.unread_count, 1); assert.deepEqual(result.unread_ids, [real.id]);
});

test('compact mode still validates options and authorizes before all storage work', async () => {
  const storage = stores();
  for (const query of ['?directory=no', '?directory=0&directory=1', '?directory=0&members_after=../../another']) {
    assert.equal((await getMemberMessages(getRequest(query), storage, auth(alice))).status, 400);
  }
  const denied = async () => { throw new MemberError(403, 'Verify your account.'); };
  assert.equal((await getMemberMessages(getRequest('?directory=0'), storage, denied)).status, 403);
  assert.equal((await sendMemberMessage(sendRequest(), storage, denied)).status, 403);
  assert.deepEqual(storage.directory.reads, []); assert.deepEqual(storage.directory.lists, []);
  assert.deepEqual(storage.messages.reads, []); assert.deepEqual(storage.messages.lists, []);
});
