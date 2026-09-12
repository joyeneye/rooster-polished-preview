import test from 'node:test';
import assert from 'node:assert/strict';
import { getTopEightRoster, selectTopEight } from '../netlify/functions/_shared/top-eight-roster.mts';
import { MemberError } from '../netlify/functions/_shared/member-auth.mts';
import { POLICY_VERSION } from '../netlify/functions/_shared/comment-moderation.mts';
const origin='https://jwhitedidit.net';
const id=n=>`${n.toString(16).padStart(8,'0')}-1111-4111-8111-111111111111`;
const member={id:id(1),name:'Viewer',isOwner:false};
const card=n=>({id:id(n),name:`Person ${n}`,photo_url:null,profile_url:`/profile.html?id=${id(n)}`});
function memory(){const records=new Map(),writes=[];return {records,writes,async get(key){return structuredClone(records.get(key)??null)},async *list({prefix}){yield {blobs:[...records.keys()].filter(key=>key.startsWith(prefix)).map(key=>({key}))}},async setJSON(key,value){writes.push(key);records.set(key,structuredClone(value));return {modified:true}}};}
function env(count=12){const profiles=memory(),directory=memory();const approved=Array.from({length:count},(_,i)=>id(i+1));for(let n=1;n<=count;n++)directory.records.set(`members/${id(n)}`,{id:id(n),name:n===1?'Viewer':`Person ${n}`});return {profiles,directory,resolveMember:async()=>member,approvedIds:async()=>approved,blockedIds:async()=>[],friends:async()=>[]};}
const req=(target='self',order)=>new Request(`${origin}/api/top-eight-roster?target_id=${target}`,order===undefined?{}:{method:'PUT',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({order})});
const read=async(opts,target='self')=>{const res=await getTopEightRoster(req(target),opts);assert.equal(res.status,200);return res.json()};
const validProfile=n=>({id:id(n),name:`Published ${n}`,status:'MORE!',about_me:'',photo_id:'a'.repeat(64),updated_at:new Date().toISOString(),approved:true,policy_version:POLICY_VERSION});

test('new member gets eight actual community picks consistently, excluding self and without storing friendship or defaults',async()=>{
 const opts=env();const a=await read(opts),b=await read(opts);
 assert.equal(a.members.length,8);assert.deepEqual(a.members,b.members);assert.equal(new Set(a.members.map(m=>m.id)).size,8);assert.equal(a.members.some(m=>m.id===member.id),false);assert.equal(a.mode,'community');assert.equal(a.editable,true);assert.equal(a.available_members.length,11);assert.equal(opts.profiles.writes.length,0);assert.equal(opts.directory.writes.length,0);
 for(const c of a.members)assert.deepEqual(Object.keys(c).sort(),['id','name','photo_url','profile_url']);
});

test('legacy partial manual order stays first, then accepted friends, then community picks',async()=>{
 const opts=env();opts.profiles.records.set(`top-eight-rosters/${member.id}`,{order:[id(9),id(3)]});opts.friends=async()=>[{member_id:id(2)},{member_id:id(3)}];
 const data=await read(opts);assert.deepEqual(data.members.slice(0,3).map(m=>m.id),[id(9),id(3),id(2)]);assert.equal(data.members.length,8);assert.equal(opts.profiles.writes.length,0);
});

test('saved full manual roster preserves exact people and order',()=>{
 const available=Array.from({length:12},(_,i)=>card(i+2)),order=available.slice(2,10).map(m=>m.id).reverse();
 assert.deepEqual(selectTopEight(member.id,available,[id(2)],{order}).members.map(m=>m.id),order);
});

test('few members show only real cards, and zero eligible members stays empty',async()=>{
 assert.equal((await read(env(3))).members.length,2);assert.deepEqual((await read(env(1))).members,[]);
});

test('private, deleted, disabled, withdrawn, unapproved and both-way blocked members never enter defaults or editor',async()=>{
 const opts=env(10);opts.profiles.records.set(`profiles/${id(2)}`,{...validProfile(2),visibility:'private'});
 opts.directory.records.set(`members/${id(3)}`,{id:id(3),name:'Deleted',deleted:true});
 opts.profiles.records.set(`public-members/${id(4)}`,{id:id(4),name:'Disabled',disabled:true});
 opts.profiles.records.set(`profiles/${id(5)}`,{...validProfile(5),approved:false});
 opts.approvedIds=async()=>[id(1),id(2),id(3),id(4),id(5),id(7),id(8),id(9),id(10)];
 opts.blockedIds=async participants=>{assert.deepEqual(participants,[member.id]);return [id(7),id(8)]};
 const data=await read(opts);assert.deepEqual(data.available_members.map(m=>m.id).sort(),[id(9),id(10)].sort());assert.equal(data.members.length,2);
});

test('approved profile display name and moderated photo are used, never arbitrary raw photo URL or private fields',async()=>{
 const opts=env(2);opts.profiles.records.set(`profiles/${id(2)}`,{...validProfile(2),email:'secret@example.test',photo_url:'https://evil.example.test/image',token:'secret'});
 const data=await read(opts);assert.deepEqual(data.members[0],{id:id(2),name:'Published 2',photo_url:`/api/profile-photo/${'a'.repeat(64)}`,profile_url:`/profile.html?id=${id(2)}`});assert.equal(JSON.stringify(data).includes('secret'),false);
});

test('custom subset and empty selection persist across requests without automatic refill',async()=>{
 const opts=env();const order=[id(5),id(2)];let res=await getTopEightRoster(req('self',order),opts);assert.equal(res.status,200);assert.equal((await res.json()).mode,'custom');assert.deepEqual((await read(opts)).members.map(m=>m.id),order);
 res=await getTopEightRoster(req('self',[]),opts);assert.equal(res.status,200);const data=await read(opts);assert.deepEqual(data.members,[]);assert.equal(data.mode,'custom');assert.equal(data.available_members.length,11);
});

test('duplicate, oversized, self, nonexistent and no-longer-approved writes are rejected without changing saved choices',async()=>{
 const opts=env();await getTopEightRoster(req('self',[id(2)]),opts);const before=structuredClone(opts.profiles.records);
 for(const order of [[id(2),id(2)],[id(1)],[id(999)],Array.from({length:9},(_,i)=>id(i+2))]){const res=await getTopEightRoster(req('self',order),opts);assert.equal(res.status,400);assert.deepEqual(opts.profiles.records,before)}
 opts.approvedIds=async()=>[id(1)];const res=await getTopEightRoster(req('self',[id(2)]),opts);assert.equal(res.status,400);assert.deepEqual(opts.profiles.records,before);
});

test('only the actual owner may save, signed-out reads stay gated, visitors do not get editor candidates',async()=>{
 const opts=env();let res=await getTopEightRoster(req(id(2),[id(3)]),opts);assert.equal(res.status,403);assert.equal(opts.profiles.writes.length,0);
 const publicView=await read(opts,id(2));assert.equal(publicView.editable,false);assert.equal('available_members' in publicView,false);
 opts.resolveMember=async()=>{throw new MemberError(401,'Please log in to open your messages.')};res=await getTopEightRoster(req(),opts);assert.equal(res.status,401);assert.equal((await res.json()).error,'Log in to see your Top 8.');
});

test('bound real owner alias retains original friendship position and links to the real profile',async()=>{
 const opts=env(3);opts.profiles.records.set('owner-binding',{id:id(3)});opts.friends=async()=>[{member_id:'owner'}];opts.approvedIds=async()=>[id(1),id(2)];opts.profiles.records.set(`top-eight-rosters/${member.id}`,{order:['owner',id(2)]});
 const data=await read(opts);assert.equal(data.members[0].id,id(3));assert.equal(data.members[0].photo_url,'/profile.jpg');assert.equal(data.members[0].profile_url,`/profile.html?id=${id(3)}`);
});

test('access or block service failure fails closed and does not silently show unvetted people',async()=>{
 for(const broken of ['approvedIds','blockedIds']){const opts=env();opts[broken]=async()=>{throw new Error('offline')};const res=await getTopEightRoster(req(),opts);assert.equal(res.status,503);assert.equal(opts.profiles.writes.length,0)}
});

test('a blocked target roster cannot be opened or reveal selected members',async()=>{
 const opts=env();opts.blockedIds=async participants=>{assert.deepEqual(participants,[id(2),member.id]);return [id(2),member.id]};const res=await getTopEightRoster(req(id(2)),opts);assert.equal(res.status,404);assert.equal('members' in await res.json(),false);
});

test('a private or withdrawn target cannot expose a roster through an otherwise valid directory entry',async()=>{
 for(const record of [{...validProfile(2),visibility:'private'},{...validProfile(2),approved:false}]){const opts=env();opts.profiles.records.set(`profiles/${id(2)}`,record);const res=await getTopEightRoster(req(id(2)),opts);assert.equal(res.status,404);assert.equal('members' in await res.json(),false)}
});

test('owner legacy alias order survives canonical self requests',async()=>{
 const opts=env();opts.profiles.records.set('owner-binding',{id:member.id});opts.resolveMember=async()=>({...member,isOwner:true});opts.profiles.records.set('top-eight-rosters/owner',{order:[id(10),id(2)]});const data=await read(opts);assert.deepEqual(data.members.slice(0,2).map(m=>m.id),[id(10),id(2)]);
});

test('each backing store key is read once per request despite directory scan and public-card validation',async()=>{
 const opts=env();for(let n=1;n<=12;n++){opts.profiles.records.set(`profiles/${id(n)}`,validProfile(n));opts.profiles.records.set(`public-members/${id(n)}`,{id:id(n),name:`Person ${n}`})}
 const counts=[];for(const store of [opts.profiles,opts.directory]){const current=new Map(),get=store.get;counts.push(current);store.get=async function(key,...args){current.set(key,(current.get(key)||0)+1);return get.call(this,key,...args)}}
 await read(opts);for(const countsByKey of counts)for(const [key,count]of countsByKey)assert.equal(count,1,`${key} read more than once`);
});
