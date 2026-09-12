import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';

const source=fs.readFileSync(new URL('../member-verification.js',import.meta.url),'utf8').replace('export function createMemberVerification','function createMemberVerification');
const html=fs.readFileSync(new URL('../members.html',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
class Element {
 constructor(){this.hidden=false;this.value='';this.textContent='';this.dataset={};this.listeners={};this.children=[];}
 addEventListener(type,fn){this.listeners[type]=fn;}
 setAttribute(){}
 replaceChildren(...children){this.children=children;}
 append(node){this.children.push(node);}
 click(){this.listeners.click?.();}
 change(){this.listeners.change?.();}
}
const row=(id='target',overrides={})=>({id,name:'Music Fan',verified:false,can_verify:false,...overrides});
const data=(owner=false,members=[row()])=>({members,can_manage_team:owner});
function environment(){
 const ids=Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Element()]));const calls=[];const queue=[];const expired=[];
 const enqueue=(body,status=200)=>queue.push(Promise.resolve({ok:status>=200&&status<300,status,json:async()=>body}));
 const defer=()=>{let finish;queue.push(new Promise(resolve=>{finish=(body,status=200)=>resolve({ok:status>=200&&status<300,status,json:async()=>body});}));return finish;};
 const context=vm.createContext({document:{getElementById:id=>ids[id],createElement:()=>new Element()},window:{addEventListener(){}},fetch:async(path,options)=>{calls.push({path,options});const result=queue.shift();if(!result)throw Error('Missing test response');return await result;},AbortController,setTimeout,clearTimeout,onSessionExpired:()=>expired.push(true)});
 vm.runInContext(source+'\nthis.controller=createMemberVerification({onSessionExpired});',context);
 return {ids,calls,expired,enqueue,defer,controller:context.controller};
}

test('ordinary members cannot see tools and a permission denial never logs them out',async()=>{
 const e=environment();e.enqueue({error:'Forbidden'},403);e.controller.setUser({id:'ordinary'});await tick();
 assert.equal(e.ids['member-verification'].hidden,true);assert.equal(e.expired.length,0);assert.equal(e.ids['verification-member'].children.length,0);
 e.ids['verification-team-action'].click();assert.equal(e.calls.length,1);e.controller.setUser(null);
});

test('team controls cannot delegate or edit their own check, and failed mutations grant nothing',async()=>{
 const e=environment();e.enqueue(data(false,[row('team',{can_verify:true}),row()]));e.controller.setUser({id:'team'});await tick();
 e.ids['verification-member'].value='team';e.ids['verification-member'].change();assert.equal(e.ids['verification-badge-action'].disabled,true);
 e.ids['verification-member'].value='target';e.ids['verification-member'].change();assert.equal(e.ids['verification-team-action'].hidden,true);
 e.ids['verification-team-action'].click();assert.equal(e.calls.length,1);
 const finish=e.defer();e.ids['verification-badge-action'].click();assert.equal(e.ids['verification-badge-action'].disabled,true);assert.match(e.ids['verification-member-state'].textContent,/No verified check/);
 assert.deepEqual(JSON.parse(e.calls.at(-1).options.body),{member_id:'target',action:'verify'});
 finish({error:'Unavailable'},503);await tick();assert.match(e.ids['verification-member-state'].textContent,/No verified check/);assert.match(e.ids['verification-status'].textContent,/could not be confirmed/);e.controller.setUser(null);
});

test('owner grants are displayed only after confirmation and refreshed from the server',async()=>{
 const e=environment();e.enqueue(data(true));e.controller.setUser({id:'owner'});await tick();e.ids['verification-member'].value='target';e.ids['verification-member'].change();
 assert.equal(e.ids['verification-team-action'].hidden,false);const finish=e.defer();e.ids['verification-team-action'].click();
 assert.deepEqual(JSON.parse(e.calls.at(-1).options.body),{member_id:'target',action:'grant_team'});assert.equal(e.calls.at(-1).options.credentials,'same-origin');
 assert.doesNotMatch(e.ids['verification-member-state'].textContent,/Can verify the roster/);
 e.enqueue(data(true,[row('target',{can_verify:true})]));finish({member:row('target',{can_verify:true}),can_manage_team:true});await tick();await tick();
 assert.match(e.ids['verification-member-state'].textContent,/Can verify the roster/);assert.equal(e.ids['verification-team-action'].textContent,'Remove Verification Access');assert.equal(e.calls.at(-1).path,'/api/verification');e.controller.setUser(null);
});

test('logout discards delayed reads and changes, including team permissions',async()=>{
 const e=environment();let finish=e.defer();e.controller.setUser({id:'owner'});e.controller.setUser(null);finish(data(true));await tick();assert.equal(e.ids['member-verification'].hidden,true);
 e.enqueue(data(true));e.controller.setUser({id:'owner'});await tick();e.ids['verification-member'].value='target';e.ids['verification-member'].change();finish=e.defer();e.ids['verification-badge-action'].click();e.controller.setUser(null);
 finish({member:row('target',{verified:true}),can_manage_team:true});await tick();assert.equal(e.ids['member-verification'].hidden,true);assert.equal(e.ids['verification-member-state'].textContent,'');assert.equal(e.ids['verification-member'].children.length,0);
});

test('revoked team access hides the tools after the server rejects an action',async()=>{
 const e=environment();e.enqueue(data(false));e.controller.setUser({id:'team'});await tick();e.ids['verification-member'].value='target';e.ids['verification-member'].change();
 e.enqueue({error:'Forbidden'},403);e.enqueue({error:'Forbidden'},403);e.ids['verification-badge-action'].click();await tick();await tick();
 assert.equal(e.ids['member-verification'].hidden,true);assert.equal(e.expired.length,0);e.controller.setUser(null);
});
