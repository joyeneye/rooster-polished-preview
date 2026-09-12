import test from 'node:test';
import assert from 'node:assert/strict';
import {handleProfileGet, handleProfileMe} from '../netlify/functions/_shared/profile-endpoint-handlers.mts';

const member = {id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name:'Alice', isOwner:false};
const request = path => new Request('https://jwhitedidit.net' + path);
const failure = error => Response.json({error:error instanceof Error ? error.message : 'failed'}, {status:503});

test('own-profile response does not wait for optional aftercare', async () => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let scheduled;
  const expected = Response.json({profile:{id:member.id}});
  const response = await handleProfileMe(request('/api/profile/me'), {
    waitUntil(work) { scheduled = work; },
  }, {
    resolveMember: async () => member,
    readProfile: async () => expected,
    aftercare: [async () => held, async () => { throw new Error('optional failure'); }],
    failure,
  });
  assert.equal(response, expected);
  assert.ok(scheduled instanceof Promise);
  let finished = false;
  scheduled.then(() => { finished = true; });
  await Promise.resolve();
  assert.equal(finished, false, 'navigation must finish while aftercare is still pending');
  release();
  await scheduled;
  assert.equal(finished, true);
});

test('own-profile gate failures preserve their mapped status and skip storage', async () => {
  for (const status of [401, 403, 503]) {
    let reads = 0;
    const response = await handleProfileMe(request('/api/profile/me'), {waitUntil() {}}, {
      resolveMember: async () => { const error = new Error('gate'); error.status = status; throw error; },
      readProfile: async () => { reads += 1; return Response.json({}); },
      failure: error => Response.json({error:'mapped'}, {status:error.status || 503}),
    });
    assert.equal(response.status, status);
    assert.equal(reads, 0);
  }
});

test('non-OK own-profile responses do not schedule aftercare', async () => {
  let scheduled = 0;
  const expected = Response.json({error:'unavailable'}, {status:503});
  const response = await handleProfileMe(request('/api/profile/me'), {
    waitUntil() { scheduled += 1; },
  }, {
    resolveMember: async () => member,
    readProfile: async () => expected,
    aftercare: [async () => {}],
    failure,
  });
  assert.equal(response, expected);
  assert.equal(scheduled, 0);
});

test('own-profile response survives a scheduler failure', async () => {
  let ran = false;
  const expected = Response.json({profile:{id:member.id}});
  const response = await handleProfileMe(request('/api/profile/me'), {
    waitUntil() { throw new Error('scheduler unavailable'); },
  }, {
    resolveMember: async () => member,
    readProfile: async () => expected,
    aftercare: [async () => { ran = true; }],
    failure,
  });
  assert.equal(response, expected);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(ran, true);
});

test('public owner profile skips the member gate', async () => {
  let gates = 0;
  const expected = Response.json({profile:{id:'owner'}});
  const response = await handleProfileGet(request('/api/profile?id=owner'), {
    authorizeMember: async () => { gates += 1; },
    readProfile: async () => expected,
    accessFailure: failure,
    profileFailure: failure,
  });
  assert.equal(response, expected);
  assert.equal(gates, 0);
});

test('only one exact owner alias is public', async () => {
  for (const path of [
    '/api/profile',
    '/api/profile?id=OWNER',
    '/api/profile?id=not-a-profile',
    '/api/profile?id=owner&id=owner',
    '/api/profile?id=' + member.id,
  ]) {
    let gates = 0;
    await handleProfileGet(request(path), {
      authorizeMember: async () => { gates += 1; },
      readProfile: async () => Response.json({}),
      accessFailure: failure,
      profileFailure: failure,
    });
    assert.equal(gates, 1, path);
  }
});

test('member profile is read only after its gate succeeds', async () => {
  const calls = [];
  const expected = Response.json({profile:{id:member.id}});
  const response = await handleProfileGet(request('/api/profile?id=' + member.id), {
    authorizeMember: async () => { calls.push('gate'); },
    readProfile: async () => { calls.push('read'); return expected; },
    accessFailure: failure,
    profileFailure: failure,
  });
  assert.equal(response, expected);
  assert.deepEqual(calls, ['gate','read']);
});

test('duplicate owner ids do not bypass the member gate', async () => {
  let reads = 0;
  const response = await handleProfileGet(request('/api/profile?id=owner&id=' + member.id), {
    authorizeMember: async () => { const error = new Error('invite required'); error.status = 403; throw error; },
    readProfile: async () => { reads += 1; return Response.json({}); },
    accessFailure: error => Response.json({error:error.message}, {status:error.status}),
    profileFailure: failure,
  });
  assert.equal(response.status, 403);
  assert.equal(reads, 0);
});

test('a denied member profile never reaches profile storage', async () => {
  let reads = 0;
  const response = await handleProfileGet(request('/api/profile?id=' + member.id), {
    authorizeMember: async () => { const error = new Error('invite required'); error.status = 403; throw error; },
    readProfile: async () => { reads += 1; return Response.json({}); },
    accessFailure: error => Response.json({error:error.message}, {status:error.status}),
    profileFailure: failure,
  });
  assert.equal(response.status, 403);
  assert.equal(reads, 0);
});

test('an access database failure stays closed and never reads a member profile', async () => {
  let reads = 0;
  const response = await handleProfileGet(request('/api/profile?id=' + member.id), {
    authorizeMember: async () => { const error = new Error('database unavailable'); error.status = 503; throw error; },
    readProfile: async () => { reads += 1; return Response.json({}); },
    accessFailure: error => Response.json({error:'try again'}, {status:error.status}),
    profileFailure: failure,
  });
  assert.equal(response.status, 503);
  assert.equal(reads, 0);
});
