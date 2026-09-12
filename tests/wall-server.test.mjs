import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { getComments, postComment as postWithModeration, originalComments, storageScope } from '../netlify/functions/_shared/comment-wall.mts';
import { config as getConfig } from '../netlify/functions/comments-get.mts';
import { config as postConfig } from '../netlify/functions/comments-post.mts';

const approval = { status: 'approved', reason: 'clearly_supportive', policy_version: 'positive-wall-v1', checked_at: '2026-09-05T00:00:00Z' };
const postComment = (req, store) => postWithModeration(req, store, async () => approval);

function memoryStore() {
  const records = new Map();
  return {
    records,
    async list({ prefix }) { return { blobs: [...records.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })) }; },
    async get(key) { return structuredClone(records.get(key) ?? null); },
    async setJSON(key, value, { onlyIfNew }) {
      if (onlyIfNew && records.has(key)) return { modified: false };
      records.set(key, structuredClone(value));
      return { modified: true };
    },
  };
}

function request(input = {}, options = {}) {
  return new Request('https://jwhitedidit.net/api/comments/post', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://jwhitedidit.net', ...options.headers },
    body: options.body ?? JSON.stringify({ name: 'Website test', message: 'Private local test.', request_id: randomUUID(), 'bot-field': '', ...input }),
  });
}

function getRequest(query = '') {
  return new Request(`https://jwhitedidit.net/api/comments${query}`);
}

test('a saved post is immediately available to an independent reader, with trimmed values', async () => {
  const store = memoryStore();
  const response = await postComment(request({ name: '  Alice  ', message: '  Hello wall!  ' }), store);
  assert.equal(response.status, 201);
  const { comment } = await response.json();
  assert.equal(comment.name, 'Alice');
  assert.equal(comment.message, 'Hello wall!');
  const read = await getComments(getRequest(), store);
  assert.equal(read.headers.get('cache-control'), 'no-store');
  const body = await read.json();
  assert.ok(body.comments.some(item => item.id === comment.id));
  assert.equal(body.total, originalComments().length + 1);
});

test('successful response waits for durable storage and storage failure never reports success', async () => {
  const store = memoryStore();
  const save = store.setJSON.bind(store);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  store.setJSON = async (...args) => { await gate; return save(...args); };
  let finished = false;
  const pending = postComment(request(), store).then(response => { finished = true; return response; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(finished, false);
  assert.equal(store.records.size, 0);
  release();
  assert.equal((await pending).status, 201);
  store.setJSON = async () => { throw new Error('private backend details'); };
  const failure = await postComment(request(), store);
  assert.equal(failure.status, 503);
  assert.ok(!(await failure.text()).includes('private backend details'));
});

test('concurrent different visitors retain every record', async () => {
  const store = memoryStore();
  const responses = await Promise.all(Array.from({ length: 30 }, (_, n) =>
    postComment(request({ name: `Visitor ${n}`, message: `Message ${n}` }), store)
  ));
  assert.ok(responses.every(response => response.status === 201));
  assert.equal(store.records.size, 30);
  assert.equal((await (await getComments(getRequest(), store)).json()).total, 32);
});

test('simultaneous retries return one original record and changed content cannot overwrite it', async () => {
  const store = memoryStore();
  const input = { name: 'Alice', message: 'An original comment.', request_id: randomUUID() };
  const responses = await Promise.all(Array.from({ length: 10 }, () => postComment(request(input), store)));
  const results = await Promise.all(responses.map(response => response.json()));
  assert.equal(store.records.size, 1);
  assert.ok(results.every(result => JSON.stringify(result) === JSON.stringify(results[0])));
  assert.equal(responses.filter(response => response.status === 201).length, 1);
  await postComment(request({ ...input, message: 'Different content.' }), store);
  assert.equal(store.records.size, 2);
  assert.ok([...store.records.values()].some(comment => comment.message === input.message));
});

test('invalid fields, cross-site posts, honeypots, malformed JSON and large payloads never write', async () => {
  const store = memoryStore();
  const cases = [
    [request({ name: ' ' }), 400],
    [request({ name: 'x'.repeat(61) }), 400],
    [request({ message: ' ' }), 400],
    [request({ message: 'x'.repeat(1001) }), 400],
    [request({ name: 'Null\u0000Name' }), 400],
    [request({ request_id: 'not-a-uuid' }), 400],
    [request({ 'bot-field': 'filled' }), 400],
    [request({}, { headers: { Origin: 'https://other.example' } }), 403],
    [request({}, { body: '{invalid' }), 400],
    [request({}, { body: '[]' }), 400],
    [request({}, { headers: { 'Content-Type': 'text/plain' } }), 415],
    [request({}, { body: 'x'.repeat(8193) }), 413],
    [request({}, { headers: { 'content-length': '99999' } }), 413],
  ];
  for (const [incoming, status] of cases) assert.equal((await postComment(incoming, store)).status, status);
  assert.equal(store.records.size, 0);
});

test('GET keeps original comments, sorts by date, and cannot expose extra stored fields via query parameters', async () => {
  const store = memoryStore();
  store.records.set('private/admin', { email: 'never-public@example.com' });
  store.records.set('comments/duplicate', { ...originalComments()[0], private_ip: '192.0.2.1' });
  store.records.set('comments/new', {
    id: 'new', name: 'Alice', message: '<img src=x onerror=alert(1)>',
    published_at: '2026-09-06T00:00:00Z', moderation: approval, email: 'private@example.com', token: 'private-token',
  });
  store.records.set('comments/invalid', { id: 'bad', name: 'Anon', message: 'bad date', published_at: 'oops' });
  const result = await getComments(getRequest('?prefix=private/&key=private/admin&fields=*'), store);
  const body = await result.json();
  assert.equal(body.total, 3);
  assert.equal(body.comments[0].id, 'new');
  assert.equal(body.comments[0].message, '<img src=x onerror=alert(1)>');
  assert.ok(body.comments.every(comment => Object.keys(comment).sort().join(',') === 'author_id,id,message,name,photo_url,profile_url,published_at,verified,verified_owner'));
  // Comments stored before member accounts existed stay unattached to any profile.
  assert.ok(body.comments.every(comment => comment.author_id === null && comment.profile_url === null && comment.photo_url === null && comment.verified === false));
  assert.ok(!JSON.stringify(body).includes('private'));
});

test('native HTML submission persists before redirecting to the wall', async () => {
  const store = memoryStore();
  const body = new URLSearchParams({ name: 'Alice', message: 'Hello without JavaScript!', 'bot-field': '' });
  const incoming = new Request('https://jwhitedidit.net/api/comments/post', {
    method: 'POST', body, headers: { Origin: 'https://jwhitedidit.net' },
  });
  const response = await postComment(incoming, store);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/#comments');
  assert.equal(store.records.size, 1);
});

test('read failure is visible instead of pretending that the wall has no posts', async () => {
  const store = memoryStore();
  store.list = async () => { throw new Error('internal details'); };
  const response = await getComments(getRequest(), store);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).comments, undefined);
});

test('production persists across deploys while drafts stay isolated; polling and writes use separate limited paths', () => {
  assert.equal(storageScope({ deploy: { context: 'production', id: 'p1' } }), 'site');
  for (const context of ['dev', 'deploy-preview', 'branch-deploy']) {
    assert.equal(storageScope({ deploy: { context, id: 'draft1' } }), 'deploy');
  }
  assert.notEqual(getConfig.path, postConfig.path);
  assert.equal(getConfig.method, 'GET');
  assert.equal(postConfig.method, 'POST');
  assert.equal(postConfig.rateLimit.windowLimit, 5);
  assert.equal(postConfig.rateLimit.windowSize, 60);
  assert.deepEqual(postConfig.rateLimit.aggregateBy, ['ip', 'domain']);
});


test('unapproved records including legacy, wrong policy, rejected and pending never reach public reads', async () => {
  const store = memoryStore();
  for (const [id, moderation] of [
    ['legacy', undefined], ['pending', {...approval, status: 'pending'}],
    ['rejected', {...approval, status: 'rejected'}], ['old', {...approval, policy_version: 'old'}],
  ]) store.records.set(`comments/${id}`, { id, name:'Visitor', message:'Unreviewed text', published_at:'2026-09-06T00:00:00Z', moderation });
  const data = await (await getComments(getRequest('?status=approved&include_pending=true'), store)).json();
  assert.equal(data.total, 2);
  assert.ok(!JSON.stringify(data).includes('Unreviewed'));
});

test('negative submissions cannot forge approval and rejected content is not echoed publicly', async () => {
  const store = memoryStore();
  const response = await postWithModeration(request({name:'Mean name', message:'Personal insult', moderation:approval, status:'approved'}), store,
    async input => { assert.equal(input.name, 'Mean name'); assert.equal(input.message, 'Personal insult'); return {...approval,status:'rejected',reason:'personal_attack'}; });
  assert.equal(response.status, 422);
  const data = await response.json();
  assert.equal(data.status, 'rejected');
  assert.equal(data.comment, undefined);
  assert.ok(!JSON.stringify(data).includes('Personal insult'));
  assert.equal([...store.records.values()][0].published_at, undefined);
  assert.equal((await (await getComments(getRequest(), store)).json()).total, 2);
});

test('unavailable or malformed moderation saves privately and never publishes', async () => {
  for (const moderate of [async()=>{throw new Error('secret upstream')}, async()=>null, async()=>({...approval,status:'allow'}), async()=>({...approval,policy_version:'old'})]) {
    const store = memoryStore();
    const response = await postWithModeration(request(), store, moderate);
    assert.equal(response.status,202);
    const data = await response.json();
    assert.equal(data.status,'pending'); assert.equal(data.comment,undefined);
    assert.ok(!JSON.stringify(data).includes('secret'));
    assert.equal((await (await getComments(getRequest(), store)).json()).total, 2);
  }
});

test('a legacy retry remains private and a rejected retry never gains approval', async () => {
  const store = memoryStore();
  const input = {request_id:randomUUID(),name:'Visitor',message:'Same content'};
  await postComment(request(input),store);
  const [key,value] = [...store.records][0];
  delete value.moderation;
  let calls=0;
  const response = await postWithModeration(request(input),store,async()=>{calls++;return approval;});
  assert.equal(response.status,202); assert.equal(calls,0);
  value.moderation={...approval,status:'rejected'};
  assert.equal((await postWithModeration(request(input),store,async()=>approval)).status,422);
});

test('native pending and rejected posts never announce that the comment is live',async()=>{
  for (const status of ['pending','rejected']) {
    const store=memoryStore();
    const incoming=new Request('https://jwhitedidit.net/api/comments/post',{method:'POST',body:new URLSearchParams({name:'Visitor',message:'Unapproved text'})});
    const response=await postWithModeration(incoming,store,async()=>({...approval,status}));
    assert.equal(response.status,status==='pending'?303:422);
    assert.equal(response.headers.get('location'),status==='pending'?'/comment-received.html':null);
    assert.equal((await (await getComments(getRequest(),store)).json()).total,2);
  }
});


test('read only moderation checks exercise decisions without storing or returning content', async()=>{
  for (const status of ['approved','pending','rejected']) {
    const store=memoryStore();
    store.get=async()=>{throw new Error('must not read queue')};
    const response=await postWithModeration(request({check_only:true}),store,async()=>({...approval,status}));
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{status,check_only:true,published:false});
    assert.equal(store.records.size,0);
  }
});
