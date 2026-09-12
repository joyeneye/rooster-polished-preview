import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {TOP_EIGHT, readTopEightOrder} from '../netlify/functions/_shared/top-eight-order.mts';

const photoHelperSource = fs.readFileSync(new URL('../photo-helper.js',import.meta.url),'utf8').replace('export async function','async function');
const topEightSource = fs.readFileSync(new URL('../top-eight-editor.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export function createTopEightEditor','function createTopEightEditor');
const source = photoHelperSource + '\n' + topEightSource + '\n' + fs.readFileSync(new URL('../member-profile.js',import.meta.url),'utf8').replace("import photoCatalog from './photo-catalog.json';", `const photoCatalog = ${fs.readFileSync(new URL('../photo-catalog.json',import.meta.url),'utf8')};`).replace("import {createTopEightEditor} from './top-eight-editor.js';", '').replace("import {preparePrivatePhoto as prepareProfilePhoto} from './photo-helper.js';", 'const prepareProfilePhoto = (file, options) => {photoSignals.push(options.signal); return preparePrivatePhoto(file, options);};').replace("import {openPhotoFilterEditor} from './photo-filter-editor.js';", 'const openPhotoFilterEditor=async()=>null;').replace(/import \{openRosterCamera\} from '\.\/roster-camera\.js(?:\?[^']*)?';/, 'const openRosterCamera=async()=>null;').replace('export function createMemberProfileEditor','function createMemberProfileEditor');
const html = fs.readFileSync(new URL('../members.html',import.meta.url),'utf8');
const ownerHtml = fs.readFileSync(new URL('../edit-profile.html',import.meta.url),'utf8');
const tick = () => new Promise(resolve=>setImmediate(resolve));
class Element {
  constructor(id=''){this.id=id;this.value='';this.textContent='';this.hidden=false;this.disabled=false;this.dataset={};this.files=[];this.listeners={};this.attrs={};this.children=[];}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=[...children];}
  addEventListener(name,fn){this.listeners[name]=fn;}
  setAttribute(key,value){this.attrs[key]=value;}
  removeAttribute(key){delete this.attrs[key];if(key==='src')this.src='';if(key==='href')this.href='';}
  reportValidity(){return true;}
  focus(){this.focusCount=(this.focusCount||0)+1;}
  scrollIntoView(){this.scrollCount=(this.scrollCount||0)+1;}
  click(){return this.listeners.click?.();}
  submit(){return this.listeners.submit?.({preventDefault(){}});}
  change(){return this.listeners.change?.();}
  input(){return this.listeners.input?.();}
}
const member={id:'94766d9a-978a-4bfd-828c-feeae28ad26b',confirmedAt:'2026-09-05T10:00:00Z'};
const own=(overrides={})=>({profile:{id:member.id,name:'Ari',status:'MORE!',photo_url:null,updated_at:null,...overrides},can_edit_owner:false});
function environment(markup=html){
 const ids=Object.fromEntries([...markup.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Element(m[1])]));
 const calls=[];const queue=[];const expired=[];const created=[];const revoked=[];const events={};const photoSignals=[];
 const preparation={width:4000,height:3000,decode:null,closed:[],canvases:[],inputs:[]};
 const createImageBitmap=async file=>{preparation.inputs.push(file);const bitmap={name:file.name,width:preparation.width,height:preparation.height,close(){preparation.closed.push(file.name);}};return preparation.decode?await preparation.decode(file,bitmap):bitmap;};
 const createElement=tag=>{if(tag!=='canvas')return new Element();const canvas={width:0,height:0,getContext(){return{fillRect(){},drawImage(image){canvas.source=image.name;}};},toBlob(done,type){done(new Blob(['prepared '+canvas.source],{type}));}};preparation.canvases.push(canvas);return canvas;};
 class TestURL extends URL {static createObjectURL(){const value=`blob:https://jwhitedidit.net/${randomUUID()}`;created.push(value);return value;}static revokeObjectURL(value){revoked.push(value);}}
 const fetch=async(path,options)=>{calls.push({path,options});const result=queue.shift();if(!result)throw Error('Missing test response');return await result;};
 const enqueue=(data,status=200)=>queue.push(Promise.resolve({ok:status>=200&&status<300,status,json:async()=>data}));
 const enqueuePhoto=(blob,status=200)=>queue.push(Promise.resolve({ok:status>=200&&status<300,status,blob:async()=>blob}));
 const deferPhoto=()=>{let finish;queue.push(new Promise(resolve=>{finish=blob=>resolve({ok:true,status:200,blob:async()=>blob});}));return finish;};
 const defer=()=>{let finish;queue.push(new Promise(resolve=>{finish=(data,status=200)=>resolve({ok:status>=200&&status<300,status,json:async()=>data});}));return finish;};
 const context=vm.createContext({TOP_EIGHT,readTopEightOrder,photoSignals,createImageBitmap,DOMException,Blob,document:{getElementById:id=>ids[id],createElement},window:{location:{origin:'https://jwhitedidit.net'},addEventListener:(name,fn)=>{events[name]=fn;}},fetch,URL:TestURL,FormData,File,AbortController,setTimeout,clearTimeout,crypto:{randomUUID},onSessionExpired:()=>expired.push(true)});
 vm.runInContext(source+'\nthis.controller=createMemberProfileEditor({onSessionExpired});',context);
 return {ids,calls,expired,created,revoked,events,preparation,photoSignals,enqueue,enqueuePhoto,deferPhoto,defer,controller:context.controller};
}

test('own profile uses confirmed service response and never submits another member ID',async()=>{
 const e=environment();e.enqueue({...own({photo_url:'/profile.jpg',verified_owner:true}),can_edit_owner:true});e.controller.setUser(member);await tick();
 assert.equal(e.ids['member-profile-status-text'].textContent,'MORE!');
 assert.equal(e.ids['member-profile-link'].href,'/#home');
 assert.equal(e.ids['member-profile-owner-note'].textContent,'This updates your main profile.');
 assert.equal(e.ids['member-profile-verified'].hidden,false);
 assert.equal(e.ids['member-profile-verified'].className,'official-gold-badge');
 const finish=e.defer();e.ids['member-profile-status'].value='Back in the studio.';e.ids['member-profile-form'].submit();
 assert.equal(e.ids['member-profile-status-text'].textContent,'MORE!','public saved state does not change before approval');
 const request=e.calls.at(-1);assert.equal(request.path,'/api/profile/update');assert.equal(request.options.credentials,'same-origin');
 assert.equal(request.options.body.get('status'),'Back in the studio.');assert.equal(request.options.body.has('id'),false);assert.equal(request.options.body.has('user_id'),false);assert.equal(request.options.body.has('photo'),false);
 finish({...own({status:'Back in the studio.'}),can_edit_owner:true});await tick();
 assert.equal(e.ids['member-profile-status-text'].textContent,'Back in the studio.');
 assert.match(e.ids['member-profile-feedback'].textContent,/Profile saved/);e.controller.setUser(null);
});

test('held and rejected updates leave approved profile alone and preserve draft',async()=>{
 const e=environment();e.enqueue(own());e.controller.setUser(member);await tick();
 e.ids['member-profile-status'].value='A draft status';e.enqueue({status:'pending'},202);e.ids['member-profile-form'].submit();await tick();
 assert.equal(e.ids['member-profile-status-text'].textContent,'MORE!');assert.equal(e.ids['member-profile-status'].value,'A draft status');
 assert.match(e.ids['member-profile-feedback'].textContent,/could not be reviewed yet/);
 e.enqueue({status:'rejected'},422);e.ids['member-profile-form'].submit();await tick();
 assert.equal(e.ids['member-profile-status-text'].textContent,'MORE!');assert.equal(e.ids['member-profile-status'].value,'A draft status');
 assert.match(e.ids['member-profile-feedback'].textContent,/not approved/);e.controller.setUser(null);
});

test('upload limits and replacement/logout revoke every local preview URL',async()=>{
 const e=environment();e.enqueue(own());e.controller.setUser(member);await tick();const upload=e.ids['member-profile-upload'];
 upload.files=[new File(['<svg/>'],'unsafe.svg',{type:'image/svg+xml'})];upload.change();await tick();assert.equal(e.created.length,0);
 upload.files=[new File([new Uint8Array(20*1024*1024+1)],'big.png',{type:'image/png'})];upload.change();await tick();assert.equal(e.created.length,0);
 upload.files=[new File(['png bytes'],'first.png',{type:'image/png'})];upload.change();await tick();assert.equal(e.created.length,1);assert.equal(e.ids['member-profile-preview-wrap'].hidden,false);
 upload.files=[new File(['jpg bytes'],'second.jpg',{type:'image/jpeg'})];upload.change();await tick();assert.equal(e.created.length,2);assert.equal(e.revoked[0],e.created[0]);
 e.controller.setUser(null);assert.equal(e.revoked[1],e.created[1]);assert.equal(e.ids['member-profile-preview'].src,'');assert.equal(upload.value,'');
});

test('large supported phone photos prepare locally and stay drafts until Save Profile',async()=>{
 const e=environment();e.enqueue(own({status:'In the studio',photo_url:'/profile.jpg',about_me:'My current bio'}));e.controller.setUser(member);await tick();
 const input=new File([new Uint8Array(6*1024*1024),'camera location metadata'],'camera-roll.jpg',{type:'image/jpeg'});e.ids['member-profile-upload'].files=[input];e.ids['member-profile-upload'].change();
 assert.equal(e.ids['member-profile-save'].disabled,true);assert.match(e.ids['member-profile-feedback'].textContent,/Getting your picture ready/);e.ids['member-profile-form'].submit();assert.equal(e.calls.filter(call=>call.path==='/api/profile/update').length,0);
 await tick();assert.equal(e.preparation.canvases[0].width,1600);assert.equal(e.preparation.canvases[0].height,1200);assert.equal(e.ids['member-profile-save'].disabled,false);assert.equal(e.ids['member-profile-photo'].src,'https://jwhitedidit.net/profile.jpg');assert.equal(e.ids['member-profile-status'].value,'In the studio');assert.equal(e.ids['member-profile-about'].value,'My current bio');assert.equal(e.calls.filter(call=>call.path==='/api/profile/update').length,0);
 e.enqueue(own({status:'In the studio',photo_url:'/api/profile-photo/new',about_me:'My current bio'}));e.ids['member-profile-form'].submit();await tick();const outgoing=e.calls.at(-1).options.body.get('photo');assert.equal(outgoing.name,'profile-photo.jpg');assert.equal(outgoing.type,'image/jpeg');assert.ok(outgoing.size<3*1024*1024);assert.equal(await outgoing.text(),'prepared camera-roll.jpg');assert.equal(e.calls.at(-1).options.body.get('about_me'),'My current bio');e.controller.setUser(null);
});

test('latest device photo wins and closes an older decoder before it can restore a preview',async()=>{
 const e=environment();e.enqueue(own());e.controller.setUser(member);await tick();const pending=new Map();e.preparation.decode=(file,bitmap)=>new Promise(resolve=>pending.set(file.name,()=>resolve(bitmap)));
 const upload=e.ids['member-profile-upload'];upload.files=[new File(['first'],'first.jpg',{type:'image/jpeg'})];upload.change();const firstSignal=e.photoSignals[0];upload.files=[new File(['second'],'second.png',{type:'image/png'})];upload.change();assert.equal(firstSignal.aborted,true);
 pending.get('second.png')();await tick();pending.get('first.jpg')();await tick();assert.equal(e.created.length,1);assert.deepEqual(e.preparation.closed,['second.png','first.jpg']);e.enqueue(own({photo_url:'/api/profile-photo/new'}));e.ids['member-profile-form'].submit();await tick();assert.equal(await e.calls.at(-1).options.body.get('photo').text(),'prepared second.png');e.controller.setUser(null);
});

test('switching accounts cancels device preparation and never reveals the old selection',async()=>{
 const e=environment();e.enqueue(own({photo_url:'/profile.jpg'}));e.controller.setUser(member);await tick();let finish;e.preparation.decode=(file,bitmap)=>new Promise(resolve=>{finish=()=>resolve(bitmap);});e.ids['member-profile-upload'].files=[new File(['private pixels'],'my-photo.jpg',{type:'image/jpeg'})];e.ids['member-profile-upload'].change();
 const second={id:'22222222-2222-4222-8222-222222222222',confirmedAt:member.confirmedAt};e.enqueue(own({id:second.id,name:'New Member',status:'New status'}));e.controller.setUser(second);assert.equal(e.photoSignals[0].aborted,true);await tick();finish();await tick();assert.equal(e.created.length,0);assert.equal(e.ids['member-profile-name'].textContent,'New Member');assert.equal(e.ids['member-profile-preview-wrap'].hidden,true);assert.equal(e.ids['member-profile-status'].value,'New status');assert.equal(e.ids['member-profile-feedback'].textContent,'');e.controller.setUser(null);
});

test('owner presets can replace a preparing device photo without changing the saved profile',async()=>{
 const e=environment();e.enqueue({...own({photo_url:'/profile.jpg'}),can_edit_owner:true});e.controller.setUser(member);await tick();let finish;e.preparation.decode=(file,bitmap)=>new Promise(resolve=>{finish=()=>resolve(bitmap);});e.ids['member-profile-upload'].files=[new File(['device pixels'],'device.jpg',{type:'image/jpeg'})];e.ids['member-profile-upload'].change();
 e.enqueuePhoto(new Blob(['preset pixels'],{type:'image/jpeg'}));e.ids['member-profile-photo-grid'].children[0].click();assert.equal(e.photoSignals[0].aborted,true);await tick();finish();await tick();assert.equal(e.created.length,0);assert.equal(e.ids['member-profile-photo-grid'].children[0].attrs['aria-pressed'],'true');assert.equal(e.ids['member-profile-photo'].src,'https://jwhitedidit.net/profile.jpg');e.enqueue({...own({photo_url:'/api/profile-photo/preset'}),can_edit_owner:true});e.ids['member-profile-form'].submit();await tick();assert.equal(e.calls.at(-1).options.body.get('photo').name,'back-in-the-day.jpg');e.controller.setUser(null);
});

test('unsupported HEIC and failed image decoding leave the current picture intact',async()=>{
 const e=environment();e.enqueue(own({photo_url:'/profile.jpg'}));e.controller.setUser(member);await tick();const upload=e.ids['member-profile-upload'];upload.files=[new File(['heic bytes'],'phone.heic',{type:'image/heic'})];upload.change();await tick();assert.match(e.ids['member-profile-feedback'].textContent,/HEIC.*compatible copy/);assert.equal(e.preparation.inputs.length,0);assert.equal(e.ids['member-profile-photo'].src,'https://jwhitedidit.net/profile.jpg');
 e.preparation.decode=async()=>{throw Error('decode failed');};upload.files=[new File(['bad bytes'],'broken.jpg',{type:'image/jpeg'})];upload.change();await tick();assert.match(e.ids['member-profile-feedback'].textContent,/could not open/);assert.equal(e.created.length,0);assert.equal(e.ids['member-profile-save'].disabled,false);assert.equal(e.ids['member-profile-preview-wrap'].hidden,true);assert.equal(e.calls.filter(call=>call.path==='/api/profile/update').length,0);e.controller.setUser(null);
});

test('network failure retains draft and request ID for a safe retry',async()=>{
 const e=environment();e.enqueue(own());e.controller.setUser(member);await tick();e.ids['member-profile-status'].value='More records coming.';
 e.enqueue({error:'Temporary failure'},503);e.ids['member-profile-form'].submit();await tick();const id=e.calls.at(-1).options.body.get('request_id');
 assert.equal(e.ids['member-profile-status-text'].textContent,'MORE!');assert.equal(e.ids['member-profile-status'].value,'More records coming.');
 e.enqueue(own({status:'More records coming.'}));e.ids['member-profile-form'].submit();await tick();
 assert.equal(e.calls.at(-1).options.body.get('request_id'),id);e.controller.setUser(null);
});

test('late read and save cannot restore an editor after logout',async()=>{
 const e=environment();let finish=e.defer();e.controller.setUser(member);e.controller.setUser(null);finish(own());await tick();
 assert.equal(e.ids['member-profile-panel'].hidden,true);assert.equal(e.ids['member-profile-name'].textContent,'');
 e.enqueue(own());e.controller.setUser(member);await tick();finish=e.defer();e.ids['member-profile-status'].value='Private draft';e.ids['member-profile-form'].submit();e.controller.setUser(null);finish(own({status:'Private draft'}));await tick();
 assert.equal(e.ids['member-profile-panel'].hidden,true);assert.equal(e.ids['member-profile-status'].value,'');assert.equal(e.ids['member-profile-feedback'].textContent,'');
});

test('Edit Profile intent waits for own profile, enables focus once and ignores ordinary refresh',async()=>{
 const e=environment();const finish=e.defer();e.controller.setUser(member);e.controller.requestEdit();
 assert.notEqual(e.ids['member-profile-editor'].open,true);assert.equal(e.ids['member-profile-status'].focusCount,undefined);
 finish(own());await tick();
 assert.equal(e.ids['member-profile-editor'].open,true);assert.equal(e.ids['member-profile-status'].disabled,false);assert.equal(e.ids['member-profile-status'].focusCount,1);assert.equal(e.ids['member-profile-status'].scrollCount,1);
 e.enqueue(own());e.ids['member-profile-refresh'].click();await tick();assert.equal(e.ids['member-profile-status'].focusCount,1,'refresh cannot steal focus after intent was consumed');e.controller.setUser(null);
});

test('logout cancels a pending Edit Profile request before a stale profile response arrives',async()=>{
 const e=environment();const finish=e.defer();e.controller.setUser(member);e.controller.requestEdit();e.controller.setUser(null);finish(own());await tick();
 assert.equal(e.ids['member-profile-editor'].open,false);assert.equal(e.ids['member-profile-status'].focusCount,undefined);
 e.enqueue(own());e.controller.setUser(member);await tick();assert.equal(e.ids['member-profile-status'].focusCount,undefined,'a later login does not revive the discarded request');e.controller.setUser(null);
});

test('expired auth clears data and foreign profile IDs are never rendered',async()=>{
 const e=environment();e.enqueue(own({id:'other-member'}));e.controller.setUser(member);await tick();
 assert.equal(e.ids['member-profile-current'].hidden,true);assert.equal(e.ids['member-profile-save'].disabled,true);
 e.enqueue(own());e.ids['member-profile-refresh'].click();await tick();
 e.enqueue({error:'Unauthorized'},401);e.ids['member-profile-refresh'].click();await tick();
 assert.equal(e.ids['member-profile-panel'].hidden,true);assert.equal(e.expired.length,1);
});

test('member verified checks require server verification and never become gold by name',async()=>{
 const e=environment();e.enqueue(own({name:'J.White Did It',verified:true,verified_owner:false}));e.controller.setUser(member);await tick();
 assert.equal(e.ids['member-profile-verified'].hidden,false);assert.equal(e.ids['member-profile-verified'].className,'member-verified-badge');
 e.enqueue(own({name:'J.White Did It',verified:false,verified_owner:false}));e.ids['member-profile-refresh'].click();await tick();assert.equal(e.ids['member-profile-verified'].hidden,true);e.controller.setUser(null);
});

test('public profile validates its ID and sends the member session so invite-only lookups resolve',async()=>{
 const publicSource=fs.readFileSync(new URL('../profile.js',import.meta.url),'utf8');
 async function run(id,aboutMe='<script>not executable</script>',reply=null){
  const ids=Object.fromEntries(['public-profile-status','public-profile-retry','public-profile','public-profile-sign-in','public-profile-photo','public-profile-name','public-profile-tagline','public-profile-initial','public-profile-verified','public-profile-about-section','public-profile-about'].map(id=>[id,new Element(id)]));
  const calls=[];const document={getElementById:id=>ids[id],title:''};
  vm.runInNewContext(publicSource,{document,window:{location:{search:`?id=${encodeURIComponent(id)}`,origin:'https://jwhitedidit.net'}},URL,URLSearchParams,AbortController,setTimeout,clearTimeout,fetch:async(path,options)=>{calls.push({path,options});if(reply)return {ok:false,status:reply.status,json:async()=>reply.body};return {ok:true,status:200,json:async()=>own({name:'<b>Member</b>',about_me:aboutMe,photo_url:'javascript:alert(1)'})};}});await tick();return {ids,calls,document};
 }
 const invalid=await run('../private');assert.equal(invalid.calls.length,0);
 const valid=await run(member.id);assert.equal(valid.calls[0].options.credentials,'same-origin');assert.equal(valid.ids['public-profile-sign-in'].hidden,true);assert.equal(valid.ids['public-profile-name'].textContent,'<b>Member</b>');assert.equal(valid.ids['public-profile-photo'].hidden,true);assert.equal(valid.ids['public-profile-verified'].hidden,true);assert.equal(valid.ids['public-profile-about'].textContent,'<script>not executable</script>');assert.equal(valid.ids['public-profile-about-section'].hidden,false);assert.equal(valid.ids['public-profile'].hidden,false);
 const empty=await run(member.id,'');assert.equal(empty.ids['public-profile-about'].textContent,"This page hasn't added a bio yet.");assert.equal(empty.ids['public-profile-about-section'].hidden,false);assert.equal(empty.ids['public-profile'].hidden,false);
});

test('a gated profile lookup explains the invite-only door instead of offering a pointless retry',async()=>{
 const publicSource=fs.readFileSync(new URL('../profile.js',import.meta.url),'utf8');
 async function run(reply){
  const ids=Object.fromEntries(['public-profile-status','public-profile-retry','public-profile','public-profile-sign-in','public-profile-photo','public-profile-name','public-profile-tagline','public-profile-initial','public-profile-verified','public-profile-about-section','public-profile-about'].map(id=>[id,new Element(id)]));
  const document={getElementById:id=>ids[id],title:''};
  vm.runInNewContext(publicSource,{document,window:{location:{search:`?id=${member.id}`,origin:'https://jwhitedidit.net'}},URL,URLSearchParams,AbortController,setTimeout,clearTimeout,fetch:async()=>({ok:false,status:reply.status,json:async()=>reply.body})});await tick();return ids;
 }
 const anonymous=await run({status:401,body:{error:'Please log in to open your messages.'}});
 assert.match(anonymous['public-profile-status'].textContent,/Log in with your approved ROOSTER account/);
 assert.equal(anonymous['public-profile-sign-in'].hidden,false,'a signed out visitor needs a way in');
 assert.equal(anonymous['public-profile-retry'].hidden,true,'retrying cannot pass the door');
 const pending=await run({status:403,body:{error:'Your request to join ROOSTER is waiting on approval.'}});
 assert.equal(pending['public-profile-status'].textContent,'Your request to join ROOSTER is waiting on approval.');
 assert.equal(pending['public-profile-sign-in'].hidden,false);assert.equal(pending['public-profile-retry'].hidden,true);
 const broken=await run({status:500,body:{}});
 assert.match(broken['public-profile-status'].textContent,/try again/i);
 assert.equal(broken['public-profile-retry'].hidden,false,'a real outage is worth retrying');
 assert.equal(broken['public-profile-sign-in'].hidden,true);
});

test('no profile client drops the session cookie on an invite-only lookup',async()=>{
 // Every entry point into a member page — Top Rosters, search, chat, messages,
 // roster/friends, comments, profile pictures — lands on profile.html and its
 // sections, so /api/profile has to be called with the session from all of
 // them. A single credentials:'omit' here reads to a signed in member as
 // "this profile couldn't load".
 for(const name of ['profile.js','profile-songs.js','profile-album.js','friend-widget.js','profile-owner.js']){
  const source=fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
  for(const line of source.split('\n')){
   if(!line.includes('/api/profile?id=')||line.includes('id=owner'))continue;
   assert.ok(!line.includes("credentials:'omit'")&&!line.includes("credentials: 'omit'"),`${name} must send the member session to /api/profile`);
  }
  const omitted=[...source.matchAll(/credentials:\s*'omit'/g)];
  if(omitted.length)assert.ok(!source.includes("'/api/profile?id='"),`${name} mixes an anonymous fetch with a gated profile lookup`);
 }
 assert.match(fs.readFileSync(new URL('../profile.js',import.meta.url),'utf8'),/credentials:'same-origin'/);
 assert.match(fs.readFileSync(new URL('../profile-songs.js',import.meta.url),'utf8'),/credentials:'same-origin'/);
});


test('owner can choose an existing photo, preserve status and save through the authenticated upload API',async()=>{
 const e=environment();e.enqueue({...own({status:'MORE HITS',photo_url:'/profile.jpg'}),can_edit_owner:true});e.controller.setUser(member);await tick();
 const grid=e.ids['member-profile-photo-grid'];assert.equal(grid.children.length,16);assert.equal(e.ids['member-profile-library'].hidden,false);
 const finish=e.deferPhoto();grid.children[0].click();assert.equal(e.ids['member-profile-save'].disabled,true);
 e.ids['member-profile-form'].submit();assert.equal(e.calls.filter(c=>c.path==='/api/profile/update').length,0);
 assert.equal(e.ids['member-profile-photo'].src,'https://jwhitedidit.net/profile.jpg');
 finish(new Blob(['image bytes'],{type:'image/jpeg'}));await tick();
 assert.equal(e.ids['member-profile-save'].disabled,false);assert.equal(grid.children[0].attrs['aria-pressed'],'true');
 assert.equal(e.ids['member-profile-status'].value,'MORE HITS');
 e.enqueue({...own({status:'MORE HITS',photo_url:'/api/profile-photo/saved'}),can_edit_owner:true});e.ids['member-profile-form'].submit();await tick();
 const request=e.calls.find(c=>c.path==='/api/profile/update');assert.equal(request.options.credentials,'same-origin');assert.equal(request.options.body.get('photo').name,'back-in-the-day.jpg');assert.equal(request.options.body.get('status'),'MORE HITS');
 assert.equal(e.ids['member-profile-photo'].src,'https://jwhitedidit.net/api/profile-photo/saved');assert.equal(grid.children.length,17);e.controller.setUser(null);
});

test('latest photo selection wins and logout aborts an unfinished picture download',async()=>{
 const e=environment();e.enqueue({...own({photo_url:'/profile.jpg'}),can_edit_owner:true});e.controller.setUser(member);await tick();
 const grid=e.ids['member-profile-photo-grid'];const first=e.deferPhoto();grid.children[0].click();const firstRequest=e.calls.at(-1);
 const second=e.deferPhoto();grid.children[1].click();assert.equal(firstRequest.options.signal.aborted,true);
 second(new Blob(['second'],{type:'image/jpeg'}));await tick();first(new Blob(['first'],{type:'image/jpeg'}));await tick();
 assert.equal(grid.children[1].attrs['aria-pressed'],'true');assert.equal(grid.children[0].attrs['aria-pressed'],'false');
 e.enqueue({...own({photo_url:'/api/profile-photo/second'}),can_edit_owner:true});e.ids['member-profile-form'].submit();await tick();assert.equal(e.calls.at(-1).options.body.get('photo').name,'freelanze.jpg');
 const late=e.deferPhoto();grid.children[2].click();const pending=e.calls.at(-1);e.controller.setUser(null);assert.equal(pending.options.signal.aborted,true);late(new Blob(['late'],{type:'image/jpeg'}));await tick();
 assert.equal(e.ids['member-profile-panel'].hidden,true);assert.equal(e.ids['member-profile-preview'].src,'');assert.equal(e.ids['member-profile-save'].disabled,true);assert.equal(grid.children.length,0);
});

test('failed or cancelled photo selection keeps the current picture and ordinary members have no owner picker',async()=>{
 const e=environment();e.enqueue(own());e.controller.setUser(member);await tick();assert.equal(e.ids['member-profile-library'].hidden,true);assert.equal(e.ids['member-profile-photo-grid'].children.length,0);e.controller.setUser(null);
 e.enqueue({...own({status:'MORE HITS',photo_url:'/profile.jpg'}),can_edit_owner:true});e.controller.setUser(member);await tick();
 e.enqueuePhoto(new Blob(['error'],{type:'text/html'}));e.ids['member-profile-photo-grid'].children[0].click();await tick();
 assert.equal(e.ids['member-profile-photo'].src,'https://jwhitedidit.net/profile.jpg');assert.equal(e.ids['member-profile-preview-wrap'].hidden,true);assert.equal(e.ids['member-profile-save'].disabled,false);
 const late=e.deferPhoto();e.ids['member-profile-photo-grid'].children[1].click();e.ids['member-profile-remove-upload'].click();late(new Blob(['image'],{type:'image/jpeg'}));await tick();
 assert.equal(e.ids['member-profile-preview-wrap'].hidden,true);assert.equal(e.ids['member-profile-status'].value,'MORE HITS');
 e.enqueue({...own({status:'MORE HITS',photo_url:'/profile.jpg'}),can_edit_owner:true});e.ids['member-profile-form'].submit();await tick();assert.equal(e.calls.at(-1).options.body.has('photo'),false);e.controller.setUser(null);
});

test('About Me is a draft until approved and saves with status through the authenticated API',async()=>{
 const e=environment();e.enqueue(own({about_me:'The approved bio.'}));e.controller.setUser(member);await tick();
 const about=e.ids['member-profile-about'];assert.equal(about.value,'The approved bio.');assert.equal(about.disabled,false);
 about.value='  A new bio about making music.  ';about.input();
 const finish=e.defer();e.ids['member-profile-form'].submit();
 const request=e.calls.at(-1);assert.equal(request.path,'/api/profile/update');assert.equal(request.options.body.get('about_me'),'A new bio about making music.');assert.equal(request.options.body.get('status'),'MORE!');assert.equal(request.options.credentials,'same-origin');
 assert.equal(about.disabled,true);finish(own({about_me:'A new bio about making music.'}));await tick();
 assert.equal(about.value,'A new bio about making music.');assert.equal(about.disabled,false);assert.match(e.ids['member-profile-feedback'].textContent,/Profile saved/);
 about.value='';about.input();e.enqueue(own({about_me:''}));e.ids['member-profile-form'].submit();await tick();
 assert.equal(e.calls.at(-1).options.body.has('about_me'),true);assert.equal(e.calls.at(-1).options.body.get('about_me'),'');e.controller.setUser(null);
});

test('simple, confident and creative bio helpers create editable drafts without publishing',async()=>{
 const e=environment();const helper=e.ids['member-profile-help-bio'];const about=e.ids['member-profile-about'];e.controller.setUser(null);
 assert.equal(helper.disabled,true);helper.click();assert.equal(about.value,'');
 e.enqueue(own({about_me:'My original bio.'}));e.controller.setUser(member);await tick();
 e.ids['member-profile-status'].value='Building my next record.';
 const drafts=[];const requests=e.calls.length;
 for(const style of ['simple','confident','creative']){
  e.ids['member-profile-bio-style'].value=style;helper.click();drafts.push(about.value);
  assert.match(about.value,/Ari/);assert.match(about.value,/Building my next record\./);assert.ok(about.value.length>20&&about.value.length<=600);assert.match(e.ids['member-profile-bio-help-status'].textContent,/Draft added/);
 }
 assert.equal(new Set(drafts).size,3);assert.equal(e.calls.length,requests);assert.equal(e.ids['member-profile-status'].value,'Building my next record.');
 about.value='My own words.';about.input();assert.equal(e.ids['member-profile-bio-help-status'].textContent,'');
 e.controller.setUser(null);assert.equal(about.value,'');assert.equal(about.disabled,true);assert.equal(helper.disabled,true);helper.click();assert.equal(about.value,'');
});

test('bio size validation, held drafts and changed-payload retries preserve the member edits',async()=>{
 const e=environment();e.enqueue(own({about_me:'Approved.'}));e.controller.setUser(member);await tick();const about=e.ids['member-profile-about'];
 about.value='x'.repeat(601);e.ids['member-profile-form'].submit();await tick();assert.equal(e.calls.length,1);assert.match(e.ids['member-profile-feedback'].textContent,/600/);
 about.value='My draft bio.';about.input();e.enqueue({status:'pending'},202);e.ids['member-profile-form'].submit();await tick();assert.equal(about.value,'My draft bio.');assert.match(e.ids['member-profile-feedback'].textContent,/could not be reviewed/);
 e.enqueue({error:'Temporary failure'},503);e.ids['member-profile-form'].submit();await tick();const originalId=e.calls.at(-1).options.body.get('request_id');
 e.enqueue({error:'Temporary failure'},503);e.ids['member-profile-form'].submit();await tick();assert.equal(e.calls.at(-1).options.body.get('request_id'),originalId);
 about.value='A changed draft.';about.input();e.enqueue({status:'rejected'},422);e.ids['member-profile-form'].submit();await tick();assert.notEqual(e.calls.at(-1).options.body.get('request_id'),originalId);assert.equal(e.calls.at(-1).options.body.get('about_me'),'A changed draft.');assert.equal(about.value,'A changed draft.');assert.match(e.ids['member-profile-feedback'].textContent,/not approved/);
 e.controller.setUser(null);
});

test('owner editor without About Me controls can still save a picture or status without clearing a saved bio',async()=>{
 const legacyOwnerHtml=ownerHtml.replace(/<label for="member-profile-about">[\s\S]*?<\/label>/,'');
 const e=environment(legacyOwnerHtml);assert.equal(e.ids['member-profile-about'],undefined);
 e.enqueue({...own({status:'MORE HITS',about_me:'Existing owner biography.',photo_url:'/profile.jpg'}),can_edit_owner:true});e.controller.setUser(member);await tick();
 assert.equal(e.ids['member-profile-save'].disabled,false);assert.equal(e.ids['member-profile-status'].value,'MORE HITS');
 e.ids['member-profile-status'].value='Studio time.';e.enqueue({...own({status:'Studio time.',about_me:'Existing owner biography.',photo_url:'/profile.jpg'}),can_edit_owner:true});e.ids['member-profile-form'].submit();await tick();
 const request=e.calls.at(-1);assert.equal(request.path,'/api/profile/update');assert.equal(request.options.body.get('status'),'Studio time.');assert.equal(request.options.body.has('about_me'),false);assert.match(e.ids['member-profile-feedback'].textContent,/Profile saved/);e.controller.setUser(null);
});

test('owner About Me editor loads and saves a custom bio with the current status and photo intact',async()=>{
 const e=environment(ownerHtml);
 e.enqueue({...own({status:'Looking for you',about_me:'Existing owner biography.',photo_url:'/profile.jpg'}),can_edit_owner:true});e.controller.setUser(member);await tick();
 assert.equal(e.ids['member-profile-about'].value,'Existing owner biography.');assert.equal(e.ids['member-profile-about'].disabled,false);
 e.ids['member-profile-about'].value='New records. New stories. MORE!';e.ids['member-profile-about'].input();
 e.enqueue({...own({status:'Looking for you',about_me:'New records. New stories. MORE!',photo_url:'/profile.jpg'}),can_edit_owner:true});e.ids['member-profile-form'].submit();await tick();
 const request=e.calls.at(-1);assert.equal(request.path,'/api/profile/update');assert.equal(request.options.body.get('about_me'),'New records. New stories. MORE!');assert.equal(request.options.body.get('status'),'Looking for you');assert.equal(request.options.body.has('photo'),false);e.controller.setUser(null);
});

test('owner Top8 moves all eight existing records and saves only through authenticated Save Profile',async()=>{
 const e=environment(ownerHtml);const original=TOP_EIGHT.map(track=>track.id);
 e.enqueue({...own({top_eight_order:original}),can_edit_owner:true});e.controller.setUser(member);await tick();
 const host=e.ids['owner-top-eight-editor'];assert.equal(host.hidden,false);
 const list=host.children[2];assert.equal(list.children.length,8);
 assert.equal(list.children[0].children[2].children[0].disabled,true);
 const down=list.children[0].children[2].children[1];assert.equal(down.disabled,false);down.click();
 const expected=[original[1],original[0],...original.slice(2)];
 assert.equal(list.children[1].children[1].children[0].textContent,'Spend Dat');
 assert.equal(e.calls.filter(call=>call.path==='/api/profile/update').length,0);
 e.enqueue({...own({top_eight_order:expected}),can_edit_owner:true});e.ids['member-profile-form'].submit();await tick();
 const request=e.calls.at(-1);assert.deepEqual(JSON.parse(request.options.body.get('top_eight_order')),expected);assert.equal(request.options.credentials,'same-origin');
 assert.equal(host.children[2].children.length,8);e.controller.setUser(null);assert.equal(host.hidden,true);assert.equal(host.children[2].children.length,0);
});

test('owner details save with About Me, Top8 order and a prepared photo in one explicit update',async()=>{
 const e=environment(ownerHtml);const original=TOP_EIGHT.map(track=>track.id);const initial={status:'MORE HITS',about_me:'My biography',title_lines:'Producer\nMusic executive',credentials:'Grammy winner',location:'Dallas, Texas',photo_url:'/profile.jpg',top_eight_order:original};
 e.enqueue({...own(initial),can_edit_owner:true});e.controller.setUser(member);await tick();
 assert.equal(e.ids['owner-profile-details'].hidden,false);assert.equal(e.ids['member-profile-title-lines'].disabled,false);assert.equal(e.ids['member-profile-title-lines'].value,initial.title_lines);assert.equal(e.ids['member-profile-credentials'].value,initial.credentials);assert.equal(e.ids['member-profile-location'].value,initial.location);
 e.ids['member-profile-title-lines'].value='  Producer\r\nRecord maker  ';e.ids['member-profile-credentials'].value='  Grammy winner\r\nMore hits  ';e.ids['member-profile-location'].value='  Dallas, Texas  ';
 e.ids['owner-top-eight-editor'].children[2].children[0].children[2].children[1].click();const order=[original[1],original[0],...original.slice(2)];
 e.ids['member-profile-upload'].files=[new File([new Uint8Array(4*1024*1024)],'new-photo.jpg',{type:'image/jpeg'})];e.ids['member-profile-upload'].change();await tick();assert.equal(e.calls.filter(call=>call.path==='/api/profile/update').length,0);
 e.enqueue({...own({...initial,title_lines:'Producer\nRecord maker',credentials:'Grammy winner\nMore hits',top_eight_order:order,photo_url:'/api/profile-photo/new'}),can_edit_owner:true});e.ids['member-profile-form'].submit();await tick();const body=e.calls.at(-1).options.body;
 assert.equal(body.get('title_lines'),'Producer\nRecord maker');assert.equal(body.get('credentials'),'Grammy winner\nMore hits');assert.equal(body.get('location'),'Dallas, Texas');assert.equal(body.get('about_me'),'My biography');assert.equal(body.get('status'),'MORE HITS');assert.deepEqual(JSON.parse(body.get('top_eight_order')),order);assert.equal(body.get('photo').type,'image/jpeg');assert.equal(await body.get('photo').text(),'prepared new-photo.jpg');assert.equal(e.ids['member-profile-title-lines'].value,'Producer\nRecord maker');
 e.controller.setUser(null);for(const id of ['member-profile-title-lines','member-profile-credentials','member-profile-location']){assert.equal(e.ids[id].value,'');assert.equal(e.ids[id].disabled,true);}assert.equal(e.ids['owner-profile-details'].hidden,true);
});

test('missing optional owner detail controls omit fields rather than clearing saved values',async()=>{
 const legacy=ownerHtml.replaceAll('id="member-profile-title-lines"','id="legacy-title"').replaceAll('id="member-profile-credentials"','id="legacy-credits"').replaceAll('id="member-profile-location"','id="legacy-location"');const e=environment(legacy);
 const details={title_lines:'Producer',credentials:'Grammy winner',location:'Dallas'};e.enqueue({...own(details),can_edit_owner:true});e.controller.setUser(member);await tick();e.enqueue({...own(details),can_edit_owner:true});e.ids['member-profile-form'].submit();await tick();const body=e.calls.at(-1).options.body;for(const field of ['title_lines','credentials','location'])assert.equal(body.has(field),false);e.controller.setUser(null);
});

test('ordinary members can edit their own headline and location without submitting owner credentials or Top 8',async()=>{
 const e=environment();e.enqueue(own({title_lines:'Speaker'}));e.controller.setUser(member);await tick();
 assert.equal(e.ids['member-profile-title-lines'].disabled,false);assert.equal(e.ids['member-profile-title-lines'].value,'Speaker');assert.equal(e.ids['member-profile-title-lines'].maxLength,100);
 e.ids['member-profile-title-lines'].value='Speaker · Church elder · Logistics';e.ids['member-profile-location'].value='Dallas, Texas';
 e.enqueue(own({title_lines:'Speaker · Church elder · Logistics',location:'Dallas, Texas'}));e.ids['member-profile-form'].submit();await tick();const body=e.calls.at(-1).options.body;
 assert.equal(body.get('title_lines'),'Speaker · Church elder · Logistics');assert.equal(body.get('location'),'Dallas, Texas');for(const field of ['credentials','top_eight_order'])assert.equal(body.has(field),false);
 e.ids['member-profile-title-lines'].value='x'.repeat(101);const count=e.calls.length;e.ids['member-profile-form'].submit();assert.equal(e.calls.length,count);assert.match(e.ids['member-profile-feedback'].textContent,/100/);e.controller.setUser(null);
});

test('owner detail limits and changed detail retries are part of the immutable save payload',async()=>{
 const e=environment(ownerHtml);e.enqueue({...own({title_lines:'Producer',credentials:'Credits',location:'Dallas'}),can_edit_owner:true});e.controller.setUser(member);await tick();
 for(const [id,limit] of [['member-profile-title-lines',180],['member-profile-credentials',240],['member-profile-location',140]]){const old=e.ids[id].value;e.ids[id].value='x'.repeat(limit+1);e.ids['member-profile-form'].submit();assert.equal(e.calls.length,1);assert.match(e.ids['member-profile-feedback'].textContent,new RegExp(String(limit)));e.ids[id].value=old;}
 e.enqueue({error:'Unavailable'},503);e.ids['member-profile-form'].submit();await tick();const first=e.calls.at(-1).options.body.get('request_id');e.enqueue({error:'Unavailable'},503);e.ids['member-profile-form'].submit();await tick();assert.equal(e.calls.at(-1).options.body.get('request_id'),first);
 e.ids['member-profile-location'].value='Kansas City';e.enqueue({error:'Unavailable'},503);e.ids['member-profile-form'].submit();await tick();assert.notEqual(e.calls.at(-1).options.body.get('request_id'),first);assert.equal(e.calls.at(-1).options.body.get('location'),'Kansas City');e.controller.setUser(null);
});
