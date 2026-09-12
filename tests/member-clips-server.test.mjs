import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { getClips, submitClip, getClipReview, reviewClip, getClipVideo, checkClip, getClipStatus } from '../netlify/functions/_shared/member-clips.mts';
import { resolveProfileMember } from '../netlify/functions/_shared/member-profiles.mts';
import { validatePrivateMessageVideo } from '../netlify/functions/_shared/private-message-videos.mts';
import { VIDEO_MODERATION_POLICY_VERSION } from '../netlify/functions/_shared/video-moderation.mts';
import { config as submitConfig } from '../netlify/functions/clips-submit.mts';
import { config as reviewConfig } from '../netlify/functions/clips-review.mts';
const origin = 'https://jwhitedidit.net';
const alice = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Alice', isOwner: false };
const bob = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Bob', isOwner: false };
const owner = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'J.White Did It', isOwner: true };
const videoBytes = await readFile(new URL('./fixtures/short-clip.mp4', import.meta.url));
const normalizedVideo = Buffer.from(validatePrivateMessageVideo(videoBytes, 'video/mp4').bytes);
const auth = member => ({ resolveMember: async () => member });
const signedOut = { resolveMember: async () => resolveProfileMember(async () => null, 'owner@example.test') };
function memoryStore() {
  const records = new Map(), tags = new Map(), reads = []; let version = 0;
  const read = key => { reads.push(key); return structuredClone(records.get(key) ?? null); };
  const write = (key, value, opts = {}) => {
    if ((opts.onlyIfNew && records.has(key)) || (opts.onlyIfMatch !== undefined && opts.onlyIfMatch !== tags.get(key))) return { modified: false };
    records.set(key, structuredClone(value)); tags.set(key, `etag-${++version}`); return { modified: true };
  };
  return { records, tags, reads,
    async get(key) { return read(key); },
    async getWithMetadata(key) { return records.has(key) ? { data: read(key), etag: tags.get(key) } : null; },
    async setJSON(key, value, opts) { return write(key, value, opts); }, async set(key, value, opts) { return write(key, value, opts); },
    async *list({ prefix }) { yield { blobs: [...records.keys()].filter(key => key.startsWith(prefix)).reverse().map(key => ({ key })) }; },
  };
}
function profiles(member = owner) { const store = memoryStore(); store.records.set('owner-binding', { id: member.id }); return store; }
function upload(fields = {}, bytes = videoBytes, type = 'video/mp4', headers = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ request_id: randomUUID(), caption: 'A little studio inspiration', ...fields })) form.set(key, String(value));
  if (bytes !== null) form.set('video', new Blob([bytes], { type }), 'upload.mp4');
  return new Request(origin + '/api/clips', { method: 'POST', headers: { Origin: origin, ...headers }, body: form });
}
const get = path => new Request(origin + path);
const review = (id, action = 'approve', extra = {}, headers = {}) => new Request(origin + '/api/clips/review', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ id, action, ...extra }) });
const check = (id, extra = {}, headers = {}) => new Request(origin + '/api/clips/check', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ id, ...extra }) });
const decision = (status = 'approved') => ({ status, policy_version: VIDEO_MODERATION_POLICY_VERSION, reason: status === 'approved' ? 'safe_music_clip' : 'needs_review' });
const feed = async store => (await getClips(get('/api/clips?member='+alice.id), store)).json();
const submit = async (store, fields = {}, member = alice) => {
  const response = await submitClip(upload(fields), store, auth(member));
  assert.equal(response.status, 202, await response.clone().text()); return response.json();
};

test('members submit server-derived identity and every clip waits for owner review', async () => {
  const store = memoryStore(), account = profiles();
  const result = await submit(store, { name: owner.name, member_id: owner.id, status: 'approved', isOwner: 'true' });
  assert.deepEqual({ status: result.status, published: result.published }, { status: 'pending', published: false });
  assert.match(result.id, /^[a-f0-9]{64}$/);
  assert.deepEqual((await feed(store)).clips, []);
  const record = store.records.get('clips/' + result.id);
  assert.equal(record.member_id, alice.id); assert.equal(record.name, alice.name);
  assert.equal([...store.records.keys()].some(key => key.startsWith('published/')), false);
  const queue = await getClipReview(get('/api/clips/review'), store, account, auth(owner));
  const data = await queue.json(); assert.equal(data.clips.length, 1); assert.equal(data.clips[0].status, 'pending');
  assert.equal(data.clips[0].video_url, '/api/clip-video/' + result.id);
  assert.equal(data.clips[0].duration <= 30, true);
  for (const key of ['digest', 'request_id', 'owner_id', 'email', 'token']) assert.equal(key in data.clips[0], false);
});

test('unconfirmed, signed out, and cross-origin uploads make no writes', async () => {
  const store = memoryStore();
  assert.equal((await submitClip(upload(), store, signedOut)).status, 401);
  const unconfirmed = { resolveMember: async () => resolveProfileMember(async () => ({ ...alice, email: 'visitor@example.test' }), 'owner@example.test') };
  assert.equal((await submitClip(upload(), store, unconfirmed)).status, 403);
  const requests = [upload({}, videoBytes, 'video/mp4', { Origin: 'https://evil.test' }), upload({}, videoBytes, 'video/mp4', { 'Sec-Fetch-Site': 'cross-site' }), upload()];
  requests.at(-1).headers.delete('Origin');
  for (const request of requests) assert.equal((await submitClip(request, store, auth(alice))).status, 403);
  assert.equal(store.records.size, 0);
});

test('a private clip is visible only to its submitter and bound owner, never ordinary members', async () => {
  const store = memoryStore(), account = profiles(), { id } = await submit(store);
  const path = '/api/clip-video/' + id;
  for (const member of [alice, owner]) {
    const response = await getClipVideo(get(path), store, account, auth(member));
    assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), normalizedVideo);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(response.headers.get('netlify-cdn-cache-control'), 'no-store');
    assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
  }
  for (const options of [signedOut, auth(bob), auth({ ...bob, isOwner: true })]) {
    store.reads.length = 0;
    assert.equal((await getClipVideo(get(path), store, account, options)).status, 404);
    assert.equal(store.reads.some(key => key.startsWith('videos/')), false, 'authorization precedes reading private bytes');
  }
  assert.equal((await getClipReview(get('/api/clips/review'), store, account, auth(alice))).status, 403);
  assert.equal((await getClipReview(get('/api/clips/review'), store, account, signedOut)).status, 401);
});

test('review requires verified email and matching immutable binding, not supplied flags or verification team membership', async () => {
  const store = memoryStore(), account = profiles(), { id } = await submit(store);
  account.records.set('verification-team/' + bob.id, { id: bob.id, can_verify: true });
  for (const member of [alice, bob, { ...bob, isOwner: true }]) {
    assert.equal((await reviewClip(review(id, 'approve', { owner_id: owner.id, isOwner: true }), store, account, auth(member))).status, 403);
    assert.equal((await getClipReview(get('/api/clips/review'), store, account, auth(member))).status, 403);
  }
  assert.equal((await reviewClip(review(id), store, memoryStore(), auth(owner))).status, 403);
  const fake = { ...bob, email: 'not-owner@example.test', confirmedAt: '2026-09-05', roles: ['admin'], isOwner: true, name: owner.name };
  const fakeAuth = { resolveMember: async () => resolveProfileMember(async () => fake, 'owner@example.test') };
  assert.equal((await reviewClip(review(id), store, account, fakeAuth)).status, 403);
  assert.deepEqual((await feed(store)).clips, []);
});

test('owner approval commits the public clip, and rejection revokes every public read', async () => {
  const store = memoryStore(), account = profiles(), { id } = await submit(store);
  const approved = await reviewClip(review(id), store, account, auth(owner));
  assert.equal(approved.status, 200); assert.equal((await approved.json()).published, true);
  assert.equal((await feed(store)).clips[0].id, id);
  assert.equal((await getClipVideo(get('/api/clip-video/' + id), store, account, signedOut)).status, 200);
  assert.equal((await getClipReview(get('/api/clips/review'), store, account, auth(owner))).status, 200);
  assert.equal((await reviewClip(review(id, 'reject'), store, account, auth(owner))).status, 200);
  assert.deepEqual((await feed(store)).clips, []);
  assert.equal((await getClipVideo(get('/api/clip-video/' + id), store, account, signedOut)).status, 404);
  assert.equal((await reviewClip(review(id), store, account, auth(owner))).status, 409);
  assert.equal((await getClipVideo(get('/api/clip-video/' + id), store, account, auth(alice))).status, 200);
});

test('missing binary, uncommitted writes, and forged index entries never expose clips', async () => {
  const store = memoryStore(), account = profiles(), { id } = await submit(store);
  const submissionKey = [...store.records.keys()].find(key => key.startsWith('submitted/'));
  const submission = store.records.get(submissionKey); store.records.delete(submissionKey);
  assert.equal((await getClipVideo(get('/api/clip-video/' + id), store, account, auth(alice))).status, 404);
  assert.equal((await reviewClip(review(id), store, account, auth(owner))).status, 404);
  store.records.set(submissionKey, submission);
  const videoKey = [...store.records.keys()].find(key => key.startsWith('videos/')); const bytes = store.records.get(videoKey); store.records.delete(videoKey);
  assert.equal((await reviewClip(review(id), store, account, auth(owner))).status, 404);
  assert.deepEqual((await feed(store)).clips, []);
  store.records.set(videoKey, bytes);
  assert.equal((await reviewClip(review(id), store, account, auth(owner))).status, 200);
  const publishKey = [...store.records.keys()].find(key => key.startsWith('published/'));
  store.records.set(publishKey, { id, digest: 'f'.repeat(64) });
  assert.deepEqual((await feed(store)).clips, []);
  assert.equal((await getClipVideo(get('/api/clip-video/' + id), store, account, signedOut)).status, 404);
});

test('identical upload retries are immutable, changed retries fail, and a failed commit is repairable', async () => {
  const store = memoryStore(); const request_id = randomUUID();
  const first = await submit(store, { request_id });
  const before = structuredClone(store.records.get('clips/' + first.id));
  const retry = await submit(store, { request_id }); assert.equal(retry.id, first.id);
  assert.deepEqual(store.records.get('clips/' + first.id), before);
  assert.equal((await submitClip(upload({ request_id, caption: 'Changed caption' }), store, auth(alice))).status, 409);
  assert.equal((await submitClip(upload({ request_id }, new Uint8Array([1, 2, 3])), store, auth(alice))).status, 415);
  const newStore = memoryStore(); const original = newStore.setJSON.bind(newStore); let fail = true;
  newStore.setJSON = async (key, data, opts) => { if (key.startsWith('submitted/') && fail) throw new Error('simulated storage error'); return original(key, data, opts); };
  assert.equal((await submitClip(upload({ request_id }), newStore, auth(alice))).status, 503);
  assert.deepEqual((await feed(newStore)).clips, []);
  fail = false; assert.equal((await submit(newStore, { request_id })).status, 'pending');
});

test('owner CAS conflicts cannot overwrite another review and an interrupted approval stays private until retry', async () => {
  const store = memoryStore(), account = profiles(), { id } = await submit(store);
  const original = store.setJSON.bind(store);
  store.setJSON = async (key, data, opts) => key.startsWith('moderation/') && opts?.onlyIfMatch ? { modified: false } : original(key, data, opts);
  assert.equal((await reviewClip(review(id), store, account, auth(owner))).status, 409);
  assert.deepEqual((await feed(store)).clips, []);
  store.setJSON = async (key, data, opts) => { if (key.startsWith('published/')) throw new Error('private storage details'); return original(key, data, opts); };
  const interrupted = await reviewClip(review(id), store, account, auth(owner));
  assert.equal(interrupted.status, 503); assert.equal((await interrupted.text()).includes('private storage details'), false);
  assert.deepEqual((await feed(store)).clips, []);
  assert.equal((await getClipVideo(get('/api/clip-video/' + id), store, account, signedOut)).status, 404);
  const queue = await (await getClipReview(get('/api/clips/review'), store, account, auth(owner))).json();
  assert.equal(queue.clips.some(clip => clip.id === id), true, 'failed approval stays available to review again');
  store.setJSON = original;
  assert.equal((await reviewClip(review(id), store, account, auth(owner))).status, 200);
  assert.equal((await feed(store)).clips.length, 1);
});

test('three pending clips per member limits uploads and review frees capacity', async () => {
  const store = memoryStore(), account = profiles();
  const pending = await Promise.all([submit(store), submit(store), submit(store)]);
  assert.equal((await submitClip(upload(), store, auth(alice))).status, 429);
  assert.equal([...store.records.keys()].filter(key => key.startsWith('videos/')).length, 3);
  assert.equal((await reviewClip(review(pending[0].id, 'reject'), store, account, auth(owner))).status, 200);
  await submit(store);
  assert.equal((await getClipReview(get('/api/clips/review'), store, account, auth(owner))).status, 200);
});

test('invalid video, duplicate fields, oversized captions and traversal IDs are rejected', async () => {
  const store = memoryStore(), account = profiles();
  for (const [request, status] of [
    [upload({}, null), 400], [upload({}, '<html>not video</html>'), 415], [upload({}, videoBytes, 'image/jpeg'), 415],
    [upload({ caption: 'x'.repeat(301) }), 400], [upload({ request_id: '../../private' }), 400], [upload({ caption: '\u0000bad' }), 400],
  ]) assert.equal((await submitClip(request, store, auth(alice))).status, status);
  assert.equal((await reviewClip(review('../../private'), store, account, auth(owner))).status, 400);
  assert.equal((await getClipVideo(get('/api/clip-video/invalid'), store, account, auth(alice))).status, 404);
  assert.equal(store.records.size, 0);
  const duplicate = upload(); const form = await duplicate.formData(); form.append('caption', 'second');
  assert.equal((await submitClip(new Request(duplicate.url, { method: 'POST', headers: { Origin: origin }, body: form }), store, auth(alice))).status, 400);
});

test('authorized range responses support phone playback without bypassing privacy', async () => {
  const store = memoryStore(), account = profiles(), { id } = await submit(store);
  const request = new Request(origin + '/api/clip-video/' + id, { headers: { Range: 'bytes=0-15' } });
  assert.equal((await getClipVideo(request, store, account, signedOut)).status, 404);
  const part = await getClipVideo(request, store, account, auth(alice));
  assert.equal(part.status, 206); assert.equal(part.headers.get('content-range'), `bytes 0-15/${videoBytes.length}`);
  assert.deepEqual(Buffer.from(await part.arrayBuffer()), videoBytes.subarray(0, 16));
  const invalid = new Request(request.url, { headers: { Range: 'bytes=9999999-' } });
  assert.equal((await getClipVideo(invalid, store, account, auth(alice))).status, 416);
  assert.equal(submitConfig.rateLimit.windowLimit, 10); assert.equal(reviewConfig.rateLimit.windowLimit, 30);
});

test('review pagination covers pending videos while public profiles remain scoped after approval', async () => {
  const store = memoryStore(), account = profiles(), ids = [];
  for (let i = 0; i < 21; i++) ids.push((await submit(store, {}, { ...alice, id: randomUUID() })).id);
  const first = await (await getClipReview(get('/api/clips/review'), store, account, auth(owner))).json();
  assert.equal(first.clips.length, 20); assert.ok(first.next);
  const second = await (await getClipReview(get('/api/clips/review?before=' + first.next), store, account, auth(owner))).json();
  assert.equal(second.clips.length, 1); assert.equal(second.next, null);
  assert.equal(new Set([...first.clips, ...second.clips].map(clip => clip.id)).size, 21);
  assert.deepEqual((await feed(store)).clips, []);
  for (const id of ids) assert.equal((await reviewClip(review(id), store, account, auth(owner))).status, 200);
  assert.deepEqual((await feed(store)).clips, [], 'Alice does not inherit the other 21 uploaders videos');
  for (const id of ids) {
    const uploader = store.records.get('clips/' + id).member_id;
    const clips = (await (await getClips(get('/api/clips?member=' + uploader), store)).json()).clips;
    assert.deepEqual(clips.map(clip => clip.id), [id]);
  }
  assert.deepEqual((await (await getClipReview(get('/api/clips/review'), store, account, auth(owner))).json()).clips, []);
});

test('cross-origin reviews and oversized binary uploads fail without writes', async () => {
  const store = memoryStore(), account = profiles();
  const badReview = review('a'.repeat(64)); badReview.headers.delete('Origin');
  assert.equal((await reviewClip(badReview, store, account, auth(owner))).status, 403);
  const largeRequest = upload({}, new Uint8Array(4 * 1024 * 1024 + 1));
  const bytes = await largeRequest.arrayBuffer();
  const response = await submitClip(new Request(largeRequest.url, { method: 'POST', headers: largeRequest.headers, body: bytes }), store, auth(alice));
  assert.equal(response.status, 413); assert.equal(store.records.size, 0);
});

test('automatic approval publishes only the immutable server video and caches the decision', async () => {
  const store = memoryStore(), account = profiles(), { id } = await submit(store);
  let calls = 0, received;
  const options = { ...auth(alice), moderateVideo: async input => { calls++; received = input; return decision(); } };
  const result = await checkClip(check(id, { name: 'Forged', caption: 'Fake', status: 'approved' }), store, options);
  assert.equal(result.status, 200); assert.deepEqual(await result.json(), { id, status: 'approved', published: true });
  assert.equal(received.name, alice.name); assert.equal(received.caption, 'A little studio inspiration');
  assert.deepEqual(Buffer.from(received.bytes), normalizedVideo);
  assert.equal((await feed(store)).clips[0].id, id);
  assert.equal((await getClipVideo(get('/api/clip-video/' + id), store, account, signedOut)).status, 200);
  assert.equal((await checkClip(check(id), store, options)).status, 200); assert.equal(calls, 1);
  const reviewRecord = store.records.get('moderation/' + id);
  assert.equal(reviewRecord.input_digest, store.records.get('clips/' + id).digest);
  assert.equal(reviewRecord.source, 'automatic'); assert.equal(reviewRecord.policy_version, VIDEO_MODERATION_POLICY_VERSION);
});

test('rejected, uncertain, malformed and unavailable video checks never publish', async () => {
  for (const value of [decision('rejected'), decision('pending'), { ...decision(), policy_version: 'unknown' }, { status: 'approved' }, null, new Error('provider secret')]) {
    const store = memoryStore(), account = profiles(), { id } = await submit(store); let calls = 0;
    const options = { ...auth(alice), moderateVideo: async () => { calls++; if (value instanceof Error) throw value; return value; } };
    const result = await checkClip(check(id), store, options); const data = await result.json();
    assert.equal(data.published, false); assert.equal(data.status, value?.status === 'rejected' ? 'rejected' : 'pending');
    assert.deepEqual((await feed(store)).clips, []);
    assert.equal((await getClipVideo(get('/api/clip-video/' + id), store, account, signedOut)).status, 404);
    await checkClip(check(id), store, options); assert.equal(calls, 1, 'flagged or failed automatic checks do not retry provider indefinitely');
    if (data.status === 'pending') {
      const queue = await (await getClipReview(get('/api/clips/review'), store, account, auth(owner))).json();
      assert.equal(queue.clips[0].id, id);
    }
  }
});

test('automatic checking requires the confirmed submitter and status is private to submitter or owner', async () => {
  const store = memoryStore(), account = profiles(), { id } = await submit(store); let calls = 0;
  const moderator = async () => { calls++; return decision(); };
  for (const options of [signedOut, auth(bob), auth(owner)]) {
    const result = await checkClip(check(id, { member_id: alice.id, isOwner: true }), store, { ...options, moderateVideo: moderator });
    assert.equal(result.status, options === signedOut ? 401 : 404);
  }
  const cross = check(id); cross.headers.delete('Origin');
  assert.equal((await checkClip(cross, store, { ...auth(alice), moderateVideo: moderator })).status, 403);
  assert.equal(calls, 0);
  for (const member of [alice, owner]) {
    const result = await getClipStatus(get('/api/clips/status/' + id), store, account, auth(member));
    assert.equal(result.status, 202); assert.equal((await result.json()).published, false);
  }
  assert.equal((await getClipStatus(get('/api/clips/status/' + id), store, account, auth(bob))).status, 404);
  assert.equal((await getClipStatus(get('/api/clips/status/' + id), store, account, signedOut)).status, 401);
});

test('concurrent checks share one paid request and report pending while it runs', async () => {
  const store = memoryStore(), account = profiles(), { id } = await submit(store);
  let finish, started; const began = new Promise(resolve => { started = resolve; }); let calls = 0;
  const options = { ...auth(alice), moderateVideo: async () => { calls++; started(); return new Promise(resolve => { finish = resolve; }); } };
  const first = checkClip(check(id), store, options); await began;
  const second = await checkClip(check(id), store, options); const data = await second.json();
  assert.equal(second.status, 202); assert.equal(data.checking, true); assert.equal(data.published, false);
  const status = await (await getClipStatus(get('/api/clips/status/' + id), store, account, auth(alice))).json();
  assert.equal(status.checking, true); assert.equal(calls, 1);
  finish(decision()); assert.equal((await first).status, 200); assert.equal(calls, 1);
});

test('an owner rejection racing automatic approval cannot republish the clip', async () => {
  const store = memoryStore(), account = profiles(), { id } = await submit(store);
  let finish, started; const began = new Promise(resolve => { started = resolve; });
  const checking = checkClip(check(id), store, { ...auth(alice), moderateVideo: async () => { started(); return new Promise(resolve => { finish = resolve; }); } });
  await began;
  assert.equal((await reviewClip(review(id, 'reject'), store, account, auth(owner))).status, 200);
  finish(decision());
  const result = await (await checking).json(); assert.deepEqual(result, { id, status: 'rejected', published: false });
  assert.deepEqual((await feed(store)).clips, []);
  assert.equal((await getClipVideo(get('/api/clip-video/' + id), store, account, signedOut)).status, 404);
});

test('a stored automatic result repairs a failed index write without a second paid check', async () => {
  const store = memoryStore(), { id } = await submit(store); let calls = 0;
  const options = { ...auth(alice), moderateVideo: async () => { calls++; return decision(); } };
  const write = store.setJSON.bind(store); let fail = true;
  store.setJSON = async (key, value, opts) => { if (fail && key.startsWith('published/')) throw new Error('index failure'); return write(key, value, opts); };
  assert.equal((await checkClip(check(id), store, options)).status, 503); assert.deepEqual((await feed(store)).clips, []);
  fail = false;
  assert.equal((await checkClip(check(id), store, options)).status, 200); assert.equal(calls, 1);
  assert.equal((await feed(store)).clips[0].id, id);
});

test('expired leases can recover but three interrupted attempts require owner review', async () => {
  const store = memoryStore(), { id } = await submit(store); const clip = store.records.get('clips/' + id); let calls = 0;
  const lease = { id, digest: clip.digest, policy_version: VIDEO_MODERATION_POLICY_VERSION, state: 'running', attempts: 2, attempt_id: randomUUID(), expires_at: '2020-01-01T00:00:00Z' };
  await store.setJSON('automatic-checks/' + id, lease);
  const options = { ...auth(alice), moderateVideo: async () => { calls++; return decision('pending'); } };
  assert.equal((await checkClip(check(id), store, options)).status, 202); assert.equal(calls, 1);
  const another = await submit(store); const otherClip = store.records.get('clips/' + another.id);
  await store.setJSON('automatic-checks/' + another.id, { ...lease, id: another.id, digest: otherClip.digest, attempts: 3 });
  assert.equal((await checkClip(check(another.id), store, options)).status, 202); assert.equal(calls, 1);
});

test('automatic approval with another digest or policy cannot expose a clip', async () => {
  const store = memoryStore(), account = profiles(), { id } = await submit(store);
  await checkClip(check(id), store, { ...auth(alice), moderateVideo: async () => decision() });
  const record = store.records.get('moderation/' + id); record.input_digest = 'f'.repeat(64);
  assert.deepEqual((await feed(store)).clips, []);
  assert.equal((await getClipVideo(get('/api/clip-video/' + id), store, account, signedOut)).status, 404);
  record.input_digest = store.records.get('clips/' + id).digest; record.policy_version = 'other';
  assert.deepEqual((await feed(store)).clips, []);
});
