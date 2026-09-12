import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {getMembers} from '../netlify/functions/_shared/member-directory.mts';
import {mergeDirectoryConnections} from '../netlify/functions/_shared/directory-connections.mts';
import {friendRelationshipsFor,addFriend,respondToFriendRequest} from '../netlify/functions/_shared/friends.mts';
import {POLICY_VERSION} from '../netlify/functions/_shared/comment-moderation.mts';
const viewer={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',name:'A',profession:'beauty_products',location:'Dallas, Texas'};
const person=(digit,profession='creator',other={})=>({id:`${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`,name:digit,profession,relationship:'none',...other});
const context={window:{}};vm.runInNewContext(readFileSync(new URL('../people-connections.js',import.meta.url),'utf8'),context);const {rank}=context.window.RoosterConnections;
function memory(){const data=new Map();return{data,async get(k){return structuredClone(data.get(k)??null)},async setJSON(k,v,o){if(o?.onlyIfNew&&data.has(k))return{modified:false};data.set(k,structuredClone(v));return{modified:true};},async *list({prefix}){yield{blobs:[...data.keys()].filter(k=>k.startsWith(prefix)).map(key=>({key}))}}};}
const req=(path,body)=>new Request('https://jwhitedidit.net'+path,body?{method:'POST',headers:{Origin:'https://jwhitedidit.net','Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);
test('complementary professions rank ahead of loose matches and only explain known public data',()=>{
 const creator=person('b'),hair=person('c','hairstylist'),dj=person('d','dj');
 const result=rank([dj,creator,hair],viewer);assert.deepEqual(Array.from(result,x=>x.member.id),[creator.id,hair.id]);
 assert.match(result[0].reason,/Hair & beauty products.*Content creator/);assert.equal(rank([dj],viewer,'music')[0].member.id,dj.id);
});
test('self, existing or pending relationships, blocks, mutes, declines and duplicates cannot appear',()=>{
 const member=person('b');
 for(const relationship of ['self','accepted','outgoing','incoming','declined','following','unknown'])assert.equal(rank([{...member,relationship}],viewer).length,0,relationship);
 for(const setting of [{blocked:true},{muted:true},{approved:false},{id:viewer.id}])assert.equal(rank([{...member,...setting}],viewer).length,0);
 assert.equal(rank([member,member],viewer).length,1);assert.equal(rank([member],viewer,'all',new Set([member.id])).length,0);
});
test('location uses voluntary coarse names and rejects street numbers or country-only matching',()=>{
 assert.equal(rank([person('b','dj',{location:'Dallas, Texas'})],viewer)[0].sameCity,true);
 for(const location of ['2446 Channel Isle Drive','USA','United States'])assert.equal(rank([person('b','dj',{location})],{...viewer,location}).length,0);
 assert.equal(rank([person('b','creator')],{...viewer,profession:'',location:''}).length,0);
});
test('ranking is bounded and does not use a name, picture, age, gender or a sensitive profile description',()=>{
 const base=person('b');const one=rank([base],viewer)[0];const two=rank([{...base,name:'Other name',photo_url:'/different',age:18,gender:'female',about_me:'sensitive private information'}],viewer)[0];assert.equal(one.score,two.score);assert.equal(one.reason,two.reason);
 assert.equal(rank([...Array(120).fill({...base,relationship:'accepted'}),person('c')],viewer).length,0);
});
test('social state merge respects blocks in both directions, mutes and existing consent states',()=>{
 const b=person('b'),c=person('c'),d=person('d'),e=person('e'),f=person('f');
 const value=mergeDirectoryConnections(viewer.id,{friendStates:{[b.id]:'declined'},blocks:[{blocker:c.id,blocked:viewer.id},{blocker:viewer.id,blocked:d.id}],mutes:[{id:e.id}],follows:[{id:b.id},{id:f.id}],connections:[{requester:b.id,addressee:viewer.id,status:'pending'}]});
 assert.deepEqual([...value.excludedIds].sort(),[c.id,d.id,e.id].sort());assert.equal(value.relationships[b.id],'declined');assert.equal(value.relationships[f.id],'following');assert.equal(value.relationships[viewer.id],'self');
});
test('directory returns approved public work fields, filters excluded/unapproved IDs and never includes account metadata',async()=>{
 const profiles=memory(),directory=memory(),presence=memory();const b=person('b'),c=person('c'),d=person('d');
 for(const member of [viewer,b,c,d]){
  profiles.data.set('public-members/'+member.id,{id:member.id,name:member.name,email:'secret@example.com'});
  profiles.data.set('profiles/'+member.id,{...member,status:'Hello',title_lines:'Public work',location:'Dallas, Texas',about_me:'Public bio',credentials:'Public credentials',photo_id:null,updated_at:'2026-09-11T12:00:00Z',approved:true,policy_version:POLICY_VERSION,email:'secret@example.com'});
 }
 const response=await getMembers(req('/api/members'),profiles,directory,presence,{viewerId:viewer.id,relationships:{[b.id]:'outgoing'},excludedIds:new Set([c.id]),approvedIds:async()=>new Set([viewer.id,b.id,c.id])});
 assert.equal(response.status,200);const value=await response.json();assert.equal(value.total,2);assert.deepEqual(value.members.map(x=>x.id).sort(),[viewer.id,b.id].sort());
 assert.equal(value.members.find(x=>x.id===b.id).profession,'creator');assert.equal(value.members.find(x=>x.id===b.id).relationship,'outgoing');assert.equal(value.connection_context.viewer.profession,'beauty_products');assert(!JSON.stringify(value).includes('secret'));assert(!JSON.stringify(value).includes('Public bio'));
});
test('friend state reader uses real accepted/pending/declined consent with no automatic acceptance',async()=>{
 const profiles=memory(),friends=memory(),b=person('b');for(const m of [viewer,b])profiles.data.set('public-members/'+m.id,m);
 let result=await addFriend(req('/api/friends/add?target_id='+b.id,{}),friends,async()=>viewer,profiles);assert.equal(result.status,200);const sent=await result.json();
 assert.equal((await friendRelationshipsFor(viewer.id,friends,profiles))[b.id],'outgoing');assert.equal((await friendRelationshipsFor(b.id,friends,profiles))[viewer.id],'incoming');
 result=await respondToFriendRequest(req('/api/friend-requests/respond',{request_id:sent.request_id,action:'accept'}),friends,async()=>b,profiles);assert.equal(result.status,200);
 assert.equal((await friendRelationshipsFor(viewer.id,friends,profiles))[b.id],'accepted');
});

test('new work professions stay discoverable through relevant work and services goals',()=>{
 const speaker=person('b','speaker'),ministry=person('c','ministry'),logistics=person('d','logistics');
 assert.equal(rank([speaker],{...viewer,profession:'ministry'})[0].member.id,speaker.id);
 assert.equal(rank([logistics],{...viewer,profession:'business'})[0].member.id,logistics.id);
 assert.deepEqual(Array.from(rank([speaker,ministry,logistics],viewer,'services'),x=>x.member.id),[speaker.id,ministry.id,logistics.id]);
});
