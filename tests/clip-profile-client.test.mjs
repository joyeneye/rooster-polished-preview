import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';

const utils=fs.readFileSync(new URL('../clip-client-utils.js',import.meta.url),'utf8').replaceAll('export function ','function ');
const source=fs.readFileSync(new URL('../member-clips.js',import.meta.url),'utf8').replace(/^import .+;\n/gm,'').replace('export function createMemberClips','function createMemberClips');
const publicSource=fs.readFileSync(new URL('../short-clips.js',import.meta.url),'utf8').replace(/^import .+;\n/gm,'').replace('export function createShortClips','function createShortClips');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const signedIn={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'};
const clip=(overrides={})=>({id:'a'.repeat(64),member_id:signedIn.id,name:'Music Friend',caption:'My little moment',created_at:'2026-09-05T12:00:00Z',video_url:'/api/clip-video/'+'a'.repeat(64),width:480,height:640,duration:12,...overrides});

function environment({publicFeed=false,memberScope='owner',search=''}={}) {
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
  ids['clips-feed'].dataset.clipMember=memberScope;
  const documentEvents={};const pageEvents={};const revoked=[];const created=[];const expired=[];
  const document={visibilityState:'visible',getElementById:id=>ids[id],createElement:tag=>new Element(tag),addEventListener:(type,fn)=>{documentEvents[type]=fn;}};
  const queue=[];const calls=[];
  const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data,blob:async()=>data});
  const enqueue=(data,status=200)=>queue.push(()=>Promise.resolve(response(data,status)));
  const deferred=()=>{let resolve;const p=new Promise(r=>{resolve=r;});queue.push(()=>p);return(data,status=200)=>resolve(response(data,status));};
  const fetch=async(path,options)=>{calls.push({path,options});const next=queue.shift();if(!next)throw Error('Missing response');return next();};
  const helper={prepare:async file=>file,record:()=>{throw Error('No camera');}};
  class Form {constructor(){this.values=new Map();}append(key,value){this.values.set(key,value);}get(key){return this.values.get(key);}}
  // This profile-scope harness has no full-screen viewer section. The real
  // viewer returns null for that DOM shape; provide the stripped import here.
  const context=vm.createContext({createClipsViewer:()=>null,createClipCommunityController:()=>({attach(){},clear(){}}),document,URLSearchParams,window:{location:{search},addEventListener:(type,fn)=>{pageEvents[type]=fn;}},fetch,AbortController,setTimeout,clearTimeout,crypto:{randomUUID},FormData:Form,URL:{createObjectURL:blob=>{const value='blob:'+created.length;created.push({value,blob});return value;},revokeObjectURL:value=>revoked.push(value)},preparePrivateVideo:(...args)=>helper.prepare(...args),recordPrivateVideo:(...args)=>helper.record(...args),onSessionExpired:reason=>expired.push(reason)});
  vm.runInContext(utils+'\n'+(publicFeed?publicSource:source+'\nthis.controller=createMemberClips({onSessionExpired});'),context);
  const nodes=(node=root)=>[node,...node.children.flatMap(item=>nodes(item))];
  return{ids,document,documentEvents,pageEvents,enqueue,deferred,calls,helper,created,revoked,expired,controller:context.controller,nodes,button:text=>nodes().find(node=>node.tagName==='button'&&node.textContent===text)};
}

async function member() {const e=environment();e.enqueue({error:'Forbidden'},403);e.controller.setUser(signedIn);await tick();return e;}
async function select(e,file={name:'hello.mp4',type:'video/mp4',size:1200}) {e.ids['member-clips-file'].files=[file];e.ids['member-clips-file'].fire('change');await tick();return file;}

test('public feed accepts only site media paths and has no autoplay audio',async()=>{
  // Auto initialization begins before a response is queued; its harmless initial
  // failure is followed by an explicit refresh for the payload under test.
  const e=environment({publicFeed:true});await tick();e.enqueue({clips:[clip()],member_id:signedIn.id});e.ids['clips-refresh'].fire('click');await tick();const card=e.ids['clips-feed'].children[0];const video=card.children.find(node=>node.tagName==='video');assert.equal(video.src,clip().video_url);assert.equal(video.autoplay,undefined);assert.equal(video.loop,true);assert.equal(video.preload,'metadata');
  e.enqueue({clips:[clip({video_url:'javascript:alert(1)'})],member_id:signedIn.id});e.ids['clips-refresh'].fire('click');await tick();assert.equal(e.ids['clips-feed'].children.length,0);assert.match(e.ids['clips-status'].textContent,/could not load/);
});

test('upload receipt opens the signed in uploader profile, never the site owner home',async()=>{
  const e=await member();
  assert.equal(e.ids['member-clips-watch'].href,`/profile.html?id=${signedIn.id}#clips`);
  e.controller.setUser(null);
  assert.equal(e.ids['member-clips-watch'].hidden,true);
  assert.doesNotMatch(e.ids['member-clips-watch'].href,/^\/#clips$/);
});
test('home viewer fetch is explicitly owner scoped and other member results are rejected',async()=>{
  const e=environment({publicFeed:true});await tick();
  assert.equal(e.calls[0].path,'/api/clips?member=owner');
  const owner='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  e.enqueue({clips:[clip()],member_id:owner});e.ids['clips-refresh'].fire('click');await tick();
  assert.equal(e.ids['clips-feed'].children.length,0);
  assert.match(e.ids['clips-status'].textContent,/could not load/);
});
test('member Videos section fetches and displays only the member in its page link',async()=>{
  const e=environment({publicFeed:true,memberScope:'profile',search:'?id='+signedIn.id});await tick();
  assert.equal(e.calls[0].path,'/api/clips?member='+signedIn.id);
  e.enqueue({clips:[clip()],member_id:signedIn.id});e.ids['clips-refresh'].fire('click');await tick();
  assert.equal(e.ids['clips-feed'].children.length,1);
  const other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  e.enqueue({clips:[clip({member_id:other})],member_id:other});e.ids['clips-refresh'].fire('click');await tick();
  assert.equal(e.ids['clips-feed'].children.length,0);
});
test('invalid member profile never fetches a global fallback feed',async()=>{
  const e=environment({publicFeed:true,memberScope:'profile',search:'?id=invalid'});await tick();
  assert.equal(e.calls.length,0);assert.equal(e.ids['clips-refresh'].disabled,true);
});
