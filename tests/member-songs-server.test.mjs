import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { getOwnSongs, getMemberSongs, uploadMemberSong, saveMemberSongLink, deleteMemberSong, checkMemberSong, getMemberSongAudio, parseMusicLink, resolveMusicLink, manageFeaturedSongs } from '../netlify/functions/_shared/member-songs.mts';
import { MemberError } from '../netlify/functions/_shared/member-auth.mts';
import { POLICY_VERSION } from '../netlify/functions/_shared/comment-moderation.mts';
import { SONG_MODERATION_POLICY_VERSION } from '../netlify/functions/_shared/video-moderation.mts';
import { config as uploadConfig } from '../netlify/functions/member-songs-upload.mts';
import { config as checkConfig } from '../netlify/functions/member-songs-check.mts';
import { config as linkConfig } from '../netlify/functions/member-songs-link.mts';

const origin = 'https://jwhitedidit.net';
const alice = { id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name:'Alice', isOwner:false };
const bob = { id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name:'Bob', isOwner:false };
const own = member => ({ resolveMember: async () => member });
const approved = { status:'approved', policy_version:SONG_MODERATION_POLICY_VERSION, reason:'Positive music.' };
const media = async (alternative = false) => new File([await readFile(new URL(`./fixtures/member-song${alternative ? '-alt' : ''}.mp3`, import.meta.url))], 'GPS-name-private.mp3', { type:'audio/mpeg' });
function memory() {
  const records = new Map(), etags = new Map(), reads = []; let revision = 0;
  return { records, etags, reads,
    async get(key) { reads.push(key); return structuredClone(records.get(key) ?? null); },
    async getWithMetadata(key) { reads.push(key); return records.has(key) ? {data:structuredClone(records.get(key)),etag:etags.get(key)} : null; },
    async setJSON(key,value,options={}) {
      if (options.onlyIfNew && records.has(key)) return {modified:false};
      if (options.onlyIfMatch && options.onlyIfMatch !== etags.get(key)) return {modified:false};
      records.set(key,structuredClone(value)); etags.set(key,String(++revision)); return {modified:true};
    },
    async set(key,value,options={}) { return this.setJSON(key,value,options); },
  };
}
async function stores(published = true) {
  const value = {songs:memory(),profiles:memory()};
  if (published) for (const member of [alice,bob]) await value.profiles.setJSON('profiles/'+member.id, {
    id:member.id,name:member.name,status:'MORE!',about_me:'',photo_id:null,updated_at:'2026-09-05T00:00:00Z',approved:true,policy_version:POLICY_VERSION,
  });
  return value;
}
function upload(file,values={},extra=[]) {
  const form = new FormData();
  for (const [key,value] of Object.entries({slot:'1',title:'My song',request_id:randomUUID(),revision:'',...values})) form.append(key,value);
  if(file!==undefined) form.append('audio',file);
  for(const [key,value] of extra)form.append(key,value);
  return new Request(origin+'/api/member-songs/upload',{method:'POST',headers:{Origin:origin},body:form});
}
function post(path,body) { return new Request(origin+'/api/member-songs/'+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)}); }
const me = async (s,member=alice) => (await getOwnSongs(new Request(origin+'/api/member-songs/me?member_id='+bob.id),s,own(member))).json();
const list = async (s,id=alice.id) => (await getMemberSongs(new Request(origin+'/api/member-songs?id='+id),s)).json();
const saved = (s,id=alice.id,slot=1) => s.songs.records.get('slots/'+id+'/'+slot);
const urlFor = song => `/api/member-song-audio/${song.member_id}/${song.slot}/${song.asset_id}`;
const audio = (s,url,headers) => getMemberSongAudio(new Request(origin+url,{headers}),s);
const featureRequest=(body,method='POST')=>new Request(origin+'/api/profile-music-features',{method,headers:{Origin:origin,'Content-Type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(body)})});
async function add(s,values={},member=alice) {
  const response = await uploadMemberSong(upload(await media(),values),s,own(member));
  assert.equal(response.status,202); return (await response.json()).slot;
}
async function review(s,slot,decision=approved,member=alice) {
  return checkMemberSong(post('check',{slot:slot.slot,revision:slot.revision}),s,{...own(member),moderate:async()=>decision});
}
async function addLink(s,values={},member=alice) {
  return saveMemberSongLink(post('link',{slot:1,title:'My linked song',url:'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC',request_id:randomUUID(),revision:'',...values}),s,own(member));
}

test('the original 26-song catalog belongs only to the verified owner profile',async()=>{
  const s=await stores();await s.profiles.setJSON('owner-binding',{id:alice.id});
  const owner=await list(s,alice.id);assert.equal(owner.catalog_songs.length,26);assert.equal(owner.max_songs,3);
  assert.equal(owner.catalog_songs[0].title,'Spend Dat · Yung Miami');
  assert.equal((await list(s,'owner')).catalog_songs.length,26);
  assert.deepEqual((await list(s,bob.id)).catalog_songs,[]);
});

test('any profession may feature approved member music with original attribution and no media copy',async()=>{
  const s=await stores();const profile=s.profiles.records.get('profiles/'+alice.id);await s.profiles.setJSON('profiles/'+alice.id,{...profile,profession:'barber'});
  const source=(await (await addLink(s,{url:'https://youtu.be/dQw4w9WgXcQ'},bob)).json()).slot;
  const input={source_member_id:bob.id,slot:1,revision:source.revision};
  const result=await manageFeaturedSongs(featureRequest(input),s,own(alice));assert.equal(result.status,201);
  const data=await result.json();assert.equal(data.featured[0].song.origin.member_id,bob.id);assert.equal(data.featured[0].song.origin.name,'Bob');
  const exposed=(await list(s,alice.id)).featured_songs;assert.equal(exposed.length,1);assert.equal(exposed[0].external_url,source.external_url);
  assert.equal(saved(s,alice.id),undefined,'no copy is added to the featuring member’s original songs');
  const raw=s.songs.records.get('featured/'+alice.id)[0];assert.equal(raw.title,undefined);assert.equal(raw.external_url,undefined);
  assert.equal((await manageFeaturedSongs(featureRequest(input),s,own(alice))).status,200);assert.equal(s.songs.records.get('featured/'+alice.id).length,1);
});

test('feature mutations derive the target from the session and cannot remove someone else’s picks',async()=>{
  const s=await stores();const source=(await (await addLink(s,{},bob)).json()).slot;const input={source_member_id:bob.id,slot:1,revision:source.revision};
  const denied={resolveMember:async()=>{throw new MemberError(401,'Log in.');}};
  assert.equal((await manageFeaturedSongs(featureRequest(input),s,denied)).status,401);
  assert.equal((await manageFeaturedSongs(featureRequest({...input,member_id:bob.id}),s,own(alice))).status,400);
  const data=await (await manageFeaturedSongs(featureRequest(input),s,own(alice))).json();const id=data.featured[0].id;
  assert.equal((await manageFeaturedSongs(featureRequest({feature_id:id},'DELETE'),s,own(bob))).status,200);
  assert.equal((await list(s,alice.id)).featured_songs.length,1);
  await manageFeaturedSongs(featureRequest({feature_id:id},'DELETE'),s,own(alice));assert.equal((await list(s,alice.id)).featured_songs.length,0);
  assert.equal((await list(s,bob.id)).songs.length,1);
});

test('removed, changed, or unapproved source songs never remain public as featured music',async()=>{
  const s=await stores();const pending=await add(s,{},bob);
  const ref={source_member_id:bob.id,slot:1,revision:pending.revision};
  assert.equal((await manageFeaturedSongs(featureRequest(ref),s,own(alice))).status,404);
  await review(s,pending,approved,bob);assert.equal((await manageFeaturedSongs(featureRequest(ref),s,own(alice))).status,201);
  assert.equal((await list(s,alice.id)).featured_songs[0].url,urlFor(saved(s,bob.id)));
  await deleteMemberSong(post('delete',{slot:1,revision:pending.revision,request_id:randomUUID()}),s,own(bob));
  assert.deepEqual((await list(s,alice.id)).featured_songs,[]);
  const privateList=await (await manageFeaturedSongs(featureRequest(null,'GET'),s,own(alice))).json();assert.equal(privateList.featured[0].song,null,'owners can still remove a stale reference');
});

test('featured music has a three-song limit and catalog songs also keep their original reference',async()=>{
  const s=await stores();
  for(let slot=1;slot<=3;slot++){const source=(await (await addLink(s,{slot},bob)).json()).slot;assert.equal((await manageFeaturedSongs(featureRequest({source_member_id:bob.id,slot,revision:source.revision}),s,own(alice))).status,201);}
  assert.equal((await manageFeaturedSongs(featureRequest({catalog_video_id:'NSZ26l3DIKE'}),s,own(alice))).status,409);
  const first=s.songs.records.get('featured/'+alice.id)[0];await manageFeaturedSongs(featureRequest({feature_id:first.id},'DELETE'),s,own(alice));
  assert.equal((await manageFeaturedSongs(featureRequest({catalog_video_id:'NSZ26l3DIKE'}),s,own(alice))).status,201);
  assert.equal((await list(s,alice.id)).featured_songs.find(song=>song.catalog_video_id)?.origin.member_id,'owner');
});

test('a removed catalog song stays unavailable and removable in the member’s music settings',async()=>{
  const s=await stores();const id=randomUUID();
  await s.songs.setJSON('featured/'+alice.id,[{id,source_member_id:'owner',slot:27,revision:'catalog:removed0001',catalog_video_id:'removed0001'}]);
  const response=await manageFeaturedSongs(featureRequest(null,'GET'),s,own(alice));assert.equal(response.status,200);
  assert.deepEqual((await response.json()).featured,[{id,song:null}]);
  assert.deepEqual((await list(s,alice.id)).featured_songs,[]);
  const removed=await manageFeaturedSongs(featureRequest({feature_id:id},'DELETE'),s,own(alice));assert.equal(removed.status,200);
  assert.deepEqual((await removed.json()).featured,[]);
});

test('verified membership and server ownership protect every manager action',async()=>{
  const s=await stores(), denied={resolveMember:async()=>{throw new MemberError(401,'Log in.');}};
  for(const response of [await getOwnSongs(new Request(origin+'/api/member-songs/me'),s,denied),await uploadMemberSong(upload(await media()),s,denied),await saveMemberSongLink(post('link',{slot:1,title:'Song',url:'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC',request_id:randomUUID(),revision:''}),s,denied),await deleteMemberSong(post('delete',{slot:1,revision:null,request_id:randomUUID()}),s,denied),await checkMemberSong(post('check',{slot:1,revision:null}),s,denied)]) assert.equal(response.status,401);
  assert.equal(s.songs.records.size,0);
  const initial=await me(s); assert.equal(initial.user.id,alice.id); assert.deepEqual(initial.slots.map(v=>v.status),['empty','empty','empty']);
  const a=await add(s,{member_id:bob.id}); assert.ok(saved(s)); assert.equal(saved(s,bob.id),undefined);
  assert.deepEqual((await me(s,bob)).slots.map(v=>v.status),['empty','empty','empty']);
  assert.equal((await deleteMemberSong(post('delete',{slot:1,revision:a.revision,request_id:randomUUID(),member_id:alice.id}),s,own(bob))).status,409);
  await s.profiles.setJSON('owner-binding',{id:alice.id});
  assert.equal((await getOwnSongs(new Request(origin+'/api/member-songs/me'),s,own(alice))).status,403);
  assert.equal((await uploadMemberSong(upload(await media()),s,own({...bob,isOwner:true}))).status,403);
});

test('songs require a published member profile and never silently publish one',async()=>{
  const s=await stores(false); const response=await uploadMemberSong(upload(await media()),s,own(alice));
  assert.equal(response.status,400); assert.match((await response.json()).error,/Save your profile once/); assert.equal(s.songs.records.size,0); assert.equal(s.profiles.records.size,0);
});

test('directory-only and legacy friend-only profiles can save and publish music links',async()=>{
  const directoryOnly=await stores(false);directoryOnly.directory=memory();
  await directoryOnly.directory.setJSON('members/'+alice.id,{id:alice.id,name:alice.name,joined_at:'2026-09-05T00:00:00Z'});
  assert.equal((await addLink(directoryOnly)).status,201);
  assert.equal((await list(directoryOnly)).songs.length,1);

  const friendOnly=await stores(false);friendOnly.friends=memory();
  await friendOnly.friends.setJSON('target/owner/'+bob.id,{member_id:bob.id,member_name:bob.name});
  assert.equal((await addLink(friendOnly,{slot:1},bob)).status,201);
  assert.equal((await list(friendOnly,bob.id)).songs.length,1);
});

test('a bound owner without a saved profile keeps every ROOSTER PLAYER song public',async()=>{
  const s=await stores(false);s.directory=memory();
  await s.directory.setJSON('members/'+alice.id,{id:alice.id,name:alice.name,joined_at:'2026-09-05T00:00:00Z'});
  const owner={...alice,isOwner:true};
  assert.equal((await addLink(s,{},owner)).status,201);
  assert.deepEqual(await s.profiles.get('owner-binding',{type:'json'}),{id:alice.id});
  assert.equal((await addLink(s,{slot:2},owner)).status,201);
  assert.equal((await list(s,alice.id)).songs.length,2);
  assert.equal((await list(s,'owner')).songs.length,2);
});

test('one malformed legacy slot cannot hide valid music and can be replaced',async()=>{
  const s=await stores();assert.equal((await addLink(s)).status,201);
  await s.songs.setJSON('slots/'+alice.id+'/2',{bad:true});
  assert.equal((await list(s)).songs.length,1);
  const ownSongs=await me(s);assert.deepEqual(ownSongs.slots.map(slot=>slot.status),['approved','empty','empty']);
  const repaired=await addLink(s,{slot:2,title:'Repaired',revision:''});assert.equal(repaired.status,201);
  assert.equal((await list(s)).songs.length,2);
});

test('three fixed slots save quickly as private pending songs without running the provider',async()=>{
  const s=await stores();let calls=0;
  const response=await uploadMemberSong(upload(await media()),s,{...own(alice),moderate:async()=>{calls++;return approved;}});
  assert.equal(response.status,202);assert.equal(calls,0);const {slot}=await response.json();
  assert.equal(slot.status,'pending');assert.equal(slot.url,null);assert.ok(slot.revision);
  assert.deepEqual((await list(s)).songs,[]);
  const before=s.songs.reads.filter(k=>k.startsWith('audio/')).length;
  assert.equal((await audio(s,urlFor(saved(s)))).status,404);
  assert.equal(s.songs.reads.filter(k=>k.startsWith('audio/')).length,before);
  await add(s,{slot:'2'});await add(s,{slot:'3'});
  assert.equal((await me(s)).slots.length,3);
  for(const value of ['0','4','1.1','../1'])assert.equal((await uploadMemberSong(upload(await media(),{slot:value}),s,own(alice))).status,400);
  assert.equal([...s.songs.records.keys()].filter(k=>k.startsWith('slots/')).length,3);
});

test('actual MP3 validation, field multiplicity and streamed byte limits reject invalid uploads',async()=>{
  const s=await stores(), file=await media();
  for(const [request,status]of[
    [upload(new File(['<script>bad</script>'],'x.mp3',{type:'audio/mpeg'})),415],
    [upload(file,{},[['audio',file]]),400],[upload(file,{title:'x'.repeat(101)}),400],[upload(file,{title:'bad\u0000title'}),400],
    [upload(file,{revision:randomUUID()}),409],
  ])assert.equal((await uploadMemberSong(request,s,own(alice))).status,status);
  const overflow=new Request(origin+'/api/member-songs/upload',{method:'POST',headers:{Origin:origin,'Content-Type':'multipart/form-data; boundary=test','Content-Length':'1'},body:new Uint8Array(4.25*1024*1024+1)});
  assert.equal((await uploadMemberSong(overflow,s,own(alice))).status,413);assert.equal(s.songs.records.size,0);
});

test('only a valid current-policy safety approval publishes metadata-free audio and byte ranges',async()=>{
  const s=await stores(), slot=await add(s);let providerInput;
  const response=await checkMemberSong(post('check',{slot:1,revision:slot.revision}),s,{...own(alice),moderate:async input=>{providerInput=input;return approved;}});
  assert.equal(response.status,200);const checked=(await response.json()).slot;assert.equal(checked.revision,slot.revision);assert.equal(checked.status,'approved');
  assert.equal(providerInput.mime,'audio/mpeg');assert.equal(providerInput.caption,'My song');assert.equal(providerInput.name,'Alice');assert.ok(providerInput.duration>0&&providerInput.duration<=600);
  assert.notEqual(Buffer.from(providerInput.bytes).subarray(0,3).toString(),'ID3');
  const songs=(await list(s)).songs;assert.equal(songs.length,1);assert.deepEqual(Object.keys(songs[0]).sort(),['duration','external_url','provider','revision','slot','source','status','title','url']);assert.ok(!JSON.stringify(songs).includes('GPS-name'));
  const full=await audio(s,checked.url);assert.equal(full.status,200);assert.equal(full.headers.get('content-type'),'audio/mpeg');assert.equal(full.headers.get('cache-control'),'no-store');assert.equal(full.headers.get('netlify-cdn-cache-control'),'no-store');assert.equal(full.headers.get('access-control-allow-origin'),null);
  const bytes=await full.arrayBuffer();const range=await audio(s,checked.url,{Range:'bytes=0-7'});assert.equal(range.status,206);assert.deepEqual(await range.arrayBuffer(),bytes.slice(0,8));
  assert.equal((await audio(s,checked.url,{Range:'bytes=0-1,3-4'})).status,416);
  assert.equal(uploadConfig.rateLimit.windowLimit,8);assert.equal(checkConfig.rateLimit.windowLimit,6);
});

test('Apple Music, Spotify and YouTube links publish immediately in no more than three fixed slots',async()=>{
  const s=await stores();
  const links=[
    'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=private-share-code',
    'https://music.apple.com/us/album/blinding-lights/1499378108?i=1499378613&uo=4',
    'https://youtu.be/dQw4w9WgXcQ?si=private-share-code',
  ];
  for(let i=0;i<3;i++){
    const response=await addLink(s,{slot:i+1,title:`Link ${i+1}`,url:links[i]});
    assert.equal(response.status,201);const data=await response.json();assert.equal(data.status,'approved');assert.equal(data.slot.source,'link');
    assert.equal(data.slot.url,null);assert.ok(['spotify','apple','youtube'].includes(data.slot.provider));
  }
  const songs=(await list(s)).songs;assert.equal(songs.length,3);assert.deepEqual(songs.map(song=>song.slot),[1,2,3]);
  assert.equal(songs[0].external_url,'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC');
  assert.equal(songs[1].external_url,'https://music.apple.com/us/album/blinding-lights/1499378108?i=1499378613');
  assert.equal(songs[2].external_url,'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(linkConfig.rateLimit.windowLimit,15);
});

test('music link validation accepts only individual tracks from the three supported services',async()=>{
  assert.equal(parseMusicLink('https://music.youtube.com/watch?v=dQw4w9WgXcQ').provider,'youtube');
  assert.equal(parseMusicLink('https://open.spotify.com/intl-de/track/4uLU6hMCjMI75M1A2tKUQC').provider,'spotify');
  assert.equal(parseMusicLink('https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC').url,'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC');
  assert.equal(parseMusicLink('https://embed.music.apple.com/us/album/blinding-lights/1499378108?i=1499378613').url,'https://music.apple.com/us/album/blinding-lights/1499378108?i=1499378613');
  assert.equal(parseMusicLink('https://www.youtube.com/live/dQw4w9WgXcQ?si=shared').url,'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(parseMusicLink('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ').provider,'youtube');
  const s=await stores();
  for(const url of ['javascript:alert(1)','https://evil.example/song','https://open.spotify.com/album/123','https://music.apple.com/us/album/name/123','https://youtube.com/playlist?list=abc']){
    assert.equal((await addLink(s,{url})).status,400,url);
  }
  assert.equal(s.songs.records.size,0);
});

test('official Spotify short share links resolve to canonical individual tracks before saving',async()=>{
  const calls=[];
  const load=async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({provider_name:'Spotify',html:'<iframe src="https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC?utm_source=oembed"></iframe>'}),{status:200,headers:{'Content-Type':'application/json'}});};
  const resolved=await resolveMusicLink('https://spotify.link/8qtwlE1mGXb?si=shared',load);
  assert.deepEqual(resolved,{provider:'spotify',url:'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC'});
  assert.match(calls[0].url,/^https:\/\/spotify\.link\/oembed\?url=/);assert.equal(calls[0].options.redirect,'error');
  const s=await stores();const response=await saveMemberSongLink(post('link',{slot:1,title:'Short share',url:'https://spotify.link/8qtwlE1mGXb',request_id:randomUUID(),revision:''}),s,{...own(alice),fetchMusic:load});
  assert.equal(response.status,201);assert.equal((await response.json()).slot.external_url,resolved.url);
  const bad=async()=>new Response(JSON.stringify({provider_name:'Spotify',html:'<iframe src="https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQCEVIL"></iframe>'}),{status:200});
  await assert.rejects(()=>resolveMusicLink('https://spotify.link/8qtwlE1mGXb',bad),error=>error instanceof MemberError&&error.status===400);
});

test('provider failures, malformed approvals and rejection never expose pending music',async()=>{
  for(const decision of [null,{...approved,policy_version:'other'},{...approved,reason:''},{status:'pending',policy_version:SONG_MODERATION_POLICY_VERSION,reason:'Try again.'},{...approved,status:'rejected'}]){
    const s=await stores(),slot=await add(s),response=await review(s,slot,decision);assert.equal(response.status,decision?.status==='rejected'?422:202);
    assert.equal((await response.json()).slot.revision,slot.revision);assert.deepEqual((await list(s)).songs,[]);assert.equal((await audio(s,urlFor(saved(s)))).status,404);
  }
  const s=await stores(),slot=await add(s);let calls=0;
  const fail=await checkMemberSong(post('check',{slot:1,revision:slot.revision}),s,{...own(alice),moderate:async()=>{calls++;throw new Error('private provider details');}});
  assert.equal(fail.status,202);assert.equal(calls,1);assert.ok(!(await fail.text()).includes('provider details'));
  assert.equal((await review(s,slot)).status,200);
});

test('duplicate uploads are immutable and CAS admits one competing replacement per slot',async()=>{
  const s=await stores(),file=await media(),values={request_id:randomUUID()};
  const responses=await Promise.all(Array.from({length:5},()=>uploadMemberSong(upload(file,values),s,own(alice))));
  assert.ok(responses.every(r=>r.status===202));assert.equal([...s.songs.records.keys()].filter(k=>k.startsWith('slots/')).length,1);assert.equal([...s.songs.records.keys()].filter(k=>k.startsWith('audio/')).length,1);
  assert.equal((await uploadMemberSong(upload(await media(true),values),s,own(alice))).status,409);
  const initial=(await me(s)).slots[0];await review(s,initial);
  const first=upload(file,{request_id:randomUUID(),revision:initial.revision,title:'First'}), second=upload(file,{request_id:randomUUID(),revision:initial.revision,title:'Second'});
  const result=await Promise.all([uploadMemberSong(first,s,own(alice)),uploadMemberSong(second,s,own(alice))]);
  assert.deepEqual(result.map(r=>r.status).sort(),[202,409]);assert.ok(['First','Second'].includes(saved(s).title));
});

test('replacing and removing a song revoke old public URLs and preserve idempotent deletion',async()=>{
  const s=await stores(),first=await add(s);await review(s,first);const oldURL=(await me(s)).slots[0].url;
  const replacement=await add(s,{revision:first.revision,title:'Replacement'});assert.equal((await audio(s,oldURL)).status,404);assert.deepEqual((await list(s)).songs,[]);
  await review(s,replacement);const url=(await me(s)).slots[0].url;assert.notEqual(url,oldURL);
  const input={slot:1,revision:replacement.revision,request_id:randomUUID()};
  const deleted=await deleteMemberSong(post('delete',input),s,own(alice));assert.equal(deleted.status,200);assert.equal((await deleted.json()).slot.status,'empty');
  assert.equal((await deleteMemberSong(post('delete',input),s,own(alice))).status,200);assert.equal((await audio(s,url)).status,404);assert.deepEqual((await list(s)).songs,[]);
  assert.equal((await review(s,replacement)).status,409);
});

test('a delayed approval cannot restore a song deleted during its safety check',async()=>{
  const s=await stores(),slot=await add(s);let begin,finish;const started=new Promise(resolve=>begin=resolve),gate=new Promise(resolve=>finish=resolve);
  const checking=checkMemberSong(post('check',{slot:1,revision:slot.revision}),s,{...own(alice),moderate:async()=>{begin();await gate;return approved;}});
  await started;assert.equal((await deleteMemberSong(post('delete',{slot:1,revision:slot.revision,request_id:randomUUID()}),s,own(alice))).status,200);finish();
  assert.equal((await checking).status,409);assert.equal((await me(s)).slots[0].status,'empty');assert.deepEqual((await list(s)).songs,[]);
});

test('deletion while audio bytes are loading revokes even an in-flight range response',async()=>{
  const s=await stores(),slot=await add(s);await review(s,slot);const url=(await me(s)).slots[0].url;
  const get=s.songs.get.bind(s.songs);let begin,finish;const started=new Promise(resolve=>begin=resolve),gate=new Promise(resolve=>finish=resolve);
  s.songs.get=async(key,options)=>{const value=await get(key,options);if(key.startsWith('audio/')){begin();await gate;}return value;};
  const reading=audio(s,url,{Range:'bytes=0-7'});await started;
  await deleteMemberSong(post('delete',{slot:1,revision:slot.revision,request_id:randomUUID()}),s,own(alice));finish();assert.equal((await reading).status,404);
});
