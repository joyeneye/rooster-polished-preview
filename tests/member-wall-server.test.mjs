import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {getMemberWall,postMemberWall,deleteMemberWallComment} from '../netlify/functions/_shared/member-wall.mts';
import {MemberError} from '../netlify/functions/_shared/member-auth.mts';
import {POLICY_VERSION} from '../netlify/functions/_shared/comment-moderation.mts';
const origin='https://jwhitedidit.net';
const alice={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',name:'Alice',isOwner:false};
const bob={id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',name:'Bob',isOwner:false};
const host={id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',name:'JWhite',isOwner:true};
const stranger={id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',name:'Other',isOwner:false};
function memory() {
  const records = new Map();
  return {
    records,
    async get(key) { return structuredClone(records.get(key) ?? null); },
    async setJSON(key, value, options = {}) {
      if (options.onlyIfNew && records.has(key)) return {modified:false};
      records.set(key, structuredClone(value)); return {modified:true};
    },
    async delete(key) { records.delete(key); },
    async *list({prefix}) {
      const keys = [...records.keys()].filter(key=>key.startsWith(prefix));
      for (let n=0;n<keys.length;n+=10) yield {blobs:keys.slice(n,n+10).map(key=>({key}))};
    }
  };
}
function setup(){const walls=memory(),profiles=memory();for(const p of [alice,bob,host,stranger])profiles.records.set('public-members/'+p.id,p);profiles.records.set('owner-binding',{id:host.id});const dependencies={profiles,resolveMember:async()=>host,moderate:async()=>({status:'approved',policy_version:POLICY_VERSION,reason:'positive_or_respectful',checked_at:new Date().toISOString()})};return {walls,profiles,dependencies}}
const request=(path,target=alice.id,value)=>new Request(`${origin}/api/member-wall${path}?member=${target}`,value?{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(value)}:{});
const post=(s,target=alice.id,message='Welcome to the space!',request_id=randomUUID(),extra={})=>postMemberWall(request('/post',target,{message,request_id,...extra}),s.walls,s.dependencies);
const get=(s,target=alice.id)=>getMemberWall(request('',target),s.walls,s.dependencies);
const remove=(s,id,target=alice.id)=>deleteMemberWallComment(request('/delete',target,{comment_id:id}),s.walls,s.dependencies);

test('JWhite writes to a new member wall with verified identity and profile link',async()=>{const s=setup(),p=await post(s);assert.equal(p.status,201);const data=await(await get(s)).json();assert.equal(data.total,1);assert.equal(data.comments[0].name,'J.White Did It');assert.equal(data.comments[0].verified_owner,true);assert.equal(data.comments[0].profile_url,'/#home');assert.equal(data.comments[0].can_delete,true);});
test('member walls stay separate from each other and from the original main wall',async()=>{const s=setup();await post(s,alice.id);await post(s,bob.id,'Different wall');assert.equal((await(await get(s,alice.id)).json()).comments[0].message,'Welcome to the space!');assert.equal((await(await get(s,bob.id)).json()).comments[0].message,'Different wall');assert([...s.walls.records.keys()].every(k=>k.startsWith('walls/')));assert.equal((await post(s,host.id)).status,400);});
test('any confirmed member can write as themselves, never as a spoofed owner',async()=>{const s=setup();s.dependencies.resolveMember=async()=>bob;const p=await post(s,alice.id,'Nice music!',randomUUID(),{author_id:host.id,name:'JWhite',verified_owner:true});assert.equal(p.status,201);const d=await p.json();assert.equal(d.comment.author_id,bob.id);assert.equal(d.comment.name,'Bob');assert.equal(d.comment.verified_owner,false);assert.equal(d.comment.profile_url,`/profile.html?id=${bob.id}`);});
test('anonymous visitors can read approved comments but cannot post',async()=>{const s=setup();await post(s);s.dependencies.resolveMember=async()=>{throw new MemberError(401,'Log in')};const data=await(await get(s)).json();assert.equal(data.comments.length,1);assert.equal(data.can_post,false);assert.equal(data.viewer_id,null);assert.equal(data.comments[0].can_delete,false);assert.equal((await post(s)).status,401);});
test('unconfirmed sessions cannot post or get posting permission',async()=>{const s=setup();s.dependencies.resolveMember=async()=>{throw new MemberError(403,'Confirm email')};assert.equal((await post(s)).status,403);assert.equal((await(await get(s)).json()).can_post,false);});
test('cross site requests and requests without an Origin are rejected',async()=>{for(const originValue of [null,'https://other.example']){const s=setup();const headers={'Content-Type':'application/json'};if(originValue)headers.Origin=originValue;const r=new Request(origin+'/api/member-wall/post?member='+alice.id,{method:'POST',headers,body:JSON.stringify({message:'Hello!',request_id:randomUUID()})});assert.equal((await postMemberWall(r,s.walls,s.dependencies)).status,403);assert.equal(s.walls.records.size,0)}});
test('double click and concurrent network retries create only one comment',async()=>{const s=setup(),nonce=randomUUID();const results=await Promise.all(Array.from({length:12},()=>post(s,alice.id,'Same message',nonce)));assert(results.every(r=>r.status===201));assert.equal((await(await get(s)).json()).total,1);assert.equal((await post(s,alice.id,'Different text',nonce)).status,409);});
test('the same request nonce on two different walls is still isolated',async()=>{const s=setup(),nonce=randomUUID();await post(s,alice.id,'Hey Alice',nonce);await post(s,bob.id,'Hey Bob',nonce);assert.equal((await(await get(s,alice.id)).json()).total,1);assert.equal((await(await get(s,bob.id)).json()).total,1);});
test('moderation unavailable holds a comment privately instead of publishing it',async()=>{const s=setup();s.dependencies.resolveMember=async()=>bob;s.dependencies.moderate=async()=>{throw new Error('Offline')};const p=await post(s);assert.equal(p.status,202);let data=await(await get(s)).json();assert.equal(data.total,0);assert.equal(data.comments[0].status,'pending');s.dependencies.resolveMember=async()=>alice;data=await(await get(s)).json();assert.equal(data.comments.length,0);});
test('invalid moderation results do not grant publication',async()=>{const s=setup();s.dependencies.moderate=async()=>({status:'approved',policy_version:'old'});assert.equal((await post(s)).status,202);assert.equal((await(await get(s)).json()).total,0);});
test('rejected comments do not enter public storage',async()=>{const s=setup();s.dependencies.moderate=async()=>({status:'rejected',policy_version:POLICY_VERSION,reason:'negative_or_abusive',checked_at:new Date().toISOString()});assert.equal((await post(s)).status,422);assert.equal(s.walls.records.size,0);});
test('page owner, author and JWhite can remove a comment but a stranger cannot',async()=>{for(const actor of [alice,bob,host,stranger]){const s=setup();s.dependencies.resolveMember=async()=>bob;const p=await(await post(s)).json();s.dependencies.resolveMember=async()=>actor;const r=await remove(s,p.comment.id);assert.equal(r.status,actor===stranger?403:200);assert.equal((await(await get(s)).json()).total,actor===stranger?1:0);}});
test('deletion removes message content and retry cannot resurrect the deleted comment',async()=>{const s=setup(),nonce=randomUUID();const p=await(await post(s,alice.id,'Delete this text',nonce)).json();assert.equal((await remove(s,p.comment.id)).status,200);assert.equal((await remove(s,p.comment.id)).status,200);assert.equal((await post(s,alice.id,'Delete this text',nonce)).status,409);assert(!JSON.stringify([...s.walls.records.values()]).includes('Delete this text'));});
test('a comment cannot be removed using a different member wall ID',async()=>{const s=setup(),p=await(await post(s)).json();assert.equal((await remove(s,p.comment.id,bob.id)).status,404);assert.equal((await(await get(s)).json()).total,1);});
test('invalid IDs, duplicate IDs and unknown or hidden profiles do not get walls',async()=>{const s=setup();for(const target of ['not-an-id',alice.id+'&member='+bob.id,'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'])assert([400,404].includes((await get(s,target)).status));s.profiles.records.set('profiles/'+alice.id,{id:alice.id,approved:false});assert.equal((await post(s)).status,404);});
test('oversized, empty and malformed comment bodies are rejected without saving',async()=>{for(const message of ['', 'a', 'x'.repeat(1001), 'Hi\u0000there', 'x'.repeat(10000)]){const s=setup();assert([400,413].includes((await post(s,alice.id,message)).status));assert.equal(s.walls.records.size,0)}});
test('storage failures report unavailable and never pretend a comment saved',async()=>{const s=setup();s.walls.setJSON=async()=>({modified:true});assert.equal((await post(s)).status,503);s.walls.list=async function*(){throw new Error('Offline')};assert.equal((await get(s)).status,503);});
test('pagination returns 20 comments then the rest with no duplicates',async()=>{const s=setup();for(let n=0;n<25;n++)await post(s,alice.id,`Comment ${n}`);const first=await(await get(s)).json();assert.equal(first.total,25);assert.equal(first.comments.length,20);assert(first.next);const second=await(await getMemberWall(new Request(`${origin}/api/member-wall?member=${alice.id}&before=${encodeURIComponent(first.next)}`),s.walls,s.dependencies)).json();assert.equal(second.comments.length,5);assert.equal(second.next,null);assert.equal(new Set([...first.comments,...second.comments].map(c=>c.id)).size,25);});
test('stored private fields and moderation reasoning never appear in wall responses',async()=>{const s=setup();await post(s);for(const value of s.walls.records.values()){value.email='secret@example.test';value.token='a-secret-token'}const text=await(await get(s)).text();assert(!text.includes('secret@example.test'));assert(!text.includes('a-secret-token'));assert(!text.includes('positive_or_respectful'));});
