import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {getClips} from '../netlify/functions/_shared/member-clips.mts';
import fs from 'node:fs';
const origin='https://jwhitedidit.net';
const alice='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const bob='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const owner='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const sha=v=>createHash('sha256').update(v).digest('hex');
function setup(binding={id:owner}) {
 const records=new Map();
 const store={async get(key){return structuredClone(records.get(key)??null)},async *list({prefix}){yield {blobs:[...records.keys()].filter(k=>k.startsWith(prefix)).map(key=>({key}))}}};
 const profiles={async get(key){assert.equal(key,'owner-binding');return binding}};
 return {records,store,profiles};
}
function add(s,member_id,options={}) {
 const request_id=randomUUID(),id=sha(`${member_id}:${request_id}`),created_at=options.created_at||'2026-09-05T12:00:00Z',digest=sha('synthetic media bytes');
 const clip={id,member_id,request_id,name:member_id===owner?'J.White Did It':'Member',caption:'My own video',created_at,digest,mime:'video/mp4',width:480,height:640,duration:12,size:200};
 const suffix=`${String(9999999999999-Date.parse(created_at)).padStart(13,'0')}-${id}`;
 s.records.set('clips/'+id,clip);
 s.records.set('moderation/'+id,{id,status:options.status||'approved',checked_at:created_at,owner_id:owner});
 s.records.set('submitted/'+suffix,{id,digest});
 s.records.set('published/'+suffix,{id,digest:options.badCommit?sha('wrong'):digest});
 return id;
}
async function read(s,query='') { const r=await getClips(new Request(origin+'/api/clips'+query),s.store,s.profiles);return {status:r.status,data:await r.json()}; }

test('home defaults to JWhite only, including older clients without a query',async()=>{
 const s=setup();add(s,alice);add(s,bob);const id=add(s,owner);
 for(const query of ['', '?member=owner']){const r=await read(s,query);assert.equal(r.status,200);assert.equal(r.data.member_id,owner);assert.deepEqual(r.data.clips.map(c=>c.id),[id]);}
});
test('existing uploaded video stays on its uploader page, not JWhite page; no records are deleted',async()=>{
 const s=setup(),id=add(s,alice),before=structuredClone([...s.records]);
 assert.equal((await read(s,'?member=owner')).data.clips.length,0);
 assert.deepEqual((await read(s,'?member='+alice)).data.clips.map(c=>c.id),[id]);
 assert.equal((await read(s,'?member='+bob)).data.clips.length,0);
 assert.deepEqual([...s.records],before);
});
test('profile selection uses immutable member ID, not an impersonated display name',async()=>{
 const s=setup(),id=add(s,alice);s.records.get('clips/'+id).name='J.White Did It';
 assert.equal((await read(s)).data.clips.length,0);
 assert.equal((await read(s,'?member='+alice)).data.clips[0].id,id);
});
test('missing owner binding never falls back to community videos',async()=>{
 const s=setup(null);add(s,alice);const r=await read(s);
 assert.equal(r.status,200);assert.equal(r.data.member_id,null);assert.deepEqual(r.data.clips,[]);
});
test('broken owner configuration and storage failures are explicit errors',async()=>{
 const s=setup({id:'invalid'});add(s,alice);assert.equal((await read(s)).status,503);
 s.profiles.get=async()=>{throw new Error('Storage offline')};assert.equal((await read(s)).status,503);
});
test('malformed or ambiguous profile filters are rejected, never treated as the community feed',async()=>{
 const s=setup();add(s,alice);
 for(const q of ['?member=', '?member=all', '?member=../owner', '?member=owner&member='+alice])assert.equal((await read(s,q)).status,400);
});
test('scope is applied before the 20 clip limit even with many newer videos from others',async()=>{
 const s=setup(),id=add(s,alice,{created_at:'2026-09-04T12:00:00Z'});
 for(let i=0;i<25;i++)add(s,bob);
 assert.deepEqual((await read(s,'?member='+alice)).data.clips.map(c=>c.id),[id]);
});
test('pending, rejected and uncommitted clips remain hidden on all public profiles',async()=>{
 const s=setup();add(s,alice,{status:'pending'});add(s,alice,{status:'rejected'});add(s,alice,{badCommit:true});
 assert.deepEqual((await read(s,'?member='+alice)).data.clips,[]);
});
test('upper case member links normalize and methods cannot mutate the video feed',async()=>{
 const s=setup(),id=add(s,alice);assert.equal((await read(s,'?member='+alice.toUpperCase())).data.clips[0].id,id);
 assert.equal((await getClips(new Request(origin+'/api/clips',{method:'POST'}),s.store,s.profiles)).status,405);
});
test('deployed handler and both page templates wire the profile scope',()=>{
 const file=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
 assert.match(file('netlify/functions/clips-get.mts'),/getClips\(req, clipsStore\(context\), profileStore\(context\)\)/);
 assert.match(file('index.html'),/data-clip-member="owner"/);
 assert.match(file('profile.html'),/data-clip-member="profile"/);
 assert.match(file('profile.html'),/short-clips\.js\?v=[a-zA-Z0-9-]+/);
 assert.match(file('build.mjs'),/public\/short-clips\.js/);
});

test('one member receives only their newest 20 approved clips',async()=>{
 const s=setup();
 for(let i=0;i<25;i++)add(s,alice,{created_at:new Date(Date.parse('2026-09-05T12:00:00Z')+i*1000).toISOString()});
 const clips=(await read(s,'?member='+alice)).data.clips;
 assert.equal(clips.length,20);
 assert(clips.every((c,i)=>!i||clips[i-1].created_at>=c.created_at));
});
