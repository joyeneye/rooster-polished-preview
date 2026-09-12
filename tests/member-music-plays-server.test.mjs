import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { getMemberMusicPlays, postMemberMusicPlay } from '../netlify/functions/_shared/member-music-plays.mts';
import { deleteMemberSong, saveMemberSongLink } from '../netlify/functions/_shared/member-songs.mts';
import { POLICY_VERSION } from '../netlify/functions/_shared/comment-moderation.mts';
import { config as getConfig } from '../netlify/functions/member-music-plays-get.mts';
import { config as postConfig } from '../netlify/functions/member-music-plays-post.mts';

const origin='https://jwhitedidit.net';
const NOW=Date.parse('2026-09-06T18:00:00Z');
const alice={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',name:'Alice',isOwner:false};
const bob={id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',name:'Bob',isOwner:false};
const noPause=async()=>{};

function memory(){
  const records=new Map(),etags=new Map();let revision=0,writes=0;
  return{records,etags,get writes(){return writes;},
    async get(key){return structuredClone(records.get(key)??null);},
    async getWithMetadata(key){return records.has(key)?{data:structuredClone(records.get(key)),etag:etags.get(key)}:null;},
    async setJSON(key,value,options={}){if(options.onlyIfNew&&records.has(key))return{modified:false};if(options.onlyIfMatch&&options.onlyIfMatch!==etags.get(key))return{modified:false};records.set(key,structuredClone(value));etags.set(key,String(++revision));writes++;return{modified:true};},
    async set(key,value,options={}){return this.setJSON(key,value,options);},
  };
}

async function setup(){
  const songs={songs:memory(),profiles:memory()};
  for(const member of [alice,bob])await songs.profiles.setJSON('profiles/'+member.id,{id:member.id,name:member.name,status:'MORE!',about_me:'',photo_id:null,updated_at:'2026-09-06T00:00:00Z',approved:true,policy_version:POLICY_VERSION});
  return{songs,plays:memory()};
}
const own=member=>({resolveMember:async()=>member});
const jsonPost=(path,body,headers={})=>new Request(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
async function addLink(stores,member=alice,{slot=1,revision='',title=`${member.name} song`,url='https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC'}={}){
  const req=jsonPost('/api/member-songs/link',{slot,title,url,request_id:randomUUID(),revision});
  const response=await saveMemberSongLink(req,stores,own(member));assert.equal(response.status,201);return(await response.json()).slot;
}
const get=(stores,member=alice)=>getMemberMusicPlays(new Request(`${origin}/api/member-music-plays?id=${member.id}`),stores.plays,stores.songs,NOW);
const play=(stores,member,song,session=randomUUID(),requestOverrides={})=>postMemberMusicPlay(jsonPost('/api/member-music-plays/post',{member_id:member.id,slot:song.slot,revision:song.revision,session_id:session},requestOverrides.headers),stores.plays,stores.songs,NOW,noPause);

test('member counters start at zero, count explicit plays and dedupe one song per session',async()=>{
  const stores=await setup(),song=await addLink(stores.songs),session=randomUUID();
  let response=await get(stores);assert.equal(response.status,200);assert.deepEqual(await response.json(),{counts:{[song.revision]:0},total:0,today:0,max_songs:3});assert.equal(stores.plays.writes,0);
  response=await play(stores,alice,song,session);assert.equal(response.status,201);assert.deepEqual(await response.json(),{counts:{[song.revision]:1},total:1,today:1,max_songs:3});
  response=await play(stores,alice,song,session);assert.equal(response.status,200);assert.equal((await response.json()).total,1);
  response=await play(stores,alice,song);assert.equal(response.status,201);assert.equal((await response.json()).total,2);
  assert.equal(getConfig.path,'/api/member-music-plays');assert.equal(getConfig.rateLimit.windowLimit,120);assert.equal(postConfig.path,'/api/member-music-plays/post');assert.equal(postConfig.rateLimit.windowLimit,30);
});

test('member IDs isolate counters and concurrent sessions survive CAS retries',async()=>{
  const stores=await setup(),aliceSong=await addLink(stores.songs,alice),bobSong=await addLink(stores.songs,bob);
  const responses=await Promise.all([play(stores,alice,aliceSong),play(stores,alice,aliceSong),play(stores,bob,bobSong)]);assert.deepEqual(responses.map(response=>response.status).sort(),[201,201,201]);
  assert.equal((await(await get(stores,alice)).json()).total,2);assert.equal((await(await get(stores,bob)).json()).total,1);assert.equal(stores.plays.records.size,2);
});

test('replacing a song resets its row count without erasing the profile total',async()=>{
  const stores=await setup(),oldSong=await addLink(stores.songs);await play(stores,alice,oldSong);
  const replacement=await addLink(stores.songs,alice,{revision:oldSong.revision,title:'Replacement',url:'https://www.youtube.com/watch?v=dQw4w9WgXcQ'});
  const snapshot=await(await get(stores)).json();assert.deepEqual(snapshot.counts,{[replacement.revision]:0});assert.equal(snapshot.total,1);assert.equal(snapshot.today,1);
  assert.equal((await play(stores,alice,oldSong)).status,409);const counted=await play(stores,alice,replacement);assert.equal(counted.status,201);assert.deepEqual(await counted.json(),{counts:{[replacement.revision]:1},total:2,today:2,max_songs:3});
});

test('stale, cross-site and malformed play reports fail without changing counts',async()=>{
  const stores=await setup(),song=await addLink(stores.songs);const valid={member_id:alice.id,slot:song.slot,revision:song.revision,session_id:randomUUID()};
  const cases=[
    [jsonPost('/api/member-music-plays/post',{...valid,slot:4}),400],
    [jsonPost('/api/member-music-plays/post',{...valid,revision:'bad'}),400],
    [jsonPost('/api/member-music-plays/post',valid,{Origin:'https://example.com'}),403],
    [jsonPost('/api/member-music-plays/post',valid,{'Content-Type':'text/plain'}),415],
    [jsonPost('/api/member-music-plays/post','{bad'),400],
    [jsonPost('/api/member-music-plays/post',JSON.stringify({...valid,padding:'x'.repeat(2200)})),413],
  ];
  const missing=jsonPost('/api/member-music-plays/post',valid);missing.headers.delete('Origin');cases.push([missing,403]);
  for(const [request,status] of cases)assert.equal((await postMemberMusicPlay(request,stores.plays,stores.songs,NOW,noPause)).status,status);
  assert.equal(stores.plays.writes,0);
  const deleted=jsonPost('/api/member-songs/delete',{slot:1,revision:song.revision,request_id:randomUUID()});assert.equal((await deleteMemberSong(deleted,stores.songs,own(alice))).status,200);
  assert.equal((await play(stores,alice,song)).status,409);assert.equal(stores.plays.writes,0);
});

test('damaged count state is never replaced with zeros',async()=>{
  const stores=await setup(),song=await addLink(stores.songs);await stores.plays.setJSON(`counts-v1/${alice.id}`,{bad:true},{onlyIfNew:true});const writes=stores.plays.writes;
  assert.equal((await get(stores)).status,503);assert.equal((await play(stores,alice,song)).status,503);assert.equal(stores.plays.writes,writes);
});
