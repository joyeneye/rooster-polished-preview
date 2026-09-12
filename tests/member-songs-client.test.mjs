import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';

const source=fs.readFileSync(new URL('../member-songs.js',import.meta.url),'utf8').replaceAll('export function','function');
const origin='https://jwhitedidit.net';
const USER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SPOTIFY='https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC';
const YOUTUBE='https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const empty=number=>({slot:number,status:'empty',revision:null,title:null,duration:null,url:null,source:null,provider:null,external_url:null});
const linked=(number=1,overrides={})=>({slot:number,status:'approved',revision:`r${number}`,title:`Song ${number}`,duration:null,url:null,source:'link',provider:'spotify',external_url:SPOTIFY,...overrides});
const listing=(records=[])=>({user:{id:USER},slots:[1,2,3].map(number=>records.find(record=>record.slot===number)||empty(number)),max_songs:3});

function environment(){
  const nodes=[];const events={};const pageEvents={};const calls=[];const queue=[];const expired=[];
  class Element{
    constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.listeners={};this.dataset={};this.hidden=false;this.disabled=false;this.value='';this.textContent='';this.paused=true;nodes.push(this);}
    append(...items){this.children.push(...items);}
    replaceChildren(...items){this.children=[...items];}
    setAttribute(key,value){this.attributes[key]=value;}
    getAttribute(key){return this.attributes[key]??null;}
    removeAttribute(key){delete this.attributes[key];if(key==='src')this.src='';}
    addEventListener(key,fn){this.listeners[key]=fn;}
    fire(key){this.listeners[key]?.({preventDefault(){},currentTarget:this});}
    pause(){this.paused=true;} load(){} reportValidity(){return true;} click(){this.fire('click');} submit(){this.fire('submit');}
    set src(value){this.attributes.src=value;}get src(){return this.attributes.src||'';}
  }
  const root=new Element();root.hidden=true;
  const document={visibilityState:'visible',getElementById:id=>id==='member-songs-root'?root:null,createElement:tag=>new Element(tag),addEventListener:(type,fn)=>{events[type]=fn;}};
  const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
  const fetch=async(path,options)=>{calls.push({path,options});const next=queue.shift();if(!next)throw new Error('No response queued');return next();};
  const enqueue=(data,status=200)=>queue.push(()=>Promise.resolve(response(data,status)));
  const defer=()=>{let resolve;queue.push(()=>new Promise(done=>{resolve=done;}));return(data,status=200)=>resolve(response(data,status));};
  const context=vm.createContext({document,window:{location:{origin},addEventListener:(type,fn)=>{pageEvents[type]=fn;}},fetch,URL,AbortController,crypto:{randomUUID},setTimeout,clearTimeout,encodeURIComponent,onSessionExpired:()=>expired.push(true)});
  vm.runInContext(source+'\nthis.controller=createMemberSongs({onSessionExpired});this.musicLink=musicLink;',context);
  const card=number=>{const section=root.children[4].children[number-1];const form=section.children[4];return{section,current:section.children[1],state:section.children[2],player:section.children[3],form,title:form.children[0].children[0],link:form.children[1].children[0],hint:form.children[2],submit:form.children[3].children[0],cancel:form.children[3].children[1],remove:form.children[3].children[2]};};
  return{root,nodes,document,events,pageEvents,calls,enqueue,defer,expired,card,notice:root.children[3],refresh:root.children[0].children[1],controller:context.controller,musicLink:context.musicLink};
}

test('only individual Apple Music, Spotify and YouTube links are accepted and canonicalized',()=>{
  const e=environment();
  assert.deepEqual({...e.musicLink(SPOTIFY+'?si=share')},{provider:'spotify',url:SPOTIFY,embed:'https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC?theme=0'});
  assert.deepEqual({...e.musicLink('https://spotify.link/8qtwlE1mGXb?si=share')},{provider:'spotify',url:'https://spotify.link/8qtwlE1mGXb',embed:null});
  assert.equal(e.musicLink('https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC').url,SPOTIFY);
  assert.equal(e.musicLink('https://music.apple.com/us/album/blinding-lights/1499378108?i=1499378613').provider,'apple');
  assert.equal(e.musicLink('https://embed.music.apple.com/us/album/blinding-lights/1499378108?i=1499378613').url,'https://music.apple.com/us/album/blinding-lights/1499378108?i=1499378613');
  assert.equal(e.musicLink('https://youtu.be/dQw4w9WgXcQ?si=share').url,YOUTUBE);
  assert.equal(e.musicLink('https://www.youtube.com/live/dQw4w9WgXcQ?si=share').url,YOUTUBE);
  for(const url of ['https://evil.example/song','javascript:alert(1)','https://open.spotify.com/album/123','https://youtube.com/playlist?list=abc'])assert.equal(e.musicLink(url),null);
});

test('the verified member response always opens exactly three link slots',async()=>{
  const e=environment();e.enqueue(listing([linked()]));e.controller.setUser({id:USER});await tick();
  assert.equal(e.root.hidden,false);assert.equal(e.root.children[4].children.length,3);assert.equal(e.calls[0].path,'/api/member-songs/me');
  assert.equal(e.card(1).player.children[0].tagName,'IFRAME');assert.equal(e.card(1).player.children[0].loading,'eager');assert.match(e.card(1).player.children[0].src,/open\.spotify\.com\/embed\/track/);
  assert.equal(e.card(1).player.children[1].tagName,'A');assert.match(e.card(1).player.children[1].textContent,/Open in Spotify/);
  assert.equal(e.card(2).state.textContent,'This spot is open.');
  e.controller.setUser(null);assert.equal(e.root.hidden,true);assert.equal(e.card(1).player.children.length,0);
});

test('pasting a link saves JSON without uploading audio and keeps a stable request for retry',async()=>{
  const e=environment();e.enqueue(listing());e.controller.setUser({id:USER});await tick();const card=e.card(1);
  card.title.value='My video';card.title.fire('input');card.link.value='https://youtu.be/dQw4w9WgXcQ?si=private';card.link.fire('input');
  assert.match(card.hint.textContent,/YouTube link ready/);assert.equal(card.submit.disabled,false);
  e.enqueue({error:'Temporary'},503);card.form.submit();await tick();const first=e.calls.at(-1);assert.equal(first.path,'/api/member-songs/link');
  const firstBody=JSON.parse(first.options.body);assert.equal(firstBody.url,YOUTUBE);assert.equal('audio' in firstBody,false);
  e.enqueue({error:'Temporary'},503);card.form.submit();await tick();assert.equal(JSON.parse(e.calls.at(-1).options.body).request_id,firstBody.request_id);
  e.enqueue({status:'approved',slot:linked(1,{title:'My video',provider:'youtube',external_url:YOUTUBE})},201);card.form.submit();await tick();
  assert.match(e.notice.textContent,/Link saved/);assert.equal(card.player.children[0].tagName,'IFRAME');assert.equal(card.player.children[0].loading,'eager');assert.match(card.player.children[0].src,/youtube-nocookie/);assert.match(card.player.children[0].src,/enablejsapi=1/);assert.match(card.player.children[0].src,/origin=https%3A%2F%2Fjwhitedidit\.net/);
});

test('a first-time member keeps the title and link while being sent to save a profile',async()=>{
  const e=environment();e.enqueue(listing());e.controller.setUser({id:USER});await tick();const card=e.card(1);
  card.title.value='Stay here';card.title.fire('input');card.link.value=YOUTUBE;card.link.fire('input');
  e.enqueue({error:'Save your profile once before adding a song.'},400);card.form.submit();await tick();
  assert.equal(card.title.value,'Stay here');assert.equal(card.link.value,YOUTUBE);assert.match(e.notice.textContent,/Save your profile once/);
  const hint=e.root.children[2].children[0];assert.equal(hint.href,'#member-profile-panel');assert.equal(hint.hidden,false);
});

test('delete uses the current revision and a stale response cannot restore music after logout',async()=>{
  const e=environment();e.enqueue(listing([linked()]));e.controller.setUser({id:USER});await tick();const finish=e.defer();e.card(1).remove.click();
  assert.deepEqual(JSON.parse(e.calls.at(-1).options.body).revision,'r1');e.controller.setUser(null);finish({status:'deleted',slot:empty(1)});await tick();
  assert.equal(e.root.hidden,true);assert.equal(e.card(1).player.children.length,0);assert.equal(e.notice.textContent,'');
  e.enqueue({...listing(),user:{id:OTHER}});e.controller.setUser({id:USER});await tick();assert.equal(e.expired.length,1);
});
