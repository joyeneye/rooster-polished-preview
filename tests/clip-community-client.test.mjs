import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';

const source=fs.readFileSync(new URL('../clip-community.js',import.meta.url),'utf8').replace('export function createClipCommunityController','function createClipCommunityController');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const id='a'.repeat(64);
const viewerA='11111111-1111-4111-8111-111111111111';
const viewerB='22222222-2222-4222-8222-222222222222';
const comment=(overrides={})=>({id:'b'.repeat(64),name:'Music Friend',body:'Love this moment!',created_at:'2026-09-05T12:00:00Z',...overrides});
const payload=(overrides={})=>({id,counts:{apple:3,tomato:1},comments:[],comment_count:0,my_reaction:null,authenticated:true,viewer_id:overrides.authenticated===false?null:viewerA,...overrides});

function environment() {
  class Element {
    constructor(tag='div'){this.tagName=tag;this.children=[];this.value='';this.hidden=false;this.disabled=false;this.open=false;this.textContent='';this.attrs={};this.listeners={};}
    append(...nodes){this.children.push(...nodes);}
    replaceChildren(...nodes){this.children=[...nodes];}
    setAttribute(key,value){this.attrs[key]=value;}
    addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
    fire(type){for(const fn of this.listeners[type]??[])fn({preventDefault(){},currentTarget:this});}
  }
  const documentEvents={};const pageEvents={};const intervals=new Map();let timer=0;const cards=[];
  const document={visibilityState:'visible',createElement:tag=>new Element(tag),addEventListener:(type,fn)=>{documentEvents[type]=fn;}};
  const queue=[];const calls=[];
  const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
  const enqueue=(data,status=200)=>queue.push(()=>Promise.resolve(response(data,status)));
  const deferred=()=>{let resolve;const p=new Promise(r=>{resolve=r;});queue.push(()=>p);return(data,status=200)=>resolve(response(data,status));};
  const fetch=async(path,options)=>{calls.push({path,options});const next=queue.shift();if(!next)throw Error('Missing response');return next();};
  const context=vm.createContext({document,window:{addEventListener:(type,fn)=>{pageEvents[type]=fn;}},fetch,AbortController,setTimeout,clearTimeout,setInterval:(fn,ms)=>{assert.equal(ms,5000);intervals.set(++timer,fn);return timer;},clearInterval:token=>intervals.delete(token),crypto:{randomUUID}});
  vm.runInContext(source+'\nthis.controller=createClipCommunityController();',context);
  const nodes=node=>[node,...node.children.flatMap(nodes)];
  const attach=(clipId=id)=>{const card=new Element('article');cards.push(card);context.controller.attach({id:clipId,name:'J.White'},card);return card;};
  const find=(className,card=cards[0])=>nodes(card).find(node=>node.className===className);
  const tag=(name,card=cards[0])=>nodes(card).find(node=>node.tagName===name);
  return{document,documentEvents,pageEvents,intervals,enqueue,deferred,calls,attach,find,tag,nodes,cards,controller:context.controller};
}
async function ready(data=payload()){const e=environment();e.enqueue(data);e.attach();await tick();return e;}
async function opened(e,data=payload()){e.enqueue(data);const details=e.find('clip-comments');details.open=true;details.fire('toggle');await tick();return details;}

test('green apples and tomatoes show actual counts only after loading',async()=>{
  const e=environment();const finish=e.deferred();e.attach();const apple=e.find('clip-reaction clip-reaction-apple');assert.equal(apple.textContent,'🍏 Green apples · …');assert.equal(apple.disabled,true);assert.ok(!source.includes('🍎'));
  finish(payload());await tick();assert.equal(apple.textContent,'🍏 Green apples · 3');assert.equal(apple.disabled,false);assert.equal(e.find('clip-reaction clip-reaction-tomato').textContent,'🍅 Tomatoes · 1');assert.equal(e.calls[0].options.credentials,'same-origin');assert.equal(e.calls[0].options.cache,'no-store');
});

test('one reaction toggles and changes only after a matching server confirmation',async()=>{
  const e=await ready();const apple=e.find('clip-reaction clip-reaction-apple');const tomato=e.find('clip-reaction clip-reaction-tomato');
  const finish=e.deferred();apple.fire('click');apple.fire('click');assert.equal(e.calls.filter(call=>call.options.method==='POST').length,1);assert.equal(apple.attrs['aria-pressed'],'false');finish({id,counts:{apple:4,tomato:1},reaction:'apple'});await tick();assert.equal(apple.attrs['aria-pressed'],'true');
  e.enqueue({id,counts:{apple:3,tomato:1},reaction:null});apple.fire('click');await tick();assert.equal(JSON.parse(e.calls.at(-1).options.body).reaction,null);assert.equal(apple.attrs['aria-pressed'],'false');
  e.enqueue({id,counts:{apple:3,tomato:2},reaction:'tomato'});tomato.fire('click');await tick();assert.equal(tomato.attrs['aria-pressed'],'true');assert.equal(apple.attrs['aria-pressed'],'false');
});

test('unknown reaction retry remains idempotent even after a poll reports its committed result',async()=>{
  const e=await ready();await opened(e);const apple=e.find('clip-reaction clip-reaction-apple');e.enqueue({error:'Unavailable'},503);apple.fire('click');await tick();const first=JSON.parse(e.calls.at(-1).options.body);
  e.enqueue(payload({counts:{apple:4,tomato:1},my_reaction:'apple'}));e.intervals.values().next().value();await tick();assert.equal(apple.attrs['aria-pressed'],'true');
  e.enqueue({id,counts:{apple:4,tomato:1},reaction:'apple'});apple.fire('click');await tick();const retry=JSON.parse(e.calls.at(-1).options.body);assert.equal(retry.request_id,first.request_id);assert.equal(retry.reaction,'apple');
});

test('anonymous and expired members get a clear login link without invented reactions',async()=>{
  const anon=await ready(payload({authenticated:false}));anon.find('clip-reaction clip-reaction-apple').fire('click');assert.equal(anon.calls.filter(call=>call.options.method==='POST').length,0);assert.equal(anon.find('clip-community-login').hidden,false);assert.equal(anon.find('clip-community-login').href,'/members.html');
  const e=await ready();e.enqueue({error:'Unauthorized'},401);e.find('clip-reaction clip-reaction-apple').fire('click');await tick();assert.equal(e.find('clip-community-login').hidden,false);assert.match(e.find('clip-community-status').textContent,/Log in/);assert.equal(e.find('clip-reaction clip-reaction-apple').attrs['aria-pressed'],'false');
});

test('only one expanded comment panel polls and closing or hiding stops it',async()=>{
  const e=await ready();const first=await opened(e);assert.equal(e.intervals.size,1);
  const secondId='c'.repeat(64);e.enqueue(payload({id:secondId}));const card=e.attach(secondId);await tick();e.enqueue(payload({id:secondId}));const second=e.find('clip-comments',card);second.open=true;second.fire('toggle');await tick();assert.equal(first.open,false);assert.equal(e.intervals.size,1);
  e.document.visibilityState='hidden';e.documentEvents.visibilitychange();assert.equal(e.intervals.size,0);
  e.enqueue(payload());e.enqueue(payload({id:secondId}));e.document.visibilityState='visible';e.documentEvents.visibilitychange();await tick();assert.equal(e.intervals.size,1);
  second.open=false;second.fire('toggle');assert.equal(e.intervals.size,0);
});

test('comments render as plaintext and only an approved matching result is posted',async()=>{
  const e=await ready(payload({comments:[comment({name:'<img src=x>',body:'<script>alert(1)</script>'})],comment_count:1}));const row=e.find('clip-comment');assert.equal(row.children[0].textContent,'<img src=x>');assert.equal(row.children[1].textContent,'<script>alert(1)</script>');assert.ok(!source.includes('innerHTML'));
  await opened(e);const body=e.tag('textarea');body.value='  This is lovely\r\nMore please  ';body.fire('input');const normalized='This is lovely\nMore please';e.enqueue({id,status:'approved',published:true,comment:comment({body:normalized})});e.enqueue(payload({comments:[comment({body:normalized})],comment_count:1}));e.find('clip-comment-form').fire('submit');await tick();assert.equal(e.find('clip-comments-list').children.length,1);assert.equal(body.value,'');assert.match(e.nodes(e.cards[0]).filter(node=>node.className==='clip-community-status').at(-1).textContent,/comment is posted/);
});

test('pending and rejected comments stay off the page with accurate messages',async()=>{
  for(const state of ['pending','rejected']){const e=await ready();await opened(e);e.tag('textarea').value='Try this';e.enqueue({id,status:state,published:false});e.find('clip-comment-form').fire('submit');await tick();assert.equal(e.find('clip-comments-list').children.length,0);const message=e.nodes(e.cards[0]).filter(node=>node.className==='clip-community-status').at(-1).textContent;assert.match(message,state==='pending'?/saved for review.*not been posted/:/cannot be posted/);assert.equal(e.tag('textarea').value,state==='pending'?'':'Try this');}
});

test('uncertain comment responses preserve text and UUID without phantom posts',async()=>{
  const e=await ready();await opened(e);e.tag('textarea').value='Good vibes';e.enqueue({id,status:'approved',published:true,comment:comment({body:'Different text'})});e.find('clip-comment-form').fire('submit');await tick();const first=JSON.parse(e.calls.at(-1).options.body);assert.equal(e.tag('textarea').value,'Good vibes');assert.equal(e.find('clip-comments-list').children.length,0);
  e.enqueue({id,status:'pending',published:false});e.find('clip-comment-form').fire('submit');await tick();const second=JSON.parse(e.calls.at(-1).options.body);assert.equal(first.request_id,second.request_id);
});

test('late mutations and reads after pagehide cannot restore member state or content',async()=>{
  const e=await ready();await opened(e);e.tag('textarea').value='Private draft';const finish=e.deferred();e.find('clip-comment-form').fire('submit');e.pageEvents.pagehide();finish({id,status:'approved',published:true,comment:comment({body:'Private draft'})});await tick();assert.equal(e.tag('textarea').value,'');assert.equal(e.find('clip-comments-list').children.length,0);assert.equal(e.intervals.size,0);assert.ok(e.calls.at(-1).options.signal.aborted);
  const other=environment();const done=other.deferred();other.attach();other.controller.clear();done(payload());await tick();assert.equal(other.find('clip-reaction clip-reaction-apple').textContent,'🍏 Green apples · …');
});

test('invalid community payload leaves controls unavailable and counts unknown',async()=>{
  for(const data of [payload({counts:{apple:-1,tomato:0}}),payload({my_reaction:'bad'}),payload({comments:[comment({id:'bad'})],comment_count:1}),payload({id:'d'.repeat(64)})]){const e=await ready(data);assert.equal(e.find('clip-reaction clip-reaction-apple').disabled,true);assert.equal(e.find('clip-reaction clip-reaction-apple').textContent,'🍏 Green apples · …');assert.match(e.find('clip-community-status').textContent,/could not load/);}
});

test('switching accounts clears the previous member draft and pending retry on return',async()=>{
  const e=await ready();await opened(e);const body=e.tag('textarea');body.value='Draft written by member A';e.enqueue({error:'Unavailable'},503);e.find('clip-comment-form').fire('submit');await tick();assert.equal(body.value,'Draft written by member A');
  e.document.visibilityState='hidden';e.documentEvents.visibilitychange();e.enqueue(payload({viewer_id:viewerB}));e.document.visibilityState='visible';e.documentEvents.visibilitychange();await tick();assert.equal(body.value,'');assert.equal(e.nodes(e.cards[0]).filter(node=>node.className==='clip-community-status').at(-1).textContent,'');assert.equal(e.calls.filter(call=>call.path==='/api/clip-comment').length,1);
});

test('returning as the same verified member keeps an unsent comment draft',async()=>{
  const e=await ready();await opened(e);e.tag('textarea').value='Keep my draft';e.document.visibilityState='hidden';e.documentEvents.visibilitychange();e.enqueue(payload());e.document.visibilityState='visible';e.documentEvents.visibilitychange();await tick();assert.equal(e.tag('textarea').value,'Keep my draft');
});
