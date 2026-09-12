import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const helper=read('profile-profession.js'),script=read('profile-experience.js');
const alysa='98ce8da4-4112-4c99-b1a2-d4aaf6027b14';
const other='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function describe(profile){const window={};vm.runInNewContext(helper,{window});return window.RoosterProfileProfession.describe(profile);}
class Node {
 constructor(dataset={}){this.dataset=dataset;this.hidden=false;this.attributes={};this.style={};this.textContent='';this.children={};this.classList={toggle:()=>{}};}
 setAttribute(key,value){this.attributes[key]=String(value);}
 removeAttribute(key){delete this.attributes[key];}
 querySelector(key){return this.children[key]||null;}
 addEventListener(){}
 scrollIntoView(){this.scrolled=(this.scrolled||0)+1;}
 closest(selector){return selector==='[data-profile-tab]'&&this.dataset.profileTab?this:selector==='[data-profile-open-tab]'&&this.dataset.profileOpenTab?this:null;}
}
function environment({member={id:alysa,name:'Alysa',profession:'creator'},viewer=null,view=''}={}){
 const nodes=Object.fromEntries([...read('profile.html').matchAll(/\bid="([^"]+)"/g)].map(match=>[match[1],new Node()]));
 const primary=nodes['profile-primary-tab'];primary.dataset.profileTab='songs';
 const tabs=[new Node({profileTab:'posts'}),primary,new Node({profileTab:'photos'}),new Node({profileTab:'about'})];
 const panels=['posts','songs','photos','about','studio'].map(profilePanel=>new Node({profilePanel}));
 const owner=[new Node(),new Node()],visitors=[new Node()],composer=new Node();composer.children={b:new Node(),span:new Node()};
 const album=new Node(),events={},clicks={},dispatched=[];
 const document={body:{dataset:{}},getElementById:id=>nodes[id]||null,querySelector:selector=>({'[data-profile-create-feature]':composer,'[data-album-grid]':album}[selector]||null),querySelectorAll:selector=>({'[data-profile-owner-only]':owner,'[data-viewed-profile]':visitors,'[data-profile-tab]':tabs,'[data-profile-panel]':panels}[selector]||[]),addEventListener:(name,fn)=>{clicks[name]=fn;}};
 const window={JWhitePublicProfile:member,addEventListener:(name,fn)=>{events[name]=fn;},dispatchEvent:event=>{dispatched.push(event);events[event.type]?.(event);}};
 vm.runInNewContext(helper,{window});
 vm.runInNewContext(script,{window,document,URL,URLSearchParams,location:{search:view?'?view='+view:''},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},MutationObserver:class{observe(){}},fetch:async path=>({ok:true,json:async()=>path==='/api/profile/me'?{profile:viewer}:{rooms:[]}})});
 return {nodes,tabs,panels,owner,visitors,composer,document,dispatched,album,ready:member=>events['jwhite:profile-ready']({detail:member}),click:node=>clicks.click({target:node})};
}
test('Alysa account has hair specialist/influencer identity even before a profession edit; copying the name cannot claim it',()=>{
 const real=describe({id:alysa,profession:'musician',name:'New display name'});assert.equal(real.label,'Influencer · Hair Specialist');assert.equal(real.kind,'beauty');assert.equal(real.music,false);
 const copy=describe({id:other,name:'alysa.jordann',profession:'creator'});assert.equal(copy.alysa,false);assert.equal(copy.kind,'creator');
});
test('all music professions and the verified catalog owner retain Profile Music',()=>{
 for(const profession of ['musician','producer','songwriter','engineer','a_and_r','dj'])assert.equal(describe({id:other,profession}).music,true);
 assert.equal(describe({id:other,verified_owner:true}).music,true);
 for(const profession of ['barber','hairstylist','beauty_products','creator','journalist','podcaster','photographer','designer','model','business','other'])assert.equal(describe({id:other,profession}).music,false);
 assert.equal(describe({id:other,name:'Crispbyjmalone'}).kind,'service');assert.equal(describe({id:other,name:'Reallyfe Jeffn'}).kind,'media');
});
test('visitor gets Creator Studio with recipient-specific collaboration, and no ownership controls',async()=>{
 const e=environment({member:{id:alysa,name:'Alysa Jordan',profession:'creator',website_url:'https://example.com/shop'},viewer:{id:other}});await settle();
 assert.equal(e.nodes['profile-primary-tab'].textContent,'Creator Studio');assert.equal(e.nodes['profile-primary-tab'].dataset.profileTab,'studio');assert.equal(e.nodes['profile-optional-music'].hidden,false);
 assert(e.owner.every(node=>node.hidden));assert(e.visitors.every(node=>!node.hidden));
 assert.equal(e.nodes['profile-studio-collaborate'].href,`/members.html?to=${alysa}&name=Alysa%20Jordan#member-mail`);assert.equal(e.nodes['profile-studio-website'].href,'https://example.com/shop');
 e.click(e.nodes['profile-primary-tab']);assert.equal(e.document.body.dataset.profileTabActive,'studio');assert.equal(e.panels.find(n=>n.dataset.profilePanel==='studio').hidden,false);assert.equal(e.dispatched.at(-1).detail.tab,'studio');
 e.click(new Node({profileOpenTab:'photos'}));assert.equal(e.document.body.dataset.profileTabActive,'photos');
 e.click(new Node({profileOpenTab:'songs'}));assert.equal(e.document.body.dataset.profileTabActive,'songs');
});
test('only matching signed-in account sees creation tools and its Clip shortcut',async()=>{
 const e=environment({viewer:{id:alysa}});await settle();assert(e.owner.every(node=>!node.hidden));assert(e.visitors.every(node=>node.hidden));assert.equal(e.composer.children.b.textContent,'Clip');assert.equal(e.composer.href,'/members.html#member-clips-root');
 const music=environment({member:{id:other,profession:'producer'},viewer:{id:other},view:'songs'});await settle();assert.equal(music.nodes['profile-primary-tab'].textContent,'Profile Music');assert.equal(music.nodes['profile-optional-music'].hidden,true);assert.equal(music.composer.children.b.textContent,'Song');assert.equal(music.document.body.dataset.profileTabActive,'songs');
});
test('no unsaved, insecure or credential-bearing business links are invented',async()=>{
 for(const website_url of [undefined,'','javascript:alert(1)','http://example.com','https://secret:password@example.com']){
  const e=environment({member:{id:alysa,website_url}});await settle();assert.equal(e.nodes['profile-studio-website'].hidden,true);assert.equal(e.nodes['profile-studio-website'].href,undefined);
 }
});
test('public owner alias stays a music profile without showing private creator tools',async()=>{
 const e=environment({member:{id:'owner',verified_owner:true},viewer:{id:other}});await settle();assert.equal(e.nodes['profile-primary-tab'].textContent,'Profile Music');assert(e.owner.every(node=>node.hidden));
});
test('shipped studio destinations exist and its panel remains under tab control',()=>{
 const html=read('profile.html'),css=read('profile-experience.css'),build=read('build.mjs');
 for(const target of ['#member-clips-root','?editor=photo#member-photo-album','/?compose=post','/live.html','data-profile-inline-open'])assert(html.includes(target));
 assert.match(html,/id="profile-creator-studio"[^>]*data-profile-panel="studio"/);
 assert.match(css,/body\[data-profile-tab-active="studio"\][^}]*data-profile-panel="studio"[^}]*display:block!important/);
 assert(build.includes("'profile-profession.js'"));assert(html.indexOf('profile-profession.js')<html.indexOf('src="profile.js'));
 assert(!read('profile-actions.js').includes("['public-profile-title-lines','title_lines']"),'actions must not erase the rendered profession');
});

test('photo and status editing stays beside identity and opens an in-page form',()=>{
 const html=read('profile.html'),css=read('profile-experience.css');
 assert.match(html,/<button id="public-profile-quick-edit"[^>]*data-profile-inline-open[^>]*aria-controls="profile-inline-editor"[^>]*hidden/);
 assert(html.indexOf('id="public-profile-quick-edit"')<html.indexOf('class="profile-hero-footer"'));
 assert(html.includes('Edit photo &amp; status'));assert(!html.includes('id="public-profile-edit"'));
 assert.match(css,/\.profile-quick-edit\{[^}]*min-height:48px/);
 assert.match(html,/<form id="profile-inline-form">/);
 assert(!html.includes('href="/members.html#edit-profile"'));
});

test('speaker, ministry and logistics pages show the work and a real message inquiry',async()=>{
 for(const [profession,label] of [['speaker','Speaking inquiry'],['ministry','Event inquiry'],['logistics','Logistics inquiry']]){
  const e=environment({member:{id:other,name:'Member',profession}});await settle();
  assert.equal(e.nodes['profile-primary-tab'].textContent,'Creator Studio');
  assert.equal(e.nodes['profile-studio-collaborate'].textContent,label);
  assert.equal(e.nodes['profile-studio-collaborate'].href,`/members.html?to=${other}&name=Member#member-mail`);
  assert.equal(e.nodes['profile-studio-website'].hidden,true);
  assert.equal(describe({id:other,profession}).kind,profession);
 }
 const identity=describe({id:other,name:'MrWilliams',profession:'creator'});assert.equal(identity.label,'Creator / Influencer','an unresolved name must not assign another person a ministry or job');
});

test('voluntarily saved multiple roles render as literal headline text without changing the primary profession',()=>{
 const look=describe({id:other,profession:'speaker',title_lines:'Speaker · Church elder · Logistics'});assert.equal(look.label,'Speaker · Church elder · Logistics');assert.equal(look.kind,'speaker');
 const literal=describe({id:other,profession:'creator',title_lines:'<b>My work</b>'});assert.equal(literal.label,'<b>My work</b>');assert.match(read('profile.js'),/role\.textContent = roleText/);
});


test('same-profile saves keep the active tab, photo scroll and current owner tools in place',async()=>{
 const e=environment({viewer:{id:alysa},view:'photos'});await settle();
 const notifications=e.dispatched.length,scrolls=e.album.scrolled;
 e.ready({id:alysa,name:'Alysa updated',profession:'creator'});
 assert.equal(e.document.body.dataset.profileTabActive,'photos');assert.equal(e.dispatched.length,notifications);assert.equal(e.album.scrolled,scrolls);assert(e.owner.every(node=>!node.hidden));
 await settle();assert(e.owner.every(node=>!node.hidden));
});

test('MrWilliams presentation follows only his supplied account, with all roles and optional music',async()=>{
 const id='1e1f21a5-3768-407f-8a43-00212eabc764';
 const look=describe({id:id.toUpperCase(),name:'Updated display name',profession:'musician'});
 assert.equal(look.mrWilliams,true);assert.equal(look.music,false);assert.equal(look.kind,'speaker');
 for(const role of ['Speaker','COGIC church elder','Trucking & logistics'])assert(look.label.includes(role));
 const copy=describe({id:other,name:'MrWilliams',profession:'creator'});
 assert.equal(copy.mrWilliams,false);assert.equal(copy.kind,'creator');assert(!copy.description.includes('COGIC'));
 const e=environment({member:{id,name:'MrWilliams',profession:'musician'},viewer:{id},view:'photos'});await settle();
 assert.equal(e.nodes['profile-primary-tab'].dataset.profileTab,'studio');assert.equal(e.nodes['profile-optional-music'].hidden,false);
 assert.equal(e.nodes['profile-studio-collaborate'].textContent,'Speaking & work inquiries');
 assert.equal(e.nodes['profile-studio-collaborate'].href,`/members.html?to=${id}&name=MrWilliams#member-mail`);
 assert.match(e.nodes['profile-studio-connect-description'].textContent,/ministry.*trucking and logistics/);
 const saved={id,name:'MrWilliams',profession:'logistics',title_lines:'My updated headline'};
 e.ready(saved);await settle();assert.equal(e.document.body.dataset.profileTabActive,'photos');
 assert.equal(describe(saved).label,'My updated headline');assert.equal(describe(saved).kind,'logistics');
});
