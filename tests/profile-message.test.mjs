import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash,webcrypto} from 'node:crypto';

const read = file => readFileSync(new URL('../'+file,import.meta.url),'utf8');
const source = read('profile-message.js').replace('export function createProfileConversation','function createProfileConversation');
const viewer = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', person = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', stranger = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const member = {id:person,name:'MrWilliams',photo_url:'/api/profile-photo/'+'a'.repeat(64)};
const response = (data,status=200) => ({ok:status>=200&&status<300,status,json:async()=>data});
const message = (overrides={}) => ({id:'a'.repeat(64),sender_id:person,recipient_id:viewer,sender_name:'MrWilliams',recipient_name:'Me',subject:'New message',body:'Hello there',created_at:'2026-09-11T10:00:00Z',...overrides});
const mailbox = (overrides={}) => ({user:{id:viewer,name:'Me'},inbox:[],sent:[],members:[],unread_count:0,unread_ids:[],next:{inbox_before:null,sent_before:null},...overrides});
const deferred = () => {let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const settle = () => new Promise(resolve=>setImmediate(resolve));
class Node {
 constructor(id=''){this.id=id;this.hidden=false;this.disabled=false;this.open=false;this.value='';this.children=[];this.listeners={};this.dataset={};this.attributes={};this.textContent='';this.scrollTop=0;this.scrollHeight=400;this.clientHeight=200;}
 addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
 async emit(type,extra={}){const event={type,target:this,currentTarget:this,preventDefault(){this.prevented=true;},...extra};await Promise.all((this.listeners[type]||[]).map(fn=>fn(event)));return event;}
 append(...nodes){for(const node of nodes){node.remove();node.parentNode=this;this.children.push(node);}}
 insertBefore(node,before){node.remove();node.parentNode=this;const index=before?this.children.indexOf(before):-1;this.children.splice(index<0?this.children.length:index,0,node);this.mutations=(this.mutations||0)+1;}
 remove(){if(this.parentNode){const siblings=this.parentNode.children;const index=siblings.indexOf(this);if(index>=0)siblings.splice(index,1);this.parentNode=null;}}
 replaceChildren(...nodes){for(const node of this.children)node.parentNode=null;this.children=[];this.append(...nodes);this.replacements=(this.replacements||0)+1;}
 setAttribute(name,value){this.attributes[name]=String(value);}
 removeAttribute(name){delete this.attributes[name];if(name==='src')delete this.src;}
 focus(options){this.focusOptions=options;}
 showModal(){this.open=true;}
 close(){this.open=false;}
 reportValidity(){return true;}
 pause(){this.paused=true;}
 click(){return this.emit('click');}
}
function environment({get=()=>response(mailbox()),post=payload=>response({message:message({...payload,id:'f'.repeat(64),sender_id:viewer,recipient_id:person,created_at:'2026-09-11T12:00:00Z'})}),profile=member,mediaGet=null}={}){
 const nodes=Object.fromEntries([...read('profile.html').matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],new Node(m[1])]));
 const openers=['public-profile-message','profile-business-message','profile-studio-collaborate'].map(id=>nodes[id]);
 openers[0].textContent='Send Message';openers[1].textContent='Speaking & logistics inquiry';openers[2].textContent='Speaking & logistics inquiry';
 const sent=[],events={},docEvents={},revoked=[],published=[],intervals=new Set(),pollDelays=[];
 const win={location:{origin:'https://jwhitedidit.net',href:'https://jwhitedidit.net/profile.html?id='+person+'&view=studio'},crypto:{randomUUID,subtle:webcrypto.subtle},URL:{createObjectURL:()=>`blob:${randomUUID()}`,revokeObjectURL:url=>revoked.push(url)},JWhitePublicProfile:profile,addEventListener:(type,fn)=>(events[type]??=[]).push(fn),dispatchEvent:event=>published.push(event)};
 const doc={hidden:false,getElementById:id=>nodes[id],createElement:tag=>new Node(tag),querySelectorAll:()=>openers,addEventListener:(type,fn)=>(docEvents[type]??=[]).push(fn)};
 const send=async(path,options)=>{sent.push({path,options});if(path==='/api/member-messages/send')return post(JSON.parse(options.body),options);if(path==='/api/member-messages/read'){const payload=JSON.parse(options.body);return response({message_id:payload.message_id,read:true,unread_count:0});}if(path.startsWith('/api/member-message-'))return mediaGet(path,options);return get(path,options);};
 const context={URL,URLSearchParams,TextEncoder,Uint8Array,setTimeout,clearTimeout,setInterval:(fn,delay)=>{intervals.add(fn);pollDelays.push(delay);return fn;},clearInterval:fn=>intervals.delete(fn),AbortController,CustomEvent:class{constructor(type,init){this.type=type;this.detail=init?.detail;}}};
 vm.runInNewContext(source,context);const api=context.createProfileConversation({doc,win,send});
 return {api,nodes,openers,sent,win,doc,revoked,published,intervals,pollDelays,fire:(type,event={})=>{for(const fn of events[type]||[])fn(event);},visibility:(hidden)=>{doc.hidden=hidden;for(const fn of docEvents.visibilitychange||[])fn();},open:async(index=0)=>{await openers[index].click();await settle();},write:async(text)=>{nodes['profile-conversation-body'].value=text;await nodes['profile-conversation-body'].emit('input');},submit:()=>nodes['profile-conversation-form'].emit('submit')};
}
function textOf(node){return node.textContent+' '+node.children.map(textOf).join(' ');}
function findNode(node,predicate){if(predicate(node))return node;for(const child of node.children){const found=findNode(child,predicate);if(found)return found;}}
const byClass=(node,name)=>findNode(node,child=>child.className===name);
const sendWrites=e=>e.sent.filter(call=>call.path.endsWith('/send')).map(call=>JSON.parse(call.options.body));

test('profile and work inquiry buttons open the exact person on the same page with safe profile photo and paired history',async()=>{
 const e=environment({get:()=>response(mailbox({inbox:[message(),message({id:'b'.repeat(64),sender_id:stranger,body:'Unrelated private message'})],sent:[message({id:'c'.repeat(64),sender_id:viewer,recipient_id:person,body:'My reply'})]}))});
 const before=e.win.location.href;await e.open(1);
 assert(e.nodes['profile-conversation'].open);assert.equal(e.nodes['profile-conversation-name'].textContent,'MrWilliams');assert.equal(e.nodes['profile-conversation-photo'].src,member.photo_url);
 const history=textOf(e.nodes['profile-conversation-history']);assert.match(history,/Hello there/);assert.match(history,/My reply/);assert.doesNotMatch(history,/Unrelated private/);
 await e.write('Can we discuss a speaking event?');await e.submit();
 const send=e.sent.find(call=>call.path.endsWith('/send')),payload=JSON.parse(send.options.body);assert.equal(payload.recipient_id,person);assert.equal(payload.subject,'Speaking & logistics inquiry');assert.equal(send.options.credentials,'same-origin');assert.equal(send.options.cache,'no-store');
 assert.equal(e.win.location.href,before);assert(e.nodes['profile-conversation'].open);assert.equal(e.nodes['profile-conversation-body'].value,'');assert.match(textOf(e.nodes['profile-conversation-history']),/Can we discuss/);
 await e.nodes['profile-conversation-close'].click();assert(!e.nodes['profile-conversation'].open);assert.equal(e.openers[1].focusOptions.preventScroll,true);assert.equal(e.win.location.href,before);assert.equal(e.intervals.size,0);
});

test('pending sends appear immediately, keep the composer open and retry the exact payload without touching a newer draft',async()=>{
 const pending=deferred();let attempts=0;const e=environment({post:payload=>++attempts===1?pending.promise:response({message:message({...payload,id:'f'.repeat(64),sender_id:viewer})})});
 await e.open();await e.write('A private booking question');const first=e.submit();await settle();
 const history=e.nodes['profile-conversation-history'];
 assert(e.nodes['profile-conversation-send'].disabled);assert.equal(e.nodes['profile-conversation-body'].disabled,false);
 assert.equal(e.nodes['profile-conversation-body'].value,'');assert.match(textOf(history),/A private booking question/);assert.match(textOf(history),/Sending…/);assert.doesNotMatch(textOf(history),/Sent/);
 await e.write('My next thought');await e.submit();assert.equal(attempts,1);
 pending.resolve(response({},503));await first;
 assert.equal(e.nodes['profile-conversation-body'].value,'My next thought');assert.match(textOf(history),/Send unconfirmed/);assert.equal(e.nodes['profile-conversation-status'].textContent,'');
 const retry=byClass(history,'profile-conversation-retry');assert(retry);await retry.click();await settle();await settle();
 const writes=sendWrites(e);assert.equal(writes.length,2);assert.equal(writes[0].request_id,writes[1].request_id);assert.equal(writes[1].body,'A private booking question');
 assert.equal(e.nodes['profile-conversation-body'].value,'My next thought');assert.equal(history.children.length,1);assert.match(textOf(history),/Sent/);assert.doesNotMatch(textOf(history),/Send unconfirmed|Retry/);
});

test('a new message gets its own request ID while an earlier failed payload remains accessible for retry',async()=>{
 const e=environment({post:()=>response({},404)});await e.open();await e.write('First idea');await e.submit();await e.write('A different idea');await e.submit();
 const writes=sendWrites(e);assert.notEqual(writes[0].request_id,writes[1].request_id);assert(writes.every(p=>p.recipient_id===person));assert.equal(e.nodes['profile-conversation-body'].value,'');
 const history=e.nodes['profile-conversation-history'];assert.match(textOf(history),/First idea/);assert.match(textOf(history),/A different idea/);assert.match(textOf(history),/person unavailable/);assert.equal(history.children.length,2);
 await byClass(history.children[0],'profile-conversation-retry').click();await settle();await settle();assert.equal(sendWrites(e)[2].request_id,writes[0].request_id);assert.equal(sendWrites(e)[2].body,'First idea');
});

test('unauthorized and unapproved sessions never get message history or a usable composer',async()=>{
 for(const status of [401,403]){
  const e=environment({get:()=>response(mailbox({inbox:[message()]}),status)});await e.open();assert.equal(e.nodes['profile-conversation-history'].children.length,0);assert(e.nodes['profile-conversation-body'].disabled);assert(!e.nodes['profile-conversation-login'].hidden);assert.match(e.nodes['profile-conversation-login'].href,/next=.*conversation/);await e.write('Denied');await e.submit();assert.equal(e.sent.filter(c=>c.path.endsWith('/send')).length,0);
 }
});

test('session changes immediately clear history and drafts and reject a late send confirmation',async()=>{
 const pending=deferred();let signedIn=true;const e=environment({get:()=>response(signedIn?mailbox({inbox:[message()]}):{},signedIn?200:401),post:()=>pending.promise});
 await e.open();await e.write('Private account draft');const submit=e.submit();await settle();signedIn=false;e.fire('jwhite:session-changed');await settle();assert.equal(e.nodes['profile-conversation-body'].value,'');assert.equal(e.nodes['profile-conversation-history'].children.length,0);assert(e.nodes['profile-conversation-send'].disabled);
 const send=e.sent.find(c=>c.path.endsWith('/send'));assert(send.options.signal.aborted);pending.resolve(response({message:message({id:'f'.repeat(64),sender_id:viewer,body:'Private account draft'})}));await submit;assert.equal(e.nodes['profile-conversation-history'].children.length,0);assert.doesNotMatch(e.nodes['profile-conversation-status'].textContent,/Sent\./);
});

test('a stale history fetch cannot display the previous account after a storage event',async()=>{
 const pending=deferred();let count=0;const e=environment({get:()=>++count===1?pending.promise:response({},401)});const opening=e.api.open(e.openers[0]);await settle();e.fire('storage',{key:'gotrue.user'});await settle();pending.resolve(response(mailbox({inbox:[message({body:'Old account secret'})]})));await opening;assert.doesNotMatch(textOf(e.nodes['profile-conversation-history']),/Old account secret/);assert(e.sent[0].options.signal.aborted);
});

test('an unexpected account ID clears private content, and self messaging remains disabled',async()=>{
 let changed=false;const e=environment({get:()=>response(mailbox(changed?{user:{id:stranger},inbox:[message()]}:{inbox:[message()]}))});await e.open();await e.write('Private draft');changed=true;await e.nodes['profile-conversation-refresh'].click();await settle();assert.equal(e.nodes['profile-conversation-body'].value,'');assert.equal(e.nodes['profile-conversation-history'].children.length,0);
 const own=environment({profile:{...member,id:viewer}});await own.open();assert(own.nodes['profile-conversation-send'].disabled);assert.match(own.nodes['profile-conversation-status'].textContent,/your profile/);
});

test('earlier history advances both cursors without restarting an exhausted folder and only marks this conversation read',async()=>{
 let count=0;const e=environment({get:path=>response(mailbox(++count===1?{inbox:[message()],unread_ids:['a'.repeat(64)],next:{inbox_before:'older-inbox',sent_before:null}}:{inbox:[message({id:'b'.repeat(64),body:'Earlier hello',created_at:'2026-09-10T12:00:00Z'})],next:{inbox_before:null,sent_before:'must-not-restart'}}))});
 await e.open();await settle();assert(e.sent.some(c=>c.path==='/api/member-messages/read'));await e.nodes['profile-conversation-more'].click();await settle();assert.match(e.sent.find(c=>c.path.includes('inbox_before')).path,/inbox_before=older-inbox/);assert(e.nodes['profile-conversation-more'].hidden);assert.match(textOf(e.nodes['profile-conversation-history']),/Earlier hello/);
});

test('closing preserves the unsent draft and pending success stays closed',async()=>{
 const pending=deferred();const e=environment({post:payload=>pending.promise});await e.open();await e.write('Save this draft');await e.nodes['profile-conversation-close'].click();await e.open();assert.equal(e.nodes['profile-conversation-body'].value,'Save this draft');const sending=e.submit();await e.nodes['profile-conversation-close'].click();pending.resolve(response({message:message({id:'f'.repeat(64),sender_id:viewer,recipient_id:person,body:'Save this draft'})}));await sending;assert(!e.nodes['profile-conversation'].open);assert.equal(e.nodes['profile-conversation-body'].value,'');
});

test('private attachments use validated same-origin endpoints, never autoplay, and revoke when the page is hidden',async()=>{
 const attached=message({video:{url:'/api/member-message-video/'+'a'.repeat(64)}});const e=environment({get:()=>response(mailbox({inbox:[attached]})),mediaGet:()=>({ok:true,status:200,blob:async()=>({type:'video/mp4',size:100})})});await e.open();const item=e.nodes['profile-conversation-history'].children[0];const host=byClass(item,'profile-conversation-attachment');await host.children[0].click();await settle();const video=host.children[0];assert.equal(video.id,'video');assert.equal(video.controls,true);assert.equal(video.autoplay,undefined);assert.match(video.src,/^blob:/);e.visibility(true);assert.equal(e.revoked.length,1);assert.equal(video.src,undefined);
});

test('all profile message openers retain their inbox fallback and the dialog is separate from profile content',()=>{
 const html=read('profile.html');for(const id of ['public-profile-message','profile-business-message','profile-studio-collaborate'])assert.match(html,new RegExp('id="'+id+'"[^>]*data-profile-message-open[^>]*href="/members.html#member-mail"'));
 assert.match(html,/<dialog id="profile-conversation"/);assert.match(html,/type="module" src="\/profile-message.js\?v=/);assert.doesNotMatch(source,/localStorage\.setItem|location\.(?:assign|replace)|history\.(?:pushState|replaceState)/);
});


test('a conversation poll removes loaded welcome messages, releases their media and preserves real history and the draft',async()=>{
 const welcome='Welcome to KON-NEKT. I’m Your Connector on here and your first friend.';
 const incoming=message({subject:'You’re connected. Let’s get it.',body:welcome,video:{url:'/api/member-message-video/'+'a'.repeat(64)}});
 const outgoing=message({id:'b'.repeat(64),sender_id:viewer,recipient_id:person,body:'Old automatic reply'});
 const quoted=message({id:'c'.repeat(64),body:'I received this: '+welcome,created_at:'2026-09-01T12:00:00Z'});
 let retired=false;
 const e=environment({get:()=>response(mailbox(retired?{inbox:[incoming],sent:[outgoing],retired_message_ids:[incoming.id,outgoing.id]}:{inbox:[incoming,quoted],sent:[outgoing]})),mediaGet:()=>({ok:true,status:200,blob:async()=>({type:'video/mp4',size:100})})});
 await e.open();await e.write('Keep my booking question');
 const item=e.nodes['profile-conversation-history'].children.find(node=>byClass(node,'profile-conversation-attachment'));
 const host=byClass(item,'profile-conversation-attachment');await host.children[0].click();await settle();const video=host.children[0],url=video.src;
 retired=true;e.intervals.values().next().value();await settle();
 const history=textOf(e.nodes['profile-conversation-history']);assert.match(history,/I received this:/);assert.doesNotMatch(history,/Old automatic reply|You’re connected/);assert.equal(e.nodes['profile-conversation-history'].children.length,1);
 assert.equal(e.nodes['profile-conversation-body'].value,'Keep my booking question');assert.equal(e.nodes['profile-conversation-name'].textContent,'MrWilliams');assert(e.nodes['profile-conversation'].open);
 assert(e.revoked.includes(url));assert.equal(video.paused,true);assert.equal(video.src,undefined);assert.equal(e.published.at(-1).detail.count,0);
 // A subsequent poll must not reintroduce a retired object even without a repeated tombstone.
 retired=false;e.intervals.values().next().value();await settle();assert.equal(e.nodes['profile-conversation-history'].children.length,1);
 await e.nodes['profile-conversation-close'].click();
});

test('earlier conversation pages retire old loaded messages without readding them or marking them read',async()=>{
 const old=message({body:'Old welcome'}),real=message({id:'b'.repeat(64),body:'A real earlier conversation'});let count=0;
 const e=environment({get:()=>response(mailbox(++count===1?{inbox:[old],next:{inbox_before:'older',sent_before:null}}:{inbox:[old,real],retired_message_ids:[old.id],unread_ids:[old.id]}))});
 await e.open();await e.write('Draft stays here');await e.nodes['profile-conversation-more'].click();await settle();
 assert.doesNotMatch(textOf(e.nodes['profile-conversation-history']),/Old welcome/);assert.match(textOf(e.nodes['profile-conversation-history']),/A real earlier conversation/);assert.equal(e.nodes['profile-conversation-body'].value,'Draft stays here');assert(!e.sent.some(call=>call.path.endsWith('/read')));
 await e.nodes['profile-conversation-close'].click();
});

test('conversation retirement rejects malformed IDs and a delayed response from the previous session',async()=>{
 const old=message();let result=response(mailbox({inbox:[old]}));const e=environment({get:()=>result});await e.open();
 result=response(mailbox({retired_message_ids:[old.id.toUpperCase(),' '+old.id,old.id+'x',null,{id:old.id}]}));await e.nodes['profile-conversation-refresh'].click();await settle();assert.match(textOf(e.nodes['profile-conversation-history']),/Hello there/);
 const pending=deferred();result=pending.promise;await e.nodes['profile-conversation-refresh'].click();await settle();
 result=response(mailbox({inbox:[message({body:'Current session conversation'})]}));e.fire('jwhite:session-changed');await settle();
 pending.resolve(response(mailbox({retired_message_ids:[old.id]})));await settle();assert.match(textOf(e.nodes['profile-conversation-history']),/Current session conversation/);
 await e.nodes['profile-conversation-close'].click();
});

test('a retired private attachment request is aborted and cannot restore removed media',async()=>{
 const old=message({photo:{url:'/api/member-message-photo/'+'a'.repeat(64)}});const pending=deferred();let retired=false;
 const e=environment({get:()=>response(mailbox(retired?{retired_message_ids:[old.id]}:{inbox:[old]})),mediaGet:()=>pending.promise});await e.open();
 const host=byClass(e.nodes['profile-conversation-history'].children[0],'profile-conversation-attachment');await host.children[0].click();await settle();
 retired=true;await e.nodes['profile-conversation-refresh'].click();await settle();const request=e.sent.find(call=>call.path.startsWith('/api/member-message-photo/'));assert(request.options.signal.aborted);
 pending.resolve({ok:true,status:200,blob:async()=>({type:'image/jpeg',size:100})});await settle();assert.equal(e.revoked.length,0);assert.doesNotMatch(textOf(e.nodes['profile-conversation-history']),/Hello there|Opening…/);
 await e.nodes['profile-conversation-close'].click();
});


test('confirmed delivery keeps a newer typed draft and preserves the outgoing bubble node',async()=>{
 const pending=deferred();let payload;const e=environment({post:data=>{payload=data;return pending.promise;}});
 await e.open();await e.write('First message');const sending=e.submit();await settle();
 const history=e.nodes['profile-conversation-history'],bubble=history.children[0];await e.write('Still typing the next message');
 pending.resolve(response({message:message({...payload,id:'f'.repeat(64),sender_id:viewer,created_at:new Date().toISOString()})}));await sending;
 assert.equal(history.children[0],bubble);assert.equal(history.children.length,1);assert.match(textOf(bubble),/Sent/);
 assert.equal(e.nodes['profile-conversation-body'].value,'Still typing the next message');assert.equal(e.nodes['profile-conversation-send'].disabled,false);
});

test('polling confirms an uncertain outgoing message by the exact server ID without duplicating it',async()=>{
 let saved;const e=environment({post:payload=>{saved=message({...payload,id:createHash('sha256').update(viewer+':'+payload.request_id).digest('hex'),sender_id:viewer,created_at:new Date().toISOString()});return response({},503);},get:()=>response(mailbox({sent:saved?[saved]:[]}))});
 await e.open();await e.write('A single private message');await e.submit();const history=e.nodes['profile-conversation-history'];assert.match(textOf(history),/Send unconfirmed/);const bubble=history.children[0];
 await e.write('Next draft');e.intervals.values().next().value();await settle();
 assert.equal(history.children.length,1);assert.equal(history.children[0],bubble);assert.match(textOf(history),/Sent/);assert.doesNotMatch(textOf(history),/Retry|unconfirmed/);assert.equal(sendWrites(e).length,1);assert.equal(e.nodes['profile-conversation-body'].value,'Next draft');
});

test('an unrelated response cannot mark a pending message sent or erase its retry payload',async()=>{
 const e=environment({post:payload=>response({message:message({...payload,id:'f'.repeat(64),sender_id:viewer,body:'A different message'})})});
 await e.open();await e.write('The actual message');await e.submit();const history=e.nodes['profile-conversation-history'];assert.match(textOf(history),/The actual message/);assert.match(textOf(history),/Send unconfirmed/);assert.doesNotMatch(textOf(history),/A different message/);
 await byClass(history,'profile-conversation-retry').click();await settle();await settle();const writes=sendWrites(e);assert.equal(writes[0].request_id,writes[1].request_id);assert.equal(writes[1].body,'The actual message');
});

test('unchanged visible polls preserve bubble and media nodes, and skip hidden conversations',async()=>{
 const attached=message({video:{url:'/api/member-message-video/'+'a'.repeat(64)}});const e=environment({get:()=>response(mailbox({inbox:[attached]})),mediaGet:()=>({ok:true,status:200,blob:async()=>({type:'video/mp4',size:100})})});
 await e.open();const history=e.nodes['profile-conversation-history'],item=history.children[0],host=byClass(item,'profile-conversation-attachment');
 await host.children[0].click();await settle();const video=host.children[0],mutations=history.mutations,replacements=history.replacements,itemReplacements=item.replacements;
 e.intervals.values().next().value();await settle();assert.equal(history.children[0],item);assert.equal(host.children[0],video);assert.equal(history.mutations,mutations);assert.equal(history.replacements,replacements);assert.equal(item.replacements,itemReplacements);
 assert.equal(e.pollDelays.at(-1),5000);assert(e.sent.filter(call=>call.path.includes('?')).every(call=>call.path.includes('directory=0')));
 e.visibility(true);const before=e.sent.length;e.intervals.values().next().value();await settle();assert.equal(e.sent.length,before);await e.nodes['profile-conversation-close'].click();assert.equal(e.intervals.size,0);
});

test('incoming replies do not move someone reading older messages or replace existing bubbles',async()=>{
 let reply=false;const e=environment({get:()=>response(mailbox({inbox:[message(),...(reply?[message({id:'b'.repeat(64),body:'A fresh reply',created_at:'2026-09-11T10:10:00Z'})]:[])]}))});await e.open();
 const history=e.nodes['profile-conversation-history'],existing=history.children[0];history.scrollTop=30;reply=true;e.intervals.values().next().value();await settle();
 assert.equal(history.children[0],existing);assert.equal(history.scrollTop,30);assert.match(textOf(history),/A fresh reply/);
});


test('shared inbox contacts open without using contact preview text as the message subject',async()=>{
 const e=environment();e.api.setRecipient(member);const contact=new Node('contact');contact.textContent='MrWilliams Last message preview';await e.api.open(contact);await e.write('A clean conversation');await e.submit();assert.equal(sendWrites(e)[0].subject,'New message');await e.nodes['profile-conversation-close'].click();assert.equal(contact.focusOptions.preventScroll,true);
});


test('an authenticated inbox snapshot opens a usable conversation before the network refresh finishes',async()=>{
 const pending=deferred();const e=environment({get:()=>pending.promise});
 assert.equal(e.api.hydrate(mailbox({inbox:[message()]})),true);
 const opening=e.api.open(e.openers[0]);await settle();assert(e.nodes['profile-conversation'].open);assert.equal(e.nodes['profile-conversation-body'].disabled,false);assert.match(textOf(e.nodes['profile-conversation-history']),/Hello there/);
 await e.write('Ready immediately');assert.equal(e.nodes['profile-conversation-send'].disabled,false);
 pending.resolve(response(mailbox({inbox:[message(),message({id:'b'.repeat(64),body:'Latest reply'})]})));await opening;
 assert.match(textOf(e.nodes['profile-conversation-history']),/Latest reply/);assert.equal(e.nodes['profile-conversation-body'].value,'Ready immediately');
});

test('mailbox hydration filters wrong participants, malformed rows, folder mismatches and retired messages',async()=>{
 const e=environment(),retired=message({id:'b'.repeat(64),body:'Retired welcome'});
 assert.equal(e.api.hydrate({user:member}),false);assert.equal(e.api.hydrate(mailbox({user:{id:'invalid'}})),false);
 const incoming=message(),outgoing=message({id:'c'.repeat(64),sender_id:viewer,recipient_id:person,body:'A real outgoing message'});
 assert.equal(e.api.hydrate(mailbox({inbox:[incoming,retired,outgoing,message({id:'d'.repeat(64),sender_id:stranger,body:'Someone else’s private message'}),{body:'Malformed message'}],sent:[outgoing,message({id:'e'.repeat(64),body:'Wrong folder'})],retired_message_ids:[retired.id]})),true);
 const history=textOf(e.nodes['profile-conversation-history']);assert.match(history,/Hello there/);assert.match(history,/A real outgoing message/);assert.doesNotMatch(history,/Retired welcome|Someone else|Malformed|Wrong folder/);assert.equal(e.nodes['profile-conversation-history'].children.length,2);
});

test('later hydration cannot replace an active draft, a failed outgoing item or an already loaded account',async()=>{
 const e=environment({post:()=>response({},503)});await e.write('A draft before loading');assert.equal(e.api.hydrate(mailbox({inbox:[message()]})),false);assert.equal(e.nodes['profile-conversation-body'].value,'A draft before loading');
 await e.open();await e.submit();assert.match(textOf(e.nodes['profile-conversation-history']),/A draft before loading/);await e.write('Next draft');
 assert.equal(e.api.hydrate(mailbox({user:{id:stranger},inbox:[message({body:'Replacement secret'})]})),false);assert.equal(e.nodes['profile-conversation-body'].value,'Next draft');assert.doesNotMatch(textOf(e.nodes['profile-conversation-history']),/Replacement secret/);assert.match(textOf(e.nodes['profile-conversation-history']),/Retry/);
});

test('hydrated history is cleared on a session change and rejects a late refresh from the previous account',async()=>{
 const pending=deferred();let signedOut=false;const e=environment({get:()=>signedOut?response({},401):pending.promise});assert.equal(e.api.hydrate(mailbox({inbox:[message({body:'Previous session history'})]})),true);
 const opening=e.api.open(e.openers[0]);await settle();await e.write('Previous session draft');signedOut=true;e.fire('jwhite:session-changed');await settle();
 pending.resolve(response(mailbox({inbox:[message({body:'Late previous session history'})]})));await opening;
 assert.equal(e.nodes['profile-conversation-body'].value,'');assert.equal(e.nodes['profile-conversation-history'].children.length,0);assert(e.nodes['profile-conversation-body'].disabled);
});
