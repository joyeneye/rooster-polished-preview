import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { getMemberMessages, sendMemberMessage, getMemberMessagePhoto, getMemberMessageVideo } from '../netlify/functions/_shared/member-messages.mts';
import { MemberError } from '../netlify/functions/_shared/member-auth.mts';
import { config } from '../netlify/functions/member-message-video.mts';

const alice = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Alice' };
const bob = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Bob' };
const chris = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Chris' };
const origin = 'https://jwhitedidit.net';
const auth = member => async () => member;
const clip = async (format = 'mp4') => new File([
  await readFile(new URL(`./fixtures/private-video.${format}`, import.meta.url)),
], 'my-private-location.' + format, { type: 'video/' + format });
const photo = async () => new File([
  await sharp({ create: { width: 24, height: 18, channels: 3, background: '#27699c' } }).jpeg().toBuffer(),
], 'picture.jpg', { type: 'image/jpeg' });

function memoryStore() {
  const records = new Map(), reads = [], writes = [];
  return {
    records, reads, writes,
    async *list({ prefix }) { yield { blobs: [...records.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })) }; },
    async get(key) { reads.push(key); return structuredClone(records.get(key) ?? null); },
    async setJSON(key, value, options = {}) {
      if (options.onlyIfNew && records.has(key)) return { modified: false };
      writes.push(key); records.set(key, structuredClone(value)); return { modified: true };
    },
    async set(key, value, options = {}) { return this.setJSON(key, value, options); },
  };
}
async function stores() {
  const store = { directory: memoryStore(), messages: memoryStore(), photos: memoryStore(), videos: memoryStore() };
  for (const member of [alice, bob, chris]) await store.directory.setJSON('members/' + member.id, member);
  return store;
}
function send(file, values = {}, extra = [], attachment = 'video') {
  const form = new FormData();
  for (const [key, value] of Object.entries({ recipient_id: bob.id, request_id: randomUUID(), subject: '', body: '', ...values })) form.append(key, value);
  if (file !== undefined) form.append(attachment, file);
  for (const [key, value] of extra) form.append(key, value);
  return new Request(origin + '/api/member-messages/send', { method: 'POST', headers: { Origin: origin }, body: form });
}
const videoRequest = (id, headers) => new Request(origin + '/api/member-message-video/' + id, { headers });
const inbox = async (store, member) => (await getMemberMessages(new Request(origin + '/api/member-messages'), store, auth(member))).json();

test('MP4 and WebM video-only messages expose only their validated private attachment metadata', async () => {
  for (const format of ['mp4', 'webm']) {
    const store = await stores();
    const response = await sendMemberMessage(send(await clip(format)), store, auth(alice));
    assert.equal(response.status, 201);
    const { message } = await response.json();
    assert.equal(message.subject, 'Video');
    assert.equal(message.body, '');
    assert.equal(message.photo, undefined);
    assert.equal(message.video.url, '/api/member-message-video/' + message.id);
    assert.equal(message.video.mime, 'video/' + format);
    assert.ok(message.video.width > 0 && message.video.width <= 1920);
    assert.ok(message.video.height > 0 && message.video.height <= 1920);
    assert.ok(message.video.duration > 0 && message.video.duration <= 30);
    assert.deepEqual(Object.keys(message.video).sort(), ['duration', 'height', 'mime', 'url', 'width']);
    assert.ok(!JSON.stringify(message).match(/my-private-location|video_digest|video_source_digest|videos\//));
    assert.deepEqual((await inbox(store, bob)).inbox, [message]);
    assert.deepEqual((await inbox(store, alice)).sent, [message]);
    assert.equal((await getMemberMessagePhoto(new Request(origin + '/api/member-message-photo/' + message.id), store, auth(alice))).status, 404);
  }
  assert.equal(config.path, '/api/member-message-video/:id');
});

test('private video access authenticates the two participants for every request and never caches bytes', async () => {
  const store = await stores(), file = await clip();
  const { message } = await (await sendMemberMessage(send(file), store, auth(alice))).json();
  const committedBytes = [...store.videos.records.values()][0];
  for (const member of [alice, bob]) {
    const response = await getMemberMessageVideo(videoRequest(message.id), store, auth(member));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'video/mp4');
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(response.headers.get('netlify-cdn-cache-control'), 'no-store');
    assert.equal(response.headers.get('cdn-cache-control'), 'no-store');
    assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.equal(response.headers.get('content-length'), String(file.size));
    assert.deepEqual(await response.arrayBuffer(), committedBytes);
  }
  for (const resolver of [auth(chris), async () => { throw new MemberError(401, 'Log in'); }]) {
    for (const Range of ['bytes=0-7', 'bytes=99999999-', 'bytes=malformed']) {
      const reads = store.videos.reads.length;
      const response = await getMemberMessageVideo(videoRequest(message.id, { Range }), store, resolver);
      assert.equal(response.status, 404);
      assert.equal(await response.text(), '{"error":"Video not found."}');
      assert.equal(store.videos.reads.length, reads);
    }
  }
});

test('authorized bounded byte ranges support mobile playback while invalid ranges remain private', async () => {
  const store = await stores(), file = await clip();
  const { message } = await (await sendMemberMessage(send(file), store, auth(alice))).json();
  const bytes = [...store.videos.records.values()][0];
  for (const [Range, start, end] of [
    ['bytes=0-15', 0, 15], ['bytes=-8', file.size - 8, file.size - 1],
    ['bytes=16-', 16, file.size - 1], ['bytes=1-9999999', 1, file.size - 1],
  ]) {
    const response = await getMemberMessageVideo(videoRequest(message.id, { Range }), store, auth(bob));
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), `bytes ${start}-${end}/${file.size}`);
    assert.equal(response.headers.get('content-length'), String(end - start + 1));
    assert.deepEqual(await response.arrayBuffer(), bytes.slice(start, end + 1));
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  }
  for (const Range of ['bytes=0-1,3-4', 'bytes=-', 'bytes=-0', 'bytes=9999999-', 'bytes=9-2', 'bytes=NaN-1']) {
    const response = await getMemberMessageVideo(videoRequest(message.id, { Range }), store, auth(bob));
    assert.equal(response.status, 416);
    assert.equal(response.headers.get('content-range'), `bytes */${file.size}`);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(await response.text(), '');
  }
});

test('one attachment, byte bounds and actual video validation are enforced before any write', async () => {
  const store = await stores(), video = await clip(), picture = await photo();
  for (const [request, status] of [
    [send(video, {}, [['photo', picture]]), 400],
    [send(video, {}, [['video', video]]), 400],
    [send('not a video'), 415],
    [send(picture), 415],
    [send(new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'large.mp4', { type: 'video/mp4' })), 413],
    [send(new File([], 'empty.mp4', { type: 'video/mp4' })), 413],
    [send(video, { body: 'x'.repeat(3001) }), 400],
  ]) assert.equal((await sendMemberMessage(request, store, auth(alice))).status, status);
  const overflow = new Request(origin + '/api/member-messages/send', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'multipart/form-data; boundary=test', 'Content-Length': '1' },
    body: new Uint8Array(4.25 * 1024 * 1024 + 1),
  });
  assert.equal((await sendMemberMessage(overflow, store, auth(alice))).status, 413);
  assert.equal(store.messages.records.size, 0);
  assert.equal(store.videos.records.size, 0);
  assert.equal(store.photos.records.size, 0);
});

test('retries cannot change video bytes, recipient, or attachment type and same bytes deliver only once', async () => {
  const store = await stores(), video = await clip(), values = { request_id: randomUUID(), subject: 'Hello', body: 'Our conversation.' };
  const first = await sendMemberMessage(send(video, values), store, auth(alice));
  const { message } = await first.json(), snapshot = [...store.videos.records.entries()];
  const repeated = await sendMemberMessage(send(video, values), store, auth(alice));
  assert.equal(repeated.status, 200);
  assert.deepEqual((await repeated.json()).message, message);
  for (const request of [
    send(await clip('webm'), values),
    send(video, { ...values, recipient_id: chris.id }),
    send(await photo(), values, [], 'photo'),
    send(undefined, values),
  ]) assert.equal((await sendMemberMessage(request, store, auth(alice))).status, 409);
  assert.deepEqual([...store.videos.records.entries()], snapshot);
  assert.equal(store.photos.records.size, 0);
  assert.equal((await inbox(store, bob)).inbox.length, 1);
  const photoValues = { ...values, request_id: randomUUID() };
  assert.equal((await sendMemberMessage(send(await photo(), photoValues, [], 'photo'), store, auth(alice))).status, 201);
  assert.equal((await sendMemberMessage(send(video, photoValues), store, auth(alice))).status, 409);
});

test('partial delivery and blob failures never expose a private video before a successful retry', async () => {
  for (const failurePoint of ['blob', 'index', 'commit']) {
    const store = await stores(), video = await clip(), values = { request_id: randomUUID() };
    const writeBlob = store.videos.set.bind(store.videos), writeMessage = store.messages.setJSON.bind(store.messages);
    if (failurePoint === 'blob') store.videos.set = async () => { throw new Error('temporary storage outage'); };
    else store.messages.setJSON = async (key, ...args) => {
      if (key.startsWith(failurePoint === 'index' ? 'inbox/' : 'delivered/')) throw new Error('temporary index outage');
      return writeMessage(key, ...args);
    };
    const response = await sendMemberMessage(send(video, values), store, auth(alice));
    assert.equal(response.status, 503);
    assert.ok(!(await response.text()).includes('outage'));
    const id = [...store.messages.records.values()].find(record => record.video).id;
    assert.deepEqual((await inbox(store, alice)).sent, []);
    assert.deepEqual((await inbox(store, bob)).inbox, []);
    for (const member of [alice, bob]) assert.equal((await getMemberMessageVideo(videoRequest(id), store, auth(member))).status, 404);
    assert.equal(store.videos.reads.length, 0);
    store.videos.set = writeBlob; store.messages.setJSON = writeMessage;
    assert.equal((await sendMemberMessage(send(video, values), store, auth(alice))).status, 200);
    assert.equal((await getMemberMessageVideo(videoRequest(id), store, auth(bob))).status, 200);
    assert.equal((await inbox(store, bob)).inbox.length, 1);
  }
});

test('bad stored metadata and corrupt private video bytes fail closed', async () => {
  const store = await stores();
  const { message } = await (await sendMemberMessage(send(await clip()), store, auth(alice))).json();
  const key = 'messages/' + message.id, saved = structuredClone(store.messages.records.get(key));
  for (const video of [
    { ...message.video, duration: 31 }, { ...message.video, width: 100000 },
    { ...message.video, url: 'https://other.example/private.mp4' }, { ...message.video, mime: 'text/html' },
  ]) {
    store.messages.records.set(key, { ...saved, video });
    const reads = store.videos.reads.length;
    assert.equal((await getMemberMessageVideo(videoRequest(message.id), store, auth(bob))).status, 404);
    assert.equal(store.videos.reads.length, reads);
  }
  store.messages.records.set(key, saved);
  const blobKey = [...store.videos.records.keys()][0];
  store.videos.records.set(blobKey, new Uint8Array([1, 2, 3]).buffer);
  assert.equal((await getMemberMessageVideo(videoRequest(message.id), store, auth(alice))).status, 404);
  assert.notEqual(createHash('sha256').update(new Uint8Array(store.videos.records.get(blobKey))).digest('hex'), saved.video_digest);
});
