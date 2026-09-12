import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

const source=readFileSync(new URL('../booking-dashboard.js',import.meta.url),'utf8').replace(/^import[^\n]*\n/gm,'');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const member={id:'member-a',confirmedAt:'2026-09-11T00:00:00Z'};
const business={id:1,name:'Fixture studio',slug:'fixture',currency:'usd',timezone:'UTC',published:true,description:'Fixture',phone:''};
const overview={metrics:{upcomingAppointments:0,todayAppointments:0,todayRevenueCents:0,monthRevenueCents:0,clients:0},upcoming:[]};
function fixture(){
 const nodes=new Map(),store=new Map();let authCallback,reply=()=>Response.json({businesses:[business]}),sdkUser=null,hydrate=async()=>null;
 class Node{
  constructor(){this.children=[];this.value='';this.attrs={};this.classes=new Set();this.classList={add:x=>this.classes.add(x),toggle:(x,on)=>on?this.classes.add(x):this.classes.delete(x)};this.textContent=''}
  set innerHTML(value){this.html=value;this.children=[]}get innerHTML(){return this.html||''}
  append(node){this.children.push(node)}replaceChildren(...children){this.html='';this.children=children}
  setAttribute(k,v){this.attrs[k]=v}removeAttribute(k){delete this.attrs[k]}reset(){this.resetCount=(this.resetCount||0)+1}
  insertAdjacentHTML(_where,html){this.html=(this.html||'')+html}
 }
 const document={querySelector:selector=>{if(!nodes.has(selector))nodes.set(selector,new Node());return nodes.get(selector)},querySelectorAll:()=>[],createElement:()=>new Node()};
 class FixtureFormData{constructor(form){this.entries=Object.entries(form.fields||{})}*[Symbol.iterator](){yield* this.entries}}
 const context={document,location:{search:'',hash:'',href:'https://example.test/booking/dashboard'},localStorage:{getItem:key=>store.get(key)||null,setItem:(key,val)=>store.set(key,String(val)),removeItem:key=>store.delete(key)},BOOKING_PRESETS:[],bookingPresetDraft(){},bookingServicePayload(){},QRCode:{},AUTH_EVENTS:{LOGOUT:'logout',LOGIN:'login',TOKEN_REFRESH:'token_refresh'},onAuthChange:cb=>{authCallback=cb},getUser:async()=>sdkUser,hydrateSession:()=>hydrate(),handleAuthCallback:async()=>null,logout:async()=>{sdkUser=null;authCallback('logout',null)},login:async()=>{sdkUser=member;authCallback('login',member);return member},signup:async()=>member,fetch:async(url,options)=>reply(url,options),URLSearchParams,URL,Intl,Date,Number,Object,FormData:FixtureFormData,File,Response,console,navigator:{clipboard:{writeText(){}}}};
 vm.runInNewContext(source+'\nglobalThis.dashboard={api,init,loadAccount,navigate,state,setBookingUser};',context);
 return {api:context.dashboard,nodes,store,context,get:selector=>document.querySelector(selector),setReply:fn=>{reply=fn},setHydrate:fn=>{hydrate=fn},setUser:user=>{sdkUser=user},emit:(event,user)=>authCallback(event,user),visible:name=>!document.querySelector('#'+name+'-view').classes.has('hidden')};
}

test('the shipped dashboard bundle parses and signed-out boot leaves the opening shell',async()=>{
 const shipped=new URL('../public/booking-dashboard.js',import.meta.url);
 const parsed=spawnSync(process.execPath,['--check',shipped.pathname],{encoding:'utf8'});
 assert.equal(parsed.status,0,parsed.stderr||parsed.stdout);
 assert.doesNotMatch(readFileSync(shipped,'utf8'),/tokens truncated/);
 const e=fixture();await tick();e.setHydrate(async()=>null);e.setUser(null);await e.api.init();
 assert.equal(e.visible('auth'),true);
 assert.equal(e.visible('loading'),false);
 assert.match(e.get('#auth-title').textContent||'Welcome back',/Welcome back/);
});

for(const failure of [new TypeError('Offline'),503,429])test(`temporary booking ${String(failure)} keeps the member and offers a working same-page retry`,async()=>{
 const e=fixture();await tick();e.api.setBookingUser(member);
 e.setReply(()=>{if(failure instanceof Error)throw failure;return Response.json({error:'Temporarily unavailable'},{status:failure})});
 await e.api.loadAccount();
 assert.equal(e.api.state.user.id,member.id);assert.equal(e.visible('loading'),true);assert.equal(e.visible('auth'),false);
 const retry=e.get('#loading-view').children[0].children.find(node=>node.textContent==='Try again');assert.ok(retry);
 e.setReply(url=>Response.json(url==='/api/booking/me'?{businesses:[business]}:overview));retry.onclick();await tick();await tick();
 assert.equal(e.visible('app'),true);assert.equal(e.api.state.business.id,business.id);
});

for(const status of [401,403])test(`booking ${status} retains its HTTP status and clears private state`,async()=>{
 const e=fixture();await tick();e.api.setBookingUser(member);e.api.state.clients=[{name:'Private client'}];e.api.state.staff=[{name:'Private staff'}];e.get('#app-content').innerHTML='Private client';e.get('#modal-content').innerHTML='Private service';
 e.setReply(()=>new Response('Not JSON',{status}));
 await assert.rejects(e.api.api('/api/booking/me'),error=>error.status===status);
 assert.equal(e.api.state.user,null);assert.equal(e.api.state.clients,undefined);assert.equal(e.api.state.staff,undefined);assert.equal(e.get('#app-content').innerHTML,'');assert.equal(e.get('#modal-content').innerHTML,'');assert.equal(e.visible('auth'),true);
});

test('a delayed workspace response cannot reopen the app after sign-out',async()=>{
 const e=fixture();await tick();e.api.setBookingUser(member);let finish;e.setReply(()=>new Promise(resolve=>{finish=resolve}));const pending=e.api.loadAccount();await tick();
 e.emit('logout',null);finish(Response.json({businesses:[business]}));await pending;
 assert.equal(e.visible('auth'),true);assert.equal(e.api.state.account,null);assert.equal(e.api.state.business,null);assert.equal(e.get('#app-content').innerHTML,'');
});

test('an old workspace or section response cannot replace a new account',async()=>{
 const e=fixture();await tick();e.api.setBookingUser(member);let finish;
 e.setReply(()=>new Promise(resolve=>{finish=resolve}));const old=e.api.loadAccount();await tick();
 const next={id:'member-b',confirmedAt:member.confirmedAt},nextBusiness={...business,id:2,name:'New studio'};
 e.setReply(url=>Response.json(url==='/api/booking/me'?{businesses:[nextBusiness]}:overview));e.emit('login',next);await tick();await tick();
 finish(Response.json({businesses:[business]}));await old;
 assert.equal(e.visible('app'),true);assert.equal(e.api.state.user.id,next.id);assert.equal(e.api.state.business.id,2);
 let finishSection;e.setReply(()=>new Promise(resolve=>{finishSection=resolve}));const section=e.api.navigate('overview');await tick();
 e.emit('logout',null);finishSection(Response.json(overview));await section;
 assert.equal(e.get('#app-content').innerHTML,'');assert.equal(e.visible('auth'),true);
});

test('a late initialization answer cannot restore the account after logout',async()=>{
 const e=fixture();await tick();let finish;e.setUser(member);e.setHydrate(()=>new Promise(resolve=>{finish=resolve}));const pending=e.api.init();await tick();e.emit('logout',null);finish(member);await pending;
 assert.equal(e.api.state.user,null);assert.equal(e.visible('auth'),true);
});

test('initial connection failure shows retry and genuine sign-in still opens the workspace',async()=>{
 const e=fixture();await tick();e.setHydrate(async()=>{throw new TypeError('Offline')});await e.api.init();assert.equal(e.visible('loading'),true);assert.equal(e.visible('auth'),false);
 e.setHydrate(async()=>null);const retry=e.get('#loading-view').children[0].children.find(node=>node.textContent==='Try again');retry.onclick();await tick();assert.equal(e.visible('auth'),true);
 e.setReply(url=>Response.json(url==='/api/booking/me'?{businesses:[business]}:overview));e.emit('login',member);await tick();await tick();assert.equal(e.visible('app'),true);assert.equal(e.api.state.user.id,member.id);
});

for(const signup of [false,true])test(`the ${signup?'confirmed signup':'login'} form still opens the booking workspace`,async()=>{
 const e=fixture();await tick();e.api.state.signup=signup;e.setReply(url=>Response.json(url==='/api/booking/me'?{businesses:[business]}:overview));
 const form=e.get('#auth-form');form.fields={email:'fixture@example.test',password:'fixture-only',name:'Fixture'};
 await form.onsubmit({preventDefault(){},target:form});await tick();
 assert.equal(e.visible('app'),true);assert.equal(e.api.state.user.id,member.id);assert.equal(e.get('#auth-error').innerHTML,'');
});

test('a temporary reload failure preserves the current private workspace until a real account change',async()=>{
 const e=fixture();await tick();e.api.setBookingUser(member);e.api.state.business=business;e.api.state.services=[{name:'Private draft service'}];e.get('#app-content').innerHTML='Private workspace';
 e.setReply(()=>Response.json({error:'Try later'},{status:503}));await e.api.loadAccount();
 assert.equal(e.api.state.business.id,business.id);assert.equal(e.api.state.services.length,1);assert.equal(e.get('#app-content').innerHTML,'Private workspace');
 e.emit('logout',null);assert.equal(e.api.state.services,undefined);assert.equal(e.get('#app-content').innerHTML,'');
});
