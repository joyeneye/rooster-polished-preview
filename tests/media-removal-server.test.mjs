import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { manageMedia, removeMedia, restoreMedia, purgeRemovedMedia, purgeExpiredMedia } from '../netlify/functions/_shared/media-removals.mts';
import { getAlbum, getAlbumPhoto, uploadAlbumPhoto } from '../netlify/functions/_shared/member-albums.mts';
import { getClips, getClipVideo, reviewClip, submitClip } from '../netlify/functions/_shared/member-clips.mts';
import { MEDIA_UNDO_MS } from '../netlify/functions/_shared/media-undo.mts';

const origin = 'https://jwhitedidit.net';
const alice = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Alice', isOwner: false };
const bob = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Bob', isOwner: false };
const owner = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'J.White Did It', isOwner: true };
const videoBytes = await readFile(new URL('./fixtures/short-clip.mp4', import.meta.url));

function memory() {
  const data = new Map(), tags = new Map(); let version = 0;
  const write = (key, value, options = {}) => {
    if ((options.onlyIfNew && data.has(key)) || (options.onlyIfMatch !== undefined && options.onlyIfMatch !== tags.get(key))) return { modified: false };
    data.set(key, structuredClone(value)); tags.set(key, `etag-${++version}`); return { modified: true };
  };
  return { data,
    async get(key) { return structuredClone(data.get(key) ?? null); },
    async getWithMetadata(key) { return data.has(key) ? { data: structuredClone(data.get(key)), etag: tags.get(key) } : null; },
    async set(key, value, options) { return write(key, value, options); },
    async setJSON(key, value, options) { return write(key, value, options); },
    async delete(key) { data.delete(key); tags.delete(key); },
    async *list({ prefix }) { yield { blobs: [...data.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })) }; },
  };
}
function stores(boundOwner = owner) {
  const profiles = memory();
  profiles.data.set('owner-binding', { id: boundOwner.id });
  return { album: memory(), clips: memory(), profiles };
}
const auth = member => ({ resolveMember: async () => member });
const get = path => new Request(origin + path);
const post = (path, payload) => new Request(origin + path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
const keys = (store, prefix) => [...store.data.keys()].filter(key => key.startsWith(prefix));

async function addPhoto(store, caption = 'At the studio', member = alice, shade = '#44aa66') {
  const bytes = await sharp({ create: { width: 24, height: 24, channels: 3, background: shade } }).jpeg().toBuffer();
  const form = new FormData();
  form.set('photo', new Blob([bytes], { type: 'image/jpeg' }), 'test.jpg');
  form.set('caption', caption);
  const response = await uploadAlbumPhoto(new Request(origin + '/api/member-album/upload', { method: 'POST', headers: { Origin: origin }, body: form }), store, async () => member);
  assert.equal(response.status, 201, await response.clone().text());
  return (await response.json()).photo;
}
async function addVideo(all, member = alice, approve = true) {
  const form = new FormData();
  form.set('request_id', randomUUID());
  form.set('caption', 'A little studio inspiration');
  form.set('video', new Blob([videoBytes], { type: 'video/mp4' }), 'upload.mp4');
  const submitted = await submitClip(new Request(origin + '/api/clips', { method: 'POST', headers: { Origin: origin }, body: form }), all.clips, auth(member));
  assert.equal(submitted.status, 202, await submitted.clone().text());
  const { id } = await submitted.json();
  if (approve) {
    const reviewed = await reviewClip(post('/api/clips/review', { id, action: 'approve' }), all.clips, all.profiles, auth(owner));
    assert.equal(reviewed.status, 200, await reviewed.clone().text());
  }
  return id;
}
const album = (all, member = alice) => getAlbum(get('/api/member-album?member=' + member.id), all.album).then(r => r.json());
const feed = (all, member = alice) => getClips(get('/api/clips?member=' + member.id), all.clips).then(r => r.json());
const remove = (all, items, member = alice) => removeMedia(post('/api/media/remove', { items }), all, auth(member));
const restore = (all, items, member = alice) => restoreMedia(post('/api/media/restore', { items }), all, auth(member));
const age = (store, key) => {
  const record = store.data.get(key);
  store.data.set(key, { ...record, removed_at: new Date(Date.now() - MEDIA_UNDO_MS - 5000).toISOString() });
};

test('a removed photo leaves the album at once and undo puts it back with its caption and slot', async () => {
  const all = stores();
  const photo = await addPhoto(all.album, 'Studio night');
  assert.equal((await album(all)).total, 1);

  const response = await remove(all, [{ kind: 'photo', id: photo.id }]);
  assert.equal(response.status, 200, await response.clone().text());
  const removed = await response.json();
  assert.deepEqual(removed.failed, []);
  assert.deepEqual(removed.removed.map(item => [item.kind, item.id]), [['photo', photo.id]]);
  assert.ok(removed.undo_seconds > 0);
  // Gone from the gallery and from the photo URL, and it stays gone on refresh.
  assert.deepEqual((await album(all)).photos, []);
  assert.equal((await album(all)).total, 0);
  assert.equal((await getAlbumPhoto(get(photo.url), all.album)).status, 404);
  assert.deepEqual(keys(all.album, `slots/${alice.id}/`), []);

  const back = await restore(all, [{ kind: 'photo', id: photo.id }]);
  assert.equal(back.status, 200, await back.clone().text());
  const data = await album(all);
  assert.equal(data.total, 1);
  assert.equal(data.photos[0].id, photo.id);
  assert.equal(data.photos[0].caption, 'Studio night');
  assert.equal(data.photos[0].url, photo.url);
  assert.equal((await getAlbumPhoto(get(photo.url), all.album)).status, 200);
  assert.deepEqual(keys(all.album, 'trash/'), []);
});

test('once the undo time has passed the picture leaves storage and cannot come back', async () => {
  const all = stores();
  const photo = await addPhoto(all.album);
  await remove(all, [{ kind: 'photo', id: photo.id }]);
  assert.deepEqual(keys(all.album, `images/${alice.id}/`), [`images/${alice.id}/${photo.id}`]);

  age(all.album, `trash/${alice.id}/${photo.id}`);
  const swept = await purgeExpiredMedia(all);
  assert.equal(swept.photos, 1);
  assert.deepEqual(keys(all.album, `images/${alice.id}/`), []);
  assert.deepEqual(keys(all.album, `captions/${alice.id}/`), []);
  assert.deepEqual(keys(all.album, 'trash/'), []);

  const late = await restore(all, [{ kind: 'photo', id: photo.id }]);
  assert.equal(late.status, 404);
  assert.equal((await album(all)).total, 0);
});

test('a member cannot remove another member’s photo and the photo stays in the album', async () => {
  const all = stores();
  const photo = await addPhoto(all.album, 'Alice only');
  const response = await remove(all, [{ kind: 'photo', id: photo.id, member_id: alice.id }], bob);
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.deepEqual(body.removed, []);
  assert.match(body.failed[0].error, /only remove your own photos/i);
  assert.equal((await album(all)).total, 1);
});

test('the site owner can take down a member photo and a member video', async () => {
  const all = stores();
  const photo = await addPhoto(all.album, 'Not allowed here');
  const clip = await addVideo(all);
  assert.equal((await feed(all)).clips.length, 1);

  const response = await remove(all, [{ kind: 'photo', id: photo.id, member_id: alice.id }, { kind: 'video', id: clip }], owner);
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.deepEqual(body.failed, []);
  assert.equal(body.removed.length, 2);
  assert.equal((await album(all)).total, 0);
  assert.deepEqual((await feed(all)).clips, []);
});

test('a removed video leaves the video section and its URL, and undo republishes it', async () => {
  const all = stores();
  const clip = await addVideo(all);
  assert.equal((await getClipVideo(get('/api/clip-video/' + clip), all.clips, all.profiles, auth(alice))).status, 200);

  const response = await remove(all, [{ kind: 'video', id: clip }]);
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual((await feed(all)).clips, []);
  assert.equal((await getClipVideo(get('/api/clip-video/' + clip), all.clips, all.profiles, auth(alice))).status, 404);
  assert.deepEqual(keys(all.clips, 'published/'), []);
  assert.deepEqual(keys(all.clips, 'submitted/'), []);

  const back = await restore(all, [{ kind: 'video', id: clip }]);
  assert.equal(back.status, 200, await back.clone().text());
  assert.equal((await feed(all)).clips.length, 1);
  assert.equal((await getClipVideo(get('/api/clip-video/' + clip), all.clips, all.profiles, auth(alice))).status, 200);
  assert.deepEqual(keys(all.clips, 'trash/'), []);
});

test('a video removed for good leaves storage and frees the member’s review place', async () => {
  const all = stores();
  const clip = await addVideo(all, alice, false);
  assert.deepEqual(all.clips.data.get(`pending-members/${alice.id}`).ids, [clip]);

  await remove(all, [{ kind: 'video', id: clip }]);
  assert.deepEqual(keys(all.clips, 'videos/'), [`videos/${clip}/${(await all.clips.get('clips/' + clip)).digest}`]);

  age(all.clips, `trash/${clip}`);
  const purged = await purgeRemovedMedia(post('/api/media/purge', { items: [{ kind: 'video', id: clip }] }), all, auth(alice));
  assert.equal(purged.status, 200, await purged.clone().text());
  assert.equal((await purged.json()).purged, 1);
  assert.deepEqual(keys(all.clips, 'videos/'), []);
  assert.equal(all.clips.data.has('clips/' + clip), false);
  assert.equal(all.clips.data.has('moderation/' + clip), false);
  assert.deepEqual(all.clips.data.get(`pending-members/${alice.id}`).ids, []);
  assert.deepEqual(keys(all.clips, 'trash/'), []);
});

test('manage media lists the member’s own photos and videos and removes a whole selection', async () => {
  const all = stores();
  const first = await addPhoto(all.album, 'One', alice, '#44aa66');
  const second = await addPhoto(all.album, 'Two', alice, '#2255cc');
  const waiting = await addVideo(all, alice, false);
  const live = await addVideo(all, alice);

  const listed = await manageMedia(get('/api/media/manage'), all, auth(alice));
  assert.equal(listed.status, 200, await listed.clone().text());
  const data = await listed.json();
  assert.equal(data.member_id, alice.id);
  assert.equal(data.is_admin, false);
  assert.deepEqual(data.photos.map(photo => photo.kind), ['photo', 'photo']);
  assert.deepEqual([...data.photos.map(photo => photo.id)].sort(), [first.id, second.id].sort());
  assert.deepEqual(data.videos.map(video => video.status).sort(), ['approved', 'pending']);
  assert.ok(data.videos.every(video => video.kind === 'video' && video.member_id === alice.id));

  const response = await remove(all, [{ kind: 'photo', id: first.id }, { kind: 'photo', id: second.id }, { kind: 'video', id: live }, { kind: 'video', id: waiting }]);
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual((await response.json()).failed, []);
  const after = await (await manageMedia(get('/api/media/manage'), all, auth(alice))).json();
  assert.deepEqual(after.photos, []);
  assert.deepEqual(after.videos, []);
});

test('a member cannot list or manage another member’s media, and the owner can', async () => {
  const all = stores();
  await addPhoto(all.album, 'Alice only');
  assert.equal((await manageMedia(get('/api/media/manage?member=' + alice.id), all, auth(bob))).status, 403);
  const ownerView = await manageMedia(get('/api/media/manage?member=' + alice.id), all, auth(owner));
  assert.equal(ownerView.status, 200);
  const data = await ownerView.json();
  assert.equal(data.is_admin, true);
  assert.equal(data.photos.length, 1);
});

test('a selection reports each item on its own instead of failing as a whole', async () => {
  const all = stores();
  const mine = await addPhoto(all.album, 'Mine', bob);
  const theirs = await addPhoto(all.album, 'Theirs', alice);
  const response = await remove(all, [{ kind: 'photo', id: mine.id, member_id: bob.id }, { kind: 'photo', id: theirs.id, member_id: alice.id }], bob);
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.deepEqual(body.removed.map(item => item.id), [mine.id]);
  assert.deepEqual(body.failed.map(item => item.id), [theirs.id]);
  assert.equal((await album(all, bob)).total, 0);
  assert.equal((await album(all, alice)).total, 1);
});

test('removals need this site’s own page and a real selection', async () => {
  const all = stores();
  const photo = await addPhoto(all.album);
  const crossSite = new Request(origin + '/api/media/remove', { method: 'POST', headers: { Origin: 'https://example.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ kind: 'photo', id: photo.id }] }) });
  assert.equal((await removeMedia(crossSite, all, auth(alice))).status, 403);
  assert.equal((await removeMedia(post('/api/media/remove', { items: [] }), all, auth(alice))).status, 400);
  assert.equal((await removeMedia(post('/api/media/remove', { items: [{ kind: 'song', id: photo.id }] }), all, auth(alice))).status, 400);
  assert.equal((await removeMedia(post('/api/media/remove', { items: Array.from({ length: 21 }, () => ({ kind: 'photo', id: photo.id })) }), all, auth(alice))).status, 400);
  assert.equal((await album(all)).total, 1);
});
