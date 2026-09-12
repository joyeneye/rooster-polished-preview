import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';

const source = fs.readFileSync(new URL('../member-chat.js', import.meta.url), 'utf8').replace('export function createMemberChat', 'function createMemberChat');
const tick = () => new Promise(resolve => setImmediate(resolve));
class Element {
  constructor(id = '') { this.id=id; this.value=''; this.hidden=false; this.disabled=false; this.open=false; this.dataset={}; this.textContent=''; this.children=[]; this.attributes={}; this.listeners={}; this.clientHeight=180; this._scrollTop=0; }
  get scrollHeight() { return this.children.length * 60; }
  get scrollTop() { return this._scrollTop; }
  set scrollTop(value) { this._scrollTop=Math.max(0,Math.min(value,this.scrollHeight-this.clientHeight)); }
  append(...nodes) { for(const node of nodes) {node.parent=this;this.children.push(node);} }
  replaceChildren(...nodes) { this.children=[];this.append(...nodes); }
  setAttribute(key,value) { this.attributes[key]=value; }
  addEventListener(event,fn) { this.listeners[event]=fn; }
  getBoundingClientRect() { const top=this.parent?.id==='chat-messages' ? this.parent.children.indexOf(this)*60-this.parent.scrollTop : 0;return {top,bottom:top+60}; }
  focus() { this.focused=true; }
  reportValidity() { return true; }
  fire(type) { return this.listeners[type]?.({preventDefault(){},currentTarget:this}); }
}
const signedIn={id:'member-a',name:'Ari'};
const recentTime=(offset=0)=>new Date(Date.now()-10_000+offset).toISOString();
const message=(id,overrides={})=>({id,member_id:'member-b',name:'Bea',body:'What is on repeat today?',created_at:recentTime(),...overrides});
const payload=(messages=[])=>({room:'The Listening Room',messages});
function environment({open=true}={}) {
  const ids=Object.fromEntries(['member-chat','chat-room','chat-messages','chat-compose-form','chat-body','chat-status','chat-connection','chat-new-messages','chat-send','chat-refresh','chat-character-count','chat-empty'].map(id=>[id,new Element(id)]));
  ids['chat-room'].open=open;
  const events={};const pageEvents={};const intervals=new Map();let intervalId=0;
  const document={visibilityState:'visible',getElementById:id=>ids[id],createElement:()=>new Element(),addEventListener:(type,fn)=>{events[type]=fn;}};
  const queue=[];const calls=[];const expired=[];const timeouts=[];
  const fetch=async(path,options)=>{calls.push({path,options});const item=queue.shift();if(!item)throw Error('Test did not enqueue response');return await item();};
  const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
  const enqueue=(data,status=200)=>queue.push(async()=>response(data,status));
  const enqueueDeferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});queue.push(()=>promise);return(data,status=200)=>resolve(response(data,status));};
  const location={hash:''};
  const context=vm.createContext({document,window:{location,addEventListener:(type,fn)=>{pageEvents[type]=fn;}},fetch,AbortController,setTimeout:(fn,delay)=>{timeouts.push(delay);return setTimeout(fn,delay);},clearTimeout,setInterval:(fn,delay)=>{assert.equal(delay,1000);const id=++intervalId;intervals.set(id,fn);return id;},clearInterval:id=>intervals.delete(id),crypto:{randomUUID},onSessionExpired:reason=>expired.push(reason)});
  vm.runInContext(source+'\nthis.controller=createMemberChat({onSessionExpired});',context);
  return {ids,document,events,pageEvents,intervals,calls,expired,timeouts,enqueue,enqueueDeferred,location,controller:context.controller};
}
async function connected() {const e=environment();e.enqueue(payload());e.controller.setUser(signedIn);await tick();return e;}
function draft(e,text='Great record!') {e.ids['chat-body'].value=text;e.ids['chat-body'].fire('input');}

test('room polls every second only while opened and visible, with no background timer',async()=>{
  const e=environment({open:false});e.controller.setUser(signedIn);
  assert.equal(e.calls.length,0);
  assert.equal(e.ids['chat-body'].disabled,true);
  assert.equal(e.intervals.size,0);assert.equal(e.calls.length,0);
  e.enqueue(payload());e.ids['chat-room'].open=true;e.ids['chat-room'].fire('toggle');await tick();
  assert.equal(e.calls.length,1);assert.equal(e.ids['chat-body'].disabled,false);
  assert.equal(e.intervals.size,1);assert.equal(e.ids['chat-connection'].textContent,'Live');
  assert.equal(e.calls[0].options.credentials,'same-origin');assert.equal(e.calls[0].options.cache,'no-store');
  e.document.visibilityState='hidden';e.events.visibilitychange();assert.equal(e.intervals.size,0);assert.equal(e.calls.length,1);assert.equal(e.ids['chat-connection'].textContent,'Paused');
  e.enqueue(payload());e.document.visibilityState='visible';e.events.visibilitychange();await tick();assert.equal(e.calls.length,2);
  assert.equal(e.intervals.size,1);
  e.ids['chat-room'].open=false;e.ids['chat-room'].fire('toggle');assert.equal(e.intervals.size,0);assert.equal(e.calls.length,2);assert.equal(e.ids['chat-connection'].textContent,'Room closed');
  e.controller.setUser(null);assert.equal(e.intervals.size,0);
});

test('late room response after logout cannot restore content or enable input',async()=>{
  const e=environment();const finish=e.enqueueDeferred();e.controller.setUser(signedIn);
  e.controller.setUser(null);assert.equal(e.calls[0].options.signal.aborted,true);
  finish(payload([message('private')]));await tick();
  assert.equal(e.ids['member-chat'].hidden,true);assert.equal(e.ids['chat-messages'].children.length,0);assert.equal(e.ids['chat-body'].disabled,true);assert.equal(e.ids['chat-status'].textContent,'');
});

test('closing room aborts read and ignores its late response until reopened',async()=>{
  const e=environment();const finish=e.enqueueDeferred();e.controller.setUser(signedIn);
  e.ids['chat-room'].open=false;e.ids['chat-room'].fire('toggle');assert.equal(e.calls[0].options.signal.aborted,true);
  finish(payload([message('old')]));await tick();assert.equal(e.ids['chat-messages'].children.length,0);
  e.enqueue(payload([message('current')]));e.ids['chat-room'].open=true;e.ids['chat-room'].fire('toggle');await tick();
  assert.equal(e.ids['chat-messages'].children[0].dataset.messageId,'current');e.controller.setUser(null);
});

test('names and message content render only as plain text',async()=>{
  const e=environment();e.enqueue(payload([message('one',{name:'<img src=x>',body:'<script>alert(1)</script>\nMusic forever.'})]));e.controller.setUser(signedIn);await tick();
  const row=e.ids['chat-messages'].children[0];assert.equal(row.children[0].children[0].textContent,'<img src=x>');assert.equal(row.children[1].textContent,'<script>alert(1)</script>\nMusic forever.');
  assert.equal(row.children[1].children.length,0);assert.ok(!source.includes('innerHTML'));e.controller.setUser(null);
});

test('new messages do not pull a reader away from older messages',async()=>{
  const e=environment();const initial=Array.from({length:10},(_,index)=>message(String(index).padStart(2,'0')));
  e.enqueue(payload(initial));e.controller.setUser(signedIn);await tick();assert.equal(e.ids['chat-messages'].scrollTop,420);
  e.ids['chat-messages'].scrollTop=60;
  e.enqueue(payload([...initial,message('new',{created_at:recentTime(1_000)})]));e.ids['chat-refresh'].fire('click');await tick();
  assert.equal(e.ids['chat-messages'].scrollTop,60);assert.equal(e.ids['chat-new-messages'].hidden,false);assert.equal(e.ids['chat-new-messages'].textContent,'1 new message');
  e.ids['chat-new-messages'].fire('click');assert.equal(e.ids['chat-messages'].scrollTop,480);assert.equal(e.ids['chat-new-messages'].hidden,true);assert.equal(e.ids['chat-messages'].focused,true);
  e.enqueue(payload([...initial,message('new'),message('next',{created_at:recentTime(2_000)})]));e.ids['chat-refresh'].fire('click');await tick();assert.equal(e.ids['chat-messages'].scrollTop,540);e.controller.setUser(null);
});

test('unknown send result keeps draft and retries with one stable request ID',async()=>{
  const e=await connected();draft(e);
  const finish=e.enqueueDeferred();e.ids['chat-compose-form'].fire('submit');assert.equal(e.ids['chat-send'].disabled,true);assert.equal(e.ids['chat-messages'].children.length,0);
  const first=JSON.parse(e.calls.at(-1).options.body);
  e.ids['chat-compose-form'].fire('submit');assert.equal(e.calls.filter(call=>call.options.method==='POST').length,1);
  finish({error:'Unavailable'},503);await tick();assert.equal(e.ids['chat-body'].value,'Great record!');assert.match(e.ids['chat-status'].textContent,/could not confirm/);
  const sent=message('sent',{member_id:'member-a',name:'Ari',body:'Great record!'});
  e.enqueue({status:'approved',published:true,message:sent});e.enqueue(payload([sent]));e.ids['chat-compose-form'].fire('submit');await tick();await tick();
  const second=JSON.parse(e.calls.filter(call=>call.options.method==='POST').at(-1).options.body);assert.equal(first.request_id,second.request_id);
  assert.equal(e.ids['chat-messages'].children.length,1);assert.equal(e.ids['chat-body'].value,'');assert.equal(e.ids['chat-status'].textContent,'Message sent.');e.controller.setUser(null);
});

test('held and rejected messages retain editable drafts and are never shown as published',async()=>{
  const e=await connected();draft(e,'Please review this');e.enqueue({status:'pending',published:false});e.ids['chat-compose-form'].fire('submit');await tick();
  assert.equal(e.ids['chat-body'].value,'Please review this');assert.equal(e.ids['chat-messages'].children.length,0);assert.match(e.ids['chat-status'].textContent,/held for review and has not been posted/);
  draft(e,'Try this instead');e.enqueue({status:'rejected',published:false},422);e.ids['chat-compose-form'].fire('submit');await tick();
  assert.equal(e.ids['chat-body'].value,'Try this instead');assert.equal(e.ids['chat-messages'].children.length,0);assert.match(e.ids['chat-status'].textContent,/Keep it kind/);assert.equal(e.ids['chat-send'].disabled,false);e.controller.setUser(null);
});

test('malformed or mismatched confirmations never clear the draft or create a phantom message',async()=>{
  for(const confirmation of [
    {status:'approved',published:false,message:message('one')},
    {status:'approved',published:true,message:message('one',{body:'Great record!'})},
    {status:'approved',published:true,message:message('one',{member_id:'member-a',body:'A different draft'})},
    {status:'pending',published:true},
    {status:'anything',published:false},
  ]) {
    const e=await connected();draft(e);e.enqueue(confirmation);e.ids['chat-compose-form'].fire('submit');await tick();
    assert.equal(e.ids['chat-body'].value,'Great record!');assert.equal(e.ids['chat-messages'].children.length,0);assert.match(e.ids['chat-status'].textContent,/could not confirm/);e.controller.setUser(null);
  }
});

test('line endings match server normalization before an approved confirmation',async()=>{
  const e=await connected();draft(e,'  Good music\r\nGood people\rGreat day  ');
  const sent=message('normalized',{member_id:'member-a',body:'Good music\nGood people\nGreat day'});
  e.enqueue({status:'approved',published:true,message:sent});e.enqueue(payload([sent]));e.ids['chat-compose-form'].fire('submit');await tick();await tick();
  const submitted=JSON.parse(e.calls.find(call=>call.options.method==='POST').options.body);assert.equal(submitted.body,sent.body);
  assert.equal(e.ids['chat-body'].value,'');assert.equal(e.ids['chat-messages'].children.length,1);e.controller.setUser(null);
});

test('invalid room payload leaves the composer disconnected until a valid response arrives',async()=>{
  for(const bad of [{room:'Another room',messages:[]},payload([message('one',{created_at:'not-a-date'})]),{room:'The Listening Room',messages:null}]) {
    const e=environment();e.enqueue(bad);e.controller.setUser(signedIn);await tick();assert.equal(e.ids['chat-body'].disabled,true);assert.equal(e.ids['chat-messages'].children.length,0);
    e.enqueue(payload());e.ids['chat-refresh'].fire('click');await tick();assert.equal(e.ids['chat-body'].disabled,false);e.controller.setUser(null);
  }
});

test('late approved send cannot restore room data after logout',async()=>{
  const e=await connected();draft(e);const finish=e.enqueueDeferred();e.ids['chat-compose-form'].fire('submit');e.controller.setUser(null);
  finish({status:'approved',published:true,message:message('late',{member_id:'member-a',body:'Great record!'})});await tick();
  assert.equal(e.ids['member-chat'].hidden,true);assert.equal(e.ids['chat-messages'].children.length,0);assert.equal(e.ids['chat-body'].value,'');assert.equal(e.ids['chat-status'].textContent,'');assert.equal(e.intervals.size,0);
});

test('unauthorized reads remove cached room data and require a verified session',async()=>{
  for(const code of [401,403]) {
    const e=environment();e.enqueue(payload([message('one')]));e.controller.setUser(signedIn);await tick();
    draft(e,'A private draft');e.enqueue({error:'Unauthorized'},code);e.ids['chat-refresh'].fire('click');await tick();
    assert.equal(e.ids['member-chat'].hidden,true);assert.equal(e.ids['chat-messages'].children.length,0);assert.equal(e.ids['chat-body'].value,'');assert.equal(e.expired[0],code===403?'confirmation':'session');
  }
});

test('pagehide clears content and input; a verified return can reconnect',async()=>{
  const e=environment();e.enqueue(payload([message('one')]));e.controller.setUser(signedIn);await tick();e.pageEvents.pagehide();
  assert.equal(e.ids['member-chat'].hidden,true);assert.equal(e.ids['chat-messages'].children.length,0);
  e.enqueue(payload([message('two')]));e.controller.setUser(signedIn);await tick();assert.equal(e.ids['member-chat'].hidden,false);assert.equal(e.ids['chat-messages'].children[0].dataset.messageId,'two');e.controller.setUser(null);
});

test('one-second ticks never overlap an active read and approved send queues an immediate fresh read',async()=>{
  const e=await connected();const finish=e.enqueueDeferred();const poll=e.intervals.values().next().value;
  poll();poll();poll();assert.equal(e.calls.filter(call=>call.path==='/api/member-chat').length,2);
  const sent=message('fresh',{member_id:'member-a',name:'Ari',body:'Great record!'});
  e.enqueue({status:'approved',published:true,message:sent});e.enqueue(payload([sent]));draft(e);e.ids['chat-compose-form'].fire('submit');await tick();
  assert.equal(e.calls.filter(call=>call.path==='/api/member-chat').length,2,'approved send waits for the active read instead of overlapping it');
  assert.equal(e.ids['chat-messages'].children[0].dataset.messageId,'fresh','approved send appears immediately');
  finish(payload());await tick();await tick();
  assert.equal(e.calls.filter(call=>call.path==='/api/member-chat').length,3,'fresh read starts immediately after the old read finishes');
  assert.equal(e.ids['chat-messages'].children[0].dataset.messageId,'fresh','stale read cannot remove the approved message');
  assert.equal(e.ids['chat-status'].textContent,'Message sent.');
  assert.ok(e.timeouts.includes(5000));assert.ok(e.timeouts.includes(20000));
  e.controller.setUser(null);
});

test('connection indicator reports failures honestly and automatically returns live on a valid read',async()=>{
  const e=environment();const finish=e.enqueueDeferred();e.controller.setUser(signedIn);
  assert.equal(e.ids['chat-connection'].textContent,'Connecting…');assert.equal(e.ids['chat-connection'].dataset.state,'connecting');
  finish(payload());await tick();assert.equal(e.ids['chat-connection'].textContent,'Live');
  const poll=e.intervals.values().next().value;e.enqueue({error:'Connection lost'},503);poll();await tick();
  assert.equal(e.ids['chat-connection'].textContent,'Reconnecting…');assert.equal(e.ids['chat-connection'].dataset.state,'reconnecting');assert.equal(e.ids['chat-body'].disabled,true);
  assert.match(e.ids['chat-status'].textContent,/Reconnecting/);assert.equal(e.intervals.size,1);
  e.enqueue(payload([message('back')]));poll();await tick();
  assert.equal(e.ids['chat-connection'].textContent,'Live');assert.equal(e.ids['chat-body'].disabled,false);assert.equal(e.ids['chat-status'].textContent,'Back in the conversation.');
  e.controller.setUser(null);assert.equal(e.ids['chat-connection'].textContent,'Offline');assert.equal(e.intervals.size,0);
});

test('browser navigation back to the chat hash reopens the room only for an authenticated member',async()=>{
  const e=environment({open:false});e.location.hash='#member-chat';e.pageEvents.hashchange();
  assert.equal(e.ids['chat-room'].open,false);assert.equal(e.calls.length,0);
  e.controller.setUser(signedIn);assert.equal(e.calls.length,0);
  e.enqueue(payload());e.pageEvents.hashchange();await tick();
  assert.equal(e.ids['chat-room'].open,true);assert.equal(e.calls.length,1);assert.equal(e.ids['chat-connection'].textContent,'Live');
  e.controller.setUser(null);
});
