import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';

const read = file => readFileSync(new URL('../'+file,import.meta.url),'utf8');
const source = read('profile-inline-editor.js').replace(/^import .*\n/,'').replace('export function createInlineProfileEditor','function createInlineProfileEditor');
const uid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const member = {id:uid,name:'Member',status:'Here for the people',title_lines:'Speaker\nLogistics',location:'City\nState',profession:'speaker',about_me:'My story',website_url:'https://example.com/book',photo_url:null,updated_at:'2026-09-11T12:00:00Z'};
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const response = (profile = member,status=200) => ({ok:status>=200&&status<300,status,json:async()=>({profile,can_edit_owner:false})});
class Node {
 constructor(id=''){this.id=id;this.hidden=true;this.disabled=false;this.value='';this.dataset={};this.attributes={};this.listeners={};this.parentElement=null;this.textContent='';this.files=[];}
 addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
 async emit(type,extra={}){const event={type,target:this,currentTarget:this,preventDefault(){this.prevented=true;},...extra};const pending=(this.listeners[type]||[]).map(fn=>fn(event));event.currentTarget=null;await Promise.all(pending);}
 setAttribute(k,v){this.attributes[k]=String(v);}
 removeAttribute(k){delete this.attributes[k];if(k==='src')delete this.src;}
 focus(options){this.focusOptions=options;}
 append(node){node.parentElement=this;}
 insertAdjacentElement(_,node){node.parentElement=this.parentElement;}
 reportValidity(){return true;}
 click(){return this.emit('click');}
}
function environment({me=()=>response(),save=()=>response(),prepare=async file=>file}={}){
 const nodes=Object.fromEntries([...read('profile.html').matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],new Node(m[1])]));
 const openers=[nodes['public-profile-quick-edit'],new Node('studio-edit')],hero=new Node('hero');
 nodes['profile-inline-editor'].parentElement=hero;
 const events={},sent=[],rendered=[],revoked=[];
 const win={location:{origin:'https://jwhitedidit.net',href:'https://jwhitedidit.net/profile?id='+uid+'&view=photos'},crypto:{randomUUID},URL:{createObjectURL:()=>`blob:${randomUUID()}`,revokeObjectURL:url=>revoked.push(url)},addEventListener:(type,fn)=>(events[type]??=[]).push(fn),JWhitePublicProfile:member,RoosterProfileRenderer:{async update(profile){rendered.push(profile);win.JWhitePublicProfile=profile;for(const fn of events['jwhite:profile-ready']||[])fn({detail:profile});return true;}}};
 const doc={getElementById:id=>nodes[id],querySelectorAll:()=>openers};
 const send=async(path,options)=>{sent.push({path,options});return path==='/api/profile/me'?me():save(options);};
 const context={URL,FormData,setTimeout,clearTimeout,AbortController,preparePrivatePhoto:prepare};
 vm.runInNewContext(source,context);context.createInlineProfileEditor({doc,win,send,preparePhoto:prepare});
 return {nodes,openers,sent,rendered,win,revoked,fire:(name,detail={})=>{for(const fn of events[name]||[])fn(detail);},open:async()=>{await settle();await openers[0].click();await settle();}};
}

test('only the matching approved member gets an editor; viewing someone else never exposes private fields',async()=>{
 for(const me of [()=>response({...member,id:other}),()=>response(null,401),()=>response(null,403)]){
  const e=environment({me});await settle();assert(e.openers.every(n=>n.hidden));assert(e.nodes['profile-inline-editor'].hidden);assert.equal(e.nodes['profile-inline-name'].value,'');
  await e.openers[0].click();assert.equal(e.sent.filter(r=>r.path.includes('update')).length,0);
 }
 const own=environment();await own.open();assert(own.openers.every(n=>!n.hidden));assert.equal(own.nodes['profile-inline-status'].value,member.status);
 assert.equal(own.nodes['profile-inline-status'].focusOptions.preventScroll,true);
});

test('approved edits save on this page without reset errors, navigation or losing multiline/untouched fields',async()=>{
 const updated={...member,status:'Available for speaking events'};const e=environment({save:()=>response(updated)});await e.open();
 const before=e.win.location.href;e.nodes['profile-inline-status'].value=updated.status;await e.nodes['profile-inline-form'].emit('submit');
 const data=e.sent.find(r=>r.path.includes('/update')).options.body;
 assert.equal(data.get('status'),updated.status);assert.equal(data.get('title_lines'),null);assert.equal(data.get('location'),null);assert.equal(data.get('photo'),null);assert.equal(data.get('credentials'),null);assert.equal(data.get('top_eight_order'),null);
 assert.equal(e.rendered.length,1);assert.equal(e.nodes['profile-inline-feedback'].dataset.tone,'success');assert.equal(e.nodes['profile-inline-editor'].hidden,false);assert.equal(e.win.location.href,before);
 assert.equal(e.nodes['profile-inline-title-lines'].value,'Speaker\nLogistics');assert.equal(e.nodes['profile-inline-location'].value,'City\nState');
});

test('cancel discards the local draft and revokes a prepared photo without posting or moving pages',async()=>{
 const e=environment();await e.open();const before=e.win.location.href;e.nodes['profile-inline-status'].value='Unpublished draft';
 e.nodes['profile-inline-photo'].files=[new File(['photo bytes'],'test.jpg',{type:'image/jpeg'})];await e.nodes['profile-inline-photo'].emit('change');
 assert.match(e.nodes['profile-inline-photo-preview'].src,/^blob:/);await e.nodes['profile-inline-cancel'].click();
 assert.equal(e.nodes['profile-inline-editor'].hidden,true);assert.equal(e.sent.filter(r=>r.path.includes('/update')).length,0);assert.equal(e.revoked.length,1);assert.equal(e.win.location.href,before);
 await e.open();assert.equal(e.nodes['profile-inline-status'].value,member.status);assert.equal(e.nodes['profile-inline-photo-preview'].hidden,true);
});

test('pending moderation and uncertain retries keep the draft and request ID until confirmed',async()=>{
 let attempts=0;const e=environment({save:()=>++attempts===1?response(null,202):response({...member,status:'New status'})});await e.open();e.nodes['profile-inline-status'].value='New status';
 await e.nodes['profile-inline-form'].emit('submit');assert.equal(e.rendered.length,0);assert.match(e.nodes['profile-inline-feedback'].textContent,/waiting for review/);assert.equal(e.nodes['profile-inline-status'].value,'New status');
 await e.nodes['profile-inline-form'].emit('submit');const writes=e.sent.filter(r=>r.path.includes('/update'));assert.equal(writes[0].options.body.get('request_id'),writes[1].options.body.get('request_id'));assert.equal(e.rendered.length,1);
});

test('a session change clears drafts and ignores a late save result from the previous member',async()=>{
 const pending=deferred();let loggedIn=true;const e=environment({me:()=>loggedIn?response():response(null,401),save:()=>pending.promise});await e.open();e.nodes['profile-inline-status'].value='Private draft';const submit=e.nodes['profile-inline-form'].emit('submit');
 loggedIn=false;e.fire('jwhite:session-changed');await settle();assert.equal(e.nodes['profile-inline-name'].value,'');assert.equal(e.nodes['profile-inline-status'].value,'');assert(e.nodes['profile-inline-editor'].hidden);assert(e.openers.every(n=>n.hidden));
 pending.resolve(response({...member,status:'Private draft'}));await submit;assert.equal(e.rendered.length,0);assert.equal(e.nodes['profile-inline-feedback'].textContent,'');
});

test('conflicting updates require loading latest data before another save',async()=>{
 let current=member;const e=environment({me:()=>response(current),save:()=>response(null,409)});await e.open();e.nodes['profile-inline-status'].value='Draft';await e.nodes['profile-inline-form'].emit('submit');
 assert.equal(e.nodes['profile-inline-save'].disabled,true);assert.equal(e.nodes['profile-inline-reload'].hidden,false);await e.nodes['profile-inline-form'].emit('submit');assert.equal(e.sent.filter(r=>r.path.includes('/update')).length,1);
 current={...member,status:'Changed elsewhere'};await e.nodes['profile-inline-reload'].click();await settle();assert.equal(e.nodes['profile-inline-status'].value,'Changed elsewhere');assert.equal(e.nodes['profile-inline-save'].disabled,false);
});


test('returning from the native photo picker cannot start an ownership check that drops the selected photo',async()=>{
 let calls=0;const stalled=deferred();const e=environment({me:()=>++calls<=2?response():stalled.promise});await e.open();
 await e.nodes['profile-inline-change-photo'].click();e.fire('focus');
 e.nodes['profile-inline-photo'].files=[new File(['photo bytes'],'new.jpg',{type:'image/jpeg'})];await e.nodes['profile-inline-photo'].emit('change');
 assert.equal(calls,2);assert.match(e.nodes['profile-inline-photo-preview'].src,/^blob:/);assert.equal(e.nodes['profile-inline-save'].disabled,false);
});

test('canceling a latest-version read keeps the editor closed after its delayed response',async()=>{
 let calls=0;const pending=deferred();const e=environment({me:()=>++calls<=2?response():pending.promise,save:()=>response(null,409)});await e.open();
 e.nodes['profile-inline-status'].value='My draft';await e.nodes['profile-inline-form'].emit('submit');await e.nodes['profile-inline-reload'].click();
 await e.nodes['profile-inline-cancel'].click();assert.equal(e.nodes['profile-inline-editor'].hidden,true);
 pending.resolve(response({...member,status:'Elsewhere'}));await settle();assert.equal(e.nodes['profile-inline-editor'].hidden,true);assert.equal(e.nodes['profile-inline-status'].value,member.status);
});
