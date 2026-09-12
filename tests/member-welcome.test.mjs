import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {getMemberMessages, getMemberUnreadMessages, markMemberMessageRead, sendMemberMessage} from '../netlify/functions/_shared/member-messages.mts';
import {welcomeVerifiedMember} from '../netlify/functions/_shared/member-welcome.mts';
import {requireMember} from '../netlify/functions/_shared/member-auth.mts';

const origin = 'https://jwhitedidit.net';
const owner = {id:'11111111-1111-4111-8111-111111111111',name:'JWhite'};
const member = {id:'22222222-2222-4222-8222-222222222222',name:'New Member'};
const stranger = {id:'33333333-3333-4333-8333-333333333333',name:'Other Member'};
const legacySubject = 'You’re connected. Let’s get it.';
const legacyBody = 'Welcome to KON-NEKT. I’m Your Connector on here and your first friend. Set up your page, add your music, come say what’s up in the chat room — then go look at OPPORTUNITIES and find somebody to create with. You’re connected. Let’s get it.';
function store(){const records=new Map();return {records,failPrefix:null,
  async get(key){return structuredClone(records.get(key)??null);},
  async setJSON(key,value,{onlyIfNew=false}={}){if(this.failPrefix&&key.startsWith(this.failPrefix))throw new Error('simulated storage failure');if(onlyIfNew&&records.has(key))return {modified:false};records.set(key,structuredClone(value));return {modified:true};},
  async delete(key){records.delete(key);},
  async *list({prefix}){yield {blobs:[...records.keys()].filter(key=>key.startsWith(prefix)).map(key=>({key}))};}
};}
function setup(binding=owner.id){const profiles=store();if(binding!==null)profiles.records.set('owner-binding',{id:binding});return {profiles,stores:{directory:store(),messages:store(),friends:store(),walls:store()}};}
async function inbox(stores,user,query=''){const response=await getMemberMessages(new Request(origin+'/api/member-messages'+query),stores,async()=>user);assert.equal(response.status,200);return response.json();}
function post(path,body){return new Request(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});}
function seedMessage(stores,recipient=member,overrides={}){
  const id=createHash('sha256').update(`jwhite:member-welcome:v1:${recipient.id.toLowerCase()}`).digest('hex');
  const message={id,sender_id:owner.id,recipient_id:recipient.id,sender_name:owner.name,recipient_name:recipient.name,subject:legacySubject,body:legacyBody,created_at:'2026-09-01T12:00:00.000Z',request_id:'member-welcome:v1',...overrides};
  const suffix=String(9999999999999-Date.parse(message.created_at)).padStart(13,'0')+'-'+message.id;
  stores.messages.records.set(`messages/${message.id}`,structuredClone(message));
  stores.messages.records.set(`inbox/${message.recipient_id}/${suffix}`,{id:message.id});
  stores.messages.records.set(`sent/${message.sender_id}/${suffix}`,{id:message.id});
  stores.messages.records.set(`delivered/${message.id}`,{id:message.id});
  stores.messages.records.set(`unread/${message.recipient_id}/${message.id}`,{id:message.id,recipient_id:message.recipient_id,created_at:message.created_at});
  return message;
}

test('verified onboarding registers real conversation participants without sending an automatic DM',async()=>{
  const {profiles,stores}=setup();
  const outcome=await welcomeVerifiedMember(member,profiles,stores);
  assert.equal(outcome.status,'sent');assert.equal(outcome.message_id,undefined);
  assert.deepEqual(stores.directory.records.get(`members/${owner.id}`),owner);
  assert.deepEqual(stores.directory.records.get(`members/${member.id}`),member);
  assert.equal(stores.messages.records.size,0);
  const page=await inbox(stores,member);
  assert.deepEqual(page.inbox,[]);assert.deepEqual(page.sent,[]);assert.equal(page.unread_count,0);
  assert(page.members.some(person=>person.id===owner.id));
  assert.deepEqual((await inbox(stores,owner)).sent,[]);
  const response=await sendMemberMessage(post('/api/member-messages/send',{recipient_id:owner.id,request_id:randomUUID(),subject:'A real conversation',body:'Can we collaborate?'}),stores,async()=>member);
  assert.equal(response.status,201);
  assert.equal((await inbox(stores,owner)).inbox[0].body,'Can we collaborate?');
  assert.deepEqual((await inbox(stores,stranger)).inbox,[]);
});

test('concurrent profile creation, inbox loads and later logins never generate an automatic DM',async()=>{
  const {profiles,stores}=setup();
  const results=await Promise.all(Array.from({length:20},()=>welcomeVerifiedMember(member,profiles,stores)));
  assert(results.some(result=>result.status==='sent'));
  assert(results.every(result=>['sent','already_sent'].includes(result.status)&&result.message_id===undefined));
  for(let i=0;i<5;i++)assert.equal((await welcomeVerifiedMember(member,profiles,stores)).status,'already_sent');
  assert.equal(stores.messages.records.size,0);
  assert.deepEqual((await inbox(stores,member)).inbox,[]);
  assert.deepEqual((await inbox(stores,owner)).sent,[]);
});

test('message-store write failures no longer block first-friend and wall onboarding',async()=>{
  const {profiles,stores}=setup();stores.messages.failPrefix='';
  stores.messages.setJSON=async()=>{throw new Error('Private-message writes are unavailable');};
  assert.equal((await welcomeVerifiedMember(member,profiles,stores)).status,'sent');
  assert.equal((await welcomeVerifiedMember(member,profiles,stores)).status,'already_sent');
  assert.equal(stores.messages.records.size,0);
  assert.equal([...stores.friends.records.keys()].filter(key=>key.startsWith('automatic-owner-v1/')).length,1);
  assert.equal([...stores.walls.records.keys()].filter(key=>key.startsWith(`walls/${member.id}/`)).length,1);
});

test('directory registration retries without duplicating completed friendship or wall work',async()=>{
  const {profiles,stores}=setup();stores.directory.failPrefix='members/';
  assert.equal((await welcomeVerifiedMember(member,profiles,stores)).status,'pending');
  stores.directory.failPrefix=null;
  assert.equal((await welcomeVerifiedMember(member,profiles,stores)).status,'already_sent');
  assert.deepEqual(stores.directory.records.get(`members/${owner.id}`),owner);
  assert.deepEqual(stores.directory.records.get(`members/${member.id}`),member);
  assert.equal([...stores.friends.records.keys()].filter(key=>key.startsWith('automatic-owner-v1/')).length,1);
  assert.equal([...stores.walls.records.keys()].filter(key=>key.startsWith(`walls/${member.id}/`)).length,1);
  assert.equal(stores.messages.records.size,0);
});

test('no fabricated owner, self welcome or unconfirmed registration is authorized',async()=>{
  for(const binding of [null,'not-a-real-id']){const {profiles,stores}=setup(binding);assert.equal((await welcomeVerifiedMember(member,profiles,stores)).status,'pending');assert.equal(stores.messages.records.size,0);assert.equal(stores.directory.records.size,0);}
  const {profiles,stores}=setup();assert.equal((await welcomeVerifiedMember(owner,profiles,stores)).status,'owner');assert.equal(stores.messages.records.size,0);
  await assert.rejects(requireMember(async()=>null),{status:401});
  await assert.rejects(requireMember(async()=>({...member,confirmedAt:null})),{status:403});
  await assert.rejects(requireMember(async()=>({...member,confirmedAt:'invalid'})),{status:403});
});

test('matching an owner display name cannot change the verified directory binding',async()=>{
  const {profiles,stores}=setup();await welcomeVerifiedMember({...member,name:'JWhite'},profiles,stores);
  assert.deepEqual(stores.directory.records.get(`members/${owner.id}`),owner);
  assert.deepEqual(stores.directory.records.get(`members/${member.id}`),{...member,name:'JWhite'});
  assert.equal(stores.messages.records.size,0);
});

test('legacy KON-NEKT system welcome disappears from inbox, sent and unread without deleting storage',async()=>{
  const {stores}=setup();const message=seedMessage(stores);
  const original=structuredClone([...stores.messages.records]);
  const received=await inbox(stores,member),sent=await inbox(stores,owner);
  assert.deepEqual(received.inbox,[]);assert.deepEqual(received.unread_ids,[]);assert.equal(received.unread_count,0);
  assert.deepEqual(sent.sent,[]);
  assert.deepEqual(received.retired_message_ids,[message.id]);
  assert.deepEqual(sent.retired_message_ids,[message.id]);
  assert.deepEqual((await inbox(stores,stranger)).retired_message_ids,[]);
  const unread=await getMemberUnreadMessages(new Request(origin+'/api/member-messages/unread'),stores,async()=>member);
  assert.equal(unread.status,200);assert.equal((await unread.json()).unread_count,0);
  const read=await markMemberMessageRead(post('/api/member-messages/read',{message_id:message.id}),stores,async()=>member);
  assert.equal(read.status,404);
  assert.deepEqual([...stores.messages.records],original);
});

test('legacy automatic welcome is identified by its server marker and key across branding changes',async()=>{
  for(const body of [legacyBody, 'Welcome to JSPACE. LET’S WORK!', 'Welcome to the ROSTER. Build your roster.', 'Welcome to the ROOSTER. Build your roster.']){
    const {stores}=setup();seedMessage(stores,member,{body});
    assert.deepEqual((await inbox(stores,member)).inbox,[]);
    assert.deepEqual((await inbox(stores,owner)).sent,[]);
  }
});

test('an ordinary member message quoting the exact welcome stays visible and unread',async()=>{
  const {profiles,stores}=setup();await welcomeVerifiedMember(member,profiles,stores);
  const hidden=seedMessage(stores);
  const response=await sendMemberMessage(post('/api/member-messages/send',{recipient_id:member.id,request_id:randomUUID(),subject:legacySubject,body:legacyBody}),stores,async()=>owner);
  assert.equal(response.status,201);const {message}=await response.json();assert.notEqual(message.id,hidden.id);
  const received=await inbox(stores,member);assert.equal(received.inbox.length,1);assert.equal(received.inbox[0].id,message.id);
  assert.equal(received.inbox[0].body,legacyBody);assert.equal(received.unread_count,1);assert.deepEqual(received.unread_ids,[message.id]);
  assert.deepEqual(received.retired_message_ids,[hidden.id]);
  assert.deepEqual((await inbox(stores,owner)).sent.map(item=>item.id),[message.id]);
});

test('retiring welcomes requires both the reserved request marker and deterministic recipient id',async()=>{
  for(const overrides of [{id:'a'.repeat(64)}, {request_id:randomUUID()}]){
    const {stores}=setup();const message=seedMessage(stores,member,overrides);
    const page=await inbox(stores,member);
    assert.deepEqual(page.inbox.map(item=>item.id),[message.id]);
    assert.deepEqual(page.retired_message_ids,[]);
  }
});

test('sent pagination fills past retired welcomes and preserves older real messages',async()=>{
  const {stores}=setup();
  for(let index=0;index<25;index++)seedMessage(stores,{id:randomUUID(),name:'Legacy member '+index},{created_at:new Date(Date.UTC(2026,8,10,0,0,index)).toISOString()});
  const first=seedMessage(stores,member,{id:'b'.repeat(64),request_id:randomUUID(),body:'First real conversation',created_at:'2026-08-20T12:00:00.000Z'});
  const second=seedMessage(stores,stranger,{id:'c'.repeat(64),request_id:randomUUID(),body:'Older real conversation',created_at:'2026-08-19T12:00:00.000Z'});
  const page=await inbox(stores,owner,'?limit=1');
  assert.deepEqual(page.sent.map(item=>item.id),[first.id]);
  assert.equal(page.retired_message_ids.length,25);
  assert(!page.retired_message_ids.includes(first.id));
  assert.equal(typeof page.next.sent_before,'string');
  const next=await inbox(stores,owner,'?limit=1&sent_before='+encodeURIComponent(page.next.sent_before));
  assert.deepEqual(next.sent.map(item=>item.id),[second.id]);assert.equal(next.next.sent_before,null);
});

test('retired IDs require an authentic participant index and delivery commit',async()=>{
  const {stores}=setup();const hidden=seedMessage(stores);
  const suffix=String(9999999999999-Date.parse(hidden.created_at)).padStart(13,'0')+'-'+hidden.id;
  // Even a corrupted per-user index must not disclose another person's IDs.
  stores.messages.records.set(`inbox/${stranger.id}/${suffix}`,{id:hidden.id});
  stores.messages.records.set(`sent/${stranger.id}/${suffix}`,{id:hidden.id});
  assert.deepEqual((await inbox(stores,stranger)).retired_message_ids,[]);
  stores.messages.records.delete(`delivered/${hidden.id}`);
  assert.deepEqual((await inbox(stores,member)).retired_message_ids,[]);
  assert.deepEqual((await inbox(stores,owner)).retired_message_ids,[]);
});

test('retired IDs reject mismatched message keys and timestamp indexes',async()=>{
  for(const corrupt of ['id','timestamp']){
    const {stores}=setup();const hidden=seedMessage(stores);
    const prefix=`inbox/${member.id}/`;
    const key=[...stores.messages.records.keys()].find(key=>key.startsWith(prefix));
    if(corrupt==='id')stores.messages.records.set(`messages/${hidden.id}`,{...hidden,id:'d'.repeat(64)});
    else {stores.messages.records.delete(key);stores.messages.records.set(`${prefix}0000000000000-${hidden.id}`,{id:hidden.id});}
    assert.deepEqual((await inbox(stores,member)).retired_message_ids,[]);
  }
});
