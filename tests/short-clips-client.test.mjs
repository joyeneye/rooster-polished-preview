import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {File} from 'node:buffer';

const utils=fs.readFileSync(new URL('../clip-client-utils.js',import.meta.url),'utf8').replaceAll('export function ','function ');
const uploadClient=fs.readFileSync(new URL('../clip-upload-client.js',import.meta.url),'utf8').replaceAll('export async function ','async function ');
const mediaClient=fs.readFileSync(new URL('../media-job-client.js',import.meta.url),'utf8').replaceAll('export async function ','async function ').replaceAll('export function ','function ');
const source=fs.readFileSync(new URL('../member-clips.js',import.meta.url),'utf8').replace(/^import .+;\n/gm,'').replace('export function createMemberClips','function createMemberClips');
const publicSource=fs.readFileSync(new URL('../short-clips.js',import.meta.url),'utf8').replace(/^import .+;\n/gm,'').replace('export function createShortClips','function createShortClips');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const memberId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const signedIn={id:memberId};
const clip=(overrides={})=>({id:'a'.repeat(64),member_id:memberId,name:'Music Friend',caption:'My little moment',created_at:'2026-09-05T12:00:00Z',video_url:'/api/clip-video/'+'a'.repeat(64),width:480,height:640,duration:12,...overrides});
const videoFile=(name='hello.mp4',size=1200,type='video/mp4')=>new File([new Uint8Array(size)],name,{type});

function environment({publicFeed=false}={}) {
  const ids={};
  class Element {
    constructor(tag='div') {this.tagName=tag;this.value='';this.hidden=false;this.disabled=false;this.open=false;this.textContent='';this.children=[];this.dataset={};this.attrs={};this.listeners={};this.files=[];this.paused=true;}
    set id(value) {this._id=value;ids[value]=this;}
    get id() {return this._id;}
    append(...nodes) {this.children.push(...nodes);}
    replaceChildren(...nodes) {this.children=[...nodes];}
    setAttribute(key,value) {this.attrs[key]=value;}
    removeAttribute(key) {delete this.attrs[key];if(key==='src')this.src='';}
    addEventListener(type,fn) {(this.listeners[type]??=[]).push(fn);}
    fire(type) {for(const fn of this.listeners[type]??[])fn({preventDefault(){},currentTarget:this});}
    pause() {this.paused=true;}
    play() {this.paused=false;return Promise.resolve();}
    load() {}
  }
  const root=new Element();root.id='member-clips-root';
  for(const id of ['clips-feed','clips-status','clips-refresh']){const e=new Element();e.id=id;}
  const documentEvents={};const pageEvents={};const revoked=[];const created=[];const expired=[];
  const document={visibilityState:'visible',getElementById:id=>ids[id],createElement:tag=>new Element(tag),addEventListener:(type,fn)=>{documentEvents[type]=fn;}};
  const queue=[];const calls=[];
  const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data,blob:async()=>data});
  const enqueue=(data,status=200)=>queue.push(()=>Promise.resolve(response(data,status)));
  const deferred=()=>{let resolve;const p=new Promise(r=>{resolve=r;});queue.push(()=>p);return(data,status=200)=>resolve(response(data,status));};
  const fetch=async(path,options={})=>{calls.push({path,options});if(path==='/api/video-uploads/start'){const input=JSON.parse(options.body);return response({upload_id:input.request_id,part_bytes:2*1024*1024,parts:Math.ceil(input.size/(2*1024*1024))});}if(path.startsWith('/api/video-uploads/part?')){const query=new URL('https://jwhitedidit.net'+path).searchParams;return response({upload_id:query.get('upload_id'),part:Number(query.get('part')),received:options.body.size});}const next=queue.shift();if(!next)throw Error('Missing response');return next();};
  const helper={preparePhone:async file=>file,record:()=>{throw Error('No camera');}};
  class Form {constructor(){this.values=new Map();}append(key,value){this.values.set(key,value);}get(key){return this.values.get(key);}}
  const context=vm.createContext({createClipCommunityController:()=>({attach(){},clear(){}}),document,window:{addEventListener:(type,fn)=>{pageEvents[type]=fn;}},fetch,AbortController,DOMException,setTimeout,clearTimeout,crypto:{randomUUID},FormData:Form,PHONE_SOURCE_LIMIT:100*1024*1024,URL:{createObjectURL:blob=>{const value='blob:'+created.length;created.push({value,blob});return value;},revokeObjectURL:value=>revoked.push(value)},preparePhoneVideo:(...args)=>helper.preparePhone(...args),preparePrivateVideo:async file=>file,recordPrivateVideo:(...args)=>helper.record(...args),onSessionExpired:reason=>expired.push(reason)});
  vm.runInContext(utils+'\n'+uploadClient+'\n'+mediaClient+'\n'+(publicFeed?publicSource:source+'\nthis.controller=createMemberClips({onSessionExpired});'),context);
  const nodes=(node=root)=>[node,...node.children.flatMap(item=>nodes(item))];
  return{ids,document,documentEvents,pageEvents,enqueue,deferred,calls,helper,created,revoked,expired,controller:context.controller,nodes,button:text=>nodes().find(node=>node.tagName==='button'&&node.textContent===text)};
}

async function member() {const e=environment();e.enqueue({error:'Forbidden'},403);e.controller.setUser(signedIn);await tick();return e;}
async function select(e,file=videoFile()) {e.ids['member-clips-file'].files=[file];e.ids['member-clips-file'].fire('change');await tick();return file;}

test('ordinary members cannot see the owner queue and a 403 does not log them out',async()=>{
  const e=await member();assert.equal(e.ids['member-clips-root'].hidden,false);assert.equal(e.ids['member-clips-review'].hidden,true);assert.deepEqual(e.expired,[]);assert.equal(e.ids['member-clips-submit'].disabled,true);
});

test('confirmed upload automatically checks safety and cannot double submit',async()=>{
  const e=await member();await select(e);e.ids['member-clips-caption'].value=' My moment ';
  const finish=e.deferred();e.ids['member-clips-form'].fire('submit');e.ids['member-clips-form'].fire('submit');
  await tick();assert.equal(e.calls.filter(call=>call.path==='/api/video-uploads/start').length,1);assert.equal(e.calls.filter(call=>call.path.startsWith('/api/video-uploads/part?')).length,1);assert.equal(e.calls.filter(call=>call.path==='/api/clips').length,1);assert.equal(e.ids['member-clips-submit'].disabled,true);
  const call=e.calls.find(call=>call.path==='/api/clips');const body=JSON.parse(call.options.body);assert.equal(call.options.credentials,'same-origin');assert.equal(body.caption,'My moment');assert.equal(body.upload_id,body.request_id);
  e.enqueue({id:'b'.repeat(64),status:'approved',published:true});finish({id:'b'.repeat(64),status:'pending',published:false});await tick();
  const check=e.calls.at(-1);assert.equal(check.path,'/api/clips/check');assert.equal(check.options.credentials,'same-origin');assert.equal(JSON.parse(check.options.body).id,'b'.repeat(64));
  assert.match(e.ids['member-clips-status'].textContent,/Your clip is live/);assert.equal(e.ids['member-clips-preview'].hidden,true);assert.equal(e.ids['member-clips-caption'].value,'');assert.equal(e.created.length,e.revoked.length);assert.equal(e.ids['member-clips-check-status'].hidden,true);
});

test('failed or malformed confirmation preserves draft and stable id for a safe retry',async()=>{
  for(const data of [{status:'pending',published:true,id:'c'.repeat(64)},{status:'approved',published:false,id:'c'.repeat(64)},{status:'pending',published:false,id:'bad'}]){
    const e=await member();await select(e);e.ids['member-clips-caption'].value='Keep this';e.enqueue(data);e.ids['member-clips-form'].fire('submit');await tick();
    const first=JSON.parse(e.calls.filter(call=>call.path==='/api/clips').at(-1).options.body);assert.equal(e.ids['member-clips-caption'].value,'Keep this');assert.match(e.ids['member-clips-status'].textContent,/could not confirm/);
    e.enqueue({status:'pending',published:false,id:'d'.repeat(64)});e.enqueue({status:'pending',published:false,id:'d'.repeat(64)});e.ids['member-clips-form'].fire('submit');await tick();await tick();const retried=JSON.parse(e.calls.filter(call=>call.path==='/api/clips').at(-1).options.body);assert.equal(retried.request_id,first.request_id);assert.equal(retried.upload_id,first.upload_id);
  }
});

test('late upload and local preparation results cannot restore a signed out draft',async()=>{
  const e=await member();await select(e);const finish=e.deferred();e.ids['member-clips-form'].fire('submit');await tick();const finalCall=e.calls.find(call=>call.path==='/api/clips');e.controller.setUser(null);finish({id:'b'.repeat(64),status:'pending',published:false});await tick();
  assert.equal(e.ids['member-clips-root'].hidden,true);assert.equal(e.ids['member-clips-status'].textContent,'');assert.equal(e.ids['member-clips-submit'].disabled,true);assert.ok(finalCall.options.signal.aborted);
  assert.equal(e.calls.filter(call=>call.path==='/api/clips/check').length,0);
  const other=await member();let resolve;other.helper.preparePhone=()=>new Promise(done=>{resolve=done;});await select(other,videoFile('late.mov',1200,'video/quicktime'));const before=other.created.length;other.button('Make upload smaller').fire('click');other.controller.setUser(null);resolve(videoFile('prepared.mp4'));await tick();assert.equal(other.created.length,before);assert.equal(other.ids['member-clips-preview'].hidden,true);
});

test('only confirmed safe clips become live while rejected and uncertain clips stay unpublished',async()=>{
  for(const [result,pattern] of [
    [{id:'b'.repeat(64),status:'pending',published:false},/saved privately.*closer look/],
    [{id:'b'.repeat(64),status:'pending',published:false,checking:true},/saved privately.*safety check finishes/],
    [{id:'b'.repeat(64),status:'rejected',published:false},/not published.*community rules/],
    [{id:'b'.repeat(64),status:'approved',published:false},/saved privately.*could not confirm/],
    [{id:'c'.repeat(64),status:'approved',published:true},/saved privately.*could not confirm/],
    [{id:'b'.repeat(64),status:'anything',published:true},/saved privately.*could not confirm/],
  ]){
    const e=await member();await select(e);e.enqueue({id:'b'.repeat(64),status:'pending',published:false});e.enqueue(result);e.ids['member-clips-form'].fire('submit');await tick();assert.match(e.ids['member-clips-status'].textContent,pattern);assert.doesNotMatch(e.ids['member-clips-status'].textContent,/Your clip is live/);
  }
});

test('moderation errors retain saved upload and status retry never uploads or checks it again',async()=>{
  const e=await member();await select(e);e.enqueue({id:'b'.repeat(64),status:'pending',published:false});e.enqueue({error:'Timed out'},503);e.ids['member-clips-form'].fire('submit');await tick();assert.match(e.ids['member-clips-status'].textContent,/upload is saved privately/);assert.equal(e.ids['member-clips-check-status'].hidden,false);
  e.enqueue({id:'b'.repeat(64),status:'approved',published:true});e.ids['member-clips-check-status'].fire('click');await tick();assert.equal(e.calls.at(-1).path,'/api/clips/status/'+'b'.repeat(64));assert.equal(e.calls.at(-1).options.method,undefined);assert.match(e.ids['member-clips-status'].textContent,/Your clip is live/);assert.equal(e.calls.filter(call=>call.path==='/api/clips').length,1);assert.equal(e.calls.filter(call=>call.path==='/api/clips/check').length,1);
});

test('hidden page aborts checking and resumes with authenticated status read only',async()=>{
  const e=await member();await select(e);e.enqueue({id:'b'.repeat(64),status:'pending',published:false});const finish=e.deferred();e.ids['member-clips-form'].fire('submit');await tick();assert.equal(e.calls.at(-1).path,'/api/clips/check');
  e.document.visibilityState='hidden';e.documentEvents.visibilitychange();assert.ok(e.calls.at(-1).options.signal.aborted);finish({id:'b'.repeat(64),status:'approved',published:true});await tick();assert.doesNotMatch(e.ids['member-clips-status'].textContent,/Your clip is live/);
  e.enqueue({error:'Forbidden'},403);e.enqueue({id:'b'.repeat(64),status:'approved',published:true});e.document.visibilityState='visible';e.documentEvents.visibilitychange();await tick();assert.equal(e.calls.filter(call=>call.path==='/api/clips/check').length,1);assert.equal(e.calls.at(-1).path,'/api/clips/status/'+'b'.repeat(64));assert.match(e.ids['member-clips-status'].textContent,/Your clip is live/);
});

test('logging out during automatic checking ignores a late approved response',async()=>{
  const e=await member();await select(e);e.enqueue({id:'b'.repeat(64),status:'pending',published:false});const finish=e.deferred();e.ids['member-clips-form'].fire('submit');await tick();e.controller.setUser(null);finish({id:'b'.repeat(64),status:'approved',published:true});await tick();assert.equal(e.ids['member-clips-root'].hidden,true);assert.equal(e.ids['member-clips-status'].textContent,'');assert.equal(e.ids['member-clips-check-status'].hidden,true);
});

test('new file selections supersede local preparation and invalid sources cannot submit',async()=>{
  const e=await member();let resolve;e.helper.preparePhone=()=>new Promise(done=>{resolve=done;});await select(e,videoFile('old.mov',1200,'video/quicktime'));e.button('Make upload smaller').fire('click');
  await select(e,videoFile('new.mp4'));resolve(videoFile('old-prepared.mp4'));await tick();assert.equal(e.created.at(-1).blob.name,'new.mp4');
  await select(e,{name:'huge.mp4',type:'video/mp4',size:100*1024*1024+1});assert.equal(e.ids['member-clips-submit'].disabled,true);assert.match(e.ids['member-clips-status'].textContent,/100 MB/);assert.equal(e.ids['member-clips-preview'].hidden,true);
});

test('owner queue uses plaintext and authenticated Blob previews, revoking them on close',async()=>{
  const e=environment();e.enqueue({clips:[clip({name:'<img src=x>',caption:'<script>bad</script>'})]});e.controller.setUser(signedIn);await tick();
  assert.equal(e.ids['member-clips-review'].hidden,false);assert.equal(e.nodes().find(node=>node.tagName==='h4').textContent,'<img src=x>');assert.equal(e.nodes().find(node=>node.className==='short-clip-caption').textContent,'<script>bad</script>');assert.ok(!source.includes('innerHTML'));
  e.ids['member-clips-review'].open=true;e.ids['member-clips-review'].fire('toggle');e.enqueue({type:'video/mp4',size:1200});e.button('Preview video').fire('click');await tick();
  assert.equal(e.calls.at(-1).options.credentials,'same-origin');assert.equal(e.calls.at(-1).options.cache,'no-store');const video=e.nodes().find(node=>node.tagName==='video'&&node!==e.ids['member-clips-preview']);assert.match(video.src,/^blob:/);assert.equal(video.controls,true);assert.equal(video.playsInline,true);assert.equal(video.autoplay,undefined);
  e.ids['member-clips-review'].open=false;e.ids['member-clips-review'].fire('toggle');assert.ok(e.revoked.includes(e.created.at(-1).value));assert.equal(e.ids['member-clips-review-list'].children.length,0);
});

test('foreign preview URLs fail closed and pending video arriving after logout is discarded',async()=>{
  const invalid=environment();invalid.enqueue({clips:[clip({video_url:'https://evil.example/steal'})]});invalid.controller.setUser(signedIn);await tick();assert.equal(invalid.ids['member-clips-review'].hidden,true);assert.equal(invalid.ids['member-clips-review-list'].children.length,0);
  const e=environment();e.enqueue({clips:[clip()]});e.controller.setUser(signedIn);await tick();e.ids['member-clips-review'].open=true;e.ids['member-clips-review'].fire('toggle');const finish=e.deferred();e.button('Preview video').fire('click');e.controller.setUser(null);finish({type:'video/mp4',size:1200});await tick();assert.equal(e.created.length,0);assert.equal(e.ids['member-clips-review-list'].children.length,0);
});

test('owner review needs an explicit decision and matching confirmation',async()=>{
  const e=environment();e.enqueue({clips:[clip()]});e.controller.setUser(signedIn);await tick();assert.equal(e.calls.filter(call=>call.options.method==='POST').length,0);
  e.enqueue({id:clip().id,status:'approved'});e.enqueue({clips:[]});e.button('Approve').fire('click');await tick();await tick();const post=e.calls.find(call=>call.options.method==='POST');assert.equal(post.path,'/api/clips/review');assert.deepEqual(JSON.parse(post.options.body),{id:clip().id,action:'approve'});assert.equal(e.ids['member-clips-review-list'].children.length,0);
});

test('hiding the page stops recording and removes previews while late results stay ignored',async()=>{
  const e=await member();let resolve;let canceled=0;e.helper.record=({onStream})=>{onStream({getTracks(){return[];}});return{stop(){},cancel(){canceled+=1;},result:new Promise(done=>{resolve=done;})};};e.ids['member-clips-record'].fire('click');assert.equal(e.ids['member-clips-stop'].hidden,false);
  e.document.visibilityState='hidden';e.documentEvents.visibilitychange();resolve({name:'late.mp4'});await tick();assert.ok(canceled>0);assert.equal(e.ids['member-clips-preview'].hidden,true);assert.equal(e.created.length,0);assert.equal(e.ids['member-clips-submit'].disabled,true);
});

test('public feed accepts only site media paths and has no autoplay audio',async()=>{
  // Auto initialization begins before a response is queued; its harmless initial
  // failure is followed by an explicit refresh for the payload under test.
  const e=environment({publicFeed:true});await tick();e.enqueue({clips:[clip()],member_id:memberId});e.ids['clips-refresh'].fire('click');await tick();const card=e.ids['clips-feed'].children[0];const video=card.children.find(node=>node.tagName==='video');assert.equal(video.src,clip().video_url);assert.equal(video.autoplay,undefined);assert.equal(video.loop,true);assert.equal(video.preload,'metadata');
  e.enqueue({clips:[clip({video_url:'javascript:alert(1)'})],member_id:memberId});e.ids['clips-refresh'].fire('click');await tick();assert.equal(e.ids['clips-feed'].children.length,0);assert.match(e.ids['clips-status'].textContent,/could not load/);
});
