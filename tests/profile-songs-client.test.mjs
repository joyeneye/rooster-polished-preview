import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';

const source=fs.readFileSync(new URL('../profile-songs.js',import.meta.url),'utf8').replace('export function createProfileSongs','function createProfileSongs').replace(/createProfileSongs\(\);\s*$/,'this.player=createProfileSongs();');
const memberId='f099f8c6-6b0a-47ac-a1c2-9246fd82a412';
const otherId='28649f48-0c5e-4c58-927f-35ca09d6f605';
const SESSION_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const settle=async()=>{for(let step=0;step<4;step++)await tick();};
const revision=slot=>`00000000-0000-4000-8000-${String(slot).padStart(12,'0')}`;
const linked=(slot=1,overrides={})=>({slot,status:'approved',revision:revision(slot),title:`Song ${slot}`,duration:null,url:null,source:'link',provider:'spotify',external_url:'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC',...overrides});
const youtubeSong=(slot=1,video='dQw4w9WgXcQ')=>linked(slot,{provider:'youtube',external_url:`https://www.youtube.com/watch?v=${video}`});
const appleSong=(slot=1)=>linked(slot,{provider:'apple',external_url:'https://music.apple.com/us/album/blinding-lights/1499378108?i=1499378613'});
const legacy=(slot=1,overrides={})=>({slot,status:'approved',revision:revision(slot),title:`Song ${slot}`,duration:123,url:`/api/member-song-audio/${memberId}/${slot}/${'a'.repeat(64)}`,source:'upload',provider:null,external_url:null,...overrides});
const list=(songs=[linked()])=>({songs,max_songs:3});
const counts=(songs=[linked()],values={})=>{const byRevision=Object.fromEntries(songs.map(song=>[song.revision,values[song.revision]??0]));return{counts:byRevision,total:Object.values(byRevision).reduce((sum,value)=>sum+value,0),today:Object.values(byRevision).reduce((sum,value)=>sum+value,0),max_songs:3};};
const posts=environment=>environment.calls.filter(call=>call.path==='/api/member-music-plays/post');

// Stand-ins for the official provider embed APIs. Nothing here starts audio on its own,
// so a test must emit a provider playback event for the player to treat a song as playing.
function fakeYouTube(){
  const players=[];
  class Player{
    constructor(element,options){this.element=element;this.events=options?.events??{};this.playCalls=0;this.pauseCalls=0;this.destroyed=false;players.push(this);}
    playVideo(){this.playCalls+=1;}
    pauseVideo(){this.pauseCalls+=1;}
    destroy(){this.destroyed=true;}
    ready(){this.events.onReady?.({target:this});}
    state(data){this.events.onStateChange?.({data});}
  }
  return {api:{Player},players};
}
function fakeSpotify(){
  const controllers=[];
  const createController=(element,options,callback)=>{
    const listeners={};
    const controller={element,options,playCalls:0,pauseCalls:0,destroyed:false,
      addListener(name,fn){(listeners[name]??=[]).push(fn);},
      play(){this.playCalls+=1;},
      pause(){this.pauseCalls+=1;},
      destroy(){this.destroyed=true;},
      emit(name,data){for(const fn of listeners[name]??[])fn({data});}};
    controllers.push(controller);
    callback(controller);
  };
  return {api:{createController},controllers};
}

function environment({search=`?id=${memberId}`,responses=[],hidden=false,youtube=null,spotify=null,head=false}={}){
  class Element{
    constructor(tag='section'){this.tagName=tag.toUpperCase();this.className='';this.children=[];this.attrs={};this.listeners={};this.dataset={};this.hidden=false;this.disabled=false;this.paused=true;this.currentTime=0;this.playCalls=0;this.pauseCalls=0;this.loadCalls=0;this.textContent='';}
    append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=[...nodes];}
    setAttribute(name,value){this.attrs[name]=value;}removeAttribute(name){delete this.attrs[name];if(name==='src')this.src='';}
    addEventListener(name,fn){(this.listeners[name]??=[]).push(fn);}fire(name){for(const fn of this.listeners[name]??[])fn({currentTarget:this});}
    play(){this.playCalls+=1;this.paused=false;this.fire('play');return Promise.resolve();}pause(){this.pauseCalls+=1;this.paused=true;}load(){this.loadCalls+=1;}
    set src(value){this.attrs.src=value;}get src(){return this.attrs.src||'';}
  }
  const root=new Element();const documentEvents={};const pageEvents={};
  const document={hidden,visibilityState:hidden?'hidden':'visible',getElementById:id=>id==='profile-songs-root'?root:null,createElement:tag=>new Element(tag),addEventListener:(name,fn)=>{documentEvents[name]=fn;}};
  // A document head lets a test model a provider script that is still loading rather than blocked outright.
  const headNode=head?new Element('head'):null;
  if(headNode)document.head=headNode;
  const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
  const queue=responses.map(([data,status=200])=>()=>Promise.resolve(response(data,status)));const calls=[];
  const fetch=async(path,options)=>{calls.push({path,options});const next=queue.shift();if(!next)throw new Error('No queued response');return next();};
  const enqueue=(data,status=200)=>queue.push(()=>Promise.resolve(response(data,status)));
  const defer=()=>{let resolve;queue.push(()=>new Promise(done=>{resolve=done;}));return(data,status=200)=>resolve(response(data,status));};
  const window={location:{search,origin:'https://jwhitedidit.net'},addEventListener:(name,fn)=>{pageEvents[name]=fn;}};
  if(youtube)window.YT=youtube.api;
  if(spotify)window.SpotifyIframeApi=spotify.api;
  const context=vm.createContext({document,window,fetch,URL,URLSearchParams,AbortController,setTimeout,clearTimeout,encodeURIComponent});
  vm.runInContext(source,context);
  const nodes=(element=root)=>[element,...element.children.flatMap(child=>nodes(child))];
  const hasClass=(node,name)=>String(node.className).split(/\s+/).includes(name);
  return{root,document,documentEvents,pageEvents,calls,enqueue,defer,window,head:headNode,player:context.player,nodes,hasClass,iframes:()=>nodes().filter(node=>node.tagName==='IFRAME'),audios:()=>nodes().filter(node=>node.tagName==='AUDIO'),buttons:()=>nodes().filter(node=>node.tagName==='BUTTON'),status:()=>nodes().find(node=>hasClass(node,'member-player-status')),now:()=>nodes().find(node=>hasClass(node,'member-retro-now')),retry:()=>nodes().find(node=>node.tagName==='BUTTON'&&node.textContent==='Try again'),trackList:()=>nodes().find(node=>hasClass(node,'member-profile-tracks')),launch:()=>nodes().find(node=>hasClass(node,'member-player-launch')),shell:()=>nodes().find(node=>hasClass(node,'member-profile-player')),open:()=>nodes().find(node=>hasClass(node,'song-open-service')),playCounts:()=>nodes().filter(node=>hasClass(node,'retro-track-plays')),footer:()=>nodes().find(node=>hasClass(node,'retro-footer'))};
}
async function ready(songs=[linked()],options={}){const e=environment({responses:[[{profile:{id:memberId,name:'Artist'}}],[list(songs)],[counts(songs)]],...options});await settle();return e;}

test('the public profile keeps a compact modern ROOSTER PLAYER with no more than three linked songs',async()=>{
  const songs=[linked(1),appleSong(2),youtubeSong(3)];
  const e=await ready(songs);assert.deepEqual(e.calls.map(call=>call.path),[`/api/profile?id=${memberId}`,`/api/member-songs?id=${memberId}`,`/api/member-music-plays?id=${memberId}`]);
  assert.equal(e.root.children[1].children[0].children[0].textContent,'ROOSTER PLAYER');
  assert.equal(e.root.hidden,false);assert.equal(e.trackList().children.length,3);assert.deepEqual(e.nodes().filter(node=>e.hasClass(node,'member-retro-track-number')).map(node=>node.textContent),['01','02','03']);assert.equal(e.playCounts().length,3);assert.equal(e.footer().children[0].textContent,'3 SONGS');assert.match(e.footer().children[1].children[0].textContent,/Plays today/);assert.match(e.footer().children[1].children[1].textContent,/Total plays/);
  assert.equal(e.iframes().length,0,'outside players stay unloaded until Play');
  const third=e.trackList().children[2].children[0];third.fire('click');assert.equal(e.iframes().length,0);e.launch().fire('click');assert.equal(e.iframes().length,1);assert.match(e.iframes()[0].src,/youtube-nocookie/);assert.match(e.iframes()[0].src,/enablejsapi=1/);assert.match(e.iframes()[0].src,/origin=https%3A%2F%2Fjwhitedidit\.net/);assert.equal(e.open().textContent,'Open in YouTube ↗');
});

test('owner alias resolves to the observed member before loading music',async()=>{
  const e=await ready([linked()],{search:'?id=owner'});assert.deepEqual(e.calls.map(call=>call.path),['/api/profile?id=owner',`/api/member-songs?id=${memberId}`,`/api/member-music-plays?id=${memberId}`]);assert.equal(e.iframes().length,0);
  const fallback=environment({search:'?id=owner',responses:[[{profile:{id:'owner'}}],[list([])]]});await settle();assert.equal(fallback.root.hidden,false);assert.equal(fallback.calls.length,2);
  const songs=[linked()];const bound=environment({responses:[[{profile:{id:'owner'}}],[list(songs)],[counts(songs)]]});await settle();assert.deepEqual(bound.calls.map(call=>call.path),[`/api/profile?id=${memberId}`,`/api/member-songs?id=${memberId}`,`/api/member-music-plays?id=${memberId}`]);assert.equal(bound.iframes().length,0);
});

test('leaving Profile Music stops playback and returning waits for another Play tap',async()=>{
  const songs=[youtubeSong()];const youtube=fakeYouTube();const e=await ready(songs,{youtube});
  e.launch().fire('click');await settle();const player=youtube.players[0];player.ready();player.state(1);
  e.pageEvents['jwhite:profile-tab']({detail:{tab:'studio'}});
  assert.equal(player.destroyed,true);
  e.enqueue({profile:{id:memberId,name:'Artist'}});e.enqueue(list(songs));e.enqueue(counts(songs));
  e.pageEvents['jwhite:profile-tab']({detail:{tab:'songs'}});await settle();
  assert.equal(e.iframes().length,0);
  assert.equal(e.launch().disabled,false);
});

test('invalid profile IDs and untrusted provider links fail closed',async()=>{
  for(const search of ['', '?id=bad',`?id=${memberId}&id=owner`,`?id=${memberId.replace('f099','z099')}`]){const e=environment({search});await settle();assert.equal(e.calls.length,0);assert.equal(e.root.hidden,true);}
  for(const song of [linked(1,{external_url:'https://evil.example/song'}),linked(1,{external_url:'javascript:alert(1)'}),linked(1,{provider:'youtube',external_url:'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=steal'})]){
    const e=await ready([song]);assert.equal(e.iframes().length,0);assert.equal(e.retry().hidden,false);
  }
  const partial=await ready([linked(1),linked(2,{provider:'youtube',external_url:'https://evil.example/song'})]);assert.equal(partial.iframes().length,0);assert.equal(partial.trackList().children.length,1);
});

test('music accepts the same UUID shape as the profile backend',async()=>{
  const id='f099f8c6-12fe-0159-0ab8-ee5de849349d';
  const songs=[linked()];const e=environment({search:`?id=${id}`,responses:[[{profile:{id}}],[list(songs)],[counts(songs)]]});await settle();
  assert.deepEqual(e.calls.map(call=>call.path),[`/api/profile?id=${id}`,`/api/member-songs?id=${id}`,`/api/member-music-plays?id=${id}`]);assert.equal(e.iframes().length,0);
});

test('old approved uploads play and pause from the ROOSTER button and count only real playback',async()=>{
  const song=legacy();const e=await ready([song]);
  assert.equal(e.audios().length,0,'uploaded audio stays completely unloaded before a tap');
  e.launch().fire('click');const audio=e.audios()[0];assert.equal(e.audios().length,1);assert.equal(audio.src,song.url);assert.equal(audio.attrs.autoplay,undefined);assert.equal(audio.preload,'none');assert.equal(audio.playCalls,1);assert.equal(e.now().textContent,'LOADING SONG');assert.equal(posts(e).length,0);
  e.enqueue(counts([song],{[song.revision]:1}),201);audio.fire('playing');await settle();
  assert.equal(e.now().textContent,'NOW PLAYING');assert.equal(e.hasClass(e.shell(),'is-playing'),true);assert.equal(posts(e).length,1);assert.equal(e.playCounts()[0].textContent,'1 play');
  e.launch().fire('click');assert.equal(audio.pauseCalls,1);audio.fire('pause');
  assert.equal(e.now().textContent,'PAUSED');assert.equal(e.hasClass(e.shell(),'is-playing'),false);
  e.launch().fire('click');audio.fire('playing');await settle();assert.equal(posts(e).length,1);
  audio.fire('error');assert.match(e.status().textContent,/could not play/);assert.equal(e.retry().hidden,false);
});

test('song titles stay plain text and empty lists hide the whole player',async()=>{
  const title='<img src=x onerror=alert(1)>';const e=await ready([linked(1,{title})]);assert.equal(e.nodes().find(node=>node.tagName==='H3'&&node.textContent===title).textContent,title);assert.equal(source.includes('innerHTML'),false);
  const empty=await ready([]);assert.equal(empty.root.hidden,false);assert.equal(empty.iframes().length,0);
  // No music yet means a compact note, never a wide empty player.
  const note=empty.nodes().find(node=>empty.hasClass(node,'member-empty-note'));
  assert.ok(note&&note.hidden===false,'an empty member player shows the short note');
  assert.match(note.textContent,/Music is optional.*feature a song/);
  assert.equal(empty.shell().hidden,true,'the large player stays out of the way until a song exists');
});

test('the owner catalog appears in Profile Music and retains existing counters without autoplay',async()=>{
  const video='NSZ26l3DIKE';
  const catalog={...youtubeSong(1,video),title:'Spend Dat · Yung Miami',revision:`catalog:${video}`,catalog_video_id:video};
  const youtube=fakeYouTube();
  const e=environment({search:'?id=owner',youtube,responses:[[{profile:{id:'owner',name:'J.White Did It',verified_owner:true}}],[{...list([]),catalog_songs:[catalog]}],[{counts:{[video]:42},total:42,today:2}]]});
  await settle();assert.equal(e.trackList().children.length,1);assert.equal(e.iframes().length,0);assert.equal(youtube.players.length,0);
  assert.equal(e.playCounts()[0].textContent,'42 plays');assert.equal(e.calls[2].path,'/api/music-plays');
  e.launch().fire('click');await settle();assert.equal(youtube.players.length,1);youtube.players[0].ready();
  e.enqueue({counts:{[video]:43},total:43,today:3},201);youtube.players[0].state(1);await settle();
  const report=e.calls.find(call=>call.path==='/api/music-plays/post');assert.ok(report);assert.equal(JSON.parse(report.options.body).video_id,video);
});

test('a noncreator can feature another member’s song by reference and original audio retains its source',async()=>{
  const song={...legacy(),url:`/api/member-song-audio/${otherId}/1/${'a'.repeat(64)}`,origin:{member_id:otherId,name:'Original Artist',slot:1,revision:revision(1)},feature_id:revision(9)};
  const e=environment({responses:[[{profile:{id:memberId,name:'Barber',profession:'barber'}}],[{...list([]),featured_songs:[song]}],[counts([song])]]});
  await settle();assert.equal(e.trackList().children.length,1);assert.equal(e.iframes().length,0);assert.equal(e.audios().length,0);
  assert.equal(e.calls[2].path,`/api/member-music-plays?id=${otherId}`);
  const add=e.buttons().find(button=>button.textContent==='Add to my Profile Music');
  e.enqueue({status:'featured'},201);add.fire('click');await settle();
  const request=e.calls.find(call=>call.path==='/api/profile-music-features');
  assert.deepEqual(JSON.parse(request.options.body),{source_member_id:otherId,slot:1,revision:revision(1)});
  assert.equal(add.textContent,'Added to my Profile Music');
  e.launch().fire('click');assert.equal(e.audios()[0].src,song.url);
  e.enqueue(counts([song],{[song.revision]:1}),201);e.audios()[0].fire('playing');await settle();
  assert.equal(JSON.parse(posts(e)[0].options.body).member_id,otherId,'the original creator receives the play');
});

test('hiding the page releases provider frames and returning reloads without autoplay',async()=>{
  const e=await ready([linked()]);const external=e.open();assert.equal(e.iframes().length,0);assert.equal(external.hidden,false);e.document.hidden=true;e.document.visibilityState='hidden';e.documentEvents.visibilitychange();assert.equal(e.iframes().length,0);assert.equal(external.hidden,true);assert.equal(external.textContent,'');
  const songs=[linked(2)];e.enqueue({profile:{id:memberId}});e.enqueue(list(songs));e.enqueue(counts(songs));e.document.hidden=false;e.document.visibilityState='visible';e.documentEvents.visibilitychange();await settle();assert.equal(e.iframes().length,0);
});

test('a ROOSTER play asks YouTube to play and only a PLAYING event updates the counter',async()=>{
  const youtube=fakeYouTube();const songs=[youtubeSong(1)];const e=await ready(songs,{youtube});
  assert.equal(youtube.players.length,0);
  assert.equal(e.launch().disabled,false);assert.equal(posts(e).length,0);assert.equal(e.playCounts()[0].textContent,'0 plays');
  // Pressing Play asks YouTube to play. The press on its own is never a play.
  e.launch().fire('click');await settle();assert.equal(youtube.players.length,1);const yt=youtube.players[0];assert.equal(yt.playCalls,0);yt.ready();assert.equal(yt.playCalls,1);await settle();assert.equal(posts(e).length,0);
  assert.equal(e.now().textContent,'LOADING SONG');assert.equal(e.hasClass(e.shell(),'is-playing'),false);
  e.enqueue(counts(songs,{[songs[0].revision]:1}),201);yt.state(1);await settle();
  const post=posts(e).at(-1);const body=JSON.parse(post.options.body);
  assert.deepEqual({member_id:body.member_id,slot:body.slot,revision:body.revision},{member_id:memberId,slot:1,revision:songs[0].revision});assert.match(body.session_id,SESSION_ID);
  assert.equal(e.now().textContent,'NOW PLAYING');assert.equal(e.hasClass(e.shell(),'is-playing'),true);assert.equal(e.playCounts()[0].textContent,'1 play');
  // The same button now pauses, and buffering or resuming cannot count a second play.
  e.launch().fire('click');assert.equal(yt.pauseCalls,1);yt.state(2);assert.equal(e.now().textContent,'PAUSED');
  yt.state(3);e.launch().fire('click');yt.state(1);await settle();assert.equal(posts(e).length,1);
});

test('a play pressed while the YouTube API is still loading is queued, not counted',async()=>{
  const youtube=fakeYouTube();const songs=[youtubeSong(1)];const e=await ready(songs,{head:true});
  assert.equal(youtube.players.length,0);assert.equal(e.launch().disabled,false);assert.equal(e.head.children.length,0);
  e.launch().fire('click');assert.match(e.head.children.at(-1).src,/youtube\.com\/iframe_api/);assert.equal(e.now().textContent,'LOADING SONG');assert.equal(posts(e).length,0);
  // The API arrives late. The queued press is delivered once the player reports ready.
  e.window.YT=youtube.api;e.window.onYouTubeIframeAPIReady();await settle();
  assert.equal(youtube.players.length,1);const yt=youtube.players[0];assert.equal(yt.playCalls,0);
  yt.ready();assert.equal(yt.playCalls,1);assert.equal(posts(e).length,0);
  e.enqueue(counts(songs,{[songs[0].revision]:1}),201);yt.state(1);await settle();
  assert.equal(posts(e).length,1);assert.equal(e.now().textContent,'NOW PLAYING');
});

test('spotify playback is driven by the provider controller and a buffering frame is not a play',async()=>{
  const spotify=fakeSpotify();const songs=[linked(1)];const e=await ready(songs,{spotify});
  assert.equal(spotify.controllers.length,0);e.launch().fire('click');await settle();assert.equal(spotify.controllers.length,1);const controller=spotify.controllers[0];
  assert.equal(controller.options.uri,'spotify:track:4uLU6hMCjMI75M1A2tKUQC');
  // Spotify builds its own frame, so the fallback embed is handed over to the controller.
  assert.equal(e.iframes().length,0);assert.equal(e.launch().disabled,false);
  controller.emit('ready');await settle();assert.match(e.status().textContent,/Starting Song 1/i);assert.equal(e.now().textContent,'LOADING SONG');assert.equal(controller.playCalls,1);assert.equal(posts(e).length,0);
  controller.emit('playback_update',{isPaused:false,isBuffering:true,position:0,duration:30000});await settle();
  assert.equal(posts(e).length,0);assert.equal(e.now().textContent,'LOADING SONG');
  e.enqueue(counts(songs,{[songs[0].revision]:1}),201);
  controller.emit('playback_update',{isPaused:false,position:1200,duration:30000});await settle();
  assert.equal(posts(e).length,1);assert.equal(e.now().textContent,'NOW PLAYING');assert.equal(e.playCounts()[0].textContent,'1 play');
  e.launch().fire('click');assert.equal(controller.pauseCalls,1);
  controller.emit('playback_update',{isPaused:true,position:1200,duration:30000});assert.equal(e.now().textContent,'PAUSED');
});

test('apple music offers an open action instead of a play button and a click never counts',async()=>{
  const e=await ready([appleSong(1)]);
  assert.equal(e.iframes().length,0);
  assert.equal(e.launch().disabled,true);assert.equal(e.open().hidden,false);assert.equal(e.open().textContent,'Open in Apple Music ↗');
  assert.match(e.status().textContent,/does not allow outside play buttons/i);
  e.launch().fire('click');e.open().fire('click');await settle();
  assert.equal(posts(e).length,0);assert.equal(e.hasClass(e.shell(),'is-playing'),false);
});

test('a blocked provider API falls back to the service link and never counts a play',async()=>{
  const e=await ready([youtubeSong(1)]);
  e.launch().fire('click');await settle();
  assert.equal(e.now().textContent,'UNAVAILABLE');assert.equal(e.launch().disabled,true);
  assert.equal(e.open().hidden,false);assert.match(e.open().textContent,/Open in YouTube/);
  assert.match(e.status().textContent,/cannot play this song here right now/i);
  e.launch().fire('click');await settle();assert.equal(posts(e).length,0);
});

test('a late provider event from a replaced song cannot be counted',async()=>{
  const youtube=fakeYouTube();const songs=[youtubeSong(1),youtubeSong(2,'aQw4w9WgXcQ')];const e=await ready(songs,{youtube});
  e.launch().fire('click');await settle();const first=youtube.players[0];e.trackList().children[1].children[0].fire('click');await settle();
  assert.equal(first.destroyed,true);assert.equal(youtube.players.length,1);e.launch().fire('click');await settle();assert.equal(youtube.players.length,2);
  first.ready();first.state(1);await settle();assert.equal(posts(e).length,0);
  e.enqueue(counts(songs,{[songs[1].revision]:1}),201);youtube.players[1].state(1);await settle();
  assert.equal(posts(e).length,1);assert.equal(JSON.parse(posts(e)[0].options.body).revision,songs[1].revision);
});

test('a counter outage never stops the music',async()=>{
  const youtube=fakeYouTube();const songs=[youtubeSong(1)];const e=await ready(songs,{youtube});
  e.launch().fire('click');await settle();const yt=youtube.players[0];yt.ready();
  e.enqueue({},500);yt.state(1);await settle();
  assert.equal(posts(e).length,1);assert.equal(e.hasClass(e.shell(),'is-playing'),true);
  assert.equal(e.playCounts()[0].textContent,'Unavailable');assert.match(e.status().textContent,/counter could not connect/i);
  e.launch().fire('click');assert.equal(yt.pauseCalls,1);
});

test('late responses cannot restore a player after pagehide',async()=>{
  const e=await ready([linked()]);e.enqueue({profile:{id:memberId}});const finish=e.defer();void e.player.refresh();await settle();const pending=e.calls.at(-1);e.pageEvents.pagehide();assert.equal(pending.options.signal.aborted,true);finish(list([linked(2)]));await settle();assert.equal(e.iframes().length,0);
});
