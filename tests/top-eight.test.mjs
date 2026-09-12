import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DEFAULT_TOP_EIGHT, TOP_EIGHT, readTopEightOrder } from '../netlify/functions/_shared/top-eight-order.mts';
import { updateProfile, getPublicProfile, getOwnProfile } from '../netlify/functions/_shared/member-profiles.mts';
import { POLICY_VERSION } from '../netlify/functions/_shared/comment-moderation.mts';
const origin='https://jwhitedidit.net';
const owner={id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',name:'J.White Did It',isOwner:true};
const member={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',name:'Alice',isOwner:false};
const reverse=[...DEFAULT_TOP_EIGHT].reverse();
function store(){const records=new Map(),tags=new Map();let n=0;return{records,async get(key){return structuredClone(records.get(key)??null);},async getWithMetadata(key){return records.has(key)?{data:structuredClone(records.get(key)),etag:tags.get(key)}:null;},async setJSON(key,value,opts={}){if((opts.onlyIfNew&&records.has(key))||(opts.onlyIfMatch!==undefined&&opts.onlyIfMatch!==tags.get(key)))return{modified:false};records.set(key,structuredClone(value));tags.set(key,String(++n));return{modified:true};}};}
function post(fields={}){const form=new FormData();for(const[key,value]of Object.entries({status:'MORE!',request_id:randomUUID(),...fields}))form.set(key,String(value));return new Request(origin+'/api/profile/update',{method:'POST',headers:{Origin:origin},body:form});}
const options=(who=owner,moderate=async()=>({status:'approved',reason:'positive_or_respectful',policy_version:POLICY_VERSION,checked_at:new Date().toISOString()}))=>({resolveMember:async()=>who,moderate});
const publicOwner=async saved=>(await getPublicProfile(new Request(origin+'/api/profile?id=owner'),saved)).json();

test('order validation is an exact permutation of the existing eight songs including Spend Dat',async()=>{
 assert.deepEqual(readTopEightOrder(reverse),reverse);
 for(const invalid of [[],reverse.slice(1),[...reverse,reverse[0]],Array(8).fill(reverse[0]),[...reverse.slice(0,7),'fake-id'],'["fake"]',null])assert.equal(readTopEightOrder(invalid),null);
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/data-top-eight-roster[^>]*data-target="self"/);assert.match(html,/data-top-eight-edit/);assert.match(html,/data-top-eight-save/);assert.equal(TOP_EIGHT[0].title,'Spend Dat');
});

test('owner reordered Top8 persists publicly and omitted fields preserve its order and About Me',async()=>{
 const saved=store();
 const result=await updateProfile(post({about_me:'A positive music biography.',top_eight_order:JSON.stringify(reverse)}),saved,options());assert.equal(result.status,200);
 assert.deepEqual((await result.json()).profile.top_eight_order,reverse);assert.deepEqual((await publicOwner(saved)).profile.top_eight_order,reverse);
 const next=await updateProfile(post({status:'More music coming.'}),saved,options());assert.equal(next.status,200);
 const profile=(await publicOwner(saved)).profile;assert.deepEqual(profile.top_eight_order,reverse);assert.equal(profile.about_me,'A positive music biography.');assert.equal(profile.photo_url,'/profile.jpg');
});

test('visitors and ordinary members cannot submit Top8 changes or spoof owner IDs',async()=>{
 const saved=store();await updateProfile(post(),saved,options());const before=structuredClone(saved.records);
 for(const who of [member,{...member,isOwner:true}])assert.equal((await updateProfile(post({top_eight_order:JSON.stringify(reverse),id:owner.id,owner_id:owner.id}),saved,options(who))).status,403);
 const signedOut=options();signedOut.resolveMember=async()=>{const error=new Error('Login required');error.status=401;throw error;};
 assert.notEqual((await updateProfile(post({top_eight_order:JSON.stringify(reverse)}),saved,signedOut)).status,200);
 assert.deepEqual(saved.records,before);
 const personal=await getOwnProfile(new Request(origin+'/api/profile/me'),saved,options(member));assert.equal('top_eight_order'in(await personal.json()).profile,false);
});

test('invalid orders cannot drop Spend Dat, duplicate songs or write arbitrary tracks',async()=>{
 for(const value of [JSON.stringify(reverse.slice(0,7)),JSON.stringify(Array(8).fill(reverse[0])),JSON.stringify([...reverse.slice(0,7),'malicious']),'{invalid']){
  const saved=store();let reviewed=false;const opts=options(owner,async()=>{reviewed=true;throw Error();});
  assert.equal((await updateProfile(post({top_eight_order:value}),saved,opts)).status,400);assert.equal(saved.records.size,0);assert.equal(reviewed,false);
 }
});

test('order-only saves reuse approved text while changed text still needs moderation',async()=>{
 const saved=store();await updateProfile(post({about_me:'Already approved bio.'}),saved,options());let calls=0;
 const unavailable=options(owner,async()=>{calls++;throw Error('offline');});
 assert.equal((await updateProfile(post({top_eight_order:JSON.stringify(reverse)}),saved,unavailable)).status,200);assert.equal(calls,0);
 const pending=await updateProfile(post({status:'New text',top_eight_order:JSON.stringify(DEFAULT_TOP_EIGHT)}),saved,unavailable);assert.equal(pending.status,202);assert.equal(calls,1);
 assert.deepEqual((await publicOwner(saved)).profile.top_eight_order,reverse);
});

test('changed idempotency payload and CAS conflicts cannot overwrite a newer Top8',async()=>{
 const saved=store();const request_id=randomUUID();await updateProfile(post({request_id,top_eight_order:JSON.stringify(reverse)}),saved,options());
 assert.equal((await updateProfile(post({request_id,top_eight_order:JSON.stringify(reverse)}),saved,options())).status,200);
 assert.equal((await updateProfile(post({request_id,top_eight_order:JSON.stringify(DEFAULT_TOP_EIGHT)}),saved,options())).status,409);
 const write=saved.setJSON.bind(saved);saved.setJSON=async(key,value,opts)=>key.startsWith('profiles/')?{modified:false}:write(key,value,opts);
 assert.equal((await updateProfile(post({top_eight_order:JSON.stringify(DEFAULT_TOP_EIGHT)}),saved,options())).status,409);assert.deepEqual((await publicOwner(saved)).profile.top_eight_order,reverse);
});

test('public homepage applies only valid saved order by moving its existing song nodes',async()=>{
 const source=await readFile(new URL('../profile-owner.js',import.meta.url),'utf8');
 async function run(order){
  const nodes=DEFAULT_TOP_EIGHT.map(id=>({getAttribute:key=>key==='data-track'?id:null,original:true}));
  const grid={nodes:[...nodes],querySelectorAll(){return this.nodes;},replaceChildren(...next){this.nodes=next;}};
  const status={textContent:''};const document={hidden:false,querySelector:selector=>selector==='.top-eight-grid'?grid:selector==='.profile-tagline'?status:null,querySelectorAll:()=>[],addEventListener(){}};
  vm.runInNewContext(source,{document,window:{addEventListener(){}},AbortController,setTimeout,clearTimeout,fetch:async()=>({ok:true,json:async()=>({profile:{status:'MORE!',top_eight_order:order,photo_url:null}})})});await new Promise(resolve=>setImmediate(resolve));return{grid,nodes};
 }
 const valid=await run(reverse);assert.deepEqual(valid.grid.nodes.map(node=>node.getAttribute('data-track')),reverse);assert.equal(valid.grid.nodes.every(node=>valid.nodes.includes(node)),true);
 for(const invalid of [[...reverse.slice(0,7),'bad'],Array(8).fill(reverse[0]),undefined]){const result=await run(invalid);assert.deepEqual(result.grid.nodes,result.nodes);}
});
