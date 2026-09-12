import test from 'node:test';
import assert from 'node:assert/strict';
import { getOwnProfile, getPublicProfile } from '../netlify/functions/_shared/member-profiles.mts';
import { getFriendCount, addFriend } from '../netlify/functions/_shared/friends.mts';
import { registerPublicMember, listRegisteredMembers } from '../netlify/functions/_shared/community-members.mts';
import { MemberError } from '../netlify/functions/_shared/member-auth.mts';
import { POLICY_VERSION } from '../netlify/functions/_shared/comment-moderation.mts';

const origin = 'https://jwhitedidit.net';
const alice = {id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',name:'Alice',isOwner:false};
const bob = {id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',name:'Bob',isOwner:false};
const owner = {id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',name:'JWhite',isOwner:true};
function memory() {
  const records=new Map();let version=0;const tags=new Map();
  return {records,
    async get(key) {return structuredClone(records.get(key) ?? null);},
    async getWithMetadata(key) {return records.has(key)?{data:structuredClone(records.get(key)),etag:tags.get(key)}:null;},
    async setJSON(key,value,options={}) {
      if(options.onlyIfNew && records.has(key))return {modified:false};
      if(options.onlyIfMatch && tags.get(key)!==options.onlyIfMatch)return {modified:false};
      records.set(key,structuredClone(value));tags.set(key,String(++version));return {modified:true};
    },
    async set(key,value,options){return this.setJSON(key,value,options);},
    async *list({prefix}) {const keys=[...records.keys()].filter(key=>key.startsWith(prefix));for(let n=0;n<keys.length;n+=2)yield {blobs:keys.slice(n,n+2).map(key=>({key}))};},
  };
}
function setup(bind=true){const profiles=memory(),directory=memory(),friends=memory();if(bind)profiles.records.set('owner-binding',{id:owner.id});return {profiles,directory,friends};}
function profileRequest(id){return new Request(`${origin}/api/profile?id=${encodeURIComponent(id)}`);}
function friendRequest(target='owner'){return new Request(`${origin}/api/friends?target_id=${target}`);}
async function visible(state,id=alice.id){return getPublicProfile(profileRequest(id),state.profiles,state);}
async function friendData(state,id='owner'){const response=await getFriendCount(friendRequest(id),state.friends,state.profiles,state.directory);assert.equal(response.status,200);return response.json();}
const approved = (member) => ({id:member.id,name:member.name,status:'Making music',about_me:'My music page',title_lines:'',credentials:'',location:'',photo_id:null,updated_at:'2026-09-05T12:00:00Z',approved:true,policy_version:POLICY_VERSION});

test('a verified first page load creates a public basic profile without a manual save',async()=>{
 const state=setup();assert.equal((await visible(state)).status,404);
 const response=await getOwnProfile(new Request(origin+'/api/profile/me'),state.profiles,{resolveMember:async()=>({...alice,email:'private@example.test',token:'hidden-secret'}),directory:state.directory});
 assert.equal(response.status,200);
 const page=await visible(state);assert.equal(page.status,200);const data=await page.json();
 assert.equal(data.profile.id,alice.id);assert.equal(data.profile.name,'Alice');assert.equal(data.profile.profile_pending,true);assert.equal(data.profile.verified_owner,false);
 assert(!JSON.stringify(data).includes('private@example.test'));assert(!JSON.stringify(data).includes('hidden-secret'));
 assert.equal(state.profiles.records.has('profiles/'+alice.id),false,'basic pages do not bypass moderation for edited content');
});

test('legacy directory members open a basic profile instead of an unpublished-page error',async()=>{
 const state=setup();state.directory.records.set('members/'+alice.id,{...alice,email:'private@example.test'});
 const response=await visible(state);assert.equal(response.status,200);assert.equal((await response.json()).profile.name,'Alice');
});

test('legacy people already in JWhite friends open a page even if no directory or profile was saved',async()=>{
 for(const target of ['owner',owner.id]){const state=setup();state.friends.records.set(`target/${target}/${alice.id}`,{member_id:alice.id,member_name:alice.name,created_at:'2026-09-05T12:00:00Z'});
 const response=await visible(state);assert.equal(response.status,200);assert.equal((await response.json()).profile.name,'Alice');}
});

test('existing edited profiles and photo URLs are preserved by registration',async()=>{
 const state=setup();state.profiles.records.set('profiles/'+alice.id,{...approved(alice),name:'Alice Music',photo_id:'a'.repeat(64)});
 const before=structuredClone(state.profiles.records.get('profiles/'+alice.id));
 await registerPublicMember(alice,state.profiles,state.directory);
 const data=await(await visible(state)).json();assert.equal(data.profile.name,'Alice Music');assert.equal(data.profile.about_me,'My music page');assert.equal(data.profile.photo_url,'/api/profile-photo/'+'a'.repeat(64));
 assert.deepEqual(state.profiles.records.get('profiles/'+alice.id),before);
});

test('unknown IDs and corrupted or unapproved saved profiles remain unavailable',async()=>{
 const state=setup();assert.equal((await visible(state)).status,404);assert.equal((await visible(state,'bad-id')).status,400);
 await registerPublicMember(alice,state.profiles,state.directory);
 for(const raw of [{...approved(alice),approved:false},{...approved(alice),policy_version:'invalid'},{...approved(alice),id:bob.id}]){
 state.profiles.records.set('profiles/'+alice.id,raw);assert.equal((await visible(state)).status,404);}
});

test('unconfirmed or unauthorized accounts cannot register a public page',async()=>{
 const state=setup();const response=await getOwnProfile(new Request(origin+'/api/profile/me'),state.profiles,{resolveMember:async()=>{throw new MemberError(403,'Confirm email');},directory:state.directory});
 assert.equal(response.status,403);assert.equal(state.profiles.records.has('public-members/'+alice.id),false);assert.equal(state.directory.records.size,0);
});

test('raw public registration is discoverability-only; verified welcome provisioning owns the automatic JWhite edge',async()=>{
 const state=setup();await registerPublicMember(alice,state.profiles,state.directory);await registerPublicMember(bob,state.profiles,state.directory);
 assert.equal((await friendData(state)).count,0);
 for(const member of [alice,bob]){const result=await friendData(state,member.id);assert.equal(result.count,0);assert.deepEqual(result.friends,[]);}
});

test('directory-only and saved-profile members do not count as accepted friends',async()=>{
 const state=setup();state.directory.records.set('members/'+alice.id,alice);state.directory.records.set('members/'+owner.id,owner);state.profiles.records.set('profiles/'+bob.id,approved(bob));
 const result=await friendData(state);assert.equal(result.count,0);assert.deepEqual(result.friends,[]);
 assert.equal((await friendData(state,owner.id)).count,0);
});

test('without the verified welcome provisioner, repeated registration and legacy aliases remain one pending request',async()=>{
 const state=setup();await Promise.all(Array.from({length:20},()=>registerPublicMember(alice,state.profiles,state.directory)));
 for(const target of ['owner',owner.id])state.friends.records.set(`target/${target}/${alice.id}`,{member_id:alice.id,member_name:'Old name',created_at:'2026-09-05T12:00:00Z'});
 state.directory.records.set('members/'+bob.id,bob);
 assert.equal((await friendData(state)).count,0);
 const response=await addFriend(new Request(origin+'/api/friends/add?target_id=owner',{method:'POST',headers:{Origin:origin}}),state.friends,async()=>alice,state.profiles,state.directory);
 const data=await response.json();assert.equal(data.count,0);assert.equal(data.added,false);assert.equal(data.request_created,false);assert.equal(data.state,'outgoing');
});

test('without an owner binding the official owner page still works without inventing a friendship',async()=>{
 const state=setup(false);await registerPublicMember(alice,state.profiles,state.directory);
 const data=await friendData(state,alice.id);assert.equal(data.count,0);assert.deepEqual(data.friends,[]);
 assert.equal((await visible(state,'owner')).status,200);
});

test('malformed directory entries never become profiles or inflate totals',async()=>{
 const state=setup();for(const value of [{id:bob.id,name:'Mismatch'},{id:alice.id,name:'private@example.test'},{id:alice.id,name:'Alice',disabled:true}]){
 state.directory.records.set('members/'+alice.id,value);assert.equal((await friendData(state)).count,0);assert.equal((await visible(state)).status,404);}
});

test('storage failures show an unavailable result rather than a false zero or fake page',async()=>{
 const state=setup();state.directory.get=async()=>{throw new Error('storage down');};assert.equal((await visible(state)).status,503);
 state.friends.list=async function*(){throw new Error('storage down');};assert.equal((await getFriendCount(friendRequest(),state.friends,state.profiles,state.directory)).status,503);
});

test('registration checks that the write really landed, not only the SDK modified flag',async()=>{
 const state=setup();state.profiles.setJSON=async()=>({modified:true});await assert.rejects(registerPublicMember(alice,state.profiles,state.directory),/not saved/);
});

test('member list enumeration refuses an incomplete total beyond its safety bound',async()=>{
 const profiles=memory();profiles.list=async function*(){for(let n=0;n<101;n++)yield {blobs:[]};};await assert.rejects(listRegisteredMembers(profiles),error=>error.status===503);
});
