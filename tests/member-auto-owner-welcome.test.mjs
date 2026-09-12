import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  addFriend,
  ensureAutomaticOwnerFriend,
  getFriendCount,
  getFriendRequests,
  respondToFriendRequest,
} from '../netlify/functions/_shared/friends.mts';
import {
  deleteMemberWallComment,
  deliverOwnerWallWelcome,
  getMemberWall,
} from '../netlify/functions/_shared/member-wall.mts';
import { getMemberMessages } from '../netlify/functions/_shared/member-messages.mts';
import { welcomeVerifiedMember } from '../netlify/functions/_shared/member-welcome.mts';

const origin = 'https://jwhitedidit.net';
const owner = { id: '11111111-1111-4111-8111-111111111111', name: 'JWhite', isOwner: true };
const member = { id: '22222222-2222-4222-8222-222222222222', name: 'New Member', isOwner: false };
const other = { id: '33333333-3333-4333-8333-333333333333', name: 'Other Member', isOwner: false };
const AUTOMATIC_KEY = `automatic-owner-v1/${owner.id}/${member.id}`;
const WALL_PREFIX = `walls/${member.id}/`;

function memory() {
  const records = new Map();
  const faults = [];
  return {
    records,
    failNext(prefix, mode = 'throw') { faults.push({ prefix, mode }); },
    async get(key) { return structuredClone(records.get(key) ?? null); },
    async getWithMetadata(key) {
      return records.has(key) ? { data: structuredClone(records.get(key)), etag: key } : null;
    },
    async setJSON(key, value, options = {}) {
      const faultIndex = faults.findIndex(fault => key.startsWith(fault.prefix));
      if (faultIndex >= 0) {
        const [{ mode }] = faults.splice(faultIndex, 1);
        if (mode === 'drop') return { modified: true };
        throw new Error('simulated storage failure');
      }
      if (options.onlyIfNew && records.has(key)) return { modified: false };
      records.set(key, structuredClone(value));
      return { modified: true };
    },
    async set(key, value, options = {}) { return this.setJSON(key, value, options); },
    async delete(key) { records.delete(key); },
    async *list({ prefix }) {
      const keys = [...records.keys()].filter(key => key.startsWith(prefix));
      for (let offset = 0; offset < keys.length; offset += 4) {
        yield { blobs: keys.slice(offset, offset + 4).map(key => ({ key })) };
      }
    },
  };
}

function setup(binding = owner.id) {
  const profiles = memory();
  const directory = memory();
  const messages = memory();
  const friends = memory();
  const walls = memory();
  if (binding !== null) profiles.records.set('owner-binding', { id: binding });
  for (const person of [owner, member, other]) {
    const publicPerson = { id: person.id, name: person.name };
    profiles.records.set(`public-members/${person.id}`, publicPerson);
    directory.records.set(`members/${person.id}`, publicPerson);
  }
  return { profiles, directory, messages, friends, walls, stores: { directory, messages, friends, walls } };
}

function jsonPost(path, body) {
  return new Request(origin + path, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function friendPage(state, target = member.id) {
  const response = await getFriendCount(
    new Request(`${origin}/api/friends?target_id=${encodeURIComponent(target)}`),
    state.friends,
    state.profiles,
    state.directory,
  );
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}

async function requestPage(state, viewer, target = null) {
  const suffix = target === null ? '' : `?target_id=${encodeURIComponent(target)}`;
  const response = await getFriendRequests(
    new Request(`${origin}/api/friend-requests${suffix}`),
    state.friends,
    async () => viewer,
    state.profiles,
  );
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}

async function wallPage(state, viewer = member) {
  const response = await getMemberWall(
    new Request(`${origin}/api/member-wall?member=${member.id}`),
    state.walls,
    {
      profiles: state.profiles,
      directory: state.directory,
      friends: state.friends,
      resolveMember: async () => viewer,
    },
  );
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}

async function messagePage(state, viewer = member) {
  const response = await getMemberMessages(
    new Request(`${origin}/api/member-messages`),
    state.stores,
    async () => viewer,
  );
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}

function artifactCounts(state) {
  return {
    friend: Number(state.friends.records.has(AUTOMATIC_KEY)),
    wall: [...state.walls.records.keys()].filter(key => key.startsWith(WALL_PREFIX)).length,
    message: [...state.messages.records.keys()].filter(key => key.startsWith('messages/')).length,
  };
}

test('concurrent verified provisioning creates one automatic JWhite friend and one exact owner wall welcome', async () => {
  const state = setup();
  await Promise.all(Array.from({ length: 24 }, () => welcomeVerifiedMember(member, state.profiles, state.stores)));

  assert.deepEqual(artifactCounts(state), { friend: 1, wall: 1, message: 0 });
  const ownFriends = await friendPage(state);
  assert.equal(ownFriends.count, 1);
  assert.deepEqual(ownFriends.friends.map(friend => friend.member_id), ['owner']);
  assert.equal(ownFriends.friends[0].member_name, 'JWhite');
  assert.equal(ownFriends.friends[0].profile_url, '/#home');

  const ownerFriends = await friendPage(state, 'owner');
  assert.equal(ownerFriends.count, 1);
  assert.deepEqual(ownerFriends.friends.map(friend => friend.member_id), [member.id]);

  const requests = await requestPage(state, member, 'owner');
  assert.deepEqual(requests.incoming, []);
  assert.deepEqual(requests.outgoing, []);
  assert.equal(requests.pending_count, 0);
  assert.equal(requests.relationship.state, 'accepted');

  const wall = await wallPage(state);
  assert.equal(wall.total, 1);
  assert.equal(wall.comments.length, 1);
  assert.equal(wall.comments[0].message, 'You’re connected. Let’s get it.');
  assert.equal(wall.comments[0].author_id, owner.id);
  assert.equal(wall.comments[0].name, 'J.White Did It');
  assert.equal(wall.comments[0].verified_owner, true);
  assert.equal(wall.comments[0].profile_url, '/#home');
  assert.equal(wall.comments[0].status, 'approved');

  const inbox = await messagePage(state);
  assert.deepEqual(inbox.inbox, []);
  assert.equal(inbox.unread_count, 0);

  await Promise.all(Array.from({ length: 8 }, () => welcomeVerifiedMember(member, state.profiles, state.stores)));
  assert.deepEqual(artifactCounts(state), { friend: 1, wall: 1, message: 0 });

  const add = await addFriend(
    new Request(`${origin}/api/friends/add?target_id=owner`, { method: 'POST', headers: { Origin: origin } }),
    state.friends,
    async () => member,
    state.profiles,
    state.directory,
  );
  assert.equal(add.status, 200);
  const addData = await add.json();
  assert.equal(addData.state, 'accepted');
  assert.equal(addData.request_created, false);
  assert.equal([...state.friends.records.keys()].filter(key => key.startsWith('requests/')).length, 0);
});

test('partial or falsely reported writes retry independently without duplicating completed welcome work', async () => {
  const scenarios = [
    { store: 'friends', prefix: 'automatic-owner-v1/', mode: 'throw', missing: 'friend' },
    { store: 'friends', prefix: 'automatic-owner-v1/', mode: 'drop', missing: 'friend' },
    { store: 'walls', prefix: WALL_PREFIX, mode: 'throw', missing: 'wall' },
    { store: 'walls', prefix: WALL_PREFIX, mode: 'drop', missing: 'wall' },
  ];
  for (const scenario of scenarios) {
    const state = setup();
    state[scenario.store].failNext(scenario.prefix, scenario.mode);
    await welcomeVerifiedMember(member, state.profiles, state.stores);
    const first = artifactCounts(state);
    assert.equal(first[scenario.missing], 0, `${scenario.store} ${scenario.mode} must not be reported as saved`);
    for (const kind of ['friend', 'wall']) {
      if (kind !== scenario.missing) assert.equal(first[kind], 1, `${kind} should not be blocked by ${scenario.store}`);
    }

    await welcomeVerifiedMember(member, state.profiles, state.stores);
    assert.deepEqual(artifactCounts(state), { friend: 1, wall: 1, message: 0 });
    assert.equal((await friendPage(state)).count, 1);
    assert.equal((await wallPage(state)).comments.filter(comment => comment.message === 'You’re connected. Let’s get it.').length, 1);
    assert.equal((await messagePage(state)).inbox.length, 0);
    assert.equal(state.messages.records.size, 0);
  }
});

test('private-message storage is untouched while automatic friendship and wall welcome are provisioned', async () => {
  const state = setup();
  state.messages.setJSON = async () => { throw new Error('Private messages are unavailable'); };
  assert.equal((await welcomeVerifiedMember(member, state.profiles, state.stores)).status, 'sent');
  assert.equal((await welcomeVerifiedMember(member, state.profiles, state.stores)).status, 'already_sent');
  assert.deepEqual(artifactCounts(state), { friend: 1, wall: 1, message: 0 });
  assert.deepEqual((await messagePage(state)).inbox, []);
  assert.deepEqual((await messagePage(state, owner)).sent, []);
  assert.equal(state.messages.records.size, 0);
});

test('corrupted automatic records are rejected instead of becoming a false zero or being overwritten', async () => {
  const state = setup();
  state.friends.records.set(AUTOMATIC_KEY, {
    version: 'automatic-owner-v1', owner_id: owner.id, member_id: member.id,
    member_name: member.name, created_at: new Date().toISOString(),
  });
  await assert.rejects(ensureAutomaticOwnerFriend(member, owner, state.friends), /Invalid automatic friend record/);
  const response = await getFriendCount(
    new Request(`${origin}/api/friends?target_id=${member.id}`), state.friends, state.profiles, state.directory,
  );
  assert.equal(response.status, 503);
  assert.equal(state.friends.records.get(AUTOMATIC_KEY).kind, undefined);
});

test('a corrupted deterministic wall welcome is rejected and never replaced', async () => {
  const state = setup();
  const id = createHash('sha256').update(`jspace:owner-wall-welcome:v1:${member.id}`).digest('hex');
  const key = `${WALL_PREFIX}${id}`;
  state.walls.records.set(key, {
    id: 'f'.repeat(64), member_id: member.id, author_id: owner.id, author_name: 'J.White Did It',
    author_is_owner: true, message: 'You’re connected. Let’s get it.', created_at: new Date().toISOString(),
    input_digest: createHash('sha256').update('You’re connected. Let’s get it.').digest('hex'), welcome_version: 'owner-wall-welcome-v1',
    moderation: { status: 'approved', policy_version: 'positive-wall-v1', checked_at: new Date().toISOString() },
  });
  await assert.rejects(deliverOwnerWallWelcome(member, owner, state.walls), /Invalid saved wall welcome/);
  assert.equal(state.walls.records.get(key).id, 'f'.repeat(64));
});

test('a wall welcome saved before the Connector wording is still valid and is not reposted', async () => {
  const state = setup();
  const id = createHash('sha256').update(`jspace:owner-wall-welcome:v1:${member.id}`).digest('hex');
  const key = `${WALL_PREFIX}${id}`;
  const legacy = 'LET’S WORK!';
  const createdAt = new Date().toISOString();
  state.walls.records.set(key, {
    id, member_id: member.id, author_id: owner.id, author_name: 'J.White Did It',
    author_is_owner: true, message: legacy, created_at: createdAt,
    input_digest: createHash('sha256').update(legacy).digest('hex'), welcome_version: 'owner-wall-welcome-v1',
    moderation: { status: 'approved', reason: 'owner_welcome', policy_version: 'positive-wall-v1', checked_at: createdAt },
  });
  assert.deepEqual(await deliverOwnerWallWelcome(member, owner, state.walls), { status: 'already_sent', comment_id: id });
  assert.equal(state.walls.records.get(key).message, legacy);
  assert.equal([...state.walls.records.keys()].filter(entry => entry.startsWith(WALL_PREFIX)).length, 1);
});

test('deleting the automatic wall welcome leaves a tombstone and provisioning never resurrects it', async () => {
  const state = setup();
  await welcomeVerifiedMember(member, state.profiles, state.stores);
  const original = await wallPage(state);
  const commentId = original.comments[0].id;
  const response = await deleteMemberWallComment(
    jsonPost(`/api/member-wall/delete?member=${member.id}`, { comment_id: commentId }),
    state.walls,
    {
      profiles: state.profiles,
      directory: state.directory,
      friends: state.friends,
      resolveMember: async () => member,
    },
  );
  assert.equal(response.status, 200, await response.clone().text());
  assert(state.walls.records.has(`removed/${member.id}/${commentId}`));

  await Promise.allSettled(Array.from({ length: 12 }, () => deliverOwnerWallWelcome(member, owner, state.walls)));
  await welcomeVerifiedMember(member, state.profiles, state.stores);
  const after = await wallPage(state);
  assert.equal(after.total, 0);
  assert.deepEqual(after.comments, []);
  assert.equal([...state.walls.records.keys()].filter(key => key.startsWith(WALL_PREFIX)).length, 0);
  assert.equal([...state.walls.records.keys()].filter(key => key.startsWith(`removed/${member.id}/`)).length, 1);
});

test('protected owner binding prevents self friendship, missing-owner writes and display-name spoofing', async () => {
  for (const binding of [null, 'not-a-member-id']) {
    const state = setup(binding);
    await welcomeVerifiedMember(member, state.profiles, state.stores);
    assert.deepEqual(artifactCounts(state), { friend: 0, wall: 0, message: 0 });
  }

  const self = setup();
  await welcomeVerifiedMember(owner, self.profiles, self.stores);
  assert.equal([...self.friends.records.keys()].filter(key => key.startsWith('automatic-owner-v1/')).length, 0);
  assert.equal([...self.walls.records.keys()].filter(key => key.startsWith('walls/')).length, 0);
  assert.equal([...self.messages.records.keys()].filter(key => key.startsWith('messages/')).length, 0);

  const spoof = setup();
  await welcomeVerifiedMember({ ...member, name: 'JWhite' }, spoof.profiles, spoof.stores);
  const wall = await wallPage(spoof);
  assert.equal(wall.comments[0].message, 'You’re connected. Let’s get it.');
  assert.equal(wall.comments[0].author_id, owner.id);
  assert.equal(wall.comments[0].name, 'J.White Did It');
  assert.equal(wall.comments[0].verified_owner, true);
  const inbox = await messagePage(spoof);
  assert.deepEqual(inbox.inbox, []);
  assert.equal(spoof.directory.records.get(`members/${owner.id}`).id, owner.id);
});

test('automatic owner edge supersedes legacy aliases and old owner-pair decisions without double counting', async () => {
  const state = setup();
  const createdAt = '2026-09-05T12:00:00.000Z';
  const legacy = { member_id: member.id, member_name: member.name, created_at: createdAt };
  state.friends.records.set(`target/owner/${member.id}`, legacy);
  state.friends.records.set(`target/${owner.id}/${member.id}`, legacy);

  const pair = [member.id, 'owner'].sort().join('/');
  const requestId = createHash('sha256').update(`friend-consent-v1:${pair}`).digest('hex');
  state.friends.records.set(`requests/${pair}`, {
    id: requestId,
    sender_id: member.id,
    recipient_id: 'owner',
    sender_name: member.name,
    recipient_name: 'JWhite',
    created_at: createdAt,
  });
  state.friends.records.set(`decisions/${requestId}`, {
    request_id: requestId,
    recipient_id: 'owner',
    action: 'declined',
    decided_at: createdAt,
  });

  await Promise.all(Array.from({ length: 16 }, () => ensureAutomaticOwnerFriend(member, owner, state.friends)));
  assert.equal(state.friends.records.has(AUTOMATIC_KEY), true);
  assert.equal([...state.friends.records.keys()].filter(key => key.startsWith('automatic-owner-v1/')).length, 1);
  const memberFriends = await friendPage(state);
  const ownerFriends = await friendPage(state, 'owner');
  assert.equal(memberFriends.count, 1);
  assert.deepEqual(memberFriends.friends.map(friend => friend.member_id), ['owner']);
  assert.equal(ownerFriends.count, 1);
  assert.deepEqual(ownerFriends.friends.map(friend => friend.member_id), [member.id]);

  const memberRequests = await requestPage(state, member, 'owner');
  const ownerRequests = await requestPage(state, owner, member.id);
  for (const page of [memberRequests, ownerRequests]) {
    assert.deepEqual(page.incoming, []);
    assert.deepEqual(page.outgoing, []);
    assert.equal(page.pending_count, 0);
    assert.equal(page.relationship.state, 'accepted');
  }
});

test('ordinary member friendship still needs consent and JWhite remains pinned before newer friends', async () => {
  const state = setup();
  await ensureAutomaticOwnerFriend(member, owner, state.friends);

  const sent = await addFriend(
    new Request(`${origin}/api/friends/add?target_id=${member.id}`, { method: 'POST', headers: { Origin: origin } }),
    state.friends,
    async () => other,
    state.profiles,
    state.directory,
  );
  assert.equal(sent.status, 200, await sent.clone().text());
  assert.equal((await sent.json()).state, 'outgoing');
  let friends = await friendPage(state);
  assert.equal(friends.count, 1);
  assert.deepEqual(friends.friends.map(friend => friend.member_id), ['owner']);

  const pending = await requestPage(state, member);
  assert.equal(pending.incoming.length, 1);
  assert.equal(pending.incoming[0].member_id, other.id);
  assert.equal(pending.pending_count, 1);
  assert.deepEqual(pending.outgoing, []);

  const accepted = await respondToFriendRequest(
    jsonPost('/api/friend-requests/respond', { request_id: pending.incoming[0].id, action: 'accept' }),
    state.friends,
    async () => member,
    state.profiles,
  );
  assert.equal(accepted.status, 200, await accepted.clone().text());
  friends = await friendPage(state);
  assert.equal(friends.count, 2);
  assert.deepEqual(friends.friends.map(friend => friend.member_id), ['owner', other.id]);
});
