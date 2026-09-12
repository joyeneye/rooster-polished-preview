import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { getMemberMessages, sendMemberMessage, getMemberMessagePhoto } from '../netlify/functions/_shared/member-messages.mts';
import { normalizeMessagePhoto } from '../netlify/functions/_shared/private-message-photos.mts';
import { MemberError } from '../netlify/functions/_shared/member-auth.mts';
import { config } from '../netlify/functions/member-message-photo.mts';

const alice = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Alice' };
const bob = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Bob' };
const chris = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Chris' };
const auth = member => async () => member;
const origin = 'https://jwhitedidit.net';
const bitmap = (background = '#1679aa', width = 32, height = 24) => sharp({ create: { width, height, channels: 3, background } });
const photo = async (format = 'jpeg', background) => new File([await bitmap(background)[format]().toBuffer()], 'private-location.jpg', { type: `image/${format}` });

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
  const store = { directory: memoryStore(), messages: memoryStore(), photos: memoryStore() };
  for (const member of [alice, bob, chris]) await store.directory.setJSON('members/' + member.id, member);
  return store;
}
function send(file, values = {}, extra = []) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ recipient_id: bob.id, request_id: randomUUID(), subject: '', body: '', ...values })) form.append(key, value);
  if (file !== undefined) form.append('photo', file);
  for (const [key, value] of extra) form.append(key, value);
  return new Request(origin + '/api/member-messages/send', { method: 'POST', headers: { Origin: origin }, body: form });
}
const imageRequest = id => new Request(origin + '/api/member-message-photo/' + id);
const inbox = async (store, member) => (await getMemberMessages(new Request(origin + '/api/member-messages'), store, auth(member))).json();

test('all allowed raster formats decode to a bounded metadata-free JPEG', async () => {
  for (const format of ['jpeg', 'png', 'webp']) {
    const output = await normalizeMessagePhoto(await photo(format));
    assert.equal(output.mime, 'image/jpeg');
    assert.deepEqual([output.width, output.height], [32, 24]);
    const metadata = await sharp(output.bytes).metadata();
    assert.equal(metadata.format, 'jpeg');
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.icc, undefined);
    assert.equal(output.digest, createHash('sha256').update(new Uint8Array(output.bytes)).digest('hex'));
  }
  const encoded = await bitmap('#1679aa', 2000, 1000).jpeg().withMetadata({ orientation: 6, exif: { IFD0: { Artist: 'Secret location and identity' } } }).toBuffer();
  const output = await normalizeMessagePhoto(new File([encoded], 'gps-photo.jpg', { type: 'image/jpeg' }));
  assert.deepEqual([output.width, output.height], [800, 1600]);
  assert.equal((await sharp(output.bytes).metadata()).exif, undefined);
  assert.ok(!Buffer.from(output.bytes).includes(Buffer.from('Secret location')));
});

test('nonraster, mislabeled, animated, malformed and appended files are rejected', async () => {
  const jpeg = Buffer.from(await (await photo()).arrayBuffer());
  const png = Buffer.from(await (await photo('png')).arrayBuffer());
  const webp = Buffer.from(await (await photo('webp')).arrayBuffer());
  const fakeAnimation = Buffer.from(webp);
  fakeAnimation.write('ANIM', 12);
  for (const file of [
    new File(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], 'photo.jpg', { type: 'image/jpeg' }),
    new File(['GIF89a'], 'photo.gif', { type: 'image/gif' }),
    new File([jpeg], 'photo.png', { type: 'image/png' }),
    new File([jpeg, '<html>trailing payload</html>'], 'photo.jpg', { type: 'image/jpeg' }),
    new File([png, 'payload'], 'photo.png', { type: 'image/png' }),
    new File([webp, 'payload'], 'photo.webp', { type: 'image/webp' }),
    new File([fakeAnimation], 'animated.webp', { type: 'image/webp' }),
    new File([jpeg.subarray(0, jpeg.length - 2)], 'broken.jpg', { type: 'image/jpeg' }),
    new File([png.subarray(0, png.length - 12)], 'broken.png', { type: 'image/png' }),
  ]) await assert.rejects(normalizeMessagePhoto(file), { status: 415 });
});

test('server enforces independent file byte, dimension and pixel bounds', async () => {
  await assert.rejects(normalizeMessagePhoto(new File([new Uint8Array(3 * 1024 * 1024 + 1)], 'large.jpg', { type: 'image/jpeg' })), { status: 413 });
  await assert.rejects(normalizeMessagePhoto(new File([], 'empty.jpg', { type: 'image/jpeg' })), { status: 413 });
  await assert.rejects(normalizeMessagePhoto('not a file'), { status: 415 });
  for (const [width, height] of [[4097, 1], [4001, 4000]]) {
    const bytes = await bitmap('#1679aa', width, height).png().toBuffer();
    await assert.rejects(normalizeMessagePhoto(new File([bytes], 'huge.png', { type: 'image/png' })), { status: 415 });
  }
});

test('a photo-only message is delivered with private metadata and no original filename or storage key', async () => {
  const store = await stores();
  const result = await sendMemberMessage(send(await photo()), store, auth(alice));
  assert.equal(result.status, 201);
  const { message } = await result.json();
  assert.equal(message.subject, 'Photo');
  assert.equal(message.body, '');
  assert.deepEqual(message.photo, { url: '/api/member-message-photo/' + message.id, mime: 'image/jpeg', width: 32, height: 24 });
  assert.deepEqual((await inbox(store, bob)).inbox, [message]);
  assert.deepEqual((await inbox(store, alice)).sent, [message]);
  assert.ok(!JSON.stringify(message).match(/private-location|photo_digest|source_digest|photos\//));
  for (const member of [alice, bob]) {
    const response = await getMemberMessagePhoto(imageRequest(message.id), store, auth(member));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/jpeg');
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(response.headers.get('netlify-cdn-cache-control'), 'no-store');
    assert.equal(response.headers.get('cdn-cache-control'), 'no-store');
    assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.equal((await sharp(await response.arrayBuffer()).metadata()).format, 'jpeg');
  }
  assert.equal(config.path, '/api/member-message-photo/:id');
});

test('anonymous, third party and cross-origin image requests cannot read any private photo bytes', async () => {
  const store = await stores();
  const { message } = await (await sendMemberMessage(send(await photo()), store, auth(alice))).json();
  for (const resolver of [async () => { throw new MemberError(401, 'Log in'); }, auth(chris)]) {
    const reads = store.photos.reads.length;
    const response = await getMemberMessagePhoto(imageRequest(message.id), store, resolver);
    assert.equal(response.status, 404);
    assert.equal(await response.text(), '{"error":"Photo not found."}');
    assert.equal(store.photos.reads.length, reads);
  }
  const foreign = new Request(origin + message.photo.url, { headers: { Origin: 'https://other.example' } });
  assert.equal((await getMemberMessagePhoto(foreign, store, auth(alice))).status, 404);
  const absent = await getMemberMessagePhoto(imageRequest('0'.repeat(64)), store, auth(bob));
  assert.equal(absent.status, 404);
});

test('multipart rejects duplicate photos or fields, and bounded reads do not trust Content-Length', async () => {
  const store = await stores();
  const file = await photo();
  for (const [request, expected] of [
    [send(file, {}, [['photo', file]]), 400],
    [send(file, {}, [['recipient_id', chris.id]]), 400],
    [send('fake file'), 415],
    [send(file, { body: 'x'.repeat(3001) }), 400],
    [send(file, { body: '\u0000bad' }), 400],
  ]) assert.equal((await sendMemberMessage(request, store, auth(alice))).status, expected);
  const overflow = new Request(origin + '/api/member-messages/send', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'multipart/form-data; boundary=test', 'Content-Length': '1' },
    body: new Uint8Array(4.25 * 1024 * 1024 + 1),
  });
  assert.equal((await sendMemberMessage(overflow, store, auth(alice))).status, 413);
  assert.equal(store.messages.records.size, 0);
  assert.equal(store.photos.records.size, 0);
});

test('retry preserves exact photo bytes and cannot replace an attachment or recipient', async () => {
  const store = await stores();
  const file = await photo(), request_id = randomUUID();
  const first = await sendMemberMessage(send(file, { request_id }), store, auth(alice));
  const { message } = await first.json();
  const snapshot = [...store.photos.records.entries()];
  const second = await sendMemberMessage(send(file, { request_id }), store, auth(alice));
  assert.equal(second.status, 200);
  assert.deepEqual((await second.json()).message, message);
  assert.equal((await sendMemberMessage(send(await photo('jpeg', '#cc2244'), { request_id }), store, auth(alice))).status, 409);
  assert.equal((await sendMemberMessage(send(file, { request_id, recipient_id: chris.id }), store, auth(alice))).status, 409);
  assert.deepEqual([...store.photos.records.entries()], snapshot);
  assert.equal((await inbox(store, bob)).inbox.length, 1);
});

test('even metadata-only changes cannot substitute different source bytes on a retry', async () => {
  const store = await stores();
  const image = await bitmap().jpeg().toBuffer();
  const files = await Promise.all(['First', 'Second'].map(async Artist => new File([
    await sharp(image).withExif({ IFD0: { Artist } }).jpeg().toBuffer(),
  ], 'photo.jpg', { type: 'image/jpeg' })));
  const outputs = await Promise.all(files.map(normalizeMessagePhoto));
  assert.equal(outputs[0].digest, outputs[1].digest);
  assert.notEqual(outputs[0].sourceDigest, outputs[1].sourceDigest);
  const request_id = randomUUID();
  assert.equal((await sendMemberMessage(send(files[0], { request_id }), store, auth(alice))).status, 201);
  assert.equal((await sendMemberMessage(send(files[1], { request_id }), store, auth(alice))).status, 409);
});

test('a failed private blob write stays invisible and retry safely completes delivery', async () => {
  const store = await stores();
  const file = await photo(), request_id = randomUUID();
  const write = store.photos.set.bind(store.photos);
  store.photos.set = async () => { throw new Error('internal outage details'); };
  const failure = await sendMemberMessage(send(file, { request_id }), store, auth(alice));
  assert.equal(failure.status, 503);
  assert.ok(!(await failure.text()).includes('outage'));
  const id = [...store.messages.records.values()][0].id;
  assert.deepEqual((await inbox(store, bob)).inbox, []);
  assert.equal((await getMemberMessagePhoto(imageRequest(id), store, auth(bob))).status, 404);
  assert.equal(store.photos.reads.length, 0);
  store.photos.set = write;
  assert.equal((await sendMemberMessage(send(file, { request_id }), store, auth(alice))).status, 200);
  assert.equal((await getMemberMessagePhoto(imageRequest(id), store, auth(bob))).status, 200);
});

test('index failures never expose uploaded bytes until the delivery commit is repaired', async () => {
  const store = await stores();
  const file = await photo(), request_id = randomUUID();
  const write = store.messages.setJSON.bind(store.messages);
  store.messages.setJSON = async (key, ...args) => {
    if (key.startsWith('inbox/')) throw new Error('index not available');
    return write(key, ...args);
  };
  assert.equal((await sendMemberMessage(send(file, { request_id }), store, auth(alice))).status, 503);
  assert.equal(store.photos.records.size, 1);
  const id = [...store.messages.records.values()].find(value => value.photo).id;
  assert.equal((await getMemberMessagePhoto(imageRequest(id), store, auth(alice))).status, 404);
  assert.equal(store.photos.reads.length, 0);
  store.messages.setJSON = write;
  assert.equal((await sendMemberMessage(send(file, { request_id }), store, auth(alice))).status, 200);
  assert.equal((await getMemberMessagePhoto(imageRequest(id), store, auth(alice))).status, 200);
});
