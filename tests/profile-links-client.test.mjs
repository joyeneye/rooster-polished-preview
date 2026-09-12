import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const origin='https://jwhitedidit.net';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
class Element {
 constructor(tag='div'){this.tagName=tag;this.children=[];this.listeners={};this.attributes={};this.dataset={};this.hidden=false;this._text='';}
 set textContent(value){this._text=String(value);this.children=[];}get textContent(){return this._text+this.children.map(c=>c.textContent||'').join('');}
 append(...children){this.children.push(...children);}
 replaceChildren(...children){this._text='';this.children=[...children];}
 setAttribute(key,value){this.attributes[key]=value;}
 removeAttribute(key){delete this.attributes[key];}
 addEventListener(name,fn){this.listeners[name]=fn;}
}
function base(){let timer=0;return {URL,URLSearchParams,AbortController,console,setTimeout:()=>++timer,clearTimeout:()=>{},navigator:{onLine:true},MutationObserver:class{observe(){}},location:{origin,search:''}};}
function widget(target='owner',friendResponse=null){
 const source=readFileSync(new URL('../friend-widget.js',import.meta.url),'utf8');
 const keys=['count','label','status','load-status','summary','list','view-all','more','retry','heading','owner-name'];
 const nodes=Object.fromEntries(keys.map(k=>[`[data-friend-${k}]`,new Element()]));nodes['[data-add-friend]']=new Element('button');
 const root=new Element();root.dataset={friendTarget:target,friendName:'JWhite'};root.querySelector=key=>nodes[key]||null;
 const calls=[];let completeProfile;
 const context=base();context.window={location:context.location,addEventListener(){}};
 context.document={hidden:false,querySelectorAll:()=>[root],getElementById:()=>null,createElement:tag=>new Element(tag),addEventListener(){}};
 context.fetch=async path=>{calls.push(path);if(path.startsWith('/api/friends?'))return {ok:true,json:async()=>(friendResponse||{count:1,friends:[{member_id:target==='owner'?id:'owner',member_name:target==='owner'?'Alice':'JWhite',profile_url:target==='owner'?`/profile.html?id=${id}`:'/#home'}]})};
 return new Promise(resolve=>{completeProfile=value=>resolve({ok:true,json:async()=>({profile:value})});});};
 vm.runInNewContext(source,context);
 return {nodes,calls,finish:value=>completeProfile(value)};
}
test('friend name, portrait and View Profile are one native link before slow profile data resolves',async()=>{
 const env=widget();await tick();const card=env.nodes['[data-friend-list]'].children[0].children[0];
 assert.equal(card.tagName,'a');assert.equal(card.href,`/profile.html?id=${id}`);assert.equal(card.children[0].textContent,'Alice');assert.equal(card.children[1].textContent,'A');assert.equal(card.children[2].textContent,'View Profile »');assert.equal(card.listeners.click,undefined);assert.equal(env.nodes['[data-friend-count]'].textContent,'1');
 env.finish({name:'Alice Music',photo_url:null});await tick();assert.equal(card.children[0].textContent,'Alice Music');assert.equal(env.nodes['[data-friend-list]'].children[0].children[0],card,'hydration must not replace a link during a tap');
});
test('the automatic owner-alias friend is rendered with a link to JWhite home',async()=>{
 const env=widget(id);await tick();const card=env.nodes['[data-friend-list]'].children[0].children[0];assert.equal(card.href,'/#home');assert.equal(card.children[0].textContent,'JWhite');env.finish({name:'JWhite',photo_url:'/profile.jpg'});await tick();assert.equal(card.children[1].children[0].src,origin+'/profile.jpg');
});
test('an automatic owner relationship presents J.White as the signed in member connector',async()=>{
 const env=widget('owner',{count:1,friends:[{member_id:id,member_name:'Alice',profile_url:`/profile.html?id=${id}`,automatic_owner:true}],relationship:{target_id:'owner',state:'accepted',automatic_owner:true}});await tick();
 assert.equal(env.nodes['[data-add-friend]'].disabled,true);assert.equal(env.nodes['[data-add-friend]'].textContent,'J.White Is Your Connector');assert.match(env.nodes['[data-friend-status]'].textContent,/Your Connector and the first name on your roster/);
 env.finish({name:'Alice',photo_url:null});await tick();
});
test('the owner card on a member page is visibly labeled Your Connector',async()=>{
 const env=widget(id,{count:1,friends:[{member_id:'owner',member_name:'JWhite',profile_url:'/#home',automatic_owner:true}]});await tick();const card=env.nodes['[data-friend-list]'].children[0].children[0];
 assert.equal(card.children[2].textContent,'Your Connector · View Profile »');assert.match(card.attributes['aria-label'],/your connector/);env.finish({name:'J.White Did It',photo_url:'/profile.jpg'});await tick();
});
function profile(path=id,responses=[]){
 const markup=readFileSync(new URL('../profile.html',import.meta.url),'utf8');
 const nodes=Object.fromEntries([...markup.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],new Element()]));
 nodes['public-profile'].hidden=true;const context=base();context.window={location:{origin,search:'?id='+path}};context.document={getElementById:key=>nodes[key],title:''};
 const calls=[];context.fetch=async path=>{calls.push(path);const next=responses.shift();if(!next)throw new Error('No test response');return {ok:next.status===200,status:next.status,json:async()=>next.body};};vm.runInNewContext(readFileSync(new URL('../profile.js',import.meta.url),'utf8'),context);
 return {nodes,calls,document:context.document};
}
const member={id,name:'Alice',status:'MORE!',about_me:'',profile_pending:true};
test('basic newly registered profile renders immediately without an edited bio or photo',async()=>{
 const env=profile(id.toUpperCase(),[{status:200,body:{profile:member}}]);await tick();assert.equal(env.calls[0],'/api/profile?id='+id);assert.equal(env.nodes['public-profile'].hidden,false);assert.equal(env.nodes['public-profile-name'].textContent,'Alice');assert.equal(env.nodes['public-profile-new-member'].hidden,false);assert.equal(env.nodes['public-profile-status'].textContent,'');
});
test('an unavailable page shows a visible explanation and can retry successfully',async()=>{
 const env=profile(id,[{status:404,body:{}},{status:200,body:{profile:member}}]);await tick();assert.match(env.nodes['public-profile-status'].textContent,/unavailable/);assert.equal(env.nodes['public-profile-retry'].hidden,false);env.nodes['public-profile-retry'].listeners.click();await tick();assert.equal(env.nodes['public-profile'].hidden,false);assert.equal(env.nodes['public-profile-name'].textContent,'Alice');
});
test('invalid profile links show recovery text without making a request',async()=>{
 const env=profile('not-an-account');await tick();assert.equal(env.calls.length,0);assert.match(env.nodes['public-profile-status'].textContent,/link/);
});
