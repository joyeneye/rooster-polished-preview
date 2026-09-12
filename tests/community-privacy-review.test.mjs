import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { getChatMessages, postChatMessage } from '../netlify/functions/_shared/member-chat.mts';
import { POLICY_VERSION } from '../netlify/functions/_shared/comment-moderation.mts';

const alice = { id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name:'Alice' };
const bob = { id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name:'Bob' };
const auth = member => async () => member;
const decision = (status='approved', reason='positive_or_respectful') => ({ status, reason, policy_version:POLICY_VERSION, checked_at:'2026-09-05T12:00:00Z' });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve=done; }); return {promise,resolve}; };

function memoryStore() {
  const records = new Map();
  return {
    records,
    async *list({prefix}) { yield {blobs:[...records.keys()].filter(key=>key.startsWith(prefix)).map(key=>({key}))}; },
    async get(key) { return structuredClone(records.get(key) ?? null); },
    async setJSON(key,value,options={}) {
      if (options.onlyIfNew && records.has(key)) return {modified:false};
      records.set(key,structuredClone(value));return {modified:true};
    },
  };
}
function send(body, requestId=randomUUID(), extras={}) {
  return new Request('https://jwhitedidit.net/api/member-chat/send', {
    method:'POST', headers:{'Content-Type':'application/json',Origin:'https://jwhitedidit.net'},
    body:JSON.stringify({body,request_id:requestId,...extras}),
  });
}
const read = (store, member=alice) => getChatMessages(new Request('https://jwhitedidit.net/api/member-chat'),store,auth(member));

test('security review: concurrent changed chat retry cannot replace the winning body or author',async()=>{
  const store=memoryStore();const gate=deferred();const reached=deferred();const requestId=randomUUID();
  const first=postChatMessage(send('A respectful music question',requestId,{member_id:bob.id,name:'Administrator',moderation:decision()}),store,auth(alice),async input=>{
    assert.deepEqual(input,{name:'Alice',message:'A respectful music question'});reached.resolve();await gate.promise;return decision();
  });
  await reached.promise;
  const winner=await postChatMessage(send('A different respectful question',requestId),store,auth(alice),async()=>decision());
  assert.equal(winner.status,201);gate.resolve();assert.equal((await first).status,409);
  const data=await (await read(store,bob)).json();
  assert.equal(data.messages.length,1);assert.equal(data.messages[0].body,'A different respectful question');
  assert.equal(data.messages[0].member_id,alice.id);assert.equal(data.messages[0].name,'Alice');
  assert.equal([...store.records.keys()].filter(key=>key.startsWith('room/')).length,1);
});

test('security review: malformed moderation approvals fail closed even behind a forged room index',async()=>{
  const invalid=[
    decision('approved','negative_or_abusive'),
    {...decision(),policy_version:'attacker-policy'},
    {...decision(),checked_at:'invalid'},
    {status:'approved'},null,
  ];
  for(const verdict of invalid){
    const store=memoryStore();
    const response=await postChatMessage(send('This must not publish'),store,auth(alice),async()=>verdict);
    assert.equal(response.status,202);assert.equal((await response.json()).published,false);
    const record=[...store.records.values()][0];
    assert.equal(record.moderation.status,'pending');
    const suffix=`${String(9999999999999-Date.parse(record.created_at)).padStart(13,'0')}-${record.id}`;
    store.records.set('room/'+suffix,{id:record.id});
    assert.deepEqual((await (await read(store)).json()).messages,[]);
  }
});

test('security review: a held request remains held when retried after moderation recovers',async()=>{
  const store=memoryStore();const requestId=randomUUID();let classifications=0;
  const initial=await postChatMessage(send('Pending content',requestId),store,auth(alice),async()=>{classifications++;throw Error('gateway down');});
  assert.equal(initial.status,202);
  const retry=await postChatMessage(send('Pending content',requestId),store,auth(alice),async()=>{classifications++;return decision();});
  assert.equal(retry.status,202);assert.equal(classifications,1);assert.equal((await retry.json()).published,false);
  assert.deepEqual((await (await read(store)).json()).messages,[]);
  assert.equal([...store.records.keys()].filter(key=>key.startsWith('room/')).length,0);
});

test('security review: room listing ignores foreign namespaces and wrong index-to-record bindings',async()=>{
  const store=memoryStore();
  await postChatMessage(send('Visible respectful chat'),store,auth(alice),async()=>decision());
  const [validIndex]=[...store.records.keys()].filter(key=>key.startsWith('room/'));
  store.records.set('inbox/'+bob.id+'/private-message',{body:'Private text',email:'private@example.test'});
  const wrongIndex='room/'+validIndex.slice(5).replace(/^\d/,'0');
  const originalList=store.list;
  store.list=async function*(options){
    for await(const page of originalList(options))yield {blobs:[...page.blobs,{key:'inbox/'+bob.id+'/private-message'},{key:wrongIndex},{key:'room/../../inbox/private-message'}]};
  };
  const response=await read(store);const text=await response.text();
  assert.equal(JSON.parse(text).messages.length,1);assert.ok(!text.includes('Private text'));assert.ok(!text.includes('@'));
  assert.equal(response.headers.get('cache-control'),'private, no-store');
});

const chris = { id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name:'Chris' };
function photoStores() {
  const records=new Map();const reads=[];
  return {
    directory:memoryStore(),messages:memoryStore(),
    photos:{
      records,reads,
      async get(key) { reads.push(key);return records.has(key)?structuredClone(records.get(key)):null; },
      async set(key,value,options) {
        if(options.onlyIfNew&&records.has(key))return {modified:false};
        records.set(key,structuredClone(value));return {modified:true};
      },
    },
  };
}
async function photoSendRequest(requestId=randomUUID(),recipient=bob) {
  const form=new FormData();
  form.set('request_id',requestId);form.set('recipient_id',recipient.id);form.set('subject','Private picture');form.set('body','');
  form.set('sender_id',chris.id);form.set('photo',new File([await readFile(new URL('../photos/back-in-the-day.jpg',import.meta.url))],'location-secret.jpg',{type:'image/jpeg'}));
  return new Request('https://jwhitedidit.net/api/member-messages/send',{method:'POST',headers:{Origin:'https://jwhitedidit.net'},body:form});
}
const photoGetRequest=id=>new Request('https://jwhitedidit.net/api/member-message-photo/'+id);

test('security review: private photo is unavailable before delivery and a racing retry cannot change its recipient',async()=>{
  const {sendMemberMessage,getMemberMessagePhoto}=await import('../netlify/functions/_shared/member-messages.mts');
  const stores=photoStores();
  for(const member of [alice,bob,chris])stores.directory.records.set('members/'+member.id,member);
  const gate=deferred();const reached=deferred();const requestId=randomUUID();
  const write=stores.photos.set.bind(stores.photos);
  stores.photos.set=async(...args)=>{reached.resolve();await gate.promise;return write(...args);};
  const pending=sendMemberMessage(await photoSendRequest(requestId),stores,auth(alice));
  await reached.promise;
  const record=[...stores.messages.records.values()][0];
  for(const member of [alice,bob,chris])assert.equal((await getMemberMessagePhoto(photoGetRequest(record.id),stores,auth(member))).status,404);
  assert.equal(stores.photos.reads.length,0,'uncommitted attachments must not even be read');
  const changed=await sendMemberMessage(await photoSendRequest(requestId,chris),stores,auth(alice));
  assert.equal(changed.status,409);
  gate.resolve();const committed=await pending;assert.equal(committed.status,201);
  const text=await committed.text();assert.ok(!text.includes('digest'));assert.ok(!text.includes('location-secret'));
  for(const member of [alice,bob]){
    const response=await getMemberMessagePhoto(photoGetRequest(record.id),stores,auth(member));
    assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/jpeg');
    assert.equal(response.headers.get('cache-control'),'private, no-store');
    assert.equal(response.headers.get('cross-origin-resource-policy'),'same-origin');
    assert.ok((await response.arrayBuffer()).byteLength>0);
  }
  const reads=stores.photos.reads.length;
  const denied=await getMemberMessagePhoto(photoGetRequest(record.id),stores,auth(chris));
  assert.equal(denied.status,404);assert.equal(stores.photos.reads.length,reads,'unrelated member must not read private bytes');
  assert.equal([...stores.photos.records.keys()].length,1);
  assert.equal([...stores.messages.records.values()].find(value=>value.photo)?.recipient_id,bob.id);
});

test('security review: forged delivery marker and corrupt private bytes fail closed',async()=>{
  const {sendMemberMessage,getMemberMessagePhoto}=await import('../netlify/functions/_shared/member-messages.mts');
  const stores=photoStores();
  for(const member of [alice,bob])stores.directory.records.set('members/'+member.id,member);
  const result=await sendMemberMessage(await photoSendRequest(),stores,auth(alice));assert.equal(result.status,201);
  const {message}=await result.json();
  stores.messages.records.set('delivered/'+message.id,{id:'f'.repeat(64)});
  const before=stores.photos.reads.length;
  let response=await getMemberMessagePhoto(photoGetRequest(message.id),stores,auth(bob));
  assert.equal(response.status,404);assert.equal(stores.photos.reads.length,before);
  stores.messages.records.set('delivered/'+message.id,{id:message.id});
  const [key]=stores.photos.records.keys();stores.photos.records.set(key,new Uint8Array([1,2,3]).buffer);
  response=await getMemberMessagePhoto(photoGetRequest(message.id),stores,auth(bob));
  assert.equal(response.status,404);assert.ok(!(await response.text()).includes(key));
  for(const name of ['Netlify-CDN-Cache-Control','CDN-Cache-Control'])assert.equal(response.headers.get(name),'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'),null);
});

function clipStore() {
  const records=new Map(),tags=new Map();let version=0;
  const write=(key,value,options={})=>{
    if((options.onlyIfNew&&records.has(key))||(options.onlyIfMatch!==undefined&&options.onlyIfMatch!==tags.get(key)))return {modified:false};
    records.set(key,structuredClone(value));tags.set(key,String(++version));return {modified:true};
  };
  return {
    records,tags,
    async get(key){return structuredClone(records.get(key)??null);},
    async getWithMetadata(key){return records.has(key)?{data:structuredClone(records.get(key)),etag:tags.get(key)}:null;},
    async setJSON(...args){return write(...args);},async set(...args){return write(...args);},
    async *list({prefix}){yield {blobs:[...records.keys()].filter(key=>key.startsWith(prefix)).map(key=>({key}))};},
  };
}
const boundOwner={...chris,isOwner:true};
const clipAuth=member=>({resolveMember:async()=>member});
const clipReview=(id,action)=>new Request('https://jwhitedidit.net/api/clips/review',{
  method:'POST',headers:{Origin:'https://jwhitedidit.net','Content-Type':'application/json'},body:JSON.stringify({id,action}),
});
async function pendingClip(store){
  const {submitClip}=await import('../netlify/functions/_shared/member-clips.mts');
  const form=new FormData();form.set('request_id',randomUUID());form.set('caption','A respectful studio moment');
  form.set('video',new Blob([await readFile(new URL('./fixtures/short-clip.mp4',import.meta.url))],{type:'video/mp4'}),'clip.mp4');
  const response=await submitClip(new Request('https://jwhitedidit.net/api/clips',{method:'POST',headers:{Origin:'https://jwhitedidit.net'},body:form}),store,clipAuth({...alice,isOwner:false}));
  assert.equal(response.status,202,await response.clone().text());return (await response.json()).id;
}

test('security review: rejection during a delayed approval commit cannot republish the clip',async()=>{
  const {reviewClip,getClips,getClipVideo}=await import('../netlify/functions/_shared/member-clips.mts');
  const store=clipStore(),profiles=clipStore();profiles.records.set('owner-binding',{id:boundOwner.id});
  const id=await pendingClip(store),gate=deferred(),reached=deferred();const write=store.setJSON.bind(store);
  store.setJSON=async(key,...args)=>{if(key.startsWith('published/')){reached.resolve();await gate.promise;}return write(key,...args);};
  const approve=reviewClip(clipReview(id,'approve'),store,profiles,clipAuth(boundOwner));await reached.promise;
  const reject=await reviewClip(clipReview(id,'reject'),store,profiles,clipAuth(boundOwner));assert.equal(reject.status,200);
  gate.resolve();assert.equal((await approve).status,409);
  const feed=await getClips(new Request('https://jwhitedidit.net/api/clips?member='+alice.id),store);const listing=await feed.json();assert.deepEqual(listing.clips,[]);assert.equal(listing.member_id,alice.id);
  const anonymous={resolveMember:async()=>{throw Error('not logged in');}};
  assert.equal((await getClipVideo(new Request('https://jwhitedidit.net/api/clip-video/'+id),store,profiles,anonymous)).status,404);
  assert.equal(store.records.get('moderation/'+id).status,'rejected');
});

test('security review: public range reads recheck approval after loading bytes',async()=>{
  const {reviewClip,getClipVideo}=await import('../netlify/functions/_shared/member-clips.mts');
  const store=clipStore(),profiles=clipStore();profiles.records.set('owner-binding',{id:boundOwner.id});
  const id=await pendingClip(store);assert.equal((await reviewClip(clipReview(id,'approve'),store,profiles,clipAuth(boundOwner))).status,200);
  const gate=deferred(),reached=deferred(),read=store.get.bind(store);
  store.get=async(key,...args)=>{const data=await read(key,...args);if(key.startsWith('videos/')){reached.resolve();await gate.promise;}return data;};
  const anonymous={resolveMember:async()=>{throw Error('not logged in');}};
  const pending=getClipVideo(new Request('https://jwhitedidit.net/api/clip-video/'+id,{headers:{Range:'bytes=0-15'}}),store,profiles,anonymous);
  await reached.promise;
  assert.equal((await reviewClip(clipReview(id,'reject'),store,profiles,clipAuth(boundOwner))).status,200);
  gate.resolve();const response=await pending;assert.equal(response.status,404);
  assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('content-range'),null);
  assert.ok(!(await response.text()).includes('ftyp'));
});
