import test from 'node:test';
import assert from 'node:assert/strict';
import { hydrateFeedAuthors } from '../netlify/functions/_shared/feed-authors.mts';
import { POLICY_VERSION } from '../netlify/functions/_shared/comment-moderation.mts';

const origin = 'https://jwhitedidit.net';
const alice = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const bob = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const owner = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const unknown = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const hash = letter => letter.repeat(64);
const photo = letter => `/api/profile-photo/${hash(letter)}`;
const request = () => new Request(`${origin}/api/community/feed?view=for_you`);

function profileStore() {
  const records = new Map([['owner-binding', { id: owner }]]);
  const reads = new Map();
  const unavailable = new Set();
  for (const id of [alice, bob, owner]) {
    // Matching display names must never be used to join a post to a person.
    records.set(`public-members/${id}`, { id, name: 'Same Display Name' });
    records.set(`profiles/${id}`, {
      id, name: 'Same Display Name', status: 'Making things.', about_me: 'On ROOSTER',
      photo_id: hash(id[0]), updated_at: '2026-09-11T00:00:00Z',
      policy_version: POLICY_VERSION, approved: true,
    });
  }
  return {
    records, reads, unavailable,
    async get(key) {
      reads.set(key, (reads.get(key) ?? 0) + 1);
      if (unavailable.has(key)) throw new Error('Profile storage unavailable');
      return structuredClone(records.get(key) ?? null);
    },
    async setJSON(key, value) {
      records.set(key, structuredClone(value));
      return { modified: true };
    },
    async *list({ prefix }) {
      yield { blobs: [...records.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })) };
    },
  };
}

function post(id, photoUrl = null, suffix = '') {
  return {
    id: `post-${id}-${suffix}`,
    author: { id, name: 'Same Display Name', photo_url: photoUrl, kind: 'member' },
    body: 'My WYD post', created_at: '2026-09-01T00:00:00Z',
    media: [{ id: `media-${suffix}`, kind: 'image', url: '/api/member-photo/example' }],
    viewer: { can_delete: id === owner, liked: false },
  };
}

test('every WYD author gets their own current picture, even when all names match', async () => {
  const profiles = profileStore();
  const posts = [post(owner, '/assets/rooster-logo.svg'), post(alice), post(bob, '/profile.jpg')];
  const before = structuredClone(posts);
  const shown = await hydrateFeedAuthors(request(), posts, { profiles });
  assert.deepEqual(shown.map(item => item.author.photo_url), [photo('c'), photo('a'), photo('b')]);
  for (let i = 0; i < shown.length; i++) {
    assert.deepEqual(shown[i], {
      ...before[i], author: { ...before[i].author, photo_url: photo(before[i].author.id[0]) },
    }, 'hydration only changes the author picture; member content, names, and permissions stay intact');
  }
});

test('old posts show changed profile pictures on the next read without posting again', async () => {
  const profiles = profileStore();
  const storedPosts = [post(alice, photo('a')), post(bob, photo('b'))];
  const first = await hydrateFeedAuthors(request(), structuredClone(storedPosts), { profiles });
  assert.deepEqual(first.map(item => item.author.photo_url), [photo('a'), photo('b')]);
  for (const [id, letter] of [[alice, 'e'], [bob, 'f']]) {
    profiles.records.set(`profiles/${id}`, {
      ...profiles.records.get(`profiles/${id}`), photo_id: hash(letter), name: 'Updated profile name',
    });
  }
  const updated = await hydrateFeedAuthors(request(), structuredClone(storedPosts), { profiles });
  assert.deepEqual(updated.map(item => item.author.photo_url), [photo('e'), photo('f')]);
  assert.deepEqual(updated.map(item => item.author.name), ['Same Display Name', 'Same Display Name']);
});

test('removing a member picture clears stale avatars and new profiles get no owner fallback', async () => {
  const profiles = profileStore();
  profiles.records.set(`profiles/${alice}`, { ...profiles.records.get(`profiles/${alice}`), photo_id: null });
  profiles.records.delete(`profiles/${bob}`);
  const shown = await hydrateFeedAuthors(request(), [post(alice, photo('a')), post(bob, photo('b'))], { profiles });
  assert.deepEqual(shown.map(item => item.author.photo_url), [null, null]);
});

test('one unavailable profile keeps its safe stored photo while other authors still update', async () => {
  const profiles = profileStore();
  profiles.unavailable.add(`profiles/${alice}`);
  const shown = await hydrateFeedAuthors(request(), [post(alice, photo('e')), post(bob, photo('f')), post(owner)], { profiles });
  assert.deepEqual(shown.map(item => item.author.photo_url), [photo('e'), photo('b'), photo('c')]);
});

test('unavailable profiles never expose invalid or external stored picture URLs', async () => {
  const profiles = profileStore();
  profiles.unavailable.add(`profiles/${alice}`);
  const unsafe = [
    'https://example.com/photo.jpg', '//example.com/photo.jpg', '/assets/rooster-logo.svg',
    'javascript:alert(1)', '/api/profile-photo/not-a-hash', `/api/profile-photo/${hash('a')}?redirect=1`,
    { url: photo('a') },
  ];
  const shown = await hydrateFeedAuthors(request(), unsafe.map((url, i) => post(alice, url, String(i))), { profiles });
  assert.deepEqual(shown.map(item => item.author.photo_url), unsafe.map(() => null));
});

test('repeated posts by the same author perform one profile lookup per request', async () => {
  const profiles = profileStore();
  const posts = [post(alice, null, '1'), post(bob), post(alice, photo('f'), '2'), post(alice, null, '3')];
  const shown = await hydrateFeedAuthors(request(), posts, { profiles });
  assert.deepEqual(shown.map(item => item.author.photo_url), [photo('a'), photo('b'), photo('a'), photo('a')]);
  assert.equal(profiles.reads.get(`profiles/${alice}`), 1);
  assert.equal(profiles.reads.get(`profiles/${bob}`), 1);
  await hydrateFeedAuthors(request(), posts, { profiles });
  assert.equal(profiles.reads.get(`profiles/${alice}`), 2, 'the next request reads fresh profile data');
});

test('unknown and unattached author IDs never inherit a matching name or owner picture', async () => {
  const profiles = profileStore();
  const ids = [unknown, 'owner', 'roster', '', null, undefined];
  const shown = await hydrateFeedAuthors(request(), [post(owner), ...ids.map((id, i) => post(id, null, String(i)))], { profiles });
  assert.equal(shown[0].author.photo_url, photo('c'));
  assert.deepEqual(shown.slice(1).map(item => item.author.photo_url), ids.map(() => null));
  assert.deepEqual(shown.slice(1).map(item => item.author.id), ids);
  assert.equal(profiles.reads.get('profiles/owner'), undefined);
  assert.equal(profiles.reads.get('profiles/roster'), undefined);
});
