import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const source=read('profile.js'), helper=read('profile-profession.js');
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const member={id,name:'Member',status:'Hello',about_me:'My work',profession:'speaker',title_lines:'Speaker · Church elder · Logistics',photo_url:'/profile.jpg',updated_at:'2026-09-11T10:00:00.000Z'};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
class Node {
 constructor(){this.hidden=false;this.dataset={};this.attributes={};this.textContent='';this.listeners={};}
 setAttribute(name,value){this.attributes[name]=String(value);}
 removeAttribute(name){delete this.attributes[name];delete this[name];}
 replaceChildren(...children){this.children=children;}
 addEventListener(name,handler){this.listeners[name]=handler;}
}
function environment(initial=member){
 const nodes=Object.fromEntries([...read('profile.html').matchAll(/\bid="([^"]+)"/g)].map(match=>[match[1],new Node()]));
 const events={},sent=[],calls=[],queue=[];
 const window={location:{search:'?id='+initial.id,origin:'https://jwhitedidit.net'},addEventListener:(name,fn)=>{events[name]=fn;},dispatchEvent:event=>{sent.push(event);events[event.type]?.(event);}};
 const document={title:'',getElementById:id=>nodes[id]||null,createElement:()=>new Node()};
 const reply=(profile,status=200)=>({ok:status===200,status,json:async()=>({profile})});
 const fetch=async(path,options)=>{calls.push({path,options});if(path.startsWith('/api/profile?id='))return reply(initial);return queue.shift()??reply(null,401);};
 const context={window,document,URL,URLSearchParams,AbortController,setTimeout,clearTimeout,fetch,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}}};
 vm.runInNewContext(helper,context);vm.runInNewContext(source,context);
 return {nodes,window,document,sent,calls,events,reply,enqueue:value=>queue.push(value)};
}
test('open-profile saves render the canonical same-account response as literal text without navigation or tab events',async()=>{
 const e=environment();await tick();
 const canonical={...member,name:'<b>My name</b>',status:'New status',title_lines:'Speaker · Logistics',photo_url:'/api/profile-photo/new',website_url:'https://example.com/booking'};
 e.enqueue(e.reply(canonical));
 const result=await e.window.RoosterProfileRenderer.update({...member,name:'Untrusted payload'});
 assert.equal(result,true);assert.equal(e.nodes['public-profile-name'].textContent,'<b>My name</b>');assert.equal(e.nodes['public-profile-tagline'].textContent,'New status');
 assert.equal(e.nodes['public-profile-title-lines'].textContent,'Speaker · Logistics');assert.equal(e.nodes['public-profile-photo'].src,'https://jwhitedidit.net/api/profile-photo/new');
 assert.equal(e.window.JWhitePublicProfile.name,canonical.name);assert.equal(e.window.location.search,'?id='+id);assert.deepEqual(e.sent.map(event=>event.type),['jwhite:profile-ready','jwhite:profile-ready']);
 assert.equal(e.calls.at(-1).path,'/api/profile/me');assert.equal(e.calls.at(-1).options.credentials,'same-origin');assert.equal(e.calls.at(-1).options.cache,'no-store');
 assert.equal(e.nodes['profile-business-message'].textContent,'Speaking inquiry');assert.equal(e.nodes['profile-business-message'].href,`/members.html?to=${id}&name=%3Cb%3EMy%20name%3C%2Fb%3E#member-mail`);
 assert.equal(e.nodes['profile-business-action'].href,'https://example.com/booking');
});
test('another profile, a signed-out response, or malformed server profile cannot replace this page',async()=>{
 const e=environment();await tick();const before=e.window.JWhitePublicProfile;
 assert.equal(await e.window.RoosterProfileRenderer.update({...member,id:other}),false);assert.equal(e.calls.length,1);
 for(const response of [e.reply({...member,id:other}),e.reply(null,401),e.reply({...member,status:null})]){
  e.enqueue(response);assert.equal(await e.window.RoosterProfileRenderer.update({...member,status:'Draft'}),false);assert.equal(e.window.JWhitePublicProfile,before);
 }
 assert.equal(e.nodes['public-profile-tagline'].textContent,'Hello');assert.equal(e.sent.length,1);
});
test('session changes and pagehide discard a delayed saved-profile refresh',async()=>{
 for(const [name,event] of [['jwhite:session-changed',{}],['storage',{key:'gotrue.user'}],['storage',{key:null}],['pagehide',{}]]){
  const e=environment();await tick();let finish;e.enqueue(new Promise(resolve=>{finish=resolve;}));const pending=e.window.RoosterProfileRenderer.update({...member,status:'Saved'});
  const signal=e.calls.at(-1).options.signal;e.events[name](event);assert.equal(signal.aborted,true);
  finish(e.reply({...member,status:'Saved'}));assert.equal(await pending,false);assert.equal(e.nodes['public-profile-tagline'].textContent,'Hello');assert.equal(e.sent.length,1);
 }
});
test('a newer save refresh wins and professional inquiry links never invent bookings or denominations',async()=>{
 const e=environment();await tick();let finish;e.enqueue(new Promise(resolve=>{finish=resolve;}));const old=e.window.RoosterProfileRenderer.update(member);
 e.enqueue(e.reply({...member,status:'Newest approved'}));assert.equal(await e.window.RoosterProfileRenderer.update(member),true);
 finish(e.reply({...member,status:'Older'}));assert.equal(await old,false);assert.equal(e.nodes['public-profile-tagline'].textContent,'Newest approved');
 for(const [profession,inquiry] of [['speaker','Speaking inquiry'],['ministry','Event inquiry'],['logistics','Logistics inquiry']]){
  const page=environment({...member,profession,title_lines:'',website_url:''});await tick();
  assert.equal(page.nodes['profile-business-showcase'].hidden,false);assert.equal(page.nodes['profile-business-message'].textContent,inquiry);assert.equal(page.nodes['profile-business-action'].hidden,true);
  assert.match(page.nodes['profile-business-message'].href,/\/members\.html\?to=.*#member-mail$/);
  assert(!page.nodes['public-profile-title-lines'].textContent.includes('COGIC'));
 }
});

test('MrWilliams showcase works with an old music role and retains canonical photo, bio and inline changes',async()=>{
 const profile={...member,id:'1e1f21a5-3768-407f-8a43-00212eabc764',name:'MrWilliams',profession:'musician',title_lines:'',website_url:''};
 const e=environment(profile);await tick();
 assert.equal(e.nodes['profile-business-showcase'].hidden,false);
 assert.equal(e.nodes['profile-business-showcase'].dataset.businessKind,'speaker');
 assert.equal(e.nodes['profile-business-title'].textContent,'Faith, purpose & life on the road');
 assert.match(e.nodes['profile-business-description'].textContent,/Speaker, COGIC church elder and truck driver/);
 assert.equal(e.nodes['profile-business-message'].textContent,'Speaking & work inquiries');
 assert.equal(e.nodes['profile-business-message'].href,`/members.html?to=${profile.id}&name=MrWilliams#member-mail`);
 assert.equal(e.nodes['profile-business-action'].hidden,true);
 assert.equal(e.nodes['public-profile-about'].textContent,profile.about_me);
 assert.equal(e.nodes['public-profile-photo'].src,'https://jwhitedidit.net/profile.jpg');
 e.enqueue(e.reply({...profile,title_lines:'Speaking and community',status:'Updated here'}));
 assert.equal(await e.window.RoosterProfileRenderer.update(profile),true);
 assert.equal(e.nodes['public-profile-title-lines'].textContent,'Speaking and community');
 assert.equal(e.nodes['public-profile-tagline'].textContent,'Updated here');
 assert.equal(e.window.location.search,'?id='+profile.id);
});
