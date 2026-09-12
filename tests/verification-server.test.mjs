import test from 'node:test';
import assert from 'node:assert/strict';
import { getVerification, updateVerification } from '../netlify/functions/_shared/member-verification.mts';
import { MemberError } from '../netlify/functions/_shared/member-auth.mts';

const origin = 'https://jwhitedidit.net';
const owner = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'J.White Did It', isOwner: true };
const team = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Team Member', isOwner: false };
const alice = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Alice', isOwner: false };
const bob = { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', name: 'Bob', isOwner: false };
const absentId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const options = (member = owner) => ({ resolveMember: async () => member });
function memoryStore() {
  const records = new Map();
  const reads = [];
  const writes = [];
  const prefixes = [];
  const tags = new Map();
  let version = 0;
  return {
    records, reads, writes, prefixes,
    async get(key) { reads.push(key); return structuredClone(records.get(key) ?? null); },
    async getWithMetadata(key) { reads.push(key); return records.has(key) ? { data: structuredClone(records.get(key)), etag: tags.get(key), metadata: {} } : null; },
    async setJSON(key, value, opts = {}) {
      if ((opts.onlyIfNew && records.has(key)) || (opts.onlyIfMatch !== undefined && tags.get(key) !== opts.onlyIfMatch)) return { modified: false };
      records.set(key, structuredClone(value));
      tags.set(key, 'etag-' + ++version);
      writes.push(key);
      return { modified: true };
    },
    async *list({ prefix, paginate }) {
      assert.equal(paginate, true);
      prefixes.push(prefix);
      const keys = [...records.keys()].filter(key => key.startsWith(prefix)).reverse();
      for (let i = 0; i < keys.length; i += 2) yield { blobs: keys.slice(i, i + 2).map(key => ({ key })) };
    },
  };
}
async function fixture({ bindOwner = true } = {}) {
  const profiles = memoryStore();
  const directory = memoryStore();
  if (bindOwner) await profiles.setJSON('owner-binding', { id: owner.id });
  for (const member of [owner, team, alice, bob]) await directory.setJSON('members/' + member.id, { id: member.id, name: member.name, email: 'private@example.test', token: 'private-token' });
  return { profiles, directory };
}
function getRequest(query = '', headers = {}) { return new Request(origin + '/api/verification' + query, { headers }); }
function postRequest(input = {}, { headers = {}, body, query = '' } = {}) {
  return new Request(origin + '/api/verification/update' + query, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...headers }, body: body ?? JSON.stringify({ member_id: alice.id, action: 'verify', ...input }) });
}
const get = (stores, member = owner, req = getRequest()) => getVerification(req, stores.profiles, stores.directory, options(member));
const update = (stores, member = owner, input = {}, req = postRequest(input)) => updateVerification(req, stores.profiles, stores.directory, options(member));
const listed = async (stores, member = owner) => (await get(stores, member)).json();


test('owner can review the member directory without exposing private account data', async () => {
  const stores = await fixture();
  const response = await get(stores);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.can_manage_team, true);
  assert.ok(result.members.some(member => member.id === alice.id));
  assert.ok(result.members.every(member => Object.keys(member).sort().join(',') === 'can_verify,id,name,verified'));
  assert.ok(!JSON.stringify(result).includes('private@example.test'));
  assert.ok(!JSON.stringify(result).includes('private-token'));
  assert.ok(stores.directory.prefixes.every(prefix => prefix === 'members/'));
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('netlify-cdn-cache-control'), 'no-store');
});

test('ordinary and unauthenticated members cannot gain authority through claimed roles or query fields', async () => {
  const stores = await fixture();
  const forged = { ...alice, is_admin: true, can_verify: true, can_manage_team: true, roles: ['owner', 'admin'] };
  assert.equal((await get(stores, forged, getRequest('?owner=true&member_id=' + owner.id))).status, 403);
  const before = structuredClone([...stores.profiles.records]);
  assert.equal((await update(stores, forged, {}, postRequest({ can_verify: true, isOwner: true, actor_id: owner.id }, { query: '?isOwner=true' }))).status, 403);
  const denied = { resolveMember: async () => { throw new MemberError(401, 'Please log in.'); } };
  assert.equal((await getVerification(getRequest(), stores.profiles, stores.directory, denied)).status, 401);
  assert.equal((await updateVerification(postRequest(), stores.profiles, stores.directory, denied)).status, 401);
  assert.deepEqual([...stores.profiles.records], before);
});

test('only the bound owner can manage the team and an unbound verified owner is allowed', async () => {
  const stores = await fixture();
  const forgedOwner = { ...alice, isOwner: true };
  assert.equal((await get(stores, forgedOwner)).status, 403);
  assert.equal((await update(stores, forgedOwner, { member_id: team.id, action: 'grant_team' })).status, 403);
  assert.equal(stores.profiles.records.has('verification-team/' + team.id), false);
  const unbound = await fixture({ bindOwner: false });
  assert.equal((await get(unbound, owner)).status, 200);
  assert.equal((await update(unbound, owner, { member_id: team.id, action: 'grant_team' })).status, 200);
  assert.equal(unbound.profiles.records.get('verification-team/' + team.id).can_verify, true);
});

test('owner can grant verification and revoke it using separate per member records', async () => {
  const stores = await fixture();
  assert.equal((await update(stores, owner, { member_id: alice.id, action: 'verify' })).status, 200);
  assert.equal(stores.profiles.records.get('verifications/' + alice.id).verified, true);
  assert.equal((await listed(stores)).members.find(member => member.id === alice.id).verified, true);
  assert.equal((await update(stores, owner, { member_id: bob.id, action: 'verify' })).status, 200);
  assert.equal((await update(stores, owner, { member_id: alice.id, action: 'unverify' })).status, 200);
  const members = (await listed(stores)).members;
  assert.equal(members.find(member => member.id === alice.id).verified, false);
  assert.equal(members.find(member => member.id === bob.id).verified, true);
});

test('delegated team members can verify but cannot delegate their authority', async () => {
  const stores = await fixture();
  assert.equal((await update(stores, owner, { member_id: team.id, action: 'grant_team' })).status, 200);
  const view = await listed(stores, team);
  assert.equal(view.can_manage_team, false);
  assert.equal(view.members.find(member => member.id === team.id).can_verify, true);
  assert.equal((await update(stores, team, { member_id: alice.id, action: 'verify' })).status, 200);
  assert.equal((await update(stores, team, { member_id: alice.id, action: 'unverify' })).status, 200);
  for (const action of ['grant_team', 'revoke_team']) assert.equal((await update(stores, team, { member_id: bob.id, action })).status, 403);
  assert.equal(stores.profiles.records.has('verification-team/' + bob.id), false);
});

test('team revocation takes effect on the very next request', async () => {
  const stores = await fixture();
  await update(stores, owner, { member_id: team.id, action: 'grant_team' });
  assert.equal((await get(stores, team)).status, 200);
  assert.equal((await update(stores, owner, { member_id: team.id, action: 'revoke_team' })).status, 200);
  assert.equal((await get(stores, team)).status, 403);
  assert.equal((await update(stores, team, { member_id: alice.id, action: 'verify' })).status, 403);
  assert.equal(stores.profiles.records.has('verifications/' + alice.id), false);
});

test('owner gold verification and owner authority cannot be altered by team actions', async () => {
  const stores = await fixture();
  await update(stores, owner, { member_id: team.id, action: 'grant_team' });
  const binding = structuredClone(stores.profiles.records.get('owner-binding'));
  for (const actor of [owner, team]) {
    for (const action of ['verify', 'unverify', 'grant_team', 'revoke_team']) {
      const response = await update(stores, actor, { member_id: owner.id, action });
      assert.equal(response.status, 403);
    }
  }
  assert.deepEqual(stores.profiles.records.get('owner-binding'), binding);
  assert.equal(stores.profiles.records.has('verifications/' + owner.id), false);
  assert.equal(stores.profiles.records.has('verification-team/' + owner.id), false);
});

test('invalid targets and actions cannot select arbitrary storage keys', async () => {
  const stores = await fixture();
  const before = structuredClone([...stores.profiles.records]);
  const cases = [
    [postRequest({ member_id: '../../owner-binding' }), 400],
    [postRequest({ member_id: 'owner' }), 400],
    [postRequest({ member_id: absentId }), 404],
    [postRequest({ action: 'make_owner' }), 400],
    [postRequest({ member_id: [alice.id] }), 400],
    [postRequest({ action: ['verify'] }), 400],
    [postRequest({}, { body: '{invalid' }), 400],
    [postRequest({}, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'member_id=' + alice.id + '&action=verify' }), 415],
  ];
  for (const [req, expected] of cases) assert.equal((await update(stores, owner, {}, req)).status, expected);
  assert.deepEqual([...stores.profiles.records], before);
});

test('missing Origin and cross site updates are rejected without changing authority or verification', async () => {
  const stores = await fixture();
  const absent = postRequest();
  absent.headers.delete('Origin');
  const before = structuredClone([...stores.profiles.records]);
  for (const req of [absent, postRequest({}, { headers: { Origin: 'https://evil.example' } }), postRequest({}, { headers: { 'Sec-Fetch-Site': 'cross-site' } })]) {
    assert.equal((await update(stores, owner, {}, req)).status, 403);
  }
  assert.deepEqual([...stores.profiles.records], before);
});

test('corrupted stored role records never grant verification authority', async () => {
  for (const record of [{ id: bob.id, can_verify: true }, { id: team.id, can_verify: 'true' }, { id: team.id, verified: true }]) {
    const stores = await fixture();
    await stores.profiles.setJSON('verification-team/' + team.id, record);
    assert.equal((await get(stores, team)).status, 403);
    assert.equal((await update(stores, team)).status, 403);
    assert.equal(stores.profiles.records.has('verifications/' + alice.id), false);
  }
});

test('storage failures report no success and do not reveal infrastructure details', async () => {
  const stores = await fixture();
  stores.profiles.setJSON = async () => { throw new Error('private storage credential'); };
  const response = await update(stores);
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes('private storage credential'));
  assert.equal(stores.profiles.records.has('verifications/' + alice.id), false);
  stores.directory.list = async function* () { throw new Error('private directory credential'); };
  const read = await get(stores);
  assert.equal(read.status, 503);
  assert.ok(!(await read.text()).includes('private directory credential'));
});
