import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';

const source=fs.readFileSync(new URL('../profile-songs.js',import.meta.url),'utf8').replace('export function createProfileSongs','function createProfileSongs').replace(/createProfileSongs\(\);\s*$/,'this.player=createProfileSongs();');
const memberId='f099f8c6-6b0a-47ac-a1c2-9246fd82a412';
const otherId='28649f48-0c5e-4c58-927f-35ca09d6f605';
const SESSION_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const revision=slot=>`00000000-0000-4000-8000-${String(slot).padStart(12,'0')}`;
const linked=(slot=1,overrides={})=>({slot,status:'approved',revision:revision(slot),title:`Song ${slot}`,duration:null,url:null,source:'link',provider:'spotify',external_url:'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC',...overrides});
const legacy=(slot=1,overrides={})=>({slot,status:'approved',revision:revision(slot),title:`Song ${slot}`,duration:123,url:`/api/member-song-audio/${memberId}/${slot}/${'a'.repeat(64)}`,source:'upload',provider:null,external_url:null,...overrides});
const list=(songs=[linked()])=>({songs,max_songs:3});
const counts=(songs=[linked()],values={})=>{const byRevision=Object.fromEntries(songs.map(song=>[song.revision,values[song.revision]??0]));return{counts:byRevision,total:Object.values(byRevision).reduce((sum,value)=>sum+value,0),today:Object.values(byRevision).reduce((sum,value)=>sum+value,0),max_songs:3};};

function environment({search=`?id=${memberId}`,responses=[],hidden=false,api=null,autoReady=true}={}){
  class Element{
    constructor(tag='section'){this.tagName=tag.toUpperCase();this.className='';this.children=[];this.attrs={};this.listeners={};this.dataset={};this.hidden=false;this.disabled=false;this.paused=true;this.playCalls=0;this.pauseCalls=0;this.loadCalls=0;this.textContent='';}
    append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=[...nodes];}
    setAttribute(name,value){this.attrs[name]=value;}removeAttribute(name){delete this.attrs[name];if(name==='src')this.src='';}
    addEventListener(name,fn){(this.listeners[name]??=[]).push(fn);}fire(name){for(const fn of this.listeners[name]??[])fn({currentTarget:this});}
    play(){this.playCalls+=1;this.paused=false;this.fire('play');return Promise.resolve();}pause(){this.pauseCalls+=1;this.paused=true;this.fire('pause');}load(){this.loadCalls+=1;}
    set src(value){this.attrs.src=value;}get src(){return this.attrs.src||'';}
  }
  const root=new Element();const documentEvents={};const pageEvents={};
  const document={hidden,visibilityState:hidden?'hidden':'visible',getElementById:id=>id==='profile-songs-root'?root:null,createElement:tag=>new Element(tag),addEventListener:(name,fn)=>{documentEvents[name]=fn;}};
  const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
  const queue=responses.map(([data,status=200])=>()=>Promise.resolve(response(data,status)));const calls=[];
  const fetch=async(path,options)=>{calls.push({path,options});const next=queue.shift();if(!next)throw new Error('No queued response');return next();};
  const enqueue=(data,status=200)=>queue.push(()=>Promise.resolve(response(data,status)));
  const defer=()=>{let resolve;queue.push(()=>new Promise(done=>{resolve=done;}));return(data,status=200)=>resolve(response(data,status));};
  const controllers=[],opened=[];
  const window={location:{search,origin:'https://jwhitedidit.net'},addEventListener:(name,fn)=>{pageEvents[name]=fn;},open:(...args)=>opened.push(args)};
  if(api==='youtube')window.YT={Player:class {
    constructor(frame,{events}){this.frame=frame;this.events=events;this.playCalls=0;this.pauseCalls=0;this.destroyCalls=0;controllers.push(this);if(autoReady)queueMicrotask(()=>events.onReady());}
    playVideo(){this.playCalls++;}
    pauseVideo(){this.pauseCalls++;this.emit(2);}
    destroy(){this.destroyCalls++;}
    emit(data){this.events.onStateChange({data});}
  }};
  if(api==='spotify')window.__rosterSpotifyAPI={createController(target,options,callback){
    const listeners={};const controller={target,options,playCalls:0,pauseCalls:0,destroyCalls:0,
      addListener(name,fn){(listeners[name]??=[]).push(fn);},
      play(){this.playCalls++;},pause(){this.pauseCalls++;this.emit('playback_update',{isPaused:true,position:1000});},destroy(){this.destroyCalls++;},
      emit(name,data){for(const fn of listeners[name]??[])fn({data});}
    };controllers.push(controller);callback(controller);if(autoReady)queueMicrotask(()=>controller.emit('ready'));
  }};
  const context=vm.createContext({document,window,fetch,URL,URLSearchParams,AbortController,setTimeout,clearTimeout,encodeURIComponent});
  vm.runInContext(source,context);
  const nodes=(element=root)=>[element,...element.children.flatMap(child=>nodes(child))];
  const hasClass=(node,name)=>String(node.className).split(/\s+/).includes(name);
  return{root,document,documentEvents,pageEvents,calls,enqueue,defer,controllers,opened,player:context.player,nodes,hasClass,iframes:()=>nodes().filter(node=>node.tagName==='IFRAME'),audios:()=>nodes().filter(node=>node.tagName==='AUDIO'),buttons:()=>nodes().filter(node=>node.tagName==='BUTTON'),status:()=>nodes().find(node=>hasClass(node,'member-player-status')),now:()=>nodes().find(node=>hasClass(node,'member-retro-now')),retry:()=>nodes().find(node=>node.tagName==='BUTTON'&&node.textContent==='Try again'),trackList:()=>nodes().find(node=>hasClass(node,'member-profile-tracks')),launch:()=>nodes().find(node=>hasClass(node,'member-player-launch')),playCounts:()=>nodes().filter(node=>hasClass(node,'retro-track-plays')),footer:()=>nodes().find(node=>hasClass(node,'retro-footer'))};
}
async function ready(songs=[linked()],options={}){const e=environment({responses:[[{profile:{id:memberId,name:'Artist'}}],[list(songs)],[counts(songs)]],...options});await tick();return e;}

test('the public profile keeps a compact ROOSTER PLAYER with the classic MySpace look and no more than three linked songs',async()=>{
  const songs=[linked(1),linked(2,{provider:'apple',external_url:'https://music.apple.com/us/album/blinding-lights/1499378108?i=1499378613'}),linked(3,{provider:'youtube',external_url:'https://www.youtube.com/watch?v=dQw4w9WgXcQ'})];
  const e=await ready(songs);assert.deepEqual(e.calls.map(call=>call.path),[`/api/profile?id=${memberId}`,`/api/member-songs?id=${memberId}`,`/api/member-music-plays?id=${memberId}`]);
  assert.equal(e.root.children[1].children[0].children[0].textContent,'ROOSTER PLAYER');
  assert.equal(e.root.hidden,false);assert.equal(e.trackList().children.length,3);assert.deepEqual(e.nodes().filter(node=>e.hasClass(node,'member-retro-track-number')).map(node=>node.textContent),['01','02','03']);assert.equal(e.playCounts().length,3);assert.equal(e.footer().children[0].textContent,'3 SONGS');assert.match(e.footer().children[1].children[0].textContent,/Plays today/);assert.match(e.footer().children[1].children[1].textContent,/Total plays/);
  assert.equal(e.iframes().length,1);assert.match(e.iframes()[0].src,/spotify\.com\/embed\/track/);assert.equal(e.iframes()[0].loading,'eager');assert.equal(e.iframes()[0].attrs.autoplay,undefined);
  const third=e.trackList().children[2].children[0];third.fire('click');assert.equal(e.iframes().length,1);assert.match(e.iframes()[0].src,/youtube-nocookie/);assert.match(e.iframes()[0].src,/enablejsapi=1/);assert.match(e.iframes()[0].src,/origin=https%3A%2F%2Fjwhitedidit\.net/);assert.equal(e.nodes().find(node=>e.hasClass(node,'song-open-service')).textContent,'Open in YouTube ↗');
});

test('owner alias resolves to the observed member before loading music',async()=>{
  const e=await ready([linked()],{search:'?id=owner'});assert.deepEqual(e.calls.map(call=>call.path),['/api/profile?id=owner',`/api/member-songs?id=${memberId}`,`/api/member-music-plays?id=${memberId}`]);assert.equal(e.iframes().length,1);
  const fallback=environment({search:'?id=owner',responses:[[{profile:{id:'owner'}}]]});await tick();assert.equal(fallback.root.hidden,true);assert.equal(fallback.calls.length,1);
  const songs=[linked()];const bound=environment({responses:[[{profile:{id:'owner'}}],[list(songs)],[counts(songs)]]});await tick();assert.deepEqual(bound.calls.map(call=>call.path),[`/api/profile?id=${memberId}`,`/api/member-songs?id=${memberId}`,`/api/member-music-plays?id=${memberId}`]);assert.equal(bound.iframes().length,1);
});

test('invalid profile IDs and untrusted provider links fail closed',async()=>{
  for(const search of ['', '?id=bad',`?id=${memberId}&id=owner`,`?id=${memberId.replace('f099','z099')}`]){const e=environment({search});await tick();assert.equal(e.calls.length,0);assert.equal(e.root.hidden,true);}
  for(const song of [linked(1,{external_url:'https://evil.example/song'}),linked(1,{external_url:'javascript:alert(1)'}),linked(1,{provider:'youtube',external_url:'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=steal'})]){
    const e=await ready([song]);assert.equal(e.iframes().length,0);assert.equal(e.retry().hidden,false);
  }
  const partial=await ready([linked(1),linked(2,{provider:'youtube',external_url:'https://evil.example/song'})]);assert.equal(partial.iframes().length,1);assert.equal(partial.trackList().children.length,1);
});

test('music accepts the same UUID shape as the profile backend',async()=>{
  const id='f099f8c6-12fe-0159-0ab8-ee5de849349d';
  const songs=[linked()];const e=environment({search:`?id=${id}`,responses:[[{profile:{id}}],[list(songs)],[counts(songs)]]});await tick();
  assert.deepEqual(e.calls.map(call=>call.path),[`/api/profile?id=${id}`,`/api/member-songs?id=${id}`,`/api/member-music-plays?id=${id}`]);assert.equal(e.iframes().length,1);
});

test('old approved uploads still play safely until the member replaces them with a link',async()=>{
  const e=await ready([legacy()]);assert.equal(e.audios().length,1);assert.equal(e.audios()[0].src,legacy().url);assert.equal(e.audios()[0].attrs.autoplay,undefined);assert.equal(e.audios()[0].playCalls,0);
  e.enqueue(counts([legacy()],{[legacy().revision]:1}),201);e.audios()[0].fire('playing');assert.equal(e.now().textContent,'NOW PLAYING');e.audios()[0].fire('pause');assert.equal(e.now().textContent,'READY TO PLAY');
  e.audios()[0].fire('error');assert.match(e.status().textContent,/could not play/);assert.equal(e.retry().hidden,false);
});

test('song titles stay plain text and empty lists hide the whole player',async()=>{
  const title='<img src=x onerror=alert(1)>';const e=await ready([linked(1,{title})]);assert.equal(e.nodes().find(node=>node.tagName==='H3'&&node.textContent===title).textContent,title);assert.equal(source.includes('innerHTML'),false);
  const empty=await ready([]);assert.equal(empty.root.hidden,true);assert.equal(empty.iframes().length,0);
});

test('hiding the page releases provider frames and returning reloads without autoplay',async()=>{
  const e=await ready([linked()]);const external=e.nodes().find(node=>e.hasClass(node,'song-open-service'));assert.equal(e.iframes().length,1);assert.equal(external.hidden,false);e.document.hidden=true;e.document.visibilityState='hidden';e.documentEvents.visibilitychange();assert.equal(e.iframes().length,0);assert.equal(external.hidden,true);assert.equal(external.textContent,'');
  const songs=[linked(2)];e.enqueue({profile:{id:memberId}});e.enqueue(list(songs));e.enqueue(counts(songs));e.document.hidden=false;e.document.visibilityState='visible';e.documentEvents.visibilitychange();await tick();assert.equal(e.iframes().length,1);assert.equal(e.iframes()[0].attrs.autoplay,undefined);
});

test('YouTube Play controls playback, Pause stops it, and only confirmed playback changes the deduplicated counter',async()=>{
  const songs=[linked(1,{provider:'youtube',external_url:'https://www.youtube.com/watch?v=dQw4w9WgXcQ'})];
  const e=await ready(songs,{api:'youtube'});const controller=e.controllers[0];
  assert.equal(controller.playCalls,0,'loading a profile must not autoplay');
  e.launch().fire('click');assert.equal(controller.playCalls,1);assert.equal(e.calls.filter(call=>call.path==='/api/member-music-plays/post').length,0);
  assert.equal(e.now().textContent,'READY TO PLAY');
  e.enqueue(counts(songs,{[songs[0].revision]:1}),201);controller.emit(1);await tick();
  const post=e.calls.at(-1);assert.equal(post.path,'/api/member-music-plays/post');const body=JSON.parse(post.options.body);assert.deepEqual({member_id:body.member_id,slot:body.slot,revision:body.revision},{member_id:memberId,slot:1,revision:songs[0].revision});assert.match(body.session_id,SESSION_ID);
  assert.equal(e.now().textContent,'NOW PLAYING');assert.equal(e.launch().attrs['aria-pressed'],'true');assert.equal(e.playCounts()[0].textContent,'1 play');assert.equal(e.footer().children[1].children[0].children[0].textContent,'1');assert.equal(e.footer().children[1].children[1].children[0].textContent,'1');
  e.launch().fire('click');assert.equal(controller.pauseCalls,1);assert.equal(e.launch().attrs['aria-pressed'],'false');
  e.launch().fire('click');assert.equal(controller.playCalls,2);controller.emit(1);await tick();
  assert.equal(e.calls.filter(call=>call.path==='/api/member-music-plays/post').length,1);e.pageEvents.pagehide();
});

test('Spotify transport uses the official track controller and never counts a button click as listening',async()=>{
  const songs=[linked()];const e=await ready(songs,{api:'spotify'});const controller=e.controllers[0];
  assert.equal(controller.options.uri,'spotify:track:4uLU6hMCjMI75M1A2tKUQC');assert.equal(controller.playCalls,0);
  e.launch().fire('click');assert.equal(controller.playCalls,1);assert.equal(e.calls.length,3);
  controller.emit('playback_update',{isPaused:false,isBuffering:true,position:12});assert.equal(e.calls.length,3);
  e.enqueue(counts(songs,{[songs[0].revision]:1}),201);controller.emit('playback_started');await tick();
  assert.equal(e.now().textContent,'NOW PLAYING');assert.equal(e.playCounts()[0].textContent,'1 play');
  e.launch().fire('click');assert.equal(controller.pauseCalls,1);assert.equal(e.now().textContent,'READY TO PLAY');
  e.pageEvents.pagehide();assert.equal(controller.destroyCalls,1);
});

test('Spotify actual playback updates also confirm listening when playback_started is absent',async()=>{
  const songs=[linked()];const e=await ready(songs,{api:'spotify'});const controller=e.controllers[0];
  controller.emit('playback_update',{isPaused:false,isBuffering:false,position:0});assert.equal(e.calls.length,3);
  e.enqueue(counts(songs,{[songs[0].revision]:1}),201);controller.emit('playback_update',{isPaused:false,isBuffering:false,position:1000});await tick();
  assert.equal(e.playCounts()[0].textContent,'1 play');e.pageEvents.pagehide();
});

test('an early Play click waits for YouTube readiness and can be cancelled by clicking again',async()=>{
  const songs=[linked(1,{provider:'youtube',external_url:'https://www.youtube.com/watch?v=dQw4w9WgXcQ'})];
  const e=await ready(songs,{api:'youtube',autoReady:false});const controller=e.controllers[0];
  e.launch().fire('click');assert.equal(controller.playCalls,0);controller.events.onReady();assert.equal(controller.playCalls,1);
  controller.events.onAutoplayBlocked();assert.match(e.status().textContent,/browser needs a tap/);assert.equal(e.calls.length,3);e.pageEvents.pagehide();
  const cancelled=await ready(songs,{api:'youtube',autoReady:false});cancelled.launch().fire('click');cancelled.launch().fire('click');cancelled.controllers[0].events.onReady();assert.equal(cancelled.controllers[0].playCalls,0);cancelled.pageEvents.pagehide();
});

test('blocked or unavailable YouTube playback never records a play or pretends music is playing',async()=>{
  const songs=[linked(1,{provider:'youtube',external_url:'https://www.youtube.com/watch?v=dQw4w9WgXcQ'})];
  const e=await ready(songs,{api:'youtube'});const controller=e.controllers[0];
  e.launch().fire('click');controller.events.onAutoplayBlocked();assert.equal(e.calls.length,3);assert.equal(e.launch().attrs['aria-pressed'],'false');assert.match(e.status().textContent,/browser needs a tap/);
  e.launch().fire('click');controller.events.onError({data:150});assert.equal(e.calls.length,3);assert.match(e.status().textContent,/cannot play here/);e.pageEvents.pagehide();
});

test('external service links and Apple Music launch do not inflate the play counter',async()=>{
  const songs=[linked(1,{provider:'apple',external_url:'https://music.apple.com/us/album/blinding-lights/1499378108?i=1499378613'})];
  const e=await ready(songs);e.nodes().find(node=>e.hasClass(node,'song-open-service')).fire('click');e.launch().fire('click');await tick();
  assert.equal(e.calls.length,3);assert.equal(e.opened.length,1);assert.deepEqual(e.opened[0],[songs[0].external_url,'_blank','noopener,noreferrer']);assert.match(e.status().textContent,/controlled by Apple Music/);assert.equal(e.now().textContent,'READY TO PLAY');
});

test('a stopped or hidden player cannot count a late provider callback',async()=>{
  const songs=[linked(1,{provider:'youtube',external_url:'https://www.youtube.com/watch?v=dQw4w9WgXcQ'}),linked(2,{provider:'youtube',external_url:'https://www.youtube.com/watch?v=9bZkp7q19f0'})];
  const e=await ready(songs,{api:'youtube'});const first=e.controllers[0];e.trackList().children[1].children[0].fire('click');await tick();
  assert.equal(first.destroyCalls,1);first.emit(1);assert.equal(e.calls.length,3);assert.equal(e.now().textContent,'READY TO PLAY');
  const second=e.controllers[1];e.pageEvents.pagehide();second.emit(1);assert.equal(second.destroyCalls,1);assert.equal(e.calls.length,3);assert.equal(e.iframes().length,0);
});

test('legacy uploaded audio toggles Play and Pause and only counts actual playing',async()=>{
  const songs=[legacy()];const e=await ready(songs);const audio=e.audios()[0];
  e.launch().fire('click');assert.equal(audio.playCalls,1);assert.equal(e.calls.length,3);assert.equal(e.now().textContent,'READY TO PLAY');
  e.enqueue(counts(songs,{[songs[0].revision]:1}),201);audio.fire('playing');await tick();assert.equal(e.playCounts()[0].textContent,'1 play');
  e.launch().fire('click');assert.equal(audio.pauseCalls,1);assert.equal(e.launch().attrs['aria-pressed'],'false');e.pageEvents.pagehide();
});

test('late responses cannot restore a player after pagehide',async()=>{
  const e=await ready([linked()]);e.enqueue({profile:{id:memberId}});const finish=e.defer();void e.player.refresh();await tick();const pending=e.calls.at(-1);e.pageEvents.pagehide();assert.equal(pending.options.signal.aborted,true);finish(list([linked(2)]));await tick();assert.equal(e.iframes().length,0);
});

test('blocked SDK loading leaves the original embed and gives a usable fallback after a Play click',async()=>{
  const e=await ready([linked()]);assert.equal(e.iframes().length,1);assert.match(e.iframes()[0].src,/spotify/);
  e.launch().fire('click');assert.match(e.status().textContent,/could not connect/);assert.doesNotMatch(e.status().textContent,/Connecting/);assert.equal(e.calls.length,3);
});

test('late playing events from a replaced upload cannot inflate its counter or change the selected song',async()=>{
  const e=await ready([legacy(),linked(2)]);const old=e.audios()[0];e.trackList().children[1].children[0].fire('click');await tick();
  old.fire('playing');old.fire('error');assert.equal(e.calls.length,3);assert.equal(e.now().textContent,'READY TO PLAY');assert.doesNotMatch(e.status().textContent,/This song could not play/);assert.equal(old.src,'');
});

test('a counter storage failure does not interrupt real playback',async()=>{
  const e=await ready([linked()],{api:'spotify'});e.enqueue({error:'unavailable'},503);e.controllers[0].emit('playback_started');await tick();
  assert.equal(e.now().textContent,'NOW PLAYING');assert.match(e.status().textContent,/Playing Song/);assert.equal(e.playCounts()[0].textContent,'Unavailable');assert.equal(e.controllers[0].pauseCalls,0);e.pageEvents.pagehide();
});

test('Spotify waits until its embedded player is ready before sending a queued Play command',async()=>{
  const e=await ready([linked()],{api:'spotify',autoReady:false});e.launch().fire('click');assert.equal(e.controllers[0].playCalls,0);
  e.controllers[0].emit('ready');assert.equal(e.controllers[0].playCalls,1);assert.equal(e.calls.length,3);e.pageEvents.pagehide();
});

test('Spotify recommendations for a different URI do not count as the selected profile song',async()=>{
  const e=await ready([linked()],{api:'spotify'});const controller=e.controllers[0];
  const other={playingURI:'spotify:track:0123456789012345678901',isPaused:false,isBuffering:false,position:5000};
  controller.emit('playback_started',other);controller.emit('playback_update',other);assert.equal(e.calls.length,3);assert.equal(e.now().textContent,'READY TO PLAY');e.pageEvents.pagehide();
});
