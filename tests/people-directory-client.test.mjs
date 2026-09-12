import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = name => readFileSync(resolve(root, name), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const alice = {id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name:'Alice', photo_url:null, profile_url:'/#home', online:false};

class Node {
  constructor(tag='div') {
    this.tagName=tag.toUpperCase(); this.children=[]; this.attributes={}; this.dataset={}; this.listeners={};
    this.className=''; this.textContent=''; this.hidden=false; this.disabled=false; this.value=''; this.href='';
    this.classList={add:(...names)=>{const set=new Set(this.className.split(/\s+/).filter(Boolean));names.forEach(name=>set.add(name));this.className=[...set].join(' ');}};
  }
  append(...nodes){this.children.push(...nodes);}
  appendChild(node){this.children.push(node);return node;}
  replaceChildren(...nodes){this.children=[...nodes];}
  setAttribute(name,value){this.attributes[name]=String(value);if(name==='id')this.id=String(value);}
  removeAttribute(name){delete this.attributes[name];}
  addEventListener(type,listener){this.listeners[type]=listener;}
  fire(type){this.listeners[type]?.({preventDefault(){},target:this});}
  focus(){this.focused=true;}
  querySelector(){return null;}
}

function descendants(node){return [node,...node.children.flatMap(child=>child instanceof Node?descendants(child):[])];}
function byClass(rootNode,name){return descendants(rootNode).find(node=>node.className.split(/\s+/).includes(name));}
function allByTag(rootNode,tag){return descendants(rootNode).filter(node=>node.tagName===tag.toUpperCase());}
function response(status,data){return {ok:status>=200&&status<300,status,json:async()=>data};}

async function directory(replies,{matches=false,connectionReplies=[]}={}){
  const host=new Node('section'); const memberCalls=[]; let ready;
  const document={body:new Node('body'),readyState:'loading',visibilityState:'visible',
    createElement:tag=>new Node(tag),
    querySelector:selector=>selector==='[data-member-directory]'?host:null,
    querySelectorAll:()=>[],
    addEventListener(type,listener){if(type==='DOMContentLoaded')ready=listener;},
  };
  const context={document,location:{href:'https://jwhitedidit.net/people.html',pathname:'/people.html',search:'',origin:'https://jwhitedidit.net',replace(){}},
    window:{addEventListener(){}},sessionStorage:{getItem:()=>null,setItem(){}},localStorage:{getItem:()=>null,setItem(){}},
    crypto:{randomUUID:()=>alice.id},AbortController,URL,URLSearchParams,encodeURIComponent,
    setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,
    fetch:async path=>{if(String(path).startsWith('/api/members')){memberCalls.push(String(path));return replies.shift()??response(503,{error:'offline'});}if(path==='/api/profile/me')return response(401,{error:'Log in.'});return response(200,{});},
  };
  if(matches)vm.runInNewContext(read('people-connections.js'),context);
  vm.runInNewContext(read('community.js'),context); ready(); await tick(); await tick();
  return {host,memberCalls};
}

test('successful and empty directory responses render honest discovery states',async()=>{
  const success=await directory([response(200,{members:[alice],total:1,next_offset:null})]);
  assert.match(byClass(success.host,'community-status').textContent,/1 on the roster/);
  const links=allByTag(success.host,'a');
  assert.equal(links.find(link=>link.className==='discover-identity').href,`/profile.html?id=${alice.id}`,'legacy profile_url cannot divert a card from the redesigned profile');
  assert.equal(links.find(link=>link.textContent==='Add to My Roster').href,`/profile.html?id=${alice.id}#friend-space`);

  const empty=await directory([response(200,{members:[],total:0,next_offset:null})]);
  assert.match(byClass(empty.host,'community-status').textContent,/Nobody on the roster matches/);
  assert.equal(byClass(empty.host,'directory-access-gate').hidden,true);
});

test('401 and 403 show the approved-member door instead of a connectivity error',async()=>{
  for(const status of [401,403]){
    const env=await directory([response(status,{error:'gated'})]);
    const gate=byClass(env.host,'directory-access-gate');
    assert.equal(gate.hidden,false,String(status));
    assert.equal(byClass(env.host,'friend-search-form').hidden,true,String(status));
    assert.match(byClass(env.host,'community-status').textContent,/available to approved members/);
    const links=allByTag(gate,'a');
    assert.deepEqual(links.map(link=>link.href),['/members.html','/members.html#request-invite']);
    assert.doesNotMatch(byClass(env.host,'community-status').textContent,/could not load|temporarily unavailable/i);
  }
});

test('endpoint failures retain a truthful error and Newest retries successfully',async()=>{
  const env=await directory([response(503,{error:'database unavailable'}),response(200,{members:[alice],total:1,next_offset:null})]);
  assert.match(byClass(env.host,'community-status').textContent,/temporarily unavailable/);
  assert.equal(byClass(env.host,'friend-search-form').hidden,false);
  const refresh=allByTag(env.host,'button').find(button=>button.textContent==='Newest on the Roster');
  refresh.fire('click'); await tick(); await tick();
  assert.equal(env.memberCalls.length,2);
  assert.match(byClass(env.host,'community-status').textContent,/1 on the roster/);
});

test('Top 8 and directory backends normalize every member link to the real profile route',()=>{
  const client=read('top-eight-roster.js');
  const topEightServer=read('netlify/functions/_shared/top-eight-roster.mts');
  const directoryServer=read('netlify/functions/_shared/member-directory.mts');
  const membersEndpoint=read('netlify/functions/members-list.mts');
  assert.match(client,/\/profile\.html\?id='\s*\+\s*encodeURIComponent\(member\.id\)/);
  assert.match(topEightServer,/profile_url:\s*`\/profile\.html\?id=\$\{person\.id\}`/);
  assert.match(directoryServer,/profile_url:`\/profile\.html\?id=\$\{member\.id\}`/);
  assert.doesNotMatch(directoryServer,/profile_url:[^\n]*\/#home/);
  assert.match(membersEndpoint,/approved ROOSTER account to open member discovery/);
});

const bob={...alice,id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',name:'Bo',profession:'creator',relationship:'none'};
const viewer={id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',profession:'beauty_products',location:''};
test('matching cards give a concrete reason and route to the existing connection widget',async()=>{
  const env=await directory([response(200,{members:[bob],total:1,next_offset:null,connection_context:{viewer,ready:true}})],{matches:true});
  const area=byClass(env.host,'people-build');assert.equal(area.hidden,false);
  assert.match(byClass(area,'people-build-reason').textContent,/Hair & beauty products.*Content creator/);
  const action=byClass(area,'people-build-connect');assert.equal(action.textContent,'View & connect');assert.equal(action.href,`/profile.html?id=${bob.id}#friend-space`);
  byClass(area,'people-build-pass').fire('click');assert.equal(byClass(area,'people-build-card'),undefined);
  assert.match(byClass(area,'people-build-status').textContent,/No new matches/);
  assert.equal(byClass(env.host,'friend-search-form').hidden,false);
});
test('a goal changes matching, while relationships stay out and errors clear old cards',async()=>{
  const unrelated={...bob,profession:'dj'};
  const env=await directory([response(200,{members:[unrelated,{...bob,id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',relationship:'outgoing'}],total:2,next_offset:null,connection_context:{viewer,ready:true}}),response(401,{error:'Log in'})],{matches:true});
  assert.equal(byClass(env.host,'people-build-card'),undefined);
  const select=allByTag(env.host,'select')[0];select.value='music';select.fire('change');
  assert.match(byClass(env.host,'people-build-reason').textContent,/Make music/);
  assert.equal(allByTag(byClass(env.host,'discover-grid'),'a').some(a=>a.textContent==='Add to My Roster'&&a.href.includes('dddddddd')),false);
  allByTag(env.host,'button').find(b=>b.textContent==='Newest on the Roster').fire('click');await tick();await tick();
  assert.equal(byClass(env.host,'people-build').hidden,true);
  assert.equal(byClass(env.host,'people-build-card'),undefined);
});
test('missing recommendation context leaves ordinary directory available',async()=>{
  const env=await directory([response(200,{members:[alice],total:1,next_offset:null})],{matches:true});
  assert.equal(byClass(env.host,'people-build').hidden,true);assert.ok(byClass(env.host,'discover-card'));
});
