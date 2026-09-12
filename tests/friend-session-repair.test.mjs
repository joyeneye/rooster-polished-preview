import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const source=readFileSync(new URL('../friend-session.js',import.meta.url),'utf8');
const USER={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',confirmedAt:'2026-09-05T00:00:00Z'};
const TARGET='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const tick=()=>new Promise(r=>setImmediate(r));
function env(saved=new Map(),fetcher=async()=>new Response(JSON.stringify({count:0,added:false,request_created:true,state:'outgoing',message:'Roster request sent. Waiting for acceptance.'}))){
 const calls=[],events={},dispatched=[];
 function el(){return {children:[],hidden:true,textContent:'',append(...x){this.children.push(...x);},replaceChildren(...x){this.children=x;},addEventListener(type,fn){this[type]=fn;}};}
 const box=el(),window={addEventListener:(t,f)=>events[t]=f,dispatchEvent:e=>dispatched.push(e)};
 vm.runInNewContext(source,{window,document:{getElementById:()=>box,createElement:()=>el()},localStorage:{getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)},crypto:{randomUUID},AbortController,Date,JSON,Number,CustomEvent:class {constructor(type,options){this.type=type;this.detail=options?.detail;}},setTimeout:()=>1,clearTimeout(){},fetch:async(...args)=>{calls.push(args);return fetcher(...args);}});
 return {api:window.JWhiteFriendSession,calls,box,events,dispatched,saved};
}
test('an Add Member click survives the login page and sends one pending request after confirmed login',async()=>{
 const original=env();original.api.remember(TARGET);assert.equal(original.calls.length,0);
 const login=env(original.saved);login.api.setUser(USER);await tick();assert.equal(login.calls.length,1);
 assert.match(login.calls[0][0],new RegExp(`target_id=${TARGET}`));assert.equal(login.calls[0][1].credentials,'same-origin');
 assert.equal(login.saved.size,0);assert.match(login.box.children[0].textContent,/Roster request sent.*Waiting for acceptance/);
 login.api.setUser(USER);await tick();assert.equal(login.calls.length,1);assert.deepEqual(login.dispatched.map(event=>event.type),['jwhite:requests-changed','jwhite:friends-changed']);
});
test('unconfirmed login cannot add, a server failure keeps the intent, and the visible retry succeeds',async()=>{
 let ok=false;const e=env(new Map(),async()=>new Response(JSON.stringify(ok?{count:1}:{error:'try later'}),{status:ok?200:503}));
 e.api.remember(TARGET);e.api.setUser({...USER,confirmedAt:null});await tick();assert.equal(e.calls.length,0);
 e.api.setUser(USER);await tick();assert.equal(e.saved.size,1);const retry=e.box.children.at(-1);assert.equal(retry.textContent,'Send Roster Request');
 ok=true;retry.click();await tick();assert.equal(e.saved.size,0);assert.equal(e.calls.length,2);
});
test('a response from a signed-out session cannot claim the next account added a friend',async()=>{
 let finish;const e=env(new Map(),()=>new Promise(resolve=>finish=resolve));e.api.remember(TARGET);e.api.setUser(USER);
 e.api.setUser(null);finish(new Response(JSON.stringify({count:1})));await tick();assert.equal(e.saved.size,1);assert.equal(e.dispatched.length,0);
});
test('expired and invalid pending targets never create a friend request',async()=>{
 const e=env();assert.equal(e.api.remember('../../someone'),null);e.api.setUser(USER);await tick();assert.equal(e.calls.length,0);
});
