import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { updateProfile, getPublicProfile } from '../netlify/functions/_shared/member-profiles.mts';
import { DEFAULT_TOP_EIGHT } from '../netlify/functions/_shared/top-eight-order.mts';
import { POLICY_VERSION } from '../netlify/functions/_shared/comment-moderation.mts';
const origin='https://jwhitedidit.net';
const owner={id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',name:'J.White Did It',isOwner:true};
const member={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',name:'Alice',isOwner:false};
const fields={about_me:'A music producer making new sounds.',title_lines:'Producer\nMusic executive',credentials:'Great records\nNew collaborations',location:'Kansas\nUnited States'};
function store(){const records=new Map(),tags=new Map();let n=0;return{records,async get(key){return structuredClone(records.get(key)??null);},async getWithMetadata(key){return records.has(key)?{data:structuredClone(records.get(key)),etag:tags.get(key)}:null;},async setJSON(key,value,opts={}){if((opts.onlyIfNew&&records.has(key))||(opts.onlyIfMatch!==undefined&&opts.onlyIfMatch!==tags.get(key)))return{modified:false};records.set(key,structuredClone(value));tags.set(key,String(++n));return{modified:true};}};}
function post(input={}){const form=new FormData();for(const[key,value]of Object.entries({status:'MORE!',request_id:randomUUID(),...input}))form.set(key,String(value));return new Request(origin+'/api/profile/update',{method:'POST',headers:{Origin:origin},body:form});}
const verdict=(status='approved')=>({status,reason:status==='approved'?'positive_or_respectful':'uncertain',policy_version:POLICY_VERSION,checked_at:new Date().toISOString()});
const options=(who=owner,moderate=async()=>verdict())=>({resolveMember:async()=>who,moderate});
const publicOwner=async saved=>(await getPublicProfile(new Request(origin+'/api/profile?id=owner'),saved)).json();

test('owner fallback retains v32 biography, work, credits and location with defaultTop8',async()=>{
 const profile=(await publicOwner(store())).profile;
 assert.match(profile.about_me,/Grammy winner\. Two times diamond\./);assert.equal(profile.title_lines,'Producer.\nMusic executive.');
 assert.equal(profile.credentials,'Grammy winner\n2X Diamond\nHitMob founder');assert.equal(profile.location,'Leavenworth, Kansas\nUnited States');assert.deepEqual(profile.top_eight_order,[...DEFAULT_TOP_EIGHT]);
});

test('owner fields save with moderation and survive legacystatus andTop8onlyupdates',async()=>{
 const saved=store();let received;
 assert.equal((await updateProfile(post(fields),saved,options(owner,async input=>{received=input.message;return verdict();}))).status,200);
 for(const text of Object.values(fields))assert.equal(received.includes(text),true);
 const reordered=[...DEFAULT_TOP_EIGHT].reverse();
 assert.equal((await updateProfile(post({top_eight_order:JSON.stringify(reordered)}),saved,options())).status,200);
 assert.equal((await updateProfile(post({status:'New music next week.'}),saved,options())).status,200);
 const profile=(await publicOwner(saved)).profile;for(const[key,value]of Object.entries(fields))assert.equal(profile[key],value);assert.deepEqual(profile.top_eight_order,reordered);
});

test('a changed work, credits or location field cannot useTop8to skip moderation',async()=>{
 for(const key of ['title_lines','credentials','location']){
  const saved=store();await updateProfile(post(fields),saved,options());const before=structuredClone(saved.records.get('profiles/'+owner.id));let calls=0;
  const result=await updateProfile(post({[key]:'A changed draft',top_eight_order:JSON.stringify([...DEFAULT_TOP_EIGHT].reverse())}),saved,options(owner,async()=>{calls++;return verdict('pending');}));
  assert.equal(result.status,202);assert.equal(calls,1);assert.deepEqual(saved.records.get('profiles/'+owner.id),before);
 }
});

test('owner field retries are immutable and each new field is bound into the update digest',async()=>{
 const saved=store(),request_id=randomUUID();await updateProfile(post({...fields,request_id}),saved,options());
 assert.equal((await updateProfile(post({...fields,request_id}),saved,options())).status,200);
 for(const key of ['title_lines','credentials','location'])assert.equal((await updateProfile(post({...fields,request_id,[key]:'Changed'}),saved,options())).status,409);
 const profile=(await publicOwner(saved)).profile;for(const[key,value]of Object.entries(fields))assert.equal(profile[key],value);
});

test('members may describe their own roles and location while owner credits and identity remain protected',async()=>{
 const saved=store();await updateProfile(post(fields),saved,options());const before=structuredClone(saved.records.get('profiles/'+owner.id));
 const result=await updateProfile(post({...fields,id:owner.id}),saved,options(member));assert.equal(result.status,200);
 const profile=(await result.json()).profile;assert.equal(profile.title_lines,fields.title_lines);assert.equal(profile.location,fields.location);assert.equal(profile.credentials,'');assert.deepEqual(saved.records.get('profiles/'+owner.id),before);
});

test('combined maximalownerfields are fully checked within the moderator1000characterlimit',async()=>{
 const saved=store();const input={status:'s'.repeat(160),about_me:'a'.repeat(600),title_lines:'t'.repeat(180),credentials:'c'.repeat(240),location:'l'.repeat(140)};const groups=[];
 const result=await updateProfile(post(input),saved,options(owner,async({message})=>{groups.push(message);return verdict();}));assert.equal(result.status,200);assert.equal(groups.length,2);assert.equal(groups.every(group=>group.length<=1000),true);
 for(const text of Object.values(input))assert.equal(groups.some(group=>group.includes(text)),true);
 const pending=store();let calls=0;
 assert.equal((await updateProfile(post(input),pending,options(owner,async()=>verdict(++calls===2?'pending':'approved')))).status,202);assert.equal(pending.records.has('profiles/'+owner.id),false);
});

test('invalidownerfields failbeforemoderation or writes',async()=>{
 for(const[key,max]of [['title_lines',180],['credentials',240],['location',140]]){
  for(const value of ['x'.repeat(max+1),'bad\u0000text']){
   const saved=store();let calls=0;const result=await updateProfile(post({[key]:value}),saved,options(owner,async()=>{calls++;return verdict();}));assert.equal(result.status,400);assert.equal(calls,0);assert.equal(saved.records.size,0);
  }
 }
});

test('member headlines use moderation and a 100 character limit while legacy updates preserve them',async()=>{
 const saved=store(),headline='Speaker · Church elder · Logistics';let moderated='';
 const result=await updateProfile(post({title_lines:headline}),saved,options(member,async({message})=>{moderated+=message;return verdict();}));
 assert.equal(result.status,200);assert.equal((await result.json()).profile.title_lines,headline);assert(moderated.includes(headline));
 assert.equal((await updateProfile(post({status:'A new day'}),saved,options(member))).status,200);assert.equal(saved.records.get('profiles/'+member.id).title_lines,headline);
 const before=structuredClone(saved.records.get('profiles/'+member.id));
 assert.equal((await updateProfile(post({title_lines:'A pending headline'}),saved,options(member,async()=>verdict('pending')))).status,202);assert.deepEqual(saved.records.get('profiles/'+member.id),before);
 assert.equal((await updateProfile(post({title_lines:'x'.repeat(101)}),saved,options(member))).status,400);assert.deepEqual(saved.records.get('profiles/'+member.id),before);
 assert.equal((await updateProfile(post({title_lines:'x'.repeat(100)}),saved,options(member))).status,200);
});
