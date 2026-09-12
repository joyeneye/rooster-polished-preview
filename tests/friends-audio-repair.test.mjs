import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {getFriendCount, addFriend, getFriendRequests, respondToFriendRequest} from '../netlify/functions/_shared/friends.mts';
import {startAudioUpload, putAudioPart, readAudioUpload, cleanAudioTransfers, AUDIO_UPLOAD_LIMIT, AUDIO_PART_BYTES} from '../netlify/functions/_shared/audio-transfers.mts';
import {uploadMemberSong,checkMemberSong,getMemberSongs,getMemberSongAudio} from '../netlify/functions/_shared/member-songs.mts';
import {validateMemberSongAudio} from '../netlify/functions/_shared/member-song-audio.mts';
import {POLICY_VERSION} from '../netlify/functions/_shared/comment-moderation.mts';
import {SONG_MODERATION_POLICY_VERSION} from '../netlify/functions/_shared/video-moderation.mts';
import {MemberError} from '../netlify/functions/_shared/member-auth.mts';
import {transferSong} from '../song-upload-client.js';
const origin='https://jwhitedidit.net';
const a={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',name:'Alice',isOwner:false};
const b={id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',name:'Bob',isOwner:false};
const owner='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ownerMember={id:owner,name:'JWhite',isOwner:true};
const resolve=m=>async()=>m;
function memory(){const records=new Map(),etags=new Map(),metadata=new Map();let rev=0;return {
 records,async get(k){return structuredClone(records.get(k)??null)},
 async getWithMetadata(k){return records.has(k)?{data:structuredClone(records.get(k)),etag:etags.get(k),metadata:metadata.get(k)||{}}:null},
 async setJSON(k,v,o={}){if(o.onlyIfNew&&records.has(k)||o.onlyIfMatch&&o.onlyIfMatch!==etags.get(k))return {modified:false};records.set(k,structuredClone(v));etags.set(k,String(++rev));metadata.set(k,o.metadata||{});return {modified:true,etag:String(rev)}},
 async set(k,v,o={}){return this.setJSON(k,v,o)},async delete(k){records.delete(k);etags.delete(k)},
 list({prefix='',paginate=false}={}){const blobs=[...records.keys()].filter(k=>k.startsWith(prefix)).map(key=>({key}));return paginate?(async function*(){for(let i=0;i<blobs.length;i+=5)yield {blobs:blobs.slice(i,i+5)}})():Promise.resolve({blobs})}
}}
const post=(path,body)=>new Request(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
const friendReq=(method,target='owner')=>new Request(origin+'/api/friends'+(method==='POST'?'/add':'')+'?target_id='+target,{method,headers:method==='POST'?{Origin:origin}:{}});
function friendProfiles(){const profiles=memory();profiles.records.set('owner-binding',{id:owner});for(const member of [a,b,ownerMember])profiles.records.set('public-members/'+member.id,member);return profiles;}
async function pending(store,member,profiles){const response=await getFriendRequests(new Request(origin+'/api/friend-requests'),store,resolve(member),profiles);assert.equal(response.status,200);return response.json();}
async function accept(store,member,id,profiles){const response=await respondToFriendRequest(post('/api/friend-requests/respond',{request_id:id,action:'accept'}),store,resolve(member),profiles);assert.equal(response.status,200);}
async function begin(s,file,m=a,kind='profile',id=randomUUID()){const response=await startAudioUpload(post('/api/audio-uploads/start',{request_id:id,kind,name:file.name,size:file.size}),s,resolve(m));assert.equal(response.status,200,JSON.stringify(await response.clone().json()));return response.json()}
async function part(s,info,file,index,m=a){return putAudioPart(new Request(origin+`/api/audio-uploads/part?upload_id=${info.upload_id}&part=${index}`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/octet-stream'},body:file.slice(index*AUDIO_PART_BYTES,Math.min(file.size,(index+1)*AUDIO_PART_BYTES))}),s,resolve(m))}
async function all(s,info,file,m=a){for(let i=0;i<info.parts;i++)assert.equal((await part(s,info,file,i,m)).status,200)}
test('friend count changes only after acceptance and repeated requests cannot inflate it',async()=>{
 const store=memory(),profiles=friendProfiles();assert.equal((await(await getFriendCount(friendReq('GET',b.id),store,profiles)).json()).count,0);
 const results=await Promise.all(Array.from({length:8},()=>addFriend(friendReq('POST',b.id),store,resolve(a),profiles)));for(const r of results)assert.equal(r.status,200);
 const requests=await pending(store,b,profiles);assert.equal(requests.incoming.length,1);assert.equal((await(await getFriendCount(friendReq('GET',b.id),store,profiles)).json()).count,0);
 await accept(store,b,requests.incoming[0].id,profiles);let data=await(await getFriendCount(friendReq('GET',b.id),store,profiles)).json();assert.equal(data.count,1);assert.equal(data.friends[0].member_name,'Alice');
 const repeated=await addFriend(friendReq('POST',b.id),store,resolve(a),profiles);assert.equal(repeated.status,200);assert.equal((await repeated.json()).state,'accepted');data=await(await getFriendCount(friendReq('GET',b.id),store,profiles)).json();assert.equal(data.count,1);assert.equal(data.friends.length,1);
});
test('old owner-ID adds without an automatic provisioning edge merge into one pending request and count once after acceptance',async()=>{
 const store=memory(),profiles=friendProfiles();
 const entry={member_id:a.id,member_name:a.name,created_at:new Date().toISOString()};await store.setJSON(`target/${owner}/${a.id}`,entry);await store.setJSON(`target/owner/${a.id}`,entry);
 let data=await(await getFriendCount(friendReq('GET'),store,profiles)).json();assert.equal(data.count,0);let requests=await pending(store,ownerMember,profiles);assert.equal(requests.incoming.length,1);await accept(store,ownerMember,requests.incoming[0].id,profiles);data=await(await getFriendCount(friendReq('GET'),store,profiles)).json();assert.equal(data.count,1);
 await addFriend(friendReq('POST',owner),store,resolve(b),profiles);
 assert.equal((await(await getFriendCount(friendReq('GET'),store,profiles)).json()).count,1);requests=await pending(store,ownerMember,profiles);assert.equal(requests.incoming.length,1);await accept(store,ownerMember,requests.incoming[0].id,profiles);
 assert.equal((await(await getFriendCount(friendReq('GET'),store,profiles)).json()).count,2);
 assert.equal((await(await getFriendCount(friendReq('GET',owner),store,profiles)).json()).count,2);
 assert.equal((await addFriend(friendReq('POST'),store,resolve({id:owner,name:'JWhite'}),profiles)).status,400);
});
test('unreadable friend storage is an explicit error, never a false zero; cross-origin and unsigned adds are blocked',async()=>{
 const broken={...memory(),list(){throw new Error('offline')}};assert.equal((await getFriendCount(friendReq('GET'),broken)).status,503);
 const s=memory();assert.equal((await addFriend(friendReq('POST'),s,async()=>{throw new MemberError(401,'Log in')})).status,401);
 assert.equal((await addFriend(new Request(origin+'/api/friends/add?target_id=owner',{method:'POST',headers:{Origin:'https://elsewhere.example'}}),s,resolve(a))).status,403);
 assert.equal(s.records.size,0);
});
test('100 MB transfer completes in fifty bounded requests, preserves every byte, and retries are idempotent',async()=>{
 const store=memory(),bytes=new Uint8Array(AUDIO_UPLOAD_LIMIT);for(let i=0;i<bytes.length;i++)bytes[i]=i%251;
 const file=new File([bytes],'maximum.mp3',{type:'audio/mpeg'}),info=await begin(store,file);assert.equal(info.parts,50);
 await all(store,info,file);assert.equal((await part(store,info,file,0)).status,200);
 const rebuilt=await readAudioUpload(store,a.id,info.upload_id,'profile');assert.equal(rebuilt.size,file.size);
 assert.equal(createHash('sha256').update(new Uint8Array(await rebuilt.arrayBuffer())).digest('hex'),createHash('sha256').update(bytes).digest('hex'));
});
test('incomplete, expired, oversized, changed and another-member transfers cannot be finalized',async()=>{
 const store=memory(),file=new File([new Uint8Array(2*1024*1024+55)],'test.mp3',{type:'audio/mpeg'}),info=await begin(store,file);
 await assert.rejects(()=>readAudioUpload(store,a.id,info.upload_id,'profile'),e=>e.status===409);
 assert.equal((await part(store,info,file,0,b)).status,404);
 await assert.rejects(()=>readAudioUpload(store,a.id,info.upload_id,'discovery'),e=>e.status===400);
 await all(store,info,file);
 assert.equal((await part(store,info,new File([new Uint8Array(file.size).fill(2)],file.name),0)).status,409);
 assert.equal((await startAudioUpload(post('/api/audio-uploads/start',{request_id:randomUUID(),kind:'profile',name:'large.mp3',size:AUDIO_UPLOAD_LIMIT+1}),store,resolve(a))).status,413);
 const key=`transfers/${a.id}/${info.upload_id}/manifest`;store.records.get(key).expires_at=Date.now()-1;
 await assert.rejects(()=>readAudioUpload(store,a.id,info.upload_id,'profile'),e=>e.status===410);
 assert.ok(await cleanAudioTransfers(store)>=3);
 assert.equal([...store.records.keys()].filter(k=>k.startsWith('transfers/')).length,0);
});
test('browser transfer routes to the real test handlers with progress and no request larger than 2 MB',async()=>{
 const store=memory(),file=new File([new Uint8Array(7*1024*1024+7)],'browser.mp3',{type:'audio/mpeg'});const id=randomUUID(),progress=[];
 const request=async(path,options)=>{if(options.body instanceof Blob)assert.ok(options.body.size<=AUDIO_PART_BYTES);const req=new Request(origin+path,{...options,headers:{Origin:origin,...options.headers}});const response=path.includes('/start')?await startAudioUpload(req,store,resolve(a)):await putAudioPart(req,store,resolve(a));const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data};
 assert.equal(await transferSong(file,{kind:'profile',request,requestId:id,onProgress:p=>progress.push(p)}),id);
 assert.deepEqual(progress,[29,57,86,100]);assert.equal((await readAudioUpload(store,a.id,id,'profile')).size,file.size);
});
test('large MP3 transfer saves privately, passes a mocked safety check, and supports full playback and seeking',async t=>{
 const fixture=process.env.JWHITE_LARGE_AUDIO_FIXTURE;if(!fixture){t.skip('Set JWHITE_LARGE_AUDIO_FIXTURE to a generated MP3 above 4 MB.');return}
 const file=new File([await readFile(fixture)],'large-song.mp3',{type:'audio/mpeg'});assert.ok(file.size>4*1024*1024&&file.size<=AUDIO_UPLOAD_LIMIT);
 const transfers=memory(),songs=memory(),profiles=memory(),stores={songs,profiles};await profiles.setJSON('profiles/'+a.id,{id:a.id,name:a.name,status:'MORE!',about_me:'',photo_id:null,updated_at:new Date().toISOString(),approved:true,policy_version:POLICY_VERSION});
 const info=await begin(transfers,file);await all(transfers,info,file);
 const body={slot:'1',title:'Test tone',request_id:info.upload_id,revision:'',upload_id:info.upload_id};const options={resolveMember:resolve(a),transfers};
 const upload=await uploadMemberSong(post('/api/member-songs/upload',body),stores,options);assert.equal(upload.status,202,JSON.stringify(await upload.clone().json()));const data=await upload.json();assert.equal(data.slot.status,'pending');
 const repeated=await uploadMemberSong(post('/api/member-songs/upload',body),stores,options);assert.equal((await repeated.json()).slot.revision,data.slot.revision);
 const list=()=>getMemberSongs(new Request(origin+'/api/member-songs?id='+a.id),stores);assert.equal((await(await list()).json()).songs.length,0);
 let checked=0;const review=await checkMemberSong(post('/api/member-songs/check',{slot:1,revision:data.slot.revision}),stores,{resolveMember:resolve(a),moderate:async input=>{checked++;assert.ok(input.bytes.byteLength>4*1024*1024);return {status:'approved',policy_version:SONG_MODERATION_POLICY_VERSION,reason:'Generated test tone.'}}});assert.equal(review.status,200);assert.equal(checked,1);
 const url=(await review.json()).slot.url;assert.equal((await(await list()).json()).songs.length,1);
 const full=await getMemberSongAudio(new Request(origin+url),stores);assert.equal(full.status,200);const fullBytes=await full.arrayBuffer();assert.deepEqual(fullBytes,validateMemberSongAudio(await file.arrayBuffer()).bytes);
 const range=await getMemberSongAudio(new Request(origin+url,{headers:{Range:'bytes=4194304-'}}),stores);assert.equal(range.status,206);assert.equal(Number(range.headers.get('content-length')),AUDIO_PART_BYTES);assert.deepEqual(await range.arrayBuffer(),fullBytes.slice(4194304,4194304+AUDIO_PART_BYTES));
});
