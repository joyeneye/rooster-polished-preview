import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {
  CHAT_RESET_RELEASE,
  ensureReleaseChatReset,
  getChatMessages,
  postChatMessage,
} from '../netlify/functions/_shared/member-chat.mts';
import {POLICY_VERSION} from '../netlify/functions/_shared/comment-moderation.mts';

const origin='https://jwhitedidit.net';
const alice={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',name:'Alice'};
const auth=async()=>alice;
const approve=async()=>({
  status:'approved',reason:'positive_or_respectful',policy_version:POLICY_VERSION,checked_at:new Date().toISOString(),
});

function memoryStore() {
  const records=new Map();
  const deleted=[];
  return {
    records,deleted,
    async *list({prefix}) {
      const keys=[...records.keys()].filter(key=>key.startsWith(prefix));
      for(let offset=0;offset<keys.length;offset+=3)yield{blobs:keys.slice(offset,offset+3).map(key=>({key}))};
    },
    async get(key){return structuredClone(records.get(key)??null);},
    async setJSON(key,value,options={}){
      if(options.onlyIfNew&&records.has(key))return{modified:false};
      records.set(key,structuredClone(value));return{modified:true};
    },
    async delete(key){deleted.push(key);records.delete(key);},
  };
}

function send(body='A music moment') {
  return new Request(origin+'/api/member-chat/send',{
    method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},
    body:JSON.stringify({body,request_id:randomUUID()}),
  });
}
const read=store=>getChatMessages(new Request(origin+'/api/member-chat'),store,auth);

test('message is visible at 59.999 seconds, pruned at 60 seconds, and absent after reload',async()=>{
  const store=memoryStore();
  const posted=await postChatMessage(send(),store,auth,approve);
  assert.equal(posted.status,201);
  const {message}=await posted.json();
  const born=Date.parse(message.created_at);
  const originalNow=Date.now;
  const originalKeys=[...store.records.keys()].sort();
  try{
    Date.now=()=>born+59_999;
    assert.deepEqual((await(await read(store)).json()).messages,[message]);
    assert.deepEqual(store.deleted,[]);

    Date.now=()=>born+60_000;
    assert.deepEqual((await(await read(store)).json()).messages,[]);
    assert.deepEqual(store.deleted.sort(),originalKeys);
    assert.equal(store.records.size,0);

    Date.now=()=>born+120_000;
    assert.deepEqual((await(await read(store)).json()).messages,[]);
  }finally{Date.now=originalNow;}
});

test('expiry stays invisible if deletion is unavailable or temporarily fails',async()=>{
  for(const mode of ['missing','failing']){
    const store=memoryStore();
    const posted=await postChatMessage(send(),store,auth,approve);
    const {message}=await posted.json();
    if(mode==='missing')delete store.delete;
    else store.delete=async()=>{throw new Error('temporary Blob outage');};
    const originalNow=Date.now;
    try{
      Date.now=()=>Date.parse(message.created_at)+60_000;
      const response=await read(store);
      assert.equal(response.status,200);
      assert.deepEqual((await response.json()).messages,[]);
    }finally{Date.now=originalNow;}
  }
});

test('release reset deletes only Chat Room rows once and preserves every other namespace',async()=>{
  const store=memoryStore();
  const roomKey='room/1234567890123-'+'a'.repeat(64);
  const messageKey='messages/'+'a'.repeat(64);
  const preserved=['wall/post-1','member-wall/member-1/post-1','profiles/member-1','maintenance/unrelated'];
  store.records.set(roomKey,{id:'a'.repeat(64)});
  store.records.set(messageKey,{body:'old chat'});
  for(const key of preserved)store.records.set(key,{keep:true});

  assert.equal(await ensureReleaseChatReset(store),true);
  assert.deepEqual(store.deleted.sort(),[messageKey,roomKey].sort());
  for(const key of preserved)assert.deepEqual(store.records.get(key),{keep:true});
  const marker=[...store.records.entries()].find(([key])=>key.startsWith('maintenance/chat-reset/'));
  assert.ok(marker);
  assert.equal(marker[1].state,'done');
  assert.equal(marker[1].release,CHAT_RESET_RELEASE);

  store.records.set('messages/new-after-reset',{body:'new chat'});
  assert.equal(await ensureReleaseChatReset(store),false);
  assert.equal(store.records.has('messages/new-after-reset'),true);
  assert.equal(store.deleted.length,2);
});

test('a concurrent request cannot pass while the one-time reset is running',async()=>{
  const store=memoryStore();
  store.records.set('messages/old',{body:'old chat'});
  let releaseDelete;
  let reachedDelete;
  const reached=new Promise(resolve=>{reachedDelete=resolve;});
  const release=new Promise(resolve=>{releaseDelete=resolve;});
  const remove=store.delete.bind(store);
  store.delete=async key=>{if(key==='messages/old'){reachedDelete();await release;}await remove(key);};

  const first=ensureReleaseChatReset(store);
  await reached;
  await assert.rejects(()=>ensureReleaseChatReset(store),error=>error.status===503);
  releaseDelete();
  assert.equal(await first,true);
  assert.equal(await ensureReleaseChatReset(store),false);
});

test('both chat endpoints gate on reset before protected room work and expose no reset route',async()=>{
  const getSource=await readFile(new URL('../netlify/functions/chat-get.mts',import.meta.url),'utf8');
  const postSource=await readFile(new URL('../netlify/functions/chat-post.mts',import.meta.url),'utf8');
  assert.ok(getSource.indexOf('await ensureReleaseChatReset(')<getSource.indexOf('return await getChatMessages('));
  assert.ok(postSource.indexOf('await ensureReleaseChatReset(')<postSource.indexOf('resolveCommunityProfileMember('));
  assert.ok(postSource.indexOf('await ensureReleaseChatReset(')<postSource.indexOf('return await postChatMessage('));
  assert.doesNotMatch(getSource+postSource,/path:\s*["'][^"']*reset/i);
});

test('browser expiry scheduling has no grace period beyond the server TTL',async()=>{
  const source=await readFile(new URL('../member-chat.js',import.meta.url),'utf8');
  assert.match(source,/const CHAT_TTL_MS = 60000/);
  assert.match(source,/now - Date\.parse\(message\.created_at\) < CHAT_TTL_MS/);
  assert.match(source,/setTimeout\(\(\) => render\(messages\), nextExpiry\)/);
  assert.doesNotMatch(source,/nextExpiry\s*\+\s*20|Math\.max\(50,/);
});
