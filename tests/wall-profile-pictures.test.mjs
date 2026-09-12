import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { getComments, postComment, originalComments } from '../netlify/functions/_shared/comment-wall.mts';
import { getMemberWall, postMemberWall } from '../netlify/functions/_shared/member-wall.mts';
import { getInteractions, postInteraction } from '../netlify/functions/_shared/wall-interactions.mts';
import { profileLink } from '../netlify/functions/_shared/wall-identity.mts';
import { POLICY_VERSION } from '../netlify/functions/_shared/comment-moderation.mts';

const origin = 'https://jwhitedidit.net';
const approval = { status: 'approved', reason: 'clearly_supportive', policy_version: POLICY_VERSION, checked_at: '2026-09-07T00:00:00Z' };
const moderate = async () => approval;
const photoId = (letter) => letter.repeat(64);

const alice = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Alice Waters', isOwner: false };
const bob = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Bob Rivers', isOwner: false };
const host = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'JWhite', isOwner: true };

function memory() {
  const records = new Map();
  return {
    records,
    async get(key) { return structuredClone(records.get(key) ?? null); },
    async setJSON(key, value, options = {}) {
      if (options.onlyIfNew && records.has(key)) return { modified: false };
      records.set(key, structuredClone(value));
      return { modified: true };
    },
    async delete(key) { records.delete(key); },
    async *list({ prefix }) {
      const keys = [...records.keys()].filter(key => key.startsWith(prefix));
      for (let n = 0; n < keys.length; n += 10) yield { blobs: keys.slice(n, n + 10).map(key => ({ key })) };
    },
  };
}

/** The main wall reads with a plain list(), the member walls with an iterator. */
function mainStore() {
  const store = memory();
  store.list = async ({ prefix }) => ({ blobs: [...store.records.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })) });
  return store;
}

function profileStore() {
  const profiles = memory();
  profiles.records.set('owner-binding', { id: host.id });
  for (const member of [alice, bob, host]) {
    profiles.records.set('public-members/' + member.id, { id: member.id, name: member.name });
    profiles.records.set('profiles/' + member.id, {
      id: member.id, name: member.name, status: 'Making music.', about_me: 'On ROOSTER',
      photo_id: photoId(member.id[0]), updated_at: '2026-09-01T00:00:00Z',
      policy_version: POLICY_VERSION, approved: true,
    });
  }
  return profiles;
}

const rename = (profiles, member, name, letter) => {
  const record = profiles.records.get('profiles/' + member.id);
  profiles.records.set('profiles/' + member.id, { ...record, name, photo_id: photoId(letter) });
};

const mainPost = (store, dependencies, body) => postComment(new Request(`${origin}/api/comments/post`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
  body: JSON.stringify({ name: 'Typed name', message: 'Love this page.', request_id: randomUUID(), 'bot-field': '', ...body }),
}), store, moderate, dependencies);

const mainRead = (store, dependencies) => getComments(new Request(`${origin}/api/comments`), store, dependencies);

test('a signed-in visitor gets their member ID, current picture and profile link on the main wall', async () => {
  const store = mainStore(), profiles = profileStore();
  const dependencies = { profiles, resolveMember: async () => alice };
  assert.equal((await mainPost(store, dependencies)).status, 201);
  const body = await (await mainRead(store, dependencies)).json();
  const posted = body.comments.find(comment => comment.author_id === alice.id);
  assert.ok(posted, 'the comment is joined to the member who wrote it');
  assert.equal(posted.name, 'Alice Waters');
  assert.equal(posted.photo_url, `/api/profile-photo/${photoId('a')}`);
  assert.equal(posted.profile_url, `/profile.html?id=${alice.id}`);
  assert.equal(posted.verified_owner, false);
});

test('a changed picture and display name appear on comments already on the wall', async () => {
  const store = mainStore(), profiles = profileStore();
  const dependencies = { profiles, resolveMember: async () => alice };
  await mainPost(store, dependencies, { name: 'Alice', message: 'First message here.' });
  rename(profiles, alice, 'Alice W. Waters', 'e');
  const [posted] = (await (await mainRead(store, dependencies)).json()).comments.filter(comment => comment.author_id === alice.id);
  assert.equal(posted.name, 'Alice W. Waters');
  assert.equal(posted.photo_url, `/api/profile-photo/${photoId('e')}`);
});

test('JWhite keeps the official owner badge and the owner profile link', async () => {
  const store = mainStore(), profiles = profileStore();
  const dependencies = { profiles, resolveMember: async () => host };
  await mainPost(store, dependencies, { message: 'Thank you all.' });
  const posted = (await (await mainRead(store, dependencies)).json()).comments.find(comment => comment.author_id === host.id);
  assert.equal(posted.verified_owner, true);
  assert.equal(posted.verified, true);
  assert.equal(posted.profile_url, '/#home');
  assert.equal(profileLink(host.id, true), '/#home');
  assert.equal(profileLink(alice.id, false), `/profile.html?id=${alice.id}`);
});

test('a verification record turns on the verified member badge, without touching the owner badge', async () => {
  const store = mainStore(), profiles = profileStore();
  profiles.records.set(`verifications/${bob.id}`, { id: bob.id, verified: true });
  const dependencies = { profiles, resolveMember: async () => bob };
  await mainPost(store, dependencies, { message: 'Checking in.' });
  const posted = (await (await mainRead(store, dependencies)).json()).comments.find(comment => comment.author_id === bob.id);
  assert.equal(posted.verified, true);
  assert.equal(posted.verified_owner, false);
});

test('an older comment with the same display name is never linked to a member profile', async () => {
  const store = mainStore(), profiles = profileStore();
  // A member now uses the display name that an old unattached comment was signed with.
  rename(profiles, bob, originalComments()[0].name, 'b');
  const body = await (await mainRead(store, { profiles, resolveMember: async () => bob })).json();
  const legacy = body.comments.find(comment => comment.id === originalComments()[0].id);
  assert.equal(legacy.name, originalComments()[0].name);
  assert.equal(legacy.author_id, null);
  assert.equal(legacy.profile_url, null);
  assert.equal(legacy.photo_url, null);
  assert.equal(legacy.verified, false);
  assert.equal(legacy.verified_owner, false);
});

test('a visitor who is not logged in can still post, and that comment links nowhere', async () => {
  const store = mainStore(), profiles = profileStore();
  const dependencies = { profiles, resolveMember: async () => { throw new Error('not signed in'); } };
  assert.equal((await mainPost(store, dependencies, { name: 'Passer By', message: 'Nice page!' })).status, 201);
  const posted = (await (await mainRead(store, dependencies)).json()).comments.find(comment => comment.name === 'Passer By');
  assert.equal(posted.author_id, null);
  assert.equal(posted.profile_url, null);
  assert.equal(posted.photo_url, null);
});

test('a member wall comment shows the writer current picture, name and profile link', async () => {
  const walls = memory(), profiles = profileStore();
  const dependencies = { profiles, resolveMember: async () => bob, moderate };
  const posted = await postMemberWall(new Request(`${origin}/api/member-wall/post?member=${alice.id}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ message: 'Your songs are great.', request_id: randomUUID() }),
  }), walls, dependencies);
  assert.equal(posted.status, 201);
  const confirmed = (await posted.json()).comment;
  assert.equal(confirmed.photo_url, `/api/profile-photo/${photoId('b')}`);
  assert.equal(confirmed.profile_url, `/profile.html?id=${bob.id}`);
  rename(profiles, bob, 'Bobby Rivers', 'f');
  const [shown] = (await (await getMemberWall(new Request(`${origin}/api/member-wall?member=${alice.id}`), walls, dependencies)).json()).comments;
  assert.equal(shown.author_id, bob.id);
  assert.equal(shown.name, 'Bobby Rivers');
  assert.equal(shown.photo_url, `/api/profile-photo/${photoId('f')}`);
  assert.equal(shown.profile_url, `/profile.html?id=${bob.id}`);
});

test('a wall reply shows a clickable picture and name that follow the profile', async () => {
  const main = mainStore(), walls = memory(), interactions = memory(), profiles = profileStore();
  const comment = originalComments()[0];
  const dependencies = { main, walls, profiles, resolve: async () => bob, moderate };
  const query = `?wall=owner&comment_id=${comment.id}`;
  const saved = await postInteraction(new Request(`${origin}/api/wall-interactions/post${query}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ action: 'reply', message: 'Agreed, this page is special.', request_id: randomUUID() }),
  }), interactions, dependencies);
  assert.equal(saved.status, 200);
  rename(profiles, bob, 'Bobby Rivers', 'f');
  const body = await (await getInteractions(new Request(`${origin}/api/wall-interactions${query}`), interactions, dependencies)).json();
  assert.equal(body.replies.length, 1);
  assert.equal(body.replies[0].author_id, bob.id);
  assert.equal(body.replies[0].name, 'Bobby Rivers');
  assert.equal(body.replies[0].photo_url, `/api/profile-photo/${photoId('f')}`);
  assert.equal(body.replies[0].profile_url, `/profile.html?id=${bob.id}`);
  assert.equal(body.replies[0].verified_owner, false);
});

test('an owner reply keeps the official badge and the owner link', async () => {
  const main = mainStore(), walls = memory(), interactions = memory(), profiles = profileStore();
  const comment = originalComments()[0];
  const dependencies = { main, walls, profiles, resolve: async () => host, moderate };
  const query = `?wall=owner&comment_id=${comment.id}`;
  await postInteraction(new Request(`${origin}/api/wall-interactions/post${query}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ action: 'reply', message: 'Appreciate the love.', request_id: randomUUID() }),
  }), interactions, dependencies);
  const body = await (await getInteractions(new Request(`${origin}/api/wall-interactions${query}`), interactions, dependencies)).json();
  assert.equal(body.replies[0].verified_owner, true);
  assert.equal(body.replies[0].verified, true);
  assert.equal(body.replies[0].profile_url, '/#home');
});

test('every wall surface in the browser joins by member ID and shows initials otherwise', () => {
  const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
  for (const name of ['wall.js', 'wall-interactions.js', 'profile-wall.js']) {
    const source = read(name);
    // Each surface reads the member ID the server stored with the comment, and
    // only accepts a profile link that belongs to that same ID.
    assert.match(source, /author_id/, `${name} uses the stored member ID`);
    assert.match(source, /profile\.html\?id=\$\{/, `${name} builds the link from that ID`);
    assert.match(source, /photo_url/, `${name} shows the member picture`);
    assert.match(source, /official-gold-badge/, `${name} keeps the official badge`);
    assert.match(source, /member-verified-badge/, `${name} keeps the verified member badge`);
    // Nobody is identified by comparing display names.
    assert.doesNotMatch(source, /\.name\s*(?:===|==|!==)\s*[A-Za-z_$][\w$]*\.name/, `${name} never matches one display name against another`);
  }
  for (const name of ['wall.js', 'wall-interactions.js']) assert.match(read(name), /initials/, `${name} falls back to initials`);
  assert.match(read('profile-wall.js'), /\[\.\.\.comment\.name\]\[0\]/, 'the member wall falls back to an initial');
  for (const name of ['style.css', 'community-updates.css']) {
    assert.match(read(name), /wall-(?:avatar|reply-avatar)/, `${name} styles the wall pictures`);
  }
  assert.match(read('profile.css'), /member-wall-portrait img/, 'the member wall picture is cropped to its circle');
});
