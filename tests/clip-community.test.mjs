import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { getClipCommunity, postClipReaction, postClipComment } from '../netlify/functions/_shared/clip-community.mts';
import { submitClip, checkClip } from '../netlify/functions/_shared/member-clips.mts';
import { MemberError } from '../netlify/functions/_shared/member-auth.mts';
import { POLICY_VERSION } from '../netlify/functions/_shared/comment-moderation.mts';
import { VIDEO_MODERATION_POLICY_VERSION } from '../netlify/functions/_shared/video-moderation.mts';
const origin = 'https://jwhitedidit.net';
const alice = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Alice', isOwner: false };
const bob = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Bob', isOwner: false };
const owner = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'J.White Did It', isOwner: true };
const auth = member => ({ resolveMember: async () => member });
const anonymous = { resolveMember: async () => { throw new MemberError(401, 'Log in.'); } };
const video = await readFile(new URL('./fixtures/short-clip.mp4', import.meta.url));
const decision = (status = 'approved') => ({ status, policy_version: POLICY_VERSION, reason: status === 'approved' ? 'positive_or_respectful' : status === 'rejected' ? 'negative_or_abusive' : 'uncertain', checked_at: new Date().toISOString() });
function memoryStore() {
  const records = new Map(), tags = new Map(); let sequence = 0;
  const read = key => structuredClone(records.get(key) ?? null);
  const write = (key, data, opts = {}) => { if ((opts.onlyIfNew && records.has(key)) || (opts.onlyIfMatch !== undefined && opts.onlyIfMatch !== tags.get(key))) return { modified: false }; records.set(key, structuredClone(data)); tags.set(key, String(++sequence)); return { modified: true }; };
  return { records, async get(key) { return read(key); }, async getWithMetadata(key) { return records.has(key) ? { data: read(key), etag: tags.get(key) } : null; }, async setJSON(key, data, opts) { return write(key, data, opts); }, async set(key, data, opts) { return write(key, data, opts); } };
}
const post = (path, data) => new Request(origin + path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
const react = (id, reaction = 'apple', extra = {}) => post('/api/clip-reaction', { clip_id: id, reaction, request_id: randomUUID(), ...extra });
const comment = (id, extra = {}) => post('/api/clip-comment', { clip_id: id, body: 'Love this studio moment!', request_id: randomUUID(), ...extra });
const get = id => new Request(origin + '/api/clip-community?id=' + id);
async function setup(status = 'approved') {
  const clips = memoryStore(), community = memoryStore(), form = new FormData();
  form.set('video', new Blob([video], { type: 'video/mp4' }), 'clip.mp4'); form.set('request_id', randomUUID()); form.set('caption', 'A studio moment');
  const uploaded = await submitClip(new Request(origin + '/api/clips', { method: 'POST', headers: { Origin: origin }, body: form }), clips, auth(alice));
  assert.equal(uploaded.status, 202); const { id } = await uploaded.json();
  if (status !== 'pending') await checkClip(post('/api/clips/check', { id }), clips, { ...auth(alice), moderateVideo: async () => ({ status, policy_version: VIDEO_MODERATION_POLICY_VERSION, reason: 'safe_music_community' }) });
  return { clips, community, id };
}
const load = async (state, options = anonymous) => (await getClipCommunity(get(state.id), state.community, state.clips, options)).json();

test('one server-derived apple or tomato per member can change and be removed', async () => {
  const state = await setup(); const { id, clips, community } = state;
  const first = await postClipReaction(react(id, 'apple', { member_id: bob.id, name: 'Forged' }), community, clips, auth(alice));
  assert.deepEqual(await first.json(), { id, counts: { apple: 1, tomato: 0 }, reaction: 'apple' });
  assert.equal((await load(state, auth(alice))).my_reaction, 'apple'); assert.equal((await load(state, auth(bob))).my_reaction, null);
  assert.equal((await load(state)).authenticated, false);
  await postClipReaction(react(id, 'tomato'), community, clips, auth(alice)); assert.deepEqual((await load(state)).counts, { apple: 0, tomato: 1 });
  await postClipReaction(react(id, null), community, clips, auth(alice)); assert.deepEqual((await load(state)).counts, { apple: 0, tomato: 0 });
  const response = await getClipCommunity(get(id), community, clips, auth(alice));
  assert.equal(response.headers.get('cache-control'), 'private, no-store'); assert.equal(response.headers.get('vary'), 'Cookie, Authorization');
  const data = await response.json(); assert.equal(data.viewer_id, alice.id); assert.equal(data.authenticated, true);
  assert.equal((await load(state)).viewer_id, null);
});

test('reaction retries are idempotent and stale requests cannot replace newer choices', async () => {
  const { id, clips, community } = await setup(); const request_id = randomUUID();
  await postClipReaction(react(id, 'apple', { request_id }), community, clips, auth(alice));
  const retry = await postClipReaction(react(id, 'apple', { request_id }), community, clips, auth(alice)); assert.equal(retry.status, 200); assert.equal((await retry.json()).counts.apple, 1);
  assert.equal((await postClipReaction(react(id, 'tomato', { request_id }), community, clips, auth(alice))).status, 409);
  await postClipReaction(react(id, 'tomato'), community, clips, auth(alice));
  assert.equal((await postClipReaction(react(id, 'apple', { request_id }), community, clips, auth(alice))).status, 409);
  assert.deepEqual((await (await getClipCommunity(get(id), community, clips, anonymous)).json()).counts, { apple: 0, tomato: 1 });
});

test('concurrent member writes preserve both reactions and comments without duplicate counts', async () => {
  const state = await setup(); const { id, clips, community } = state;
  const results = await Promise.all([postClipReaction(react(id, 'apple'), community, clips, auth(alice)), postClipReaction(react(id, 'tomato'), community, clips, auth(bob))]);
  assert.equal(results.every(result => result.status === 200), true); assert.deepEqual((await load(state)).counts, { apple: 1, tomato: 1 });
  const options = member => ({ ...auth(member), moderate: async () => decision() });
  const comments = await Promise.all([postClipComment(comment(id), community, clips, options(alice)), postClipComment(comment(id, { body: 'Great music!' }), community, clips, options(bob))]);
  assert.equal(comments.every(result => result.status === 201), true); const data = await load(state); assert.equal(data.comment_count, 2); assert.equal(data.comments.length, 2);
});

test('comments use verified identity, positive moderation, and immutable commit retries', async () => {
  const state = await setup(); const { id, clips, community } = state; let received, calls = 0;
  const options = { ...auth(alice), moderate: async input => { calls++; received = input; return decision(); } }; const request_id = randomUUID();
  const result = await postClipComment(comment(id, { request_id, name: owner.name, member_id: owner.id, body: '  Great music!\r\nMore please.  ' }), community, clips, options);
  assert.equal(result.status, 201); const data = await result.json(); assert.equal(data.comment.name, 'Alice'); assert.match(data.comment.id, /^[a-f0-9]{64}$/);
  assert.deepEqual(received, { name: 'Alice', message: 'Great music!\nMore please.' });
  const retry = await postClipComment(comment(id, { request_id, body: 'Great music!\nMore please.' }), community, clips, options); assert.equal(retry.status, 200); assert.equal(calls, 1);
  assert.equal((await load(state)).comment_count, 1);
  assert.equal((await postClipComment(comment(id, { request_id, body: 'Changed request' }), community, clips, options)).status, 409);
  const publicData = await load(state); assert.equal(JSON.stringify(publicData).includes('moderation'), false); assert.equal(JSON.stringify(publicData).includes(alice.id), false);
});

test('pending, rejected, malformed and unavailable comment moderation cannot publish', async () => {
  for (const verdict of [decision('pending'), decision('rejected'), { ...decision(), reason: 'negative_or_abusive' }, new Error('secret')]) {
    const state = await setup(); const { id, clips, community } = state;
    const result = await postClipComment(comment(id), community, clips, { ...auth(alice), moderate: async () => { if (verdict instanceof Error) throw verdict; return verdict; } });
    assert.equal((await result.json()).published, false); assert.equal((await load(state)).comment_count, 0);
    // An unapproved record accidentally present in the aggregate remains private.
    const held = [...community.records.entries()].find(([key]) => key.startsWith('comments/'))[1];
    community.records.set('comment-feed/' + id, { comments: [held] });
    assert.deepEqual((await load(state)).comments, []);
  }
});

test('unapproved and revoked clips expose no comments or reactions', async () => {
  for (const status of ['pending', 'rejected']) {
    const { id, clips, community } = await setup(status);
    assert.equal((await getClipCommunity(get(id), community, clips, anonymous)).status, 404);
    assert.equal((await postClipReaction(react(id), community, clips, auth(alice))).status, 404);
    assert.equal((await postClipComment(comment(id), community, clips, { ...auth(alice), moderate: async () => decision() })).status, 404);
    assert.equal(community.records.size, 0);
  }
  const state = await setup(); const { id, clips, community } = state;
  await postClipReaction(react(id), community, clips, auth(alice));
  await postClipComment(comment(id), community, clips, { ...auth(alice), moderate: async () => decision() });
  clips.records.set('moderation/' + id, { id, status: 'rejected', checked_at: new Date().toISOString(), owner_id: owner.id });
  assert.equal((await getClipCommunity(get(id), community, clips, anonymous)).status, 404);
});

test('authorization and same-origin checks run before writes, moderation or forged member claims', async () => {
  const { id, clips, community } = await setup(); let calls = 0; const options = { ...anonymous, moderate: async () => { calls++; return decision(); } };
  assert.equal((await postClipReaction(react(id, 'apple', { member_id: alice.id }), community, clips, anonymous)).status, 401);
  assert.equal((await postClipComment(comment(id), community, clips, options)).status, 401);
  const a = react(id), b = comment(id); a.headers.delete('Origin'); b.headers.set('Origin', 'https://evil.example');
  assert.equal((await postClipReaction(a, community, clips, auth(alice))).status, 403);
  assert.equal((await postClipComment(b, community, clips, { ...auth(alice), moderate: options.moderate })).status, 403);
  assert.equal(calls, 0); assert.equal(community.records.size, 0);
});

test('clip revocation during a write or moderation cannot return a public success', async () => {
  const { id, clips, community } = await setup();
  const revoked = { id, status: 'rejected', checked_at: new Date().toISOString(), owner_id: owner.id };
  const result = await postClipComment(comment(id), community, clips, { ...auth(alice), moderate: async () => { clips.records.set('moderation/' + id, revoked); return decision(); } });
  assert.equal(result.status, 404); assert.equal(community.records.has('comment-feed/' + id), false);
});
