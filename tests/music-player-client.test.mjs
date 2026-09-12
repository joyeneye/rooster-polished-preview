import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';

// The homepage player is an IIFE, so the offline DOM below stands in for the markup in index.html.
const source=fs.readFileSync(new URL('../music.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const settle=async()=>{for(let step=0;step<4;step++)await tick();};
const FIRST='XvinPCCGSxc';
const IDS=['retro-player','music-count','music-playlist-label','music-tracks','music-play','music-seek','music-volume','music-mute','music-mobile-volume-note','music-video','music-title','music-artist','music-external','music-elapsed','music-duration','music-state','music-status','music-total','music-today','music-play-label','music-play-symbol','music','music-prev','music-next'];

function fakeYouTube(){
  const players=[];
  class Player{
    constructor(target,options){
      this.target=target;this.events=options?.events??{};this.state=-1;this.videoId=FIRST;
      this.playCalls=0;this.pauseCalls=0;this.loaded=[];this.destroyed=false;players.push(this);
    }
    playVideo(){this.playCalls+=1;}
    pauseVideo(){this.pauseCalls+=1;}
    loadVideoById(id){this.loaded.push(id);this.videoId=id;}
    getVideoData(){return {video_id:this.videoId};}
    getPlayerState(){return this.state;}
    getDuration(){return 200;}
    getCurrentTime(){return 5;}
    setVolume(){}unMute(){}mute(){}isMuted(){return false;}seekTo(){}destroy(){this.destroyed=true;}
    ready(){this.events.onReady?.({target:this});}
    // A provider state change always reports the state the player is actually in.
    change(data,videoId){if(videoId)this.videoId=videoId;this.state=data;this.events.onStateChange?.({data});}
  }
  return {api:{Player},players};
}

function environment({youtube=null,counts={counts:{},total:0,today:0}}={}){
  const classes=new WeakMap();
  class Element{
    constructor(tag='div'){this.tagName=tag.toUpperCase();this.className='';this.children=[];this.attrs={};this.listeners={};this.dataset={};this.textContent='';this.disabled=false;this.hidden=false;this.value='70';this.offsetTop=0;
      const own=new Set();classes.set(this,own);
      this.classList={toggle:(name,on)=>{if(on)own.add(name);else own.delete(name);},contains:name=>own.has(name)};}
    get classes(){return classes.get(this);}
    append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=[...nodes];}
    setAttribute(name,value){this.attrs[name]=value;}getAttribute(name){return this.attrs[name];}removeAttribute(name){delete this.attrs[name];}
    addEventListener(name,fn){(this.listeners[name]??=[]).push(fn);}
    fire(name){for(const fn of this.listeners[name]??[])fn({currentTarget:this});}
    descendants(){return this.children.flatMap(child=>[child,...child.descendants()]);}
    querySelectorAll(selector){
      const match=node=>selector.startsWith('.')?String(node.className).split(/\s+/).includes(selector.slice(1)):node.tagName===selector.toUpperCase();
      return this.descendants().filter(match);
    }
    querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
    scrollIntoView(){}
    set src(value){this.attrs.src=value;}get src(){return this.attrs.src||'';}
  }
  const byId=new Map(IDS.map(id=>[id,new Element(id==='music-video'?'iframe':id==='music-tracks'?'ol':'div')]));
  byId.get('music-play').disabled=true;byId.get('music-volume').disabled=true;byId.get('music-mute').disabled=true;
  const head=new Element('head');const pageEvents={};
  const document={head,getElementById:id=>byId.get(id)??null,createElement:tag=>new Element(tag),querySelectorAll:()=>[]};
  const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
  const queue=[()=>Promise.resolve(response(counts))];const calls=[];
  const fetch=async(path,options)=>{calls.push({path,options});const next=queue.shift();if(!next)throw new Error('No queued response');return next();};
  const enqueue=(data,status=200)=>queue.push(()=>Promise.resolve(response(data,status)));
  const intervals=[];const timers=new Map();let nextTimer=1;let clock=0;
  const setTimeoutFake=(fn,delay)=>{const id=nextTimer++;timers.set(id,{fn,at:clock+Number(delay||0)});return id;};
  const clearTimeoutFake=id=>{timers.delete(id);};
  const advance=ms=>{
    clock+=ms;
    for(const [id,entry] of [...timers].sort((a,b)=>a[1].at-b[1].at)){if(entry.at<=clock){timers.delete(id);entry.fn();}}
  };
  const window={matchMedia:()=>({matches:true}),addEventListener:(name,fn)=>{pageEvents[name]=fn;},onYouTubeIframeAPIReady:undefined};
  if(youtube)window.YT=youtube.api;
  const context=vm.createContext({document,window,fetch,URL,URLSearchParams,AbortController,
    setTimeout:setTimeoutFake,clearTimeout:clearTimeoutFake,
    setInterval:(fn)=>{intervals.push(fn);return intervals.length;},clearInterval:()=>{},
    performance:{now:()=>clock},Date,Math,Number,String,JSON,Set,Map,Array,Object,Error,Promise,
    navigator:{userAgent:'Mozilla/5.0 (Windows NT 10.0)',platform:'Win32',maxTouchPoints:0},
    location:{origin:'https://jwhitedidit.net'},console});
  vm.runInContext(source,context);
  return {byId:id=>byId.get(id),head,pageEvents,window,calls,enqueue,intervals,advance,clockTick:ms=>{clock+=ms;},
    state:()=>byId.get('music-state').textContent,status:()=>byId.get('music-status').textContent,
    play:()=>byId.get('music-play'),frame:()=>byId.get('music-video'),shell:()=>byId.get('retro-player'),
    label:()=>byId.get('music-play-label').textContent,
    trackButtons:()=>byId.get('music-tracks').querySelectorAll('button'),
    posts:()=>calls.filter(call=>call.path==='/api/music-plays/post')};
}

test('the homepage player builds the full playlist and asks for the origin-correct frame',async()=>{
  const e=environment();await settle();
  assert.equal(e.trackButtons().length,26);
  assert.equal(e.byId('music-count').textContent,'26 SONGS');
  assert.match(e.frame().src,/^https:\/\/www\.youtube\.com\/embed\/XvinPCCGSxc\?/);
  assert.match(e.frame().src,/enablejsapi=1/);
  assert.match(e.frame().src,/origin=https%3A%2F%2Fjwhitedidit\.net/);
  assert.doesNotMatch(e.frame().src,/autoplay/);
  assert.equal(e.calls[0].path,'/api/music-plays');
});

test('a blocked frame API still leaves a working Play, Pause and playlist',async()=>{
  const e=environment();await settle();
  assert.equal(e.play().disabled,true,'the button starts disabled exactly as the markup ships it');
  // The API script cannot load, so the transport takes over the video frame.
  e.head.children.at(-1).onerror();
  assert.equal(e.play().disabled,false);
  assert.equal(e.state(),'USE VIDEO CONTROLS');
  e.play().fire('click');
  assert.match(e.frame().src,/autoplay=1/);
  assert.match(e.frame().src,/embed\/XvinPCCGSxc/);
  assert.equal(e.label(),'PAUSE');
  assert.equal(e.state(),'PLAYING IN VIDEO');
  // Pause reloads the frame without autoplay, which stops the audio.
  e.play().fire('click');
  assert.doesNotMatch(e.frame().src,/autoplay/);
  assert.equal(e.label(),'PLAY');
  assert.equal(e.state(),'PAUSED');
  // Picking another song works without the API and never animates unconfirmed playback.
  e.trackButtons()[4].fire('click');
  assert.match(e.frame().src,/autoplay=1/);
  assert.equal(e.byId('music-title').textContent,'Able');
  assert.equal(e.shell().classes.has('is-playing'),false);
  await settle();
  assert.equal(e.posts().length,0,'a fallback frame cannot confirm playback, so nothing is counted');
});

test('a tap answered by a silent API falls through to the video frame',async()=>{
  const e=environment();await settle();
  e.play().disabled=false;
  e.play().fire('click');
  assert.equal(e.state(),'CONNECTING');
  assert.equal(e.posts().length,0);
  e.advance(2500);
  assert.equal(e.state(),'PLAYING IN VIDEO');
  assert.match(e.frame().src,/autoplay=1/);
});

test('Play and Pause drive the frame API and only confirmed playback is counted',async()=>{
  const youtube=fakeYouTube();
  const e=environment({youtube});await settle();
  assert.equal(youtube.players.length,1);
  const player=youtube.players[0];
  player.ready();
  assert.equal(e.play().disabled,false);
  const opening=player.playCalls;
  assert.ok(opening>=1,'the player makes one arrival attempt');
  // A request alone is not a play.
  player.change(3);
  await settle();
  assert.equal(e.posts().length,0);
  assert.equal(e.shell().classes.has('is-playing'),false);
  player.change(1,FIRST);
  assert.equal(e.state(),'NOW PLAYING');
  assert.equal(e.shell().classes.has('is-playing'),true);
  assert.equal(e.label(),'PAUSE');
  await settle();
  assert.equal(e.posts().length,0,'a started song is not counted until it has really been heard');
  // Ten seconds of confirmed playback is what counts.
  e.enqueue({counts:{[FIRST]:1},total:1,today:1});
  e.clockTick(10000);
  e.intervals[0]();
  await settle();
  assert.equal(e.posts().length,1);
  const body=JSON.parse(e.posts()[0].options.body);
  assert.equal(body.video_id,FIRST);
  assert.match(body.session_id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(e.byId('music-total').textContent,'1');
  // Pause reaches the provider and does not count again.
  e.play().fire('click');
  assert.equal(player.pauseCalls,1);
  player.change(2);
  assert.equal(e.state(),'PAUSED');
  assert.equal(e.shell().classes.has('is-playing'),false);
  e.play().fire('click');
  assert.equal(player.playCalls,opening+1);
  player.change(1,FIRST);
  e.clockTick(10000);
  e.intervals[0]();
  await settle();
  assert.equal(e.posts().length,1,'the same song is only counted once per visit');
});

test('a song that cannot be embedded points at YouTube instead of pretending to play',async()=>{
  const youtube=fakeYouTube();
  const e=environment({youtube});await settle();
  const player=youtube.players[0];
  player.ready();
  player.events.onError({data:150});
  assert.equal(e.state(),'OPEN ON YOUTUBE');
  assert.match(e.status(),/cannot play here right now/i);
  assert.equal(e.byId('music-external').href,'https://www.youtube.com/watch?v='+FIRST);
  assert.equal(e.shell().classes.has('is-playing'),false);
  await settle();
  assert.equal(e.posts().length,0);
});

test('autoplay blocked by the browser is reported without counting a play',async()=>{
  const youtube=fakeYouTube();
  const e=environment({youtube});await settle();
  const player=youtube.players[0];
  player.ready();
  player.events.onAutoplayBlocked();
  assert.equal(e.state(),'TAP PLAY');
  assert.equal(e.label(),'PLAY');
  await settle();
  assert.equal(e.posts().length,0);
  // The visitor's own tap is honoured.
  e.play().fire('click');
  assert.ok(player.playCalls>=2);
});
