import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  ROOM_HEARTBEAT_SECONDS, ROOM_TTL_MS, cleanupRoomPresence, getRoomPresence,
  postRoomPresence, readRoomPresence,
} from '../netlify/functions/_shared/chat-room-presence.mts';
import { CHAT_ROOM } from '../netlify/functions/_shared/member-chat.mts';
import { config as postConfig } from '../netlify/functions/chat-presence-post.mts';
import { config as getConfig } from '../netlify/functions/chat-presence-get.mts';
import { config as cleanupConfig } from '../netlify/functions/chat-presence-cleanup.mts';

const owner = { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', name: 'J.White Did It', isOwner: true };
const alice = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Alice', isOwner: false };
const bob = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Bob', isOwner: false };
const NOW = Date.parse('2026-09-07T18:00:00Z');

function memoryStore() {
  const records = new Map();
  return {
    records,
    async *list({ prefix }) {
      const keys = [...records.keys()].filter(key => key.startsWith(prefix));
      for (let i = 0; i < keys.length; i += 5) yield { blobs: keys.slice(i, i + 5).map(key => ({ key })) };
    },
    async get(key) { return structuredClone(records.get(key) ?? null); },
    async setJSON(key, value, options = {}) {
      if (options.onlyIfNew && records.has(key)) return { modified: false };
      records.set(key, structuredClone(value));
      return { modified: true };
    },
    async delete(key) { records.delete(key); },
  };
}
const profiles = (binding = null) => {
  const store = memoryStore();
  if (binding) store.records.set('owner-binding', { id: binding });
  return store;
};
const as = who => async () => ({ ...who });
const enter = (sessionId, state = 'inside', origin = 'https://jwhitedidit.net') =>
  new Request('https://jwhitedidit.net/api/chat-room-presence', {
    method: 'POST', headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ session_id: sessionId, state }),
  });

async function step(store, people, profileStore, now = NOW) {
  for (const [who, sessionId, state] of people) {
    const response = await postRoomPresence(enter(sessionId, state), store, profileStore, as(who), now);
    assert.equal(response.status, 200, `${who.name} ${state} should be accepted`);
  }
  return readRoomPresence(store, profileStore, now);
}

test('the presence routes are wired to their own path, method and sweep schedule', () => {
  assert.equal(postConfig.path, '/api/chat-room-presence');
  assert.equal(postConfig.method, 'POST');
  assert.equal(getConfig.path, '/api/chat-room-presence');
  assert.equal(getConfig.method, 'GET');
  assert.equal(cleanupConfig.schedule, '*/10 * * * *');
});

test('an empty room reports nobody inside and no glow', async () => {
  const status = await readRoomPresence(memoryStore(), profiles(owner.id), NOW);
  assert.equal(status.inside, 0);
  assert.equal(status.owner_inside, false);
  assert.equal(status.owner_identified, true);
  assert.equal(status.room, CHAT_ROOM);
  assert.equal(status.heartbeat_seconds, ROOM_HEARTBEAT_SECONDS);
});

test('the full room lifecycle: member enters, owner enters, owner leaves, everyone leaves', async () => {
  const store = memoryStore(), bound = profiles(owner.id);
  const aliceSession = randomUUID(), bobSession = randomUUID(), ownerSession = randomUUID();

  let status = await step(store, [[alice, aliceSession]], bound);
  assert.deepEqual([status.inside, status.owner_inside], [1, false], 'one member inside is green');

  status = await step(store, [[bob, bobSession]], bound);
  assert.deepEqual([status.inside, status.owner_inside], [2, false]);

  status = await step(store, [[owner, ownerSession]], bound);
  assert.deepEqual([status.inside, status.owner_inside], [3, true], 'the owner inside is gold');

  status = await step(store, [[owner, ownerSession, 'left']], bound);
  assert.deepEqual([status.inside, status.owner_inside], [2, false], 'back to green while others remain');

  status = await step(store, [[alice, aliceSession, 'left'], [bob, bobSession, 'left']], bound);
  assert.deepEqual([status.inside, status.owner_inside], [0, false], 'an emptied room stops glowing');
  assert.equal(store.records.size, 0, 'no seat is left behind');
});

test('a member with several tabs open counts once', async () => {
  const store = memoryStore(), bound = profiles(owner.id);
  const status = await step(store, [[alice, randomUUID()], [alice, randomUUID()], [alice, randomUUID()]], bound);
  assert.equal(status.inside, 1);
  assert.equal(store.records.size, 3, 'each tab still keeps its own seat');
});

test('a stale seat from a closed page or dropped connection stops counting and is swept', async () => {
  const store = memoryStore(), bound = profiles(owner.id);
  await step(store, [[alice, randomUUID()], [owner, randomUUID()]], bound, NOW - ROOM_TTL_MS - 1_000);
  const status = await readRoomPresence(store, bound, NOW);
  assert.deepEqual([status.inside, status.owner_inside], [0, false], 'expired seats never glow');
  assert.equal(await cleanupRoomPresence(store, NOW), 2);
  assert.equal(store.records.size, 0);
});

test('a heartbeat inside the window keeps a seat alive', async () => {
  const store = memoryStore(), bound = profiles(owner.id);
  const session = randomUUID();
  await step(store, [[alice, session]], bound, NOW - 40_000);
  await step(store, [[alice, session]], bound, NOW - 5_000);
  assert.equal((await readRoomPresence(store, bound, NOW)).inside, 1);
});

test('no other account can trigger gold, whatever it calls itself', async () => {
  const store = memoryStore(), bound = profiles(owner.id);
  const impostors = [
    { ...alice, name: 'J.White Did It' },
    { ...bob, name: 'J.White Did It', isOwner: true },
    { ...alice, id: owner.id.toUpperCase(), isOwner: false },
  ];
  for (const who of impostors) {
    const response = await postRoomPresence(enter(randomUUID()), store, bound, as(who), NOW);
    if (response.ok) {
      const status = await readRoomPresence(store, bound, NOW);
      assert.equal(status.owner_inside, false, `${who.name} (${who.id}) must not turn the tab gold`);
    } else {
      assert.equal(response.status, 403);
    }
  }
  assert.equal((await readRoomPresence(store, bound, NOW)).owner_inside, false);
});

test('gold is withheld rather than guessed when no owner account is bound yet', async () => {
  const store = memoryStore(), unbound = profiles();
  const status = await step(store, [[alice, randomUUID()]], unbound);
  assert.equal(status.inside, 1);
  assert.equal(status.owner_inside, false);
  assert.equal(status.owner_identified, false, 'the page is told the owner is unknown instead of being shown gold');
});

test('the owner account binds itself on first entry and is then gold', async () => {
  const store = memoryStore(), unbound = profiles();
  const status = await step(store, [[owner, randomUUID()]], unbound);
  assert.deepEqual([status.inside, status.owner_inside, status.owner_identified], [1, true, true]);
  assert.equal((await unbound.get('owner-binding')).id, owner.id);
});

test('presence is only ever written by an explicit room post', async () => {
  const store = memoryStore(), bound = profiles(owner.id);
  const rejected = [
    ['a cross-origin post', enter(randomUUID(), 'inside', 'https://not-roster.example'), 403],
    ['a browsing signal instead of a room state', enter(randomUUID(), 'browsing'), 400],
    ['a missing session id', enter('not-a-uuid'), 400],
    ['a GET to the write path', new Request('https://jwhitedidit.net/api/chat-room-presence'), 405],
  ];
  for (const [label, request, status] of rejected) {
    assert.equal((await postRoomPresence(request, store, bound, as(alice), NOW)).status, status, label);
  }
  assert.equal(store.records.size, 0);
  assert.equal((await readRoomPresence(store, bound, NOW)).inside, 0, 'being signed in is not being in the room');
});

test('the public status is a count and two flags, with no member details', async () => {
  const store = memoryStore(), bound = profiles(owner.id);
  await step(store, [[alice, randomUUID()], [owner, randomUUID()]], bound);
  const response = await getRoomPresence(new Request('https://jwhitedidit.net/api/chat-room-presence'), store, bound, NOW);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control')?.includes('no-store'), true);
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ['expires_in_seconds', 'heartbeat_seconds', 'inside', 'measured_at', 'owner_identified', 'owner_inside', 'room']);
  const serialised = JSON.stringify(body);
  for (const secret of [alice.id, owner.id, alice.name, 'example.test']) {
    assert.equal(serialised.includes(secret), false, `${secret} must not appear in the public status`);
  }
  assert.equal((await getRoomPresence(new Request('https://jwhitedidit.net/api/chat-room-presence', { method: 'PUT' }), store, bound, NOW)).status, 405);
});
