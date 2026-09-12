import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
const html=fs.readFileSync(new URL('../edit-profile.html',import.meta.url),'utf8');
const source=fs.readFileSync(new URL('../owner-editor.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const member={id:'owner-id',confirmedAt:'2026-09-05T10:00:00Z'};
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
class Element{constructor(){this.hidden=false;this.value='';this.dataset={};this.listeners={};}addEventListener(type,fn){this.listeners[type]=fn;}setAttribute(){}focus(){}reportValidity(){return true;}click(){this.listeners.click?.();}}
async function environment({current=null,owner=false,pendingUser=null,pendingAccess=null}={}){
 const ids=Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Element()]));const calls=[];const users=[];const events={};let authChange;let edits=0;
 vm.runInNewContext(source,{document:{getElementById:id=>ids[id]},window:{location:{hash:'',replace(){}},addEventListener:(type,fn)=>{events[type]=fn;}},URLSearchParams,AbortController,setTimeout,clearTimeout,AUTH_EVENTS:{LOGOUT:'logout'},getUser:()=>pendingUser||Promise.resolve(current),login:async()=>member,logout:async()=>{},requestPasswordRecovery:async()=>{},onAuthChange:fn=>{authChange=fn;},createMemberProfileEditor:()=>({setUser:user=>users.push(user),requestEdit:()=>{edits++;}}),fetch:async(path,options)=>{calls.push({path,options});return pendingAccess||{ok:true,json:async()=>({profile:{id:member.id},can_edit_owner:owner})};}});
 await tick();return {ids,calls,users,events,authChange,edits:()=>edits};
}
test('owner editor contains no signup and requires an authenticated confirmed account',async()=>{
 assert.doesNotMatch(html,/sign\s*up|join the space|portal-auth-tabs/i);assert.match(html,/Checking your existing owner login/);assert.doesNotMatch(html,/Owner access must be activated first|@gmail\.com/);
 const e=await environment();assert.equal(e.calls.length,0);assert.equal(e.ids['owner-edit-area'].hidden,true);assert.equal(e.ids['owner-login-panel'].hidden,false);
});
test('owner bio and native photo controls are explicit and do not force camera capture',()=>{
 assert.match(html,/<label for="member-profile-about">About Me<textarea[^>]*maxlength="600"/);
 assert.match(html,/<label for="member-profile-upload">Choose from Photos<input[^>]*type="file"/);
 assert.doesNotMatch(html,/\bcapture(?:=|\s|>)/i);
 assert.match(html,/Use a photo already on your site/);
});
test('only server confirmed owner access opens the editor',async()=>{
 const denied=await environment({current:member,owner:false});assert.equal(denied.edits(),0);assert.equal(denied.ids['owner-edit-area'].hidden,true);
 const accepted=await environment({current:member,owner:true});assert.equal(accepted.edits(),1);assert.equal(accepted.ids['owner-edit-area'].hidden,false);assert.equal(accepted.calls[0].options.credentials,'same-origin');
});
test('pagehide drops late session results and logout drops late owner checks',async()=>{
 const session=deferred();const e=await environment({pendingUser:session.promise});e.events.pagehide();session.resolve(member);await tick();assert.equal(e.calls.length,0);assert.equal(e.edits(),0);
 const access=deferred();const f=await environment({current:member,pendingAccess:access.promise});f.authChange('logout',null);access.resolve({ok:true,json:async()=>({profile:{id:member.id},can_edit_owner:true})});await tick();assert.equal(f.edits(),0);assert.equal(f.ids['owner-edit-area'].hidden,true);
});
