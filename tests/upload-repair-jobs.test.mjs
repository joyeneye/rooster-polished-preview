import test from 'node:test';
import assert from 'node:assert/strict';
import {enqueueMedia,runMediaJob,getMediaJob,mediaInput} from '../netlify/functions/_shared/media-jobs.mts';
import {waitForMediaJob,selectPhoneVideo} from '../media-job-client.js';
import {inspectVideoUpload,startVideoUpload,putVideoPart,readVideoUpload,VIDEO_UPLOAD_LIMIT} from '../netlify/functions/_shared/video-transfers.mts';
import {createSongModerator,SONG_MODERATION_POLICY_VERSION} from '../netlify/functions/_shared/video-moderation.mts';
import {CHAT_TTL_MS} from '../netlify/functions/_shared/member-chat.mts';
const origin='https://jwhitedidit.net';
const alice={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',name:'Alice',isOwner:false};
const bob={id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',name:'Bob',isOwner:false};
const upload='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const input={upload_id:upload,request_id:upload,caption:'Studio moment'};
function memory(){const records=new Map(),etags=new Map();let n=0;return{records,async get(k){return structuredClone(records.get(k)||null)},async getWithMetadata(k){return records.has(k)?{data:structuredClone(records.get(k)),etag:etags.get(k)}:null},async setJSON(k,v,o={}){if(o.onlyIfNew&&records.has(k)||o.onlyIfMatch&&o.onlyIfMatch!==etags.get(k))return{modified:false};records.set(k,structuredClone(v));etags.set(k,''+(++n));return{modified:true}},async set(k,v,o){return this.setJSON(k,v,o)},async *list({prefix}){yield{blobs:[...records.keys()].filter(k=>k.startsWith(prefix)).map(key=>({key}))}},async delete(k){records.delete(k)}}}
const post=(path,body)=>new Request(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
const status=(id)=>new Request(origin+'/api/media-jobs/'+id);
const enqueue=async(s,dispatch,extras={})=>enqueueMedia(post('/api/clips',input),s,'video',{resolve:async()=>alice,dispatch,...extras});
test('only one job is dispatched for duplicate authenticated submissions',async()=>{const s=memory();let calls=0;const dispatch=async()=>{calls++};const replies=await Promise.all([enqueue(s,dispatch),enqueue(s,dispatch)]);assert.equal(calls,1);assert.deepEqual(await replies[0].json(),await replies[1].json());assert.equal(s.records.size,1);});
test('job token and member identity protect processing and status',async()=>{const s=memory();let ticket;const data=await(await enqueue(s,async(id,token)=>{ticket={job_id:id,token}})).json();let calls=0;const process=async()=>{calls++;return Response.json({id:'f'.repeat(64),status:'approved',published:true})};await runMediaJob(post('/api/media-processing/run',{...ticket,token:'0'.repeat(64)}),s,process);assert.equal(calls,0);await assert.rejects(()=>getMediaJob(status(data.job_id),s,async()=>bob),e=>e.status===404);await runMediaJob(post('/api/media-processing/run',ticket),s,process);await runMediaJob(post('/api/media-processing/run',ticket),s,process);assert.equal(calls,1);const result=await(await getMediaJob(status(data.job_id),s,async()=>alice)).json();assert.equal(result.published,true);assert.equal(result.token,undefined);assert.equal(result.member,undefined);});
test('changed caption cannot reuse a committed upload ID',async()=>{const s=memory();await enqueue(s,async()=>{});await assert.rejects(()=>enqueueMedia(post('/api/clips',{...input,caption:'Different'}),s,'video',{resolve:async()=>alice,dispatch:async()=>{}}),e=>e.status===409);});
test('missing upload and cross-site requests are rejected before dispatch',async()=>{const s=memory();let calls=0;await assert.rejects(()=>enqueue(s,async()=>{calls++},{validate:async()=>{throw new Error('missing upload')}}));assert.equal(s.records.size,0);await assert.rejects(()=>enqueueMedia(new Request(origin+'/api/clips',{method:'POST',headers:{Origin:'https://other.test','Content-Type':'application/json'},body:JSON.stringify(input)}),s,'video',{resolve:async()=>alice,dispatch:async()=>{calls++}}),e=>e.status===403);assert.equal(calls,0);});
test('dispatch failure is not reported as successful processing',async()=>{const s=memory();await assert.rejects(()=>enqueue(s,async()=>{throw new Error('network')}),e=>e.status===503);assert.equal([...s.records.values()][0].state,'failed');let ticket;await enqueue(s,async(id,token)=>{ticket={job_id:id,token}});await runMediaJob(post('/api/media-processing/run',ticket),s,async()=>Response.json({error:'Videos must be 30 seconds or shorter.'},{status:415}));const reply=await getMediaJob(status(ticket.job_id),s,async()=>alice);assert.equal(reply.status,422);assert.match((await reply.json()).error,/30 seconds/);});
test('server preparation does not auto-approve a pending or rejected clip',async()=>{for(const verdict of ['pending','rejected']){const s=memory();let ticket;await enqueue(s,async(id,token)=>{ticket={job_id:id,token}});await runMediaJob(post('/api/media-processing/run',ticket),s,async()=>Response.json({id:'e'.repeat(64),status:verdict,published:false},{status:verdict==='rejected'?422:202}));const result=await(await getMediaJob(status(ticket.job_id),s,async()=>alice)).json();assert.equal(result.status,verdict);assert.equal(result.published,false);}});
test('pending provider verdict can be checked again after cooldown',async()=>{const s=memory();let ticket;await enqueue(s,async(id,token)=>{ticket={job_id:id,token}});await runMediaJob(post('/api/media-processing/run',ticket),s,async()=>Response.json({status:'pending',published:false}));const job=s.records.get('jobs/'+ticket.job_id);job.updated_at-=31000;await s.setJSON('jobs/'+job.id,job);let calls=0;await enqueue(s,async()=>{calls++});assert.equal(calls,1);});
test('phone selection accepts originals without decoding and enforces 100 MB',()=>{const source={name:'IMG_001.MOV',type:'video/quicktime',size:100*1024*1024};assert.equal(selectPhoneVideo(source),source);assert.throws(()=>selectPhoneVideo({...source,size:source.size+1}),/100 MB/);assert.throws(()=>selectPhoneVideo({name:'script.html',type:'text/html',size:400}),/video/);assert.equal(VIDEO_UPLOAD_LIMIT,100*1024*1024);});
test('bounded parts carry a full 100 MB upload and reject overflow and wrong owner',async()=>{const s=memory();const size=100*1024*1024;const first=await startVideoUpload(post('/api/video-uploads/start',{request_id:upload,kind:'clip',name:'camera.mov',size}),s,async()=>alice);assert.equal(first.status,200);const manifest=await first.json();assert.equal(manifest.parts,50);for(let part=0;part<manifest.parts;part++){const bytes=new Uint8Array(manifest.part_bytes);bytes[0]=part;const result=await putVideoPart(new Request(origin+`/api/video-uploads/part?upload_id=${upload}&part=${part}`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/octet-stream'},body:bytes}),s,async()=>alice);assert.equal(result.status,200);}const file=await readVideoUpload(s,alice.id,upload,'clip');assert.equal(file.size,size);await assert.rejects(()=>inspectVideoUpload(s,bob.id,upload),e=>e.status===404);const over=await startVideoUpload(post('/api/video-uploads/start',{request_id:upload,kind:'clip',name:'camera.mov',size:size+1}),s,async()=>alice);assert.equal(over.status,413);});
test('large song review receives the full source for preparation, never a truncated slice',async()=>{const source=new ArrayBuffer(13*1024*1024);let prepared=false,called=false;const moderate=createSongModerator({env:n=>({GEMINI_API_KEY:'test',GOOGLE_GEMINI_BASE_URL:'https://gateway.example.test'})[n],prepareSong:async bytes=>{assert.equal(bytes,source);prepared=true;return new Uint8Array([1,2,3,4]).buffer},fetch:async(_url,init)=>{called=true;const body=JSON.parse(init.body);assert.equal(body.contents[0].parts[0].inlineData.data,'AQIDBA==');const verdict={decision:'approve',certainty:'clear',timeline_reviewed:true,audio_review:'reviewed',flags:Object.fromEntries(['nudity_or_sexual','death_or_graphic_violence','self_harm','hate_or_harassment','dangerous_or_illegal','spam_or_private_info'].map(k=>[k,false])),reason:'safe_music_community'};return Response.json({candidates:[{finishReason:'STOP',content:{role:'model',parts:[{text:JSON.stringify(verdict)}]}}]})}});const result=await moderate({bytes:source,mime:'audio/mpeg',name:'Alice',caption:'Full song',duration:599});assert.equal(prepared,true);assert.equal(called,true);assert.equal(result.status,'approved');assert.equal(result.policy_version,SONG_MODERATION_POLICY_VERSION);});
test('large song conversion failure stays pending instead of bypassing screening',async()=>{let calls=0;const result=await createSongModerator({env:n=>({GEMINI_API_KEY:'test',GOOGLE_GEMINI_BASE_URL:'https://gateway.example.test'})[n],prepareSong:async()=>{throw new Error('decoder')},fetch:async()=>{calls++}})({bytes:new ArrayBuffer(13*1024*1024),mime:'audio/mpeg',name:'Alice',caption:'Song',duration:600});assert.equal(result.status,'pending');assert.equal(calls,0);});
test('processing poll respects account changes and returns only a completed result',async()=>{const id='a'.repeat(64);let calls=0;const result=await waitForMediaJob({processing:true,job_id:id},{request:async()=>++calls===1?{processing:true,job_id:id}:{status:'pending',published:false},sleep:async()=>{}});assert.equal(calls,2);assert.equal(result.published,false);await assert.rejects(()=>waitForMediaJob({processing:true,job_id:id},{isCurrent:()=>false,request:async()=>{},sleep:async()=>{}}),e=>e.name==='AbortError');assert.equal(CHAT_TTL_MS,60000);});

test('chat stays for 59.999 seconds and does not return at 60 seconds or on reload',async()=>{
  const {postChatMessage,getChatMessages}=await import('../netlify/functions/_shared/member-chat.mts');
  const {POLICY_VERSION}=await import('../netlify/functions/_shared/comment-moderation.mts');
  const s=memory();
  const posted=await postChatMessage(post('/api/member-chat/send',{body:'A music moment',request_id:upload}),s,async()=>alice,async()=>({status:'approved',reason:'positive_or_respectful',policy_version:POLICY_VERSION,checked_at:new Date().toISOString()}));
  assert.equal(posted.status,201);const {message}=await posted.json();const born=Date.parse(message.created_at);const savedNow=Date.now;
  try{
    Date.now=()=>born+59999;
    assert.equal((await(await getChatMessages(new Request(origin+'/api/member-chat'),s,async()=>alice)).json()).messages.length,1);
    for(const after of [60000,120000]){
      Date.now=()=>born+after;
      assert.equal((await(await getChatMessages(new Request(origin+'/api/member-chat'),s,async()=>alice)).json()).messages.length,0);
    }
  }finally{Date.now=savedNow;}
});
test('chat links name and Message action to that member, and browser expiry matches server',async()=>{
  const {readFile}=await import('node:fs/promises');const source=await readFile(new URL('../member-chat.js',import.meta.url),'utf8');
  assert.match(source,/const CHAT_TTL_MS = 60000/);
  assert.match(source,/name\.href = '\/profile\.html\?id=' \+ encodeURIComponent\(message\.member_id\)/);
  // Message still carries a plain link to that exact member for a new tab or
  // a browser without scripts, and it now names them so the messages panel
  // can address the conversation straight away.
  assert.match(source,/messageLink\.href='\/members\.html\?to='\+encodeURIComponent\(message\.member_id\)/);
  assert.match(source,/\+'&name='\+encodeURIComponent\(message\.name \|\| ''\)\+'#member-mail'/);
  // A click asks the member account to open the conversation in place, so the
  // chat room stays behind it and a live voice room stays connected.
  assert.match(source,/roster:open-conversation/);
  assert.match(source,/detail:\{id:message\.member_id,name:message\.name,back:'chat'\}/);
  assert.match(source,/if\(handled\) event\.preventDefault\(\);/);
});
