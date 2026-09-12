import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {describe, test} from 'node:test';
import {getUser} from '@netlify/identity';
import {requireMember} from '../netlify/functions/_shared/member-auth.mts';
import {resolveProfileMember} from '../netlify/functions/_shared/member-profiles.mts';

const require = createRequire(import.meta.url);
const clients = [['ES module', getUser], ['CommonJS', require('@netlify/identity').getUser]];
const identityURL = 'https://identity.example.test/.netlify/identity';
const ownerEmail = 'owner@example.test';
const ownerID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const userToken = 'fictional-member-session';
const operatorToken = 'fictional-operator-session';
const verifiedUser = {
  id: ownerID,
  email: ownerEmail,
  confirmed_at: '2026-09-05T12:00:00Z',
  user_metadata: {full_name: 'Fixture Owner'},
};
const claims = {sub: ownerID, email: ownerEmail, user_metadata: {full_name: 'Fixture Owner'}};

// Each test runs in this isolated test process and restores the runtime fixtures.
// The application never assigns globals or receives these fictional credentials.
function runtime(t, {cookie = userToken, identityClaims = claims, responseUser = verifiedUser, validCookie = true, unavailable = false} = {}) {
  for (const [name, value] of [
    ['Netlify', {context: {url: new URL(identityURL), cookies: {get: key => key === 'nf_jwt' ? cookie : undefined}}}],
    ['netlifyIdentityContext', {url: identityURL, token: operatorToken, user: identityClaims}],
  ]) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {value, configurable: true, writable: true});
    t.after(() => previous ? Object.defineProperty(globalThis, name, previous) : delete globalThis[name]);
  }
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const usesCookie = options?.headers?.Authorization === `Bearer ${userToken}`;
    const expectedEndpoint = String(url) === `${identityURL}/user`;
    requests.push({usesCookie, expectedEndpoint});
    if (unavailable) return Response.json({error:'Temporarily unavailable'}, {status:503});
    return usesCookie && validCookie && expectedEndpoint
      ? Response.json(responseUser)
      : Response.json({error: 'Unauthorized'}, {status: 401});
  });
  return requests;
}

for (const [format, loadUser] of clients) {
  describe(`Identity server session through the actual ${format} SDK`, {concurrency: false}, () => {
    test('the member cookie wins over a distinct runtime operator token', async t => {
      const requests = runtime(t);
      const user = await loadUser();
      assert.equal(user.id, ownerID);
      assert.equal(user.confirmedAt, verifiedUser.confirmed_at);
      assert.equal(requests.length, 1);
      assert.ok(requests.every(request => request.usesCookie && request.expectedEndpoint));
    });

    test('a full user verified by Identity passes the backend member and owner gates', async t => {
      runtime(t);
      assert.deepEqual(await requireMember(loadUser), {id: ownerID, name: 'Fixture Owner'});
      const owner = await resolveProfileMember(loadUser, ownerEmail);
      assert.equal(owner.isOwner, true);
      assert.equal(owner.id, ownerID);
    });

    test('temporary Identity failures stay unavailable instead of becoming a false sign-out', async t => {
      runtime(t, {unavailable:true});
      await assert.rejects(loadUser, /temporarily unavailable/i);
      await assert.rejects(requireMember(loadUser), error => error.status !== 401 && error.status !== 403);
    });

    test('an invalid cookie cannot gain access from platform claims', async t => {
      runtime(t, {validCookie: false, identityClaims: {...claims, confirmed_at: verifiedUser.confirmed_at, confirmedAt: verifiedUser.confirmed_at}});
      const fallback = await loadUser();
      assert.equal(fallback.id, ownerID);
      assert.equal(fallback.confirmedAt, undefined);
      await assert.rejects(requireMember(loadUser), {status: 403});
      await assert.rejects(resolveProfileMember(loadUser, ownerEmail), {status: 403});
    });

    test('an operator token and claims without a member cookie cannot grant member access', async t => {
      const requests = runtime(t, {cookie: null});
      assert.equal(await loadUser(), null);
      await assert.rejects(requireMember(loadUser), {status: 401});
      assert.equal(requests.length, 0, 'a guest must not send the runtime operator credential to Identity');
    });

    for (const cookie of [null, '']) test(`a guest with ${cookie === null ? 'no' : 'an empty'} cookie remains signed out during an operator service outage`, async t => {
      const requests = runtime(t, {cookie, unavailable:true});
      assert.equal(await loadUser(), null);
      await assert.rejects(requireMember(loadUser), {status:401});
      await assert.rejects(resolveProfileMember(loadUser, ownerEmail), {status:401});
      assert.equal(requests.length, 0, 'there is no authenticated session to validate');
    });

    test('an ordinary verified member cannot claim owner access through name, roles or metadata', async t => {
      runtime(t, {responseUser: {
        ...verifiedUser,
        email: 'visitor@example.test',
        user_metadata: {full_name: 'J.White Did It', isOwner: true, email: ownerEmail},
        app_metadata: {roles: ['admin', 'owner']},
      }});
      const ordinary = await resolveProfileMember(loadUser, ownerEmail);
      assert.equal(ordinary.id, ownerID);
      assert.equal(ordinary.isOwner, false);
    });
  });
}
