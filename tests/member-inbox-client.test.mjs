import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {File} from 'node:buffer';

const source = fs.readFileSync(new URL('../member-inbox.js', import.meta.url), 'utf8').replace("import {preparePrivatePhoto} from './photo-helper.js';", '').replace("import {preparePrivateVideo, recordPrivateVideo} from './video-helper.js';", '').replace("import {createProfileConversation} from './profile-message.js';", '').replace('export function createMemberInbox', 'function createMemberInbox');
const html = fs.readFileSync(new URL('../members.html', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise,resolve};};
class Element {
  constructor(id = '') {this.id=id;this.value='';this.hidden=false;this.disabled=false;this.dataset={};this.textContent='';this.children=[];this.attributes={};this.listeners={};}
  append(...nodes) {this.children.push(...nodes);}
  replaceChildren(...nodes) {this.children=nodes;}
  setAttribute(key,value) {this.attributes[key]=value;}
  removeAttribute(key) {delete this.attributes[key];if(key==='src')this.src='';}
  addEventListener(event,fn) {this.listeners[event]=fn;}
  focus() {}
  pause() {this.paused=true;}
  play() {this.paused=false;return Promise.resolve();}
  load() {}
  reportValidity() {return true;}
  click() {return this.listeners.click?.({currentTarget:this});}
  submit() {return this.listeners.submit?.({preventDefault(){},currentTarget:this});}
}
function message(id, overrides = {}) {
  return {id,sender_id:'member-b',recipient_id:'member-a',sender_name:'Bea',recipient_name:'Ari',subject:'A good record',body:'That song is on repeat.',created_at:'2026-09-05T12:00:00.000Z',...overrides};
}
function payload(overrides = {}) {
  return {user:{id:'member-a',name:'Ari'},inbox:[],sent:[],members:[{id:'member-b',name:'Bea'}],unread_count:0,unread_ids:[],next:{inbox_before:null,sent_before:null,members_after:null},...overrides};
}
function environment({messenger = null} = {}) {
  const ids = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Element(m[1])]));
  const tabs = ['inbox','sent','compose'].map(mode=>{const element=ids[`mail-${mode}-tab`];element.dataset.mailGo=mode;return element;});
  ids['mail-compose-form'].reset=()=>{for (const id of ['mail-recipient','mail-subject','mail-body'])ids[id].value='';};
  const events={};const pageEvents={};const dispatched=[];const intervals=new Map();let intervalId=0;
  const document={visibilityState:'visible',getElementById:id=>ids[id],createElement:()=>new Element(),querySelectorAll:()=>tabs,addEventListener:(type,fn)=>{events[type]=fn;}};
  const queue=[];const calls=[];const expired=[];const preparationQueue=[];const prepared=[];const objectURLs=[];const revoked=[];
  const preparePrivatePhoto=async(file,options)=>{prepared.push({file,options});return preparationQueue.length ? await preparationQueue.shift() : new File(['prepared pixels'],'private-photo.jpg',{type:'image/jpeg'});};
  const videoQueue=[];const preparedVideos=[];const recordings=[];
  const preparePrivateVideo=async(file,options)=>{preparedVideos.push({file,options});return videoQueue.length ? await videoQueue.shift() : file;};
  const recordPrivateVideo=options=>{
    let resolve,reject;const result=new Promise((ok,no)=>{resolve=ok;reject=no;});
    const controller={options,result,canceled:false,stopped:false,
      stop(){this.stopped=true;options.onStream(null);resolve(new File(['recorded video'],'private-video.webm',{type:'video/webm'}));},
      cancel(){this.canceled=true;options.onStream(null);reject(new DOMException('Canceled','AbortError'));}};
    options.signal.addEventListener('abort',()=>controller.cancel(),{once:true});
    recordings.push(controller);options.onStream({id:'test-stream'});options.onTick(29);return controller;
  };
  const fetch=async(path,options)=>{calls.push({path,options});const item=queue.shift();if(!item)throw Error('Test did not enqueue response');return await item;};
  const enqueue=(data,status=200)=>queue.push(Promise.resolve({ok:status>=200&&status<300,status,json:async()=>data}));
  const enqueueDeferred=()=>{const pending=deferred();queue.push(pending.promise);return (data,status=200)=>pending.resolve({ok:status>=200&&status<300,status,json:async()=>data});};
  const enqueuePhoto=(blob=new Blob(['private pixels'],{type:'image/jpeg'}),status=200)=>queue.push(Promise.resolve({ok:status>=200&&status<300,status,blob:async()=>blob}));
  const enqueueDeferredPhoto=()=>{const pending=deferred();queue.push(pending.promise);return (blob=new Blob(['private pixels'],{type:'image/jpeg'}),status=200)=>pending.resolve({ok:status>=200&&status<300,status,blob:async()=>blob});};
  const deferPreparation=()=>{const pending=deferred();preparationQueue.push(pending.promise);return pending.resolve;};
  const choosePhoto=()=>{ids['mail-photo-input'].files=[new File(['original camera file'],'camera.jpg',{type:'image/jpeg'})];ids['mail-photo-input'].listeners.change();};
  const chooseVideo=()=>{ids['mail-video-input'].files=[new File(['original private video'],'camera.mp4',{type:'video/mp4'})];ids['mail-video-input'].listeners.change();};
  const deferVideoPreparation=()=>{const pending=deferred();videoQueue.push(pending.promise);return pending.resolve;};
  class TestCustomEvent { constructor(type,options={}) {this.type=type;this.detail=options.detail;} }
  const context=vm.createContext({createProfileConversation:()=>messenger,document,window:{addEventListener:(type,fn)=>{pageEvents[type]=fn;},dispatchEvent:event=>{dispatched.push(event);return true;}},CustomEvent:TestCustomEvent,fetch,preparePrivatePhoto,preparePrivateVideo,recordPrivateVideo,FormData,AbortController,URL:{createObjectURL:blob=>{const url=`blob:private-${objectURLs.length}`;objectURLs.push({url,blob});return url;},revokeObjectURL:url=>revoked.push(url)},URLSearchParams,setTimeout,clearTimeout,setInterval:fn=>{const id=++intervalId;intervals.set(id,fn);return id;},clearInterval:id=>intervals.delete(id),crypto:{randomUUID},onSessionExpired:reason=>expired.push(reason)});
  vm.runInContext(source+'\nthis.controller=createMemberInbox({onSessionExpired});',context);
  return {ids,tabs,document,events,pageEvents,dispatched,intervals,calls,expired,enqueue,enqueueDeferred,enqueuePhoto,enqueueDeferredPhoto,deferPreparation,choosePhoto,prepared,objectURLs,revoked,chooseVideo,deferVideoPreparation,preparedVideos,recordings,controller:context.controller};
}
const signedIn={id:'member-a',name:'Ari',confirmedAt:'2026-09-05T10:00:00Z'};

test('private inbox ignores a delayed read after logout and stops polling', async()=>{
  const e=environment();const finish=e.enqueueDeferred();
  e.controller.setUser(signedIn);
  assert.equal(e.calls.length,1);
  assert.equal(e.calls[0].options.credentials,'same-origin');
  assert.equal(e.calls[0].options.cache,'no-store');
  e.controller.setUser(null);
  finish(payload({inbox:[message('secret')]}));await tick();
  assert.equal(e.ids['member-mail'].hidden,true);
  assert.equal(e.ids['mail-list'].children.length,0);
  assert.equal(e.ids['mail-inbox-count'].textContent,'0');
  assert.equal(e.intervals.size,0);
});

test('plaintext messages, reply limits, recipient directory and duplicate name labels',async()=>{
  const e=environment();e.enqueue(payload({inbox:[message('one',{subject:'X'.repeat(100),body:'<img src=x onerror=alert(1)>'})],members:[{id:'member-b',name:'Bea'},{id:'member-c',name:'Bea'}]}));
  e.controller.setUser(signedIn);await tick();
  assert.equal(e.ids['mail-recipient'].children[1].textContent,'Bea (member-b)');
  assert.equal(e.ids['mail-recipient'].children[2].textContent,'Bea (member-c)');
  e.ids['mail-list'].children[0].children[0].click();
  assert.equal(e.ids['mail-message-body'].textContent,'<img src=x onerror=alert(1)>');
  e.ids['mail-reply'].click();
  assert.equal(e.ids['mail-recipient'].value,'member-b');
  assert.equal(e.ids['mail-subject'].value.length,100);
  assert.match(e.ids['mail-subject'].value,/^Re: /);
  // A reply holds on to the person it is addressed to even when the next page
  // of the roster does not happen to include them. Losing them is what made
  // Reply and Message quietly land on an empty inbox instead of on somebody.
  e.enqueue(payload({inbox:[message('one')],members:[]}));e.ids['mail-refresh'].click();await tick();
  assert.equal(e.ids['mail-recipient'].value,'member-b');
  assert.equal(e.ids['mail-recipient'].children[1].textContent,'Bea');
  assert.equal(e.ids['mail-send'].disabled,false);
  assert.equal(e.ids['mail-no-members'].hidden,true);
  // New Message starts clean, and with nobody on the roster there is nobody
  // to write to.
  e.ids['mail-compose-tab'].click();
  assert.equal(e.ids['mail-recipient'].value,'');
  assert.equal(e.ids['mail-send'].disabled,true);
  assert.equal(e.ids['mail-no-members'].hidden,false);
  e.controller.setUser(null);
});

test('Message beside somebody opens a private conversation with that exact person',async()=>{
  const bea='11111111-1111-4111-8111-111111111111';
  const cass='22222222-2222-4222-8222-222222222222';
  const e=environment();
  // A roster page that does not happen to include the person being written to.
  e.enqueue(payload({members:[{id:'member-z',name:'Zed'}]}));
  e.controller.setUser(signedIn);await tick();

  assert.equal(e.controller.openConversation({id:bea,name:'Bea',back:'chat'}),true);
  assert.equal(e.ids['mail-compose'].hidden,false,'Message must open the message itself, not the inbox list');
  assert.equal(e.ids['mail-list-view'].hidden,true);
  assert.equal(e.ids['mail-compose-heading'].textContent,'Message Bea');
  assert.equal(e.ids['mail-recipient'].value,bea,'the conversation must be addressed to that exact person');
  assert.equal(e.ids['mail-recipient'].children[1].textContent,'Bea');
  assert.equal(e.ids['mail-send'].disabled,false);
  // The way back into the room the member came from.
  assert.equal(e.ids['mail-conversation-back'].hidden,false);
  assert.equal(e.controller.backTo(),'chat');

  // Writing to them reaches them, not whoever the loaded roster page held.
  e.ids['mail-body'].value='Heard your set last night.';
  e.enqueue({message:message('sent-one',{sender_id:'member-a',recipient_id:bea,recipient_name:'Bea'})},201);
  e.ids['mail-compose-form'].submit();await tick();
  const send=e.calls.find(call=>call.options?.method==='POST'&&call.path==='/api/member-messages/send');
  assert.ok(send,'the message must actually be sent');
  assert.equal(JSON.parse(send.options.body).recipient_id,bea);

  // A made up member id opens nothing.
  assert.equal(e.controller.openConversation({id:'not-a-member'}),false);
  // A name out of a link is text, and a long one is cut down rather than trusted.
  assert.equal(e.controller.openConversation({id:cass,name:'<img src=x onerror=alert(1)> '+'y'.repeat(90)}),true);
  assert.equal(e.ids['mail-compose-heading'].textContent.length,'Message '.length+60);
  assert.match(e.ids['mail-compose-heading'].textContent,/^Message <img src=x onerror=alert\(1\)>/);
  // Nobody is pinned once the member starts a plain new message.
  e.ids['mail-compose-tab'].click();
  assert.equal(e.ids['mail-compose-heading'].textContent,'New Message');
  assert.equal(e.ids['mail-recipient'].value,'');
  assert.equal(e.ids['mail-conversation-back'].hidden,true);
  e.controller.setUser(null);
});

test('unopened inbox rows show NEW and clear the red count only after a confirmed open',async()=>{
  const first='a'.repeat(64),second='b'.repeat(64);const e=environment();
  e.enqueue(payload({inbox:[message(first),message(second,{subject:'Another record'})],unread_count:2,unread_ids:[first,second]}));
  e.controller.setUser(signedIn);await tick();
  const firstRow=e.ids['mail-list'].children[0].children[0];
  assert.equal(firstRow.className,'mail-row is-unread');
  assert.equal(firstRow.children[2].children.at(-1).textContent,'NEW');
  assert.match(firstRow.attributes['aria-label'],/New message from Bea/);
  assert.equal(e.dispatched.filter(event=>event.type==='jwhite:messages-changed').at(-1).detail.count,2);

  e.enqueue({message_id:first,read:true,unread_count:1});
  firstRow.click();await tick();
  const read=e.calls.find(call=>call.path==='/api/member-messages/read');
  assert.ok(read);
  assert.equal(read.options.method,'POST');
  assert.equal(read.options.credentials,'same-origin');
  assert.equal(read.options.cache,'no-store');
  assert.deepEqual(JSON.parse(read.options.body),{message_id:first});
  assert.equal(e.dispatched.at(-1).detail.count,1);
  e.ids['mail-back'].click();
  assert.equal(e.ids['mail-list'].children[0].children[0].className,'mail-row');
  assert.equal(e.ids['mail-list'].children[1].children[0].className,'mail-row is-unread');
  e.controller.setUser(null);
  assert.equal(e.dispatched.at(-1).detail.count,0);
});

test('a failed read update keeps the message visibly new',async()=>{
  const id='c'.repeat(64);const e=environment();
  e.enqueue(payload({inbox:[message(id)],unread_count:1,unread_ids:[id]}));e.controller.setUser(signedIn);await tick();
  e.enqueue({error:'Temporary'},503);e.ids['mail-list'].children[0].children[0].click();await tick();
  assert.match(e.ids['mail-status'].textContent,/new badge could not update/);
  e.ids['mail-back'].click();
  assert.equal(e.ids['mail-list'].children[0].children[0].className,'mail-row is-unread');
  assert.equal(e.dispatched.filter(event=>event.type==='jwhite:messages-changed').at(-1).detail.count,1);
  e.controller.setUser(null);
});

test('send waits for confirmation, preserves a failed draft and reuses the request ID',async()=>{
  const e=environment();e.enqueue(payload());e.controller.setUser(signedIn);await tick();
  e.ids['mail-compose-tab'].click();e.ids['mail-recipient'].value='member-b';e.ids['mail-subject'].value='New record';e.ids['mail-body'].value='Want to hear this one?';
  let finish=e.enqueueDeferred();e.ids['mail-compose-form'].submit();
  assert.equal(e.ids['mail-sent-count'].textContent,'0');
  assert.equal(e.ids['mail-send'].disabled,true);
  const firstBody=JSON.parse(e.calls.at(-1).options.body);
  e.ids['mail-compose-form'].submit();assert.equal(e.calls.filter(c=>c.options.method==='POST').length,1);
  finish({error:'Temporary error'},503);await tick();
  assert.equal(e.ids['mail-body'].value,'Want to hear this one?');
  assert.equal(e.ids['mail-sent-count'].textContent,'0');
  assert.match(e.ids['mail-status'].textContent,/couldn't confirm/);
  const sent=message('sent-one',{sender_id:'member-a',recipient_id:'member-b',sender_name:'Ari',recipient_name:'Bea',subject:'New record',body:'Want to hear this one?'});
  e.enqueue({message:sent},200);e.enqueue(payload({sent:[sent]}));e.ids['mail-compose-form'].submit();await tick();await tick();
  const secondBody=JSON.parse(e.calls.filter(c=>c.options.method==='POST').at(-1).options.body);
  assert.equal(secondBody.request_id,firstBody.request_id);
  assert.equal(e.ids['mail-sent-count'].textContent,'1');
  assert.equal(e.ids['mail-body'].value,'');
  assert.equal(e.ids['mail-status'].textContent,'Message sent.');
  e.controller.setUser(null);
});

test('late send response cannot restore messages after logout',async()=>{
  const e=environment();e.enqueue(payload());e.controller.setUser(signedIn);await tick();
  e.ids['mail-recipient'].value='member-b';e.ids['mail-subject'].value='Private';e.ids['mail-body'].value='Private words';
  const finish=e.enqueueDeferred();e.ids['mail-compose-form'].submit();e.controller.setUser(null);
  finish({message:message('late',{sender_id:'member-a',recipient_id:'member-b'})},201);await tick();
  assert.equal(e.ids['member-mail'].hidden,true);
  assert.equal(e.ids['mail-sent-count'].textContent,'0');
  assert.equal(e.ids['mail-body'].value,'');
  assert.equal(e.ids['mail-status'].textContent,'');
});

test('unauthorized and unconfirmed responses remove cached private content',async()=>{
  for(const code of [401,403]){
    const e=environment();e.enqueue(payload({inbox:[message('private')]}));e.controller.setUser(signedIn);await tick();
    e.ids['mail-list'].children[0].children[0].click();
    assert.equal(e.ids['mail-message-body'].textContent,'That song is on repeat.');
    e.enqueue({error:'Unauthorized'},code);e.ids['mail-refresh'].click();await tick();
    assert.equal(e.ids['member-mail'].hidden,true);
    assert.equal(e.ids['mail-message-body'].textContent,'');
    assert.equal(e.expired[0],code===403?'confirmation':'session');
  }
});

test('folder and member cursors append without duplicate rows and survive a refresh',async()=>{
  const e=environment();const first=message('first');const older=message('older',{created_at:'2026-09-04T11:00:00.000Z'});
  e.enqueue(payload({inbox:[first],next:{inbox_before:'older-cursor',sent_before:null,members_after:'member-cursor'}}));e.controller.setUser(signedIn);await tick();
  e.enqueue(payload({inbox:[first,older],next:{inbox_before:null,sent_before:null,members_after:'member-cursor'}}));e.ids['mail-load-more'].click();await tick();
  assert.match(e.calls.at(-1).path,/inbox_before=older-cursor/);
  assert.equal(e.ids['mail-list'].children.length,2);
  assert.equal(e.ids['mail-load-more'].hidden,true);
  e.enqueue(payload({members:[{id:'member-b',name:'Bea'},{id:'member-c',name:'Cam'}]}));e.ids['mail-more-members'].click();await tick();
  assert.match(e.calls.at(-1).path,/members_after=member-cursor/);
  assert.equal(e.ids['mail-recipient'].children.length,3);
  e.enqueue(payload({inbox:[first]}));e.ids['mail-refresh'].click();await tick();
  assert.equal(e.ids['mail-list'].children.length,2,'newest page refresh retains older loaded messages');
  assert.equal(e.ids['mail-recipient'].children.length,3,'directory retains explicitly loaded later pages');
  e.document.visibilityState='hidden';const count=e.calls.length;e.intervals.values().next().value();
  assert.equal(e.calls.length,count,'hidden tabs do not poll');
  e.controller.setUser(null);
});

test('pagehide clears private data and a verified return can load it again',async()=>{
  const e=environment();e.enqueue(payload({inbox:[message('one')]}));e.controller.setUser(signedIn);await tick();
  e.pageEvents.pagehide();assert.equal(e.ids['member-mail'].hidden,true);
  e.enqueue(payload({inbox:[message('two')]}));e.controller.setUser(signedIn);await tick();
  assert.equal(e.ids['member-mail'].hidden,false);
  assert.equal(e.ids['mail-inbox-count'].textContent,'1');
  e.controller.setUser(null);
});

test('photo-only draft sends only on explicit submit and preserves exact bytes and request ID after failure',async()=>{
  const e=environment();e.enqueue(payload());e.controller.setUser(signedIn);await tick();
  e.ids['mail-compose-tab'].click();e.ids['mail-recipient'].value='member-b';
  e.choosePhoto();await tick();
  assert.equal(e.calls.filter(call=>call.options.method==='POST').length,0);
  assert.equal(e.ids['mail-body'].required,false);
  assert.equal(e.ids['mail-photo-draft'].hidden,false);
  e.enqueue({error:'Temporary'},503);e.ids['mail-compose-form'].submit();await tick();
  const first=e.calls.at(-1).options.body;
  assert.ok(first instanceof FormData);
  assert.equal(first.get('subject'),'Photo');assert.equal(first.get('body'),'');
  assert.equal(await first.get('photo').text(),'prepared pixels');
  assert.equal(e.ids['mail-photo-draft'].hidden,false,'failed draft stays visible');
  e.enqueue({error:'Temporary'},503);e.ids['mail-compose-form'].submit();await tick();
  const second=e.calls.at(-1).options.body;
  assert.equal(second.get('request_id'),first.get('request_id'));
  assert.equal(await second.get('photo').text(),await first.get('photo').text());
  const oldPreview=e.ids['mail-photo-preview'].src;
  e.choosePhoto();await tick();
  assert.ok(e.revoked.includes(oldPreview));
  e.enqueue({error:'Temporary'},503);e.ids['mail-compose-form'].submit();await tick();
  assert.notEqual(e.calls.at(-1).options.body.get('request_id'),first.get('request_id'));
  e.controller.setUser(null);
  assert.equal(e.ids['mail-photo-draft'].hidden,true);
  assert.equal(e.ids['mail-photo-preview'].src,'');
});

test('removing a photo cancels pending preparation and restores text validation',async()=>{
  const e=environment();e.enqueue(payload());e.controller.setUser(signedIn);await tick();
  e.ids['mail-compose-tab'].click();e.choosePhoto();await tick();
  const oldURL=e.ids['mail-photo-preview'].src;
  const finish=e.deferPreparation();e.choosePhoto();
  assert.equal(e.ids['mail-send'].disabled,true);
  e.ids['mail-remove-photo'].click();
  finish(new File(['late photo'],'late.jpg',{type:'image/jpeg'}));await tick();
  assert.ok(e.prepared.at(-1).options.signal.aborted);
  assert.ok(e.revoked.includes(oldURL));
  assert.equal(e.ids['mail-photo-draft'].hidden,true);
  assert.equal(e.ids['mail-body'].required,true);
  e.ids['mail-recipient'].value='member-b';e.ids['mail-compose-form'].submit();
  assert.equal(e.calls.filter(call=>call.options.method==='POST').length,0);
  assert.match(e.ids['mail-status'].textContent,/add a message or picture/);
  e.controller.setUser(null);
});

test('late photo preparation cannot restore a draft after logout or leaving compose',async()=>{
  for(const leave of ['logout','tab']){
    const e=environment();e.enqueue(payload());e.controller.setUser(signedIn);await tick();
    e.ids['mail-compose-tab'].click();const finish=e.deferPreparation();e.choosePhoto();
    if(leave==='logout')e.controller.setUser(null);else e.ids['mail-inbox-tab'].click();
    finish(new File(['private late photo'],'late.jpg',{type:'image/jpeg'}));await tick();
    assert.ok(e.prepared[0].options.signal.aborted);
    assert.equal(e.objectURLs.length,0);
    assert.equal(e.ids['mail-photo-draft'].hidden,true);
    e.controller.setUser(null);
  }
});

test('private pictures fetch only when opened with cookie no-store and revoke on navigation',async()=>{
  const id='a'.repeat(64);const url=`/api/member-message-photo/${id}`;
  const e=environment();e.enqueue(payload({inbox:[message(id,{photo:{url,mime:'image/jpeg',width:100,height:100}})]}));
  e.controller.setUser(signedIn);await tick();
  assert.equal(e.calls.length,1,'list rendering does not preload photos');
  e.enqueuePhoto();e.ids['mail-list'].children[0].children[0].click();await tick();
  assert.equal(e.calls.at(-1).path,url);
  assert.equal(e.calls.at(-1).options.credentials,'same-origin');
  assert.equal(e.calls.at(-1).options.cache,'no-store');
  assert.equal(e.calls.at(-1).options.redirect,'error');
  const objectURL=e.ids['mail-message-photo'].src;
  assert.match(objectURL,/^blob:/);
  assert.equal(e.ids['mail-message-photo-wrap'].hidden,false);
  e.ids['mail-back'].click();
  assert.ok(e.revoked.includes(objectURL));
  assert.equal(e.ids['mail-message-photo'].src,'');
  e.controller.setUser(null);
});

test('stale photo responses cannot show after another folder, hidden page or logout',async()=>{
  for(const leave of ['folder','hidden','logout']){
    const id='b'.repeat(64);const url=`/api/member-message-photo/${id}`;
    const e=environment();e.enqueue(payload({inbox:[message(id,{photo:{url}})]}));e.controller.setUser(signedIn);await tick();
    const finish=e.enqueueDeferredPhoto();e.ids['mail-list'].children[0].children[0].click();
    const photoRequest=e.calls.at(-1);
    if(leave==='folder')e.ids['mail-sent-tab'].click();
    else if(leave==='hidden'){e.document.visibilityState='hidden';e.events.visibilitychange();}
    else e.controller.setUser(null);
    finish();await tick();
    assert.ok(photoRequest.options.signal.aborted);
    assert.equal(e.objectURLs.length,0);
    assert.equal(e.ids['mail-message-photo-wrap'].hidden,true);
    e.controller.setUser(null);
  }
});

test('external and mismatched photo URLs are never fetched',async()=>{
  for(const url of ['https://example.com/private.jpg','/api/member-message-photo/'+ 'd'.repeat(64),'/profile.jpg']){
    const e=environment();e.enqueue(payload({inbox:[message('c'.repeat(64),{photo:{url}})]}));e.controller.setUser(signedIn);await tick();
    e.ids['mail-list'].children[0].children[0].click();await tick();
    assert.equal(e.calls.length,1);
    assert.equal(e.ids['mail-message-photo-wrap'].hidden,true);
    e.controller.setUser(null);
  }
});

test('photo access failures clear private content and expired sessions cannot leave an image behind',async()=>{
  const id='e'.repeat(64);const url=`/api/member-message-photo/${id}`;
  for(const status of [401,403,404]){
    const e=environment();e.enqueue(payload({inbox:[message(id,{photo:{url}})]}));e.controller.setUser(signedIn);await tick();
    e.enqueuePhoto(undefined,status);e.ids['mail-list'].children[0].children[0].click();await tick();
    assert.equal(e.ids['mail-message-photo'].src,'');
    if(status===404){assert.equal(e.ids['mail-photo-retry'].hidden,false);assert.match(e.ids['mail-message-photo-status'].textContent,/could not open/);}
    else {assert.equal(e.ids['member-mail'].hidden,true);assert.equal(e.expired.length,1);}
    e.controller.setUser(null);
  }
});

test('video is sent explicitly with exact-byte retries and replaces a photo attachment',async()=>{
  const e=environment();e.enqueue(payload());e.controller.setUser(signedIn);await tick();
  e.ids['mail-compose-tab'].click();e.ids['mail-recipient'].value='member-b';e.choosePhoto();await tick();
  const photoPreview=e.ids['mail-photo-preview'].src;
  e.chooseVideo();await tick();
  assert.match(e.ids['mail-video-input'].accept,/\.mov/);
  assert.equal(typeof e.preparedVideos[0].options.onProgress,'function');
  assert.equal(e.ids['mail-photo-draft'].hidden,true);assert.ok(e.revoked.includes(photoPreview));
  assert.equal(e.ids['mail-video-draft'].hidden,false);assert.equal(e.ids['mail-body'].required,false);
  assert.equal(e.calls.filter(call=>call.options.method==='POST').length,0);
  e.enqueue({error:'Temporary'},503);e.ids['mail-compose-form'].submit();await tick();
  const first=e.calls.at(-1).options.body;
  assert.equal(first.get('subject'),'Video');assert.equal(first.get('photo'),null);
  assert.equal(first.get('video').type,'video/mp4');assert.equal(await first.get('video').text(),'original private video');
  e.enqueue({error:'Temporary'},503);e.ids['mail-compose-form'].submit();await tick();
  const second=e.calls.at(-1).options.body;
  assert.equal(second.get('request_id'),first.get('request_id'));
  assert.equal(await second.get('video').text(),await first.get('video').text());
  e.choosePhoto();await tick();assert.equal(e.ids['mail-video-draft'].hidden,true);
  e.enqueue({error:'Temporary'},503);e.ids['mail-compose-form'].submit();await tick();
  assert.equal(e.calls.at(-1).options.body.get('video'),null);
  assert.notEqual(e.calls.at(-1).options.body.get('request_id'),first.get('request_id'));
  e.controller.setUser(null);
});

test('recording requires its explicit button and stop offers a preview before sending',async()=>{
  const e=environment();e.enqueue(payload());e.controller.setUser(signedIn);await tick();
  e.ids['mail-compose-tab'].click();assert.equal(e.recordings.length,0);
  e.ids['mail-record-video'].click();assert.equal(e.recordings.length,1);
  assert.equal(e.ids['mail-recording'].hidden,false);
  assert.equal(e.ids['mail-recording-preview'].muted,true);
  assert.equal(e.ids['mail-recording-countdown'].textContent,'29 seconds left');
  assert.equal(e.ids['mail-send'].disabled,true);
  e.ids['mail-stop-recording'].click();await tick();
  assert.equal(e.recordings[0].stopped,true);
  assert.equal(e.ids['mail-recording-preview'].srcObject,null);
  assert.equal(e.ids['mail-recording'].hidden,true);
  assert.equal(e.ids['mail-video-draft'].hidden,false);
  assert.equal(e.calls.filter(call=>call.options.method==='POST').length,0);
  assert.match(e.ids['mail-photo-status'].textContent,/Watch it first/);
  e.controller.setUser(null);
});

test('cancel, hidden page, logout and tab navigation immediately abort capture and clear live preview',async()=>{
  for(const leave of ['cancel','hidden','logout','tab']){
    const e=environment();e.enqueue(payload());e.controller.setUser(signedIn);await tick();
    e.ids['mail-compose-tab'].click();e.ids['mail-record-video'].click();
    if(leave==='cancel')e.ids['mail-cancel-recording'].click();
    else if(leave==='hidden'){e.document.visibilityState='hidden';e.events.visibilitychange();}
    else if(leave==='logout')e.controller.setUser(null);
    else e.ids['mail-inbox-tab'].click();
    await tick();
    assert.ok(e.recordings[0].options.signal.aborted);
    assert.ok(e.recordings[0].canceled);
    assert.equal(e.ids['mail-recording-preview'].srcObject,null);
    assert.equal(e.ids['mail-recording'].hidden,true);
    assert.equal(e.ids['mail-video-draft'].hidden,true);
    e.controller.setUser(null);
  }
});

test('stale video preparation cannot replace a newer photo selection',async()=>{
  const e=environment();e.enqueue(payload());e.controller.setUser(signedIn);await tick();
  e.ids['mail-compose-tab'].click();const finish=e.deferVideoPreparation();e.chooseVideo();
  e.choosePhoto();await tick();
  finish(new File(['late video'],'late.mp4',{type:'video/mp4'}));await tick();
  assert.ok(e.preparedVideos[0].options.signal.aborted);
  assert.equal(e.ids['mail-photo-draft'].hidden,false);
  assert.equal(e.ids['mail-video-draft'].hidden,true);
  e.controller.setUser(null);
});

test('private videos are fetched only when opened and playback bytes clear on closing or logout',async()=>{
  const id='f'.repeat(64);const url=`/api/member-message-video/${id}`;
  const e=environment();e.enqueue(payload({inbox:[message(id,{video:{url,mime:'video/mp4',duration:10}})]}));e.controller.setUser(signedIn);await tick();
  assert.equal(e.calls.length,1);
  e.enqueuePhoto(new Blob(['movie'],{type:'video/mp4'}));e.ids['mail-list'].children[0].children[0].click();await tick();
  const call=e.calls.at(-1);assert.equal(call.path,url);assert.equal(call.options.credentials,'same-origin');assert.equal(call.options.cache,'no-store');assert.equal(call.options.redirect,'error');
  const objectURL=e.ids['mail-message-video'].src;assert.match(objectURL,/^blob:/);
  assert.equal(e.ids['mail-message-video-wrap'].hidden,false);
  e.ids['mail-back'].click();assert.ok(e.revoked.includes(objectURL));assert.equal(e.ids['mail-message-video'].src,'');assert.equal(e.ids['mail-message-video'].paused,true);
  const finish=e.enqueueDeferredPhoto();e.ids['mail-list'].children[0].children[0].click();
  e.controller.setUser(null);finish(new Blob(['late movie'],{type:'video/mp4'}));await tick();
  assert.equal(e.ids['mail-message-video'].src,'');assert.equal(e.ids['mail-message-video-wrap'].hidden,true);
});

test('invalid private video URLs, types and oversized bodies never become playable',async()=>{
  const id='d'.repeat(64);const url=`/api/member-message-video/${id}`;
  for(const invalid of ['external','mime','size']){
    const e=environment();e.enqueue(payload({inbox:[message(id,{video:{url:invalid==='external'?'https://example.com/movie.mp4':url}})]}));e.controller.setUser(signedIn);await tick();
    if(invalid!=='external')e.enqueuePhoto(invalid==='mime'?new Blob(['html'],{type:'text/html'}):new Blob([new Uint8Array(4*1024*1024+1)],{type:'video/mp4'}));
    e.ids['mail-list'].children[0].children[0].click();await tick();
    assert.equal(e.ids['mail-message-video'].src,'');
    if(invalid==='external')assert.equal(e.calls.length,1);else assert.equal(e.ids['mail-video-retry'].hidden,false);
    e.controller.setUser(null);
  }
});


test('refresh retires a loaded welcome in both folders, clears its open detail and keeps the real conversation and draft',async()=>{
  const receivedId='a'.repeat(64),sentId='b'.repeat(64),quotedId='c'.repeat(64),replyId='d'.repeat(64);
  const welcome='Welcome to KON-NEKT. I’m Your Connector on here and your first friend.';
  const received=message(receivedId,{subject:'You’re connected. Let’s get it.',body:welcome});
  const sent=message(sentId,{sender_id:'member-a',recipient_id:'member-b',subject:'You’re connected. Let’s get it.',body:welcome,video:{url:'/api/member-message-video/'+sentId}});
  const quoted=message(quotedId,{body:'I received this: '+welcome});
  const reply=message(replyId,{sender_id:'member-a',recipient_id:'member-b',body:'Can we discuss the event?'});
  const e=environment();e.enqueue(payload({inbox:[received,quoted],sent:[sent,reply],unread_count:2,unread_ids:[receivedId,quotedId]}));e.controller.setUser(signedIn);await tick();
  e.ids['mail-compose-tab'].click();e.ids['mail-recipient'].value='member-b';e.ids['mail-subject'].value='My question';e.ids['mail-body'].value='Keep my unsent draft';
  e.ids['mail-sent-tab'].click();e.enqueuePhoto(new Blob(['video'],{type:'video/mp4'}));e.ids['mail-list'].children[0].children[0].click();await tick();
  const videoURL=e.ids['mail-message-video'].src;assert.match(videoURL,/^blob:/);assert.equal(e.ids['mail-message-body'].textContent,welcome);
  // Even if an old replica also sends the retired object, its verified ID wins.
  e.enqueue(payload({inbox:[received,quoted],sent:[sent,reply],retired_message_ids:[receivedId,sentId],unread_count:1,unread_ids:[quotedId]}));e.ids['mail-refresh'].click();await tick();
  assert.equal(e.ids['mail-inbox-count'].textContent,'1');assert.equal(e.ids['mail-sent-count'].textContent,'1');
  assert(e.ids['mail-detail'].hidden);assert(!e.ids['mail-list-view'].hidden);
  for(const id of ['mail-message-subject','mail-message-from','mail-message-to','mail-message-date','mail-message-body'])assert.equal(e.ids[id].textContent,'');
  assert.equal(e.ids['mail-message-video'].src,'');assert(e.revoked.includes(videoURL));assert.equal(e.ids['mail-message-video'].paused,true);
  assert.equal(e.ids['mail-body'].value,'Keep my unsent draft');assert.equal(e.ids['mail-subject'].value,'My question');assert.equal(e.ids['mail-recipient'].value,'member-b');
  assert.equal(e.dispatched.at(-1).detail.count,1);
  e.ids['mail-inbox-tab'].click();const row=e.ids['mail-list'].children[0].children[0];assert.equal(row.className,'mail-row is-unread');assert.match(row.children[2].children[1].textContent,/I received this:/);
  e.controller.setUser(null);
});

test('polling remembers retired IDs and retains previously loaded genuine older messages',async()=>{
  const old=message('a'.repeat(64),{body:'Old welcome'}),older=message('b'.repeat(64),{body:'A real older conversation',created_at:'2026-09-01T10:00:00Z'});
  const e=environment();e.enqueue(payload({inbox:[old,older],unread_count:1,unread_ids:[old.id]}));e.controller.setUser(signedIn);await tick();
  e.enqueue(payload({retired_message_ids:[old.id]}));e.intervals.values().next().value();await tick();
  assert.equal(e.ids['mail-inbox-count'].textContent,'1');assert.equal(e.dispatched.at(-1).detail.count,0);
  // A later response need not repeat every retired ID.
  e.enqueue(payload({inbox:[old],unread_ids:[old.id]}));e.intervals.values().next().value();await tick();
  assert.equal(e.ids['mail-inbox-count'].textContent,'1');assert.equal(e.ids['mail-list'].children[0].children[0].className,'mail-row');
  assert.equal(e.ids['mail-list'].children[0].children[0].children[2].children[1].textContent,'A real older conversation');
  e.controller.setUser(null);
});

test('every pagination kind applies verified retirements to both folders without losing older genuine rows',async()=>{
  for(const kind of ['inbox','sent','members']){
    const inId='a'.repeat(64),sentId='b'.repeat(64),real=message('c'.repeat(64));
    const incoming=message(inId),outgoing=message(sentId,{sender_id:'member-a',recipient_id:'member-b'});
    const e=environment();e.enqueue(payload({inbox:[incoming,real],sent:[outgoing],unread_count:1,unread_ids:[inId],next:{inbox_before:'older-inbox',sent_before:'older-sent',members_after:'more-members'}}));e.controller.setUser(signedIn);await tick();
    if(kind==='sent')e.ids['mail-sent-tab'].click();
    e.enqueue(payload({inbox:[incoming],sent:[outgoing],retired_message_ids:[inId,sentId]}));e.ids[kind==='members'?'mail-more-members':'mail-load-more'].click();await tick();
    assert.equal(e.ids['mail-inbox-count'].textContent,'1',kind);assert.equal(e.ids['mail-sent-count'].textContent,'0',kind);assert.equal(e.dispatched.at(-1).detail.count,0,kind);
    e.controller.setUser(null);
  }
});

test('malformed retired IDs never hide an ordinary message or quoted welcome',async()=>{
  const id='a'.repeat(64);const e=environment();e.enqueue(payload({inbox:[message(id,{body:'Welcome to KON-NEKT.'})]}));e.controller.setUser(signedIn);await tick();
  e.enqueue(payload({retired_message_ids:[id.toUpperCase(),' '+id,id+'x',null,64,{id}]}));e.ids['mail-refresh'].click();await tick();assert.equal(e.ids['mail-inbox-count'].textContent,'1');
  e.enqueue(payload({retired_message_ids:id}));e.ids['mail-refresh'].click();await tick();assert.equal(e.ids['mail-inbox-count'].textContent,'1');e.controller.setUser(null);
});

test('a delayed retirement response cannot remove a message loaded after an account session changes',async()=>{
  const id='a'.repeat(64);const e=environment();e.enqueue(payload({inbox:[message(id)]}));e.controller.setUser(signedIn);await tick();
  const finish=e.enqueueDeferred();e.ids['mail-refresh'].click();e.controller.setUser(null);
  e.enqueue(payload({inbox:[message(id,{body:'Current session message'})]}));e.controller.setUser(signedIn);await tick();
  finish(payload({retired_message_ids:[id]}));await tick();assert.equal(e.ids['mail-inbox-count'].textContent,'1');assert.equal(e.ids['mail-list'].children[0].children[0].children[2].children[1].textContent,'Current session message');
  e.controller.setUser(null);
});

test('Messages groups both directions by person and opens the shared text conversation without leaving the page',async()=>{
  const viewer='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',peer='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const opened=[],people=[],snapshots=[];let clears=0,closes=0;
  const messenger={setRecipient:person=>people.push(person),hydrate:snapshot=>snapshots.push(snapshot),open:button=>opened.push(button),clear:()=>clears++,close:()=>closes++};
  const incoming=message('a'.repeat(64),{sender_id:peer,recipient_id:viewer,subject:'New message',body:'Are you free to talk?',created_at:'2026-09-11T10:00:00Z'});
  const outgoing=message('b'.repeat(64),{sender_id:viewer,recipient_id:peer,recipient_name:'Bea',subject:'New message',body:'Yes, let’s talk.',created_at:'2026-09-11T10:01:00Z'});
  const e=environment({messenger});e.enqueue(payload({user:{id:viewer,name:'Ari'},members:[{id:peer,name:'Bea'}],inbox:[incoming],sent:[outgoing],unread_count:1,unread_ids:[incoming.id]}));
  e.controller.setUser({id:viewer,name:'Ari'});await tick();
  assert.equal(e.ids['mail-list'].children.length,1);assert.equal(e.ids['mail-inbox-count'].textContent,'1');assert(e.ids['mail-sent-tab'].hidden);
  const row=e.ids['mail-list'].children[0].children[0];assert.equal(row.className,'mail-row is-unread');row.click();
  assert.equal(opened.length,1);assert.equal(snapshots[0].user.id,viewer);assert.equal(snapshots[0].inbox[0].id,incoming.id);assert.equal(snapshots[0].sent[0].id,outgoing.id);assert.equal(people[0].id,peer);assert.equal(people[0].name,'Bea');assert.equal(e.calls.filter(call=>call.options.method==='POST').length,0);
  e.ids['mail-compose-tab'].click();e.ids['mail-recipient'].value=peer;e.ids['mail-recipient'].listeners.change();assert(!e.ids['mail-open-chat'].disabled);e.ids['mail-open-chat'].click();assert.equal(opened.length,2);
  e.ids['mail-attachments-compose'].open=true;e.ids['mail-recipient'].listeners.change();assert(e.ids['mail-attachments-compose'].open,'typing/selecting must not close the attachment tools');
  assert.equal(e.controller.openConversation({id:peer,name:'Bea',back:'chat'}),true);assert.equal(opened.length,3);
  e.controller.setUser(null);assert(clears>=2);assert(closes>=2);assert.equal(e.ids['mail-list'].children.length,0);
});

test('shared Messages can load older conversations from both inbox and sent pages',async()=>{
  const viewer='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',a='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',b='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const messenger={setRecipient(){},open(){},clear(){},close(){}};
  const e=environment({messenger});const base={user:{id:viewer,name:'Ari'},members:[]};
  e.enqueue(payload({...base,next:{inbox_before:'in-cursor',sent_before:'out-cursor',members_after:null}}));e.controller.setUser({id:viewer,name:'Ari'});await tick();
  e.enqueue(payload({...base,inbox:[message('a'.repeat(64),{sender_id:a,recipient_id:viewer})]}));
  e.enqueue(payload({...base,sent:[message('b'.repeat(64),{sender_id:viewer,recipient_id:b})]}));
  e.ids['mail-load-more'].click();await tick();await tick();
  assert(e.calls.some(call=>call.path.includes('inbox_before=in-cursor')));assert(e.calls.some(call=>call.path.includes('sent_before=out-cursor')));assert.equal(e.ids['mail-list'].children.length,2);assert(e.ids['mail-load-more'].hidden);
  e.controller.setUser(null);
});
