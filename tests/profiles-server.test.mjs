import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { getPublicProfile, getOwnProfile, updateProfile, getProfilePhoto, resolveProfileMember } from '../netlify/functions/_shared/member-profiles.mts';
import { POLICY_VERSION } from '../netlify/functions/_shared/comment-moderation.mts';

const origin = 'https://jwhitedidit.net';
const alice = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Alice', isOwner: false };
const bob = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Bob', isOwner: false };
const owner = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'J.White Did It', isOwner: true };
const verdict = status => ({ status, reason: status === 'approved' ? 'positive_or_respectful' : status === 'rejected' ? 'negative_or_abusive' : 'uncertain', policy_version: POLICY_VERSION, checked_at: '2026-09-05T12:00:00Z' });
const options = (member = alice, status = 'approved') => ({ resolveMember: async () => member, moderate: async () => verdict(status) });
const photoBytes = await readFile(new URL('../profile.jpg', import.meta.url));

function memoryStore() {
  const records = new Map();
  const metadata = new Map();
  const tags = new Map();
  let version = 0;
  const writes = [];
  const read = key => structuredClone(records.get(key) ?? null);
  const write = (key, value, opts = {}) => {
    if ((opts.onlyIfNew && records.has(key)) || (opts.onlyIfMatch !== undefined && opts.onlyIfMatch !== tags.get(key))) return { modified: false };
    records.set(key, structuredClone(value));
    if (opts.metadata) metadata.set(key, structuredClone(opts.metadata));
    const etag = 'etag-' + (++version);
    tags.set(key, etag);
    writes.push(key);
    return { modified: true, etag };
  };
  return {
    records, metadata, tags, writes,
    async get(key) { return read(key); },
    async getWithMetadata(key) { return records.has(key) ? { data: read(key), etag: tags.get(key), metadata: structuredClone(metadata.get(key) ?? {}) } : null; },
    async setJSON(key, value, opts) { return write(key, value, opts); },
    async set(key, value, opts) { return write(key, value, opts); },
  };
}
function getRequest(id = alice.id) { return new Request(origin + '/api/profile?id=' + encodeURIComponent(id)); }
function ownRequest() { return new Request(origin + '/api/profile/me'); }
function postRequest(fields = {}, photo = null, headers = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ status: 'More music on the way!', request_id: randomUUID(), ...fields })) form.set(key, String(value));
  if (photo) form.set('photo', new Blob([photo.bytes], { type: photo.type }), photo.name ?? 'portrait.jpg');
  return new Request(origin + '/api/profile/update', { method: 'POST', headers: { Origin: origin, ...headers }, body: form });
}
const jpeg = () => ({ bytes: photoBytes, type: 'image/jpeg' });
const ownProfile = async (store, member = alice) => (await getOwnProfile(ownRequest(), store, options(member))).json();
const publicProfile = async (store, id = alice.id) => (await getPublicProfile(getRequest(id), store)).json();

test('profile identity requires a verified account and owner access comes only from its verified email', async () => {
  await assert.rejects(resolveProfileMember(async () => null, 'owner@example.test'), { status: 401 });
  await assert.rejects(resolveProfileMember(async () => ({ ...alice, email: 'owner@example.test' }), 'owner@example.test'), { status: 403 });
  const verified = { ...alice, email: 'owner@example.test', confirmedAt: '2026-09-05' };
  assert.equal((await resolveProfileMember(async () => verified, 'owner@example.test')).isOwner, true);
  const invitedOwner = await resolveProfileMember(async () => ({ ...verified, name: undefined }), 'owner@example.test');
  assert.deepEqual(invitedOwner, { id: alice.id, name: 'J.White Did It', isOwner: true });
  const ordinary = await resolveProfileMember(async () => ({ ...verified, name: 'J.White Did It', email: 'visitor@example.test', isOwner: true, roles: ['admin'] }), 'owner@example.test');
  assert.equal(ordinary.isOwner, false);
  assert.equal(ordinary.id, alice.id);
  assert.ok(!JSON.stringify(ordinary).includes('@'));
});

test('new own profiles use safe defaults and public projections omit private account fields', async () => {
  const store = memoryStore();
  const mine = await ownProfile(store, { ...alice, email: 'private@example.test', token: 'secret-token' });
  assert.equal(mine.profile.status, 'MORE!');
  assert.equal(mine.profile.about_me, '');
  assert.equal(mine.profile.name, alice.name);
  assert.equal(mine.profile.photo_url, null);
  assert.equal(mine.can_edit_owner, false);
  const theirs = await ownProfile(store, owner);
  assert.equal(theirs.profile.photo_url, '/profile.jpg');
  assert.equal(theirs.can_edit_owner, true);
  const visible = await publicProfile(store, 'owner');
  assert.ok(!JSON.stringify([mine, theirs, visible]).includes('private@example.test'));
  assert.ok(!JSON.stringify([mine, theirs, visible]).includes('secret-token'));
});

test('profile updates ignore submitted identity and owner fields and modify only the authenticated member', async () => {
  const store = memoryStore();
  await updateProfile(postRequest({ status: 'Bob makes music.' }), store, options(bob));
  const before = structuredClone(store.records.get('profiles/' + bob.id));
  const response = await updateProfile(postRequest({ id: bob.id, member_id: bob.id, owner_id: owner.id, isOwner: 'true', is_owner: 'true', name: 'Impersonated owner', status: 'A new studio day.' }), store, options(alice));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.profile.name, alice.name);
  assert.equal(result.profile.status, 'A new studio day.');
  assert.equal(result.can_edit_owner, false);
  assert.deepEqual(store.records.get('profiles/' + bob.id), before);
  assert.equal(store.records.has('profiles/' + owner.id), false);
  assert.equal(store.records.has('owner-binding'), false);
});

test('the owner alias binding cannot be reassigned to a second account', async () => {
  const store = memoryStore();
  assert.equal((await updateProfile(postRequest({ status: 'MORE!' }), store, options(owner))).status, 200);
  assert.equal(store.records.get('owner-binding').id, owner.id);
  const before = structuredClone(store.records.get('owner-binding'));
  const response = await updateProfile(postRequest({ status: 'An attempted replacement.' }), store, options({ ...alice, isOwner: true }));
  assert.notEqual(response.status, 200);
  assert.deepEqual(store.records.get('owner-binding'), before);
});

test('owner verification is computed from verified identity and immutable binding, never names or submitted flags', async () => {
  const store = memoryStore();
  assert.equal((await publicProfile(store, 'owner')).profile.verified_owner, true);
  const impostor = { ...alice, name: 'J.White Did It' };
  const saved = await updateProfile(postRequest({ status: 'Hello music fans!', verified_owner: 'true', badge: 'verified' }), store, options(impostor));
  assert.equal((await saved.json()).profile.verified_owner, false);
  // Even an unrelated legacy field in storage must not become verification.
  store.records.get('profiles/' + alice.id).verified_owner = true;
  assert.equal((await publicProfile(store, alice.id)).profile.verified_owner, false);
  assert.equal((await ownProfile(store, impostor)).profile.verified_owner, false);
  const ownerUpdate = await updateProfile(postRequest({ status: 'MORE!' }), store, options(owner));
  assert.equal((await ownerUpdate.json()).profile.verified_owner, true);
  assert.equal((await publicProfile(store, 'owner')).profile.verified_owner, true);
  assert.equal((await publicProfile(store, owner.id)).profile.verified_owner, true);
  assert.equal((await ownProfile(store, owner)).profile.verified_owner, true);
  assert.equal((await ownProfile(store, { ...owner, isOwner: false })).profile.verified_owner, false);
});

test('member checks appear only from private verification records and disappear on revocation', async () => {
  const store = memoryStore();
  await updateProfile(postRequest({ status: 'More good music!', verified: 'true', can_verify: 'true' }), store, options(alice));
  store.records.get('profiles/' + alice.id).verified = true;
  assert.equal((await publicProfile(store, alice.id)).profile.verified, false);
  await store.setJSON('verifications/' + alice.id, { id: alice.id, verified: true });
  const checked = (await publicProfile(store, alice.id)).profile;
  assert.equal(checked.verified, true);
  assert.equal(checked.verified_owner, false);
  assert.equal((await ownProfile(store, alice)).profile.verified, true);
  const update = await updateProfile(postRequest({ status: 'Another studio day!' }), store, options(alice));
  assert.equal((await update.json()).profile.verified, true);
  await store.setJSON('verifications/' + alice.id, { id: alice.id, verified: false });
  assert.equal((await publicProfile(store, alice.id)).profile.verified, false);
});

test('pending and rejected moderation preserve the previous profile and never publish uploaded assets', async () => {
  for (const [status, expected] of [['pending', 202], ['rejected', 422]]) {
    const store = memoryStore();
    await updateProfile(postRequest({ status: 'A positive studio day.' }), store, options());
    const before = structuredClone(store.records.get('profiles/' + alice.id));
    let reviewed;
    const opts = { ...options(), moderate: async input => { reviewed = input; return verdict(status); } };
    const response = await updateProfile(postRequest({ status: 'Text being reviewed.' }, jpeg()), store, opts);
    assert.equal(response.status, expected);
    assert.equal(reviewed.name, alice.name);
    assert.equal(reviewed.message, 'Display name: Alice\n\nText being reviewed.');
    assert.deepEqual(store.records.get('profiles/' + alice.id), before);
    assert.equal([...store.records.keys()].some(key => key.startsWith('photo-public/')), false);
  }
});

test('missing Origin and cross origin updates cannot write or invoke moderation', async () => {
  const store = memoryStore();
  let calls = 0;
  const opts = { ...options(), moderate: async () => { calls++; return verdict('approved'); } };
  const absent = postRequest();
  absent.headers.delete('Origin');
  const requests = [absent, postRequest({}, null, { Origin: 'https://evil.example' }), postRequest({}, null, { 'Sec-Fetch-Site': 'cross-site' })];
  for (const request of requests) assert.equal((await updateProfile(request, store, opts)).status, 403);
  assert.equal(store.records.size, 0);
  assert.equal(calls, 0);
});

test('oversized status and invalid, oversized, or mismatched image uploads fail before publication', async () => {
  const invalidPhotos = [
    { bytes: '<svg onload="alert(1)"></svg>', type: 'image/svg+xml', name: 'bad.svg' },
    { bytes: '<html>not an image</html>', type: 'image/jpeg' },
    { bytes: photoBytes, type: 'image/png' },
    { bytes: new Uint8Array(9 * 1024 * 1024), type: 'image/jpeg' },
  ];
  for (const photo of invalidPhotos) {
    const store = memoryStore();
    let request = postRequest({}, photo);
    if (photo.bytes.byteLength > 4 * 1024 * 1024) {
      // A real request arrives as bytes. Materialize the local multipart encoder
      // before cancellation so Undici does not enqueue into its closed stream.
      const bytes = await request.arrayBuffer();
      request = new Request(request.url, { method: 'POST', headers: request.headers, body: bytes });
    }
    const response = await updateProfile(request, store, options());
    assert.ok(response.status >= 400 && response.status < 500, 'invalid photo must fail validation');
    assert.equal([...store.records.keys()].some(key => key.startsWith('profiles/') || key.startsWith('photo-public/')), false);
  }
  assert.equal((await updateProfile(postRequest({ status: 'x'.repeat(161) }), memoryStore(), options())).status, 400);
});

test('approved photos are available only after a committed public profile references them', async () => {
  const store = memoryStore();
  const hash = 'a'.repeat(64);
  await store.set('assets/' + hash, photoBytes.buffer.slice(photoBytes.byteOffset, photoBytes.byteOffset + photoBytes.byteLength), { metadata: { content_type: 'image/jpeg' } });
  const inaccessible = await getProfilePhoto(new Request(origin + '/api/profile-photo/' + hash), store);
  assert.equal(inaccessible.status, 404);
  await store.setJSON('photo-public/' + hash, { owner_id: alice.id });
  assert.equal((await getProfilePhoto(new Request(origin + '/api/profile-photo/' + hash), store)).status, 404);
  const result = await updateProfile(postRequest({}, jpeg()), store, options());
  assert.equal(result.status, 200);
  const { profile } = await result.json();
  assert.match(profile.photo_url, /^\/api\/profile-photo\/[a-f0-9]{64}$/);
  const response = await getProfilePhoto(new Request(origin + profile.photo_url), store);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/jpeg');
  assert.equal(Buffer.compare(Buffer.from(await response.arrayBuffer()), photoBytes), 0);
});

test('profile commit CAS conflicts report 409 and leave the previous public version intact', async () => {
  const store = memoryStore();
  await updateProfile(postRequest({ status: 'Original approved text.' }), store, options());
  const before = structuredClone(store.records.get('profiles/' + alice.id));
  const saved = store.setJSON.bind(store);
  store.setJSON = async (key, value, opts) => key.startsWith('profiles/') ? { modified: false } : saved(key, value, opts);
  const response = await updateProfile(postRequest({ status: 'Losing concurrent update.' }, jpeg()), store, options());
  assert.equal(response.status, 409);
  assert.deepEqual(store.records.get('profiles/' + alice.id), before);
  for (const key of store.records.keys()) {
    if (key.startsWith('photo-public/')) assert.equal((await getProfilePhoto(new Request(origin + '/api/profile-photo/' + key.split('/')[1]), store)).status, 404);
  }
});

test('storage and moderation failures never return a successful profile change or raw errors', async () => {
  const broken = memoryStore();
  broken.setJSON = async () => { throw new Error('private storage token'); };
  const write = await updateProfile(postRequest(), broken, options());
  assert.equal(write.status, 503);
  assert.ok(!(await write.text()).includes('private storage token'));
  const store = memoryStore();
  await updateProfile(postRequest({ status: 'Original approved text.' }), store, options());
  const before = structuredClone(store.records.get('profiles/' + alice.id));
  const response = await updateProfile(postRequest(), store, { ...options(), moderate: async () => { throw new Error('private model token'); } });
  assert.ok(response.status === 202 || response.status === 503);
  assert.ok(!(await response.text()).includes('private model token'));
  assert.deepEqual(store.records.get('profiles/' + alice.id), before);
});

test('public reads reject invalid IDs and never expose unreviewed legacy records', async () => {
  const store = memoryStore();
  await store.setJSON('profiles/' + alice.id, { id: alice.id, name: 'Unreviewed name', status: 'Unreviewed text', photo_url: '/private.jpg', email: 'private@example.test', isOwner: true });
  const response = await getPublicProfile(getRequest(alice.id), store);
  const body = await response.text();
  assert.ok(!body.includes('Unreviewed'));
  assert.ok(!body.includes('private@example.test'));
  assert.ok(!body.includes('/private.jpg'));
  assert.equal((await getPublicProfile(getRequest('../../owner-binding'), store)).status, 400);
});

test('unauthenticated profile reads and writes make no storage changes', async () => {
  const store = memoryStore();
  const opts = { ...options(), resolveMember: async () => resolveProfileMember(async () => null, 'owner@example.test') };
  assert.equal((await getOwnProfile(ownRequest(), store, opts)).status, 401);
  assert.equal((await updateProfile(postRequest({}, jpeg()), store, opts)).status, 401);
  assert.equal(store.records.size, 0);
});

test('identical retries are idempotent but stale requests cannot overwrite a newer approved profile', async () => {
  const store = memoryStore();
  let reviews = 0;
  const opts = { ...options(), moderate: async () => { reviews++; return verdict('approved'); } };
  const firstInput = { request_id: randomUUID(), status: 'First approved studio update.' };
  const firstResponse = await updateProfile(postRequest(firstInput, jpeg()), store, opts);
  assert.equal(firstResponse.status, 200);
  const first = await firstResponse.json();
  const committed = structuredClone(store.records.get('profiles/' + alice.id));
  const writeCount = store.writes.length;
  const retry = await updateProfile(postRequest(firstInput, jpeg()), store, opts);
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), first);
  assert.deepEqual(store.records.get('profiles/' + alice.id), committed);
  assert.equal(store.writes.length, writeCount);
  assert.equal(reviews, 1);

  const changedRetry = await updateProfile(postRequest({ ...firstInput, status: 'Changed payload with the same request ID.' }, jpeg()), store, opts);
  assert.equal(changedRetry.status, 409);
  assert.deepEqual(store.records.get('profiles/' + alice.id), committed);

  const newer = await updateProfile(postRequest({ status: 'A newer approved studio update.' }), store, opts);
  assert.equal(newer.status, 200);
  const latest = structuredClone(store.records.get('profiles/' + alice.id));
  const stale = await updateProfile(postRequest(firstInput, jpeg()), store, opts);
  assert.equal(stale.status, 409);
  assert.deepEqual(store.records.get('profiles/' + alice.id), latest);
  assert.equal((await publicProfile(store)).profile.status, 'A newer approved studio update.');
});

test('approved About Me is moderated with status and is preserved by legacy status-only saves', async () => {
  const store = memoryStore();
  const reviewed = [];
  const opts = { ...options(), moderate: async input => { reviewed.push(input); return verdict('approved'); } };
  const first = await updateProfile(postRequest({ status: 'Making records.', about_me: '  Keys, drums and great people.\nMore music soon.  ' }), store, opts);
  assert.equal(first.status, 200);
  assert.equal((await first.json()).profile.about_me, 'Keys, drums and great people.\nMore music soon.');
  assert.match(reviewed[0].message, /Making records\./);
  assert.match(reviewed[0].message, /Keys, drums and great people\.\nMore music soon\./);
  assert.equal((await ownProfile(store)).profile.about_me, 'Keys, drums and great people.\nMore music soon.');
  assert.equal((await publicProfile(store)).profile.about_me, 'Keys, drums and great people.\nMore music soon.');

  assert.equal((await updateProfile(postRequest({ status: 'In the studio.' }, jpeg()), store, opts)).status, 200);
  assert.equal((await publicProfile(store)).profile.about_me, 'Keys, drums and great people.\nMore music soon.');
  assert.match(reviewed.at(-1).message, /In the studio\./);
  assert.match(reviewed.at(-1).message, /Keys, drums and great people\./);

  assert.equal((await updateProfile(postRequest({ about_me: '' }), store, opts)).status, 200);
  assert.equal((await publicProfile(store)).profile.about_me, '');
});

test('invalid or ambiguous About Me inputs fail before moderation or storage changes', async () => {
  const invalidRequests = [
    postRequest({ about_me: 'x'.repeat(601) }),
    postRequest({ about_me: 'Hidden\u0000control' }),
    postRequest({ about_me: 'Hidden\u001bcontrol' }),
    postRequest({ about_me: 'Hidden\u007fcontrol' }),
  ];
  for (const duplicate of [false, true]) {
    const form = new FormData();
    form.set('status', 'A positive status.');
    form.set('request_id', randomUUID());
    form.set('about_me', duplicate ? 'A real bio.' : new Blob(['bio'], { type: 'text/plain' }));
    if (duplicate) form.append('about_me', 'Another bio.');
    invalidRequests.push(new Request(origin + '/api/profile/update', { method: 'POST', headers: { Origin: origin }, body: form }));
  }
  for (const request of invalidRequests) {
    const store = memoryStore();
    let moderationCalls = 0;
    const response = await updateProfile(request, store, { ...options(), moderate: async () => { moderationCalls++; return verdict('approved'); } });
    assert.equal(response.status, 400);
    assert.equal(moderationCalls, 0);
    assert.equal(store.writes.length, 0);
  }
  const exactLimit = await updateProfile(postRequest({ about_me: 'x'.repeat(600) }), memoryStore(), options());
  assert.equal(exactLimit.status, 200);
});

test('pending or rejected About Me changes preserve the complete approved profile', async () => {
  for (const [decision, expected] of [['pending', 202], ['rejected', 422]]) {
    const store = memoryStore();
    await updateProfile(postRequest({ status: 'Approved status.', about_me: 'Approved bio.' }), store, options());
    const before = structuredClone(store.records.get('profiles/' + alice.id));
    let reviewed;
    const response = await updateProfile(postRequest({ status: 'A friendly status.', about_me: 'Text that fails review.' }), store, {
      ...options(), moderate: async input => { reviewed = input; return verdict(decision); },
    });
    assert.equal(response.status, expected);
    assert.match(reviewed.message, /Text that fails review\./);
    assert.deepEqual(store.records.get('profiles/' + alice.id), before);
    assert.equal((await publicProfile(store)).profile.about_me, 'Approved bio.');
  }
});

test('idempotency binds About Me and cannot reuse an approved request to replace the bio', async () => {
  const store = memoryStore();
  let moderationCalls = 0;
  const opts = { ...options(), moderate: async () => { moderationCalls++; return verdict('approved'); } };
  const fields = { request_id: randomUUID(), status: 'Same status.', about_me: 'First approved bio.' };
  const original = await updateProfile(postRequest(fields), store, opts);
  assert.equal(original.status, 200);
  const result = await original.json();
  const writes = store.writes.length;
  const retry = await updateProfile(postRequest(fields), store, opts);
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), result);
  assert.equal(store.writes.length, writes);
  for (const replacement of ['Unreviewed replacement.', '']) {
    const altered = await updateProfile(postRequest({ ...fields, about_me: replacement }), store, opts);
    assert.equal(altered.status, 409);
  }
  assert.equal(moderationCalls, 1);
  assert.equal((await publicProfile(store)).profile.about_me, 'First approved bio.');
});

test('speaker, ministry and logistics are real saveable professions with unchanged profile ownership',async()=>{
 for(const profession of ['speaker','ministry','logistics']){
  const store=memoryStore();
  const response=await updateProfile(postRequest({profession,status:'Here to connect.'}),store,options(alice));
  assert.equal(response.status,200);assert.equal((await response.json()).profile.profession,profession);
  assert.equal((await ownProfile(store)).profile.profession,profession);
  assert.equal((await publicProfile(store)).profile.profession,profession);
  assert.equal(store.records.has('profiles/'+bob.id),false);
 }
});
