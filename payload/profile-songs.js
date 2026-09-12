const MEMBER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDER_NAMES = {apple:'Apple Music',spotify:'Spotify',youtube:'YouTube'};

function youtubeEmbed(id) {
  const origin = typeof window.location?.origin === 'string' && /^https?:\/\/[^/]+$/.test(window.location.origin)
    ? window.location.origin : 'https://jwhitedidit.net';
  return `https://www.youtube-nocookie.com/embed/${id}?playsinline=1&rel=0&enablejsapi=1&origin=${encodeURIComponent(origin)}`;
}

function profileId() {
  const values = new URLSearchParams(window.location.search).getAll('id');
  return values.length === 1 && (values[0] === 'owner' || MEMBER_ID.test(values[0])) ? values[0].toLowerCase() : null;
}

function linkedSong(song) {
  if (song?.source !== 'link' || !['apple','spotify','youtube'].includes(song.provider) || typeof song.external_url !== 'string') return null;
  let input;
  try { input = new URL(song.external_url); } catch { return null; }
  if (input.protocol !== 'https:' || input.username || input.password || input.port || input.hash) return null;
  const host = input.hostname.toLowerCase();
  if (song.provider === 'spotify' && host === 'open.spotify.com') {
    const match = /^\/track\/([a-zA-Z0-9]{22})\/?$/.exec(input.pathname);
    if (!match || input.search) return null;
    return {provider:'spotify',url:`https://open.spotify.com/track/${match[1]}`,embed:`https://open.spotify.com/embed/track/${match[1]}?theme=0`};
  }
  if (song.provider === 'apple' && host === 'music.apple.com') {
    const match = /^\/([a-z]{2})\/(album|song)\/([a-zA-Z0-9._~%-]+)\/(\d+)\/?$/i.exec(input.pathname);
    const songId = input.searchParams.get('i');
    if (!match || (match[2].toLowerCase() === 'album' && (!songId || !/^\d+$/.test(songId))) || [...input.searchParams.keys()].some(key=>key !== 'i')) return null;
    const base = `https://music.apple.com/${match[1].toLowerCase()}/${match[2].toLowerCase()}/${match[3]}/${match[4]}`;
    const url = songId && /^\d+$/.test(songId) ? `${base}?i=${songId}` : base;
    if (url !== song.external_url) return null;
    return {provider:'apple',url,embed:url.replace('https://music.apple.com/','https://embed.music.apple.com/')};
  }
  if (song.provider === 'youtube' && host === 'www.youtube.com' && input.pathname === '/watch') {
    const id = input.searchParams.get('v');
    if (!id || !/^[a-zA-Z0-9_-]{11}$/.test(id) || [...input.searchParams.keys()].some(key=>key !== 'v')) return null;
    const url = `https://www.youtube.com/watch?v=${id}`;
    if (url !== song.external_url) return null;
    return {provider:'youtube',url,embed:youtubeEmbed(id)};
  }
  return null;
}

function songList(data, memberId) {
  if (data?.max_songs !== 3 || !Array.isArray(data.songs) || data.songs.length > 3) throw new Error('Invalid song list');
  const slots = new Set(); const songs = [];
  for (const song of data.songs) {
    try {
      if (!song || !Number.isInteger(song.slot) || song.slot < 1 || song.slot > 3 || slots.has(song.slot) ||
          typeof song.revision !== 'string' || !MEMBER_ID.test(song.revision) ||
          song.status !== 'approved' || typeof song.title !== 'string' || !song.title.trim() || song.title.length > 120 ||
          !['link','upload'].includes(song.source)) throw new Error('Invalid song');
      const link = linkedSong(song);
      if (song.source === 'link' && !link) throw new Error('Invalid song link');
      let audio = null;
      if (song.source === 'upload') {
        if (!Number.isFinite(song.duration) || song.duration <= 0 || song.duration > 600 || typeof song.url !== 'string') throw new Error('Invalid song audio');
        const route = `/api/member-song-audio/${memberId}/${song.slot}/`;
        if (!song.url.startsWith(route) || !/^[0-9a-f]{64}$/.test(song.url.slice(route.length))) throw new Error('Invalid audio location');
        audio = song.url;
      }
      slots.add(song.slot); songs.push({slot:song.slot,revision:song.revision.toLowerCase(),title:song.title.trim(),source:song.source,link,audio});
    } catch { /* Keep the other valid tracks available. */ }
  }
  if (!songs.length && data.songs.length) throw new Error('Invalid song list');
  return songs.sort((first, second) => first.slot - second.slot);
}


// Load each official player API once. Keep native embeds usable when an API is blocked.
const playbackAPIs = new Map();
function loadPlaybackAPI(provider) {
  const present = provider === 'youtube' ? window.YT : window.__rosterSpotifyAPI;
  if (provider === 'youtube' ? present?.Player : present?.createController) return Promise.resolve(present);
  if (playbackAPIs.has(provider)) return playbackAPIs.get(provider);
  const promise = new Promise((resolve, reject) => {
    if (!document.head?.append) { reject(new Error('Player API unavailable')); return; }
    const callback = provider === 'youtube' ? 'onYouTubeIframeAPIReady' : 'onSpotifyIframeApiReady';
    const previous = window[callback];
    let finished = false;
    const timeout = setTimeout(() => finish(null), 12000);
    function finish(api) {
      if (finished) return;
      finished = true; clearTimeout(timeout);
      if (api) resolve(api); else reject(new Error('Player API unavailable'));
    }
    window[callback] = api => {
      if (provider === 'spotify') window.__rosterSpotifyAPI = api;
      try { if (typeof previous === 'function') previous(api); } catch { /* Another player must not block this one. */ }
      finally { finish(provider === 'youtube' ? window.YT : api); }
    };
    const script = document.createElement('script'); script.async = true;
    script.src = provider === 'youtube' ? 'https://www.youtube.com/iframe_api' : 'https://open.spotify.com/embed/iframe-api/v1';
    script.addEventListener('error', () => finish(null), {once:true});
    document.head.append(script);
  });
  playbackAPIs.set(provider, promise);
  promise.catch(() => { if (playbackAPIs.get(provider) === promise) playbackAPIs.delete(provider); });
  return promise;
}

function linkedTransport({link, frame, container, active, onState, onStart, onError}) {
  let disposed = false, controller = null, ready = false, pending = false, playing = false, requestTimer = null;
  let mount = null, apiFailed = false, readyTimer = null;
  const expectedURI = link.provider === 'spotify' ? `spotify:track:${new URL(link.url).pathname.split('/').pop()}` : null;
  const alive = () => !disposed && active();
  function fail(message) {
    if (!alive()) return;
    pending = false; playing = false; clearTimeout(requestTimer); onState(false); onError(message);
  }
  function start() {
    if (!alive()) return;
    pending = false; playing = true; clearTimeout(requestTimer); onState(true); onStart();
  }
  function command() {
    if (!alive()) return;
    if (!ready) { pending = true; return; }
    pending = false;
    try {
      if (playing) {
        if (link.provider === 'youtube') controller.pauseVideo(); else controller.pause();
      } else {
        // These documented calls request real playback, not a simulated play counter.
        clearTimeout(requestTimer);
        requestTimer = setTimeout(() => fail('Tap Play inside the embedded player, or use the service link below.'), 10000);
        const result = link.provider === 'youtube' ? controller.playVideo() : controller.play();
        result?.catch?.(() => fail('Playback needs a tap inside the embedded player.'));
      }
    } catch { fail('Use Play inside the embedded player, or open the song with the service link below.'); }
  }
  function becameReady() {
    if (!alive()) { try { controller?.destroy?.(); } catch {} return; }
    ready = true; apiFailed = false; clearTimeout(readyTimer);
    if (pending) command();
  }
  if (link.provider !== 'apple') {
    readyTimer = setTimeout(() => {apiFailed=true;fail('The player controls could not connect. Use Play inside the embedded player or the service link below.');}, 15000);
    loadPlaybackAPI(link.provider).then(api => {
      if (!alive()) return;
      if (link.provider === 'youtube') {
        controller = new api.Player(frame, {events:{
          onReady: becameReady,
          onStateChange(event) {
            if (!alive()) return;
            if (event.data === 1) start();
            else if ([0,2,3,5].includes(event.data)) {
              playing = false; onState(false);
              if (event.data !== 3) clearTimeout(requestTimer);
            }
          },
          onAutoplayBlocked: () => fail('Your browser needs a tap. Use Play inside the YouTube video.'),
          onError: () => fail('This video cannot play here. Open it on YouTube using the link below.')
        }});
      } else {
        mount = document.createElement('div'); const target = document.createElement('div');
        mount.hidden = true; mount.append(target); container.append(mount);
        api.createController(target, {uri:expectedURI,width:'100%',height:152}, value => {
          if (!alive()) { try { value.destroy(); } catch {} return; }
          controller = value; frame.hidden = true; frame.removeAttribute('src'); mount.hidden = false;
          controller.addListener('ready', becameReady);
          controller.addListener('playback_started', event => {if (!event?.data?.playingURI || event.data.playingURI === expectedURI) start();});
          controller.addListener('playback_update', event => {
            if (!alive()) return;
            const data = event?.data;
            if (!data || typeof data.isPaused !== 'boolean' || (data.playingURI && data.playingURI !== expectedURI)) return;
            if (!data.isPaused && !data.isBuffering && Number(data.position) > 0) start();
            else if (data.isPaused) { playing = false; clearTimeout(requestTimer); onState(false); }
          });
          // Wait for the documented ready event before sending a queued Play request.
        });
      }
    }).catch(() => {apiFailed = true; clearTimeout(readyTimer); fail('The player controls could not connect. Use Play inside the embedded player or the service link below.');});
  }
  return {
    toggle() {
      if (!alive()) return;
      if (link.provider === 'apple') {
        // Apple embeds do not expose a public external Play API. Be explicit, never fake playback.
        window.open?.(link.url, '_blank', 'noopener,noreferrer');
        onError('Apple Music opened in a new tab. Full playback is controlled by Apple Music.');
        return;
      }
      if (apiFailed) { fail('The player controls could not connect. Use Play inside the embedded player or the service link below.'); return; }
      if (!ready) {
        pending = !pending;
        onError(pending ? 'Connecting the player. You can also tap Play inside the embed.' : 'Playback request cancelled. Press Play to try again.');
        return;
      }
      command();
    },
    destroy() {
      disposed = true; pending = false; clearTimeout(requestTimer); clearTimeout(readyTimer);
      try { controller?.destroy?.(); } catch {}
      controller = null;
    }
  };
}

function releaseAudio(audio) {
  audio.pause(); audio.removeAttribute('src'); audio.load();
}

export function createProfileSongs() {
  const root = document.getElementById('profile-songs-root');
  if (!root) return null;
  const id = profileId(); root.hidden = true;
  if (!id) return null;
  root.className = `${root.className || ''} song-public`.trim();

  const heading = document.createElement('div'); heading.className = 'song-heading song-player-heading';
  const headingTitle = document.createElement('h2'); headingTitle.textContent = '♫ Profile Music';
  const limit = document.createElement('span'); limit.className = 'song-player-limit'; limit.textContent = '3 SONG MAX';
  heading.append(headingTitle,limit);
  const shell = document.createElement('div'); shell.className = 'retro-player member-profile-player';
  const titlebar = document.createElement('div'); titlebar.className = 'retro-titlebar';
  const wordmark = document.createElement('span'); wordmark.className = 'retro-wordmark'; wordmark.textContent = 'ROOSTER PLAYER';
  const owner = document.createElement('span'); owner.className = 'retro-owner'; owner.textContent = 'ROOSTER MEMBER';
  titlebar.append(wordmark,owner);
  const body = document.createElement('div'); body.className = 'retro-body';
  const player = document.createElement('div'); player.className = 'retro-video member-profile-media';
  const deck = document.createElement('div'); deck.className = 'retro-deck';
  const transport = document.createElement('div'); transport.className = 'retro-transport member-player-transport';
  const previous = document.createElement('button'); previous.type = 'button'; previous.className = 'retro-button'; previous.textContent = '◀◀'; previous.setAttribute('aria-label','Previous song');
  const launch = document.createElement('button'); launch.type = 'button'; launch.className = 'retro-button retro-play member-player-launch'; launch.setAttribute('aria-label','Play selected song');
  const launchSymbol = document.createElement('span'); launchSymbol.className = 'member-player-play-symbol'; launchSymbol.setAttribute('aria-hidden','true'); launchSymbol.textContent = '▶'; launch.append(launchSymbol);
  const next = document.createElement('button'); next.type = 'button'; next.className = 'retro-button'; next.textContent = '▶▶'; next.setAttribute('aria-label','Next song');
  const controlNote = document.createElement('span'); controlNote.className = 'member-player-control-note'; controlNote.textContent = 'ROOSTER PLAY';
  transport.append(previous,launch,next,controlNote);
  const display = document.createElement('div'); display.className = 'retro-display';
  const displayTop = document.createElement('div'); displayTop.className = 'retro-display-top';
  const now = document.createElement('span'); now.className = 'member-retro-now'; now.textContent = 'READY TO PLAY';
  const meter = document.createElement('span'); meter.className = 'retro-equalizer'; meter.setAttribute('aria-hidden','true');
  for (let index = 0; index < 5; index++) meter.append(document.createElement('i'));
  displayTop.append(now,meter);
  const title = document.createElement('h3'); title.textContent = 'Choose a song';
  const service = document.createElement('p'); service.textContent = 'Apple Music · Spotify · YouTube';
  display.append(displayTop,title,service);
  const status = document.createElement('p'); status.className = 'retro-status member-player-status'; status.setAttribute('role','status'); status.setAttribute('aria-live','polite');
  const external = document.createElement('a'); external.className = 'song-open-service'; external.target = '_blank'; external.rel = 'noopener noreferrer'; external.hidden = true;
  deck.append(transport,display,status,external); body.append(player,deck);
  const library = document.createElement('div'); library.className = 'retro-library';
  const tracks = document.createElement('ol'); tracks.className = 'retro-tracks member-profile-tracks'; library.append(tracks);
  const footer = document.createElement('div'); footer.className = 'retro-footer';
  const songCount = document.createElement('span'); songCount.className = 'member-player-song-count'; songCount.textContent = '0 SONGS';
  const totals = document.createElement('div'); totals.className = 'retro-play-totals';
  const todayLine = document.createElement('span'); todayLine.textContent = 'Plays today: ';
  const today = document.createElement('b'); today.textContent = '…'; todayLine.append(today);
  const totalLine = document.createElement('span'); totalLine.textContent = 'Total plays: ';
  const total = document.createElement('b'); total.textContent = '…'; totalLine.append(total);
  totals.append(todayLine,totalLine); footer.append(songCount,totals);
  shell.append(titlebar,body,library,footer);
  const actions = document.createElement('div'); actions.className = 'song-actions';
  const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Try again'; retry.hidden = true; actions.append(retry);
  root.replaceChildren(heading,shell,actions);

  const playCountNodes = new Map(); const reportControllers = new Set(); const activeReports = new Set(); const confirmedReports = new Set();
  let generation = 0; let counterGeneration = 0; let request = null; let countRequest = null; let currentAudio = null;
  let transportController = null;
  let currentSong = null; let currentSongs = []; let currentButtons = []; let currentMemberId = null; let pageSuspended = false; let needsRefresh = true;
  function musicSession() {
    const storageKey = 'jspace-member-music-visit-v1'; let saved = null;
    try { saved = sessionStorage.getItem(storageKey); } catch { /* Session storage can be unavailable. */ }
    if (saved && SESSION_ID.test(saved)) return saved.toLowerCase();
    const value = globalThis.crypto?.randomUUID?.() || '10000000-1000-4000-8000-100000000000'.replace(/[018]/g,digit=>(Number(digit)^Math.random()*16>>Number(digit)/4).toString(16));
    try { sessionStorage.setItem(storageKey,value); } catch { /* In-memory dedupe still protects this page. */ }
    return value;
  }
  const sessionId = musicSession();
  const visible = () => !pageSuspended && !document.hidden && document.visibilityState !== 'hidden';
  function releasePlayer() {
    transportController?.destroy(); transportController = null;
    launchSymbol.textContent = '▶'; launch.setAttribute('aria-pressed','false');
    shell.classList?.remove('is-playing');
    if (currentAudio) releaseAudio(currentAudio);
    currentAudio = null; player.replaceChildren(); external.hidden = true; external.removeAttribute('href'); external.textContent = '';
  }
  function releaseCounters() {
    counterGeneration += 1; countRequest?.abort(); countRequest = null;
    reportControllers.forEach(controller=>controller.abort()); reportControllers.clear(); activeReports.clear();
  }
  function suspend() {
    generation += 1; request?.abort(); request = null; releaseCounters(); releasePlayer(); needsRefresh = true; retry.disabled = false; root.setAttribute('aria-busy','false');
  }
  function playText(value) { return `${value.toLocaleString('en-US')} ${value === 1 ? 'play' : 'plays'}`; }
  function unavailableCounts() {
    playCountNodes.forEach(node=>{node.textContent='Unavailable';}); today.textContent = 'Unavailable'; total.textContent = 'Unavailable';
  }
  function applyCounts(data, songs) {
    if (!data || data.max_songs !== 3 || !data.counts || typeof data.counts !== 'object' || Array.isArray(data.counts) ||
        !Number.isSafeInteger(data.total) || data.total < 0 || !Number.isSafeInteger(data.today) || data.today < 0 || data.today > data.total) throw new Error('Invalid play counts');
    const revisions = songs.map(song=>song.revision); const keys = Object.keys(data.counts);
    if (keys.length !== revisions.length || keys.some(key=>!revisions.includes(key))) throw new Error('Invalid play counts');
    let sum = 0;
    songs.forEach(song=>{const value=data.counts[song.revision];if(!Number.isSafeInteger(value)||value<0)throw new Error('Invalid play counts');sum+=value;});
    if (sum > data.total) throw new Error('Invalid play counts');
    songs.forEach(song=>{const node=playCountNodes.get(song.revision);if(node)node.textContent=playText(data.counts[song.revision]);});
    today.textContent = data.today.toLocaleString('en-US'); total.textContent = data.total.toLocaleString('en-US');
  }
  async function loadCounts(memberId, songs, epoch) {
    countRequest?.abort(); const sequence = ++counterGeneration; const controller = new AbortController(); countRequest = controller;
    try {
      const response = await fetch(`/api/member-music-plays?id=${encodeURIComponent(memberId)}`,{credentials:'omit',cache:'no-store',redirect:'error',headers:{Accept:'application/json'},signal:controller.signal});
      if (!response.ok) throw new Error('Play counts unavailable'); const data = await response.json();
      if (epoch === generation && sequence === counterGeneration && visible()) applyCounts(data,songs);
    } catch { if (epoch === generation && sequence === counterGeneration && visible()) unavailableCounts(); }
    finally { if (countRequest === controller) countRequest = null; }
  }
  async function reportPlay(song, epoch) {
    if (!currentMemberId || epoch !== generation || !visible()) return;
    const key = `${currentMemberId}:${song.revision}`;
    if (activeReports.has(key) || confirmedReports.has(key)) return;
    activeReports.add(key); countRequest?.abort(); countRequest = null; const sequence = ++counterGeneration;
    const controller = new AbortController(); reportControllers.add(controller);
    try {
      const response = await fetch('/api/member-music-plays/post',{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({member_id:currentMemberId,slot:song.slot,revision:song.revision,session_id:sessionId}),signal:controller.signal});
      if (!response.ok) throw new Error('Play count unavailable'); const data = await response.json(); confirmedReports.add(key);
      if (epoch === generation && sequence === counterGeneration && visible()) applyCounts(data,currentSongs);
    } catch {
      if (epoch === generation && sequence === counterGeneration && visible()) { unavailableCounts(); /* Counter errors must not overwrite playback state or interrupt the song. */ }
    } finally { activeReports.delete(key); reportControllers.delete(controller); }
  }
  function select(song, buttons, epoch) {
    if (epoch !== generation || !visible()) return;
    releasePlayer(); currentSong = song; title.textContent = song.title; now.textContent = 'READY TO PLAY'; launch.disabled = false;
    previous.disabled = buttons.length < 2; next.disabled = buttons.length < 2;
    buttons.forEach(button=>button.setAttribute('aria-current',String(button.dataset.revision === song.revision)));
    if (song.link) {
      service.textContent = PROVIDER_NAMES[song.link.provider];
      const frame = document.createElement('iframe'); frame.className = `song-embed song-embed-${song.link.provider}`; frame.src = song.link.embed;
      frame.title = `${song.title} on ${PROVIDER_NAMES[song.link.provider]}`; frame.loading = 'eager';
      frame.setAttribute('allow','autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture'); frame.setAttribute('referrerpolicy','strict-origin-when-cross-origin'); frame.setAttribute('allowfullscreen','');
      frame.addEventListener('error',()=>{if(epoch===generation&&visible()&&currentSong?.revision===song.revision){status.textContent=`The ${PROVIDER_NAMES[song.link.provider]} player was blocked. Use the button below to open the song.`;}});
      player.append(frame);
      launch.setAttribute('aria-label',song.link.provider === 'apple' ? 'Open song in Apple Music' : 'Play selected song');
      launch.title = song.link.provider === 'apple' ? 'Open in Apple Music' : 'Play or pause this song';
      controlNote.textContent = song.link.provider === 'apple' ? 'OPEN APPLE MUSIC' : 'PLAY / PAUSE';
      transportController = linkedTransport({link:song.link,frame,container:player,
        active:()=>epoch===generation&&visible()&&currentSong?.revision===song.revision,
        onState(isPlaying) {
          now.textContent=isPlaying?'NOW PLAYING':'READY TO PLAY';
          launchSymbol.textContent=isPlaying?'Ⅱ':'▶';
          launch.setAttribute('aria-pressed',String(isPlaying));
          launch.setAttribute('aria-label',isPlaying?'Pause song':'Play selected song');
          shell.classList?.toggle('is-playing',isPlaying);
          status.textContent=isPlaying?`Playing ${song.title}.`:'Playback is paused, ended or waiting for the service. Press Play to resume.';
        },
        onStart:()=>void reportPlay(song,epoch),
        onError:message=>{status.textContent=message;}
      });
      external.href = song.link.url; external.textContent = `Open in ${PROVIDER_NAMES[song.link.provider]} ↗`; external.hidden = false;
    } else {
      service.textContent = 'Uploaded song';
      controlNote.textContent = 'PLAY / PAUSE';
      launch.setAttribute('aria-label','Play selected song');
      launch.title='Play or pause this song';
      const audio = document.createElement('audio'); audio.controls = true; audio.preload = 'metadata'; audio.src = song.audio; audio.setAttribute('aria-label',`Play ${song.title}`);
      audio.addEventListener('error',()=>{if(currentAudio===audio&&epoch===generation&&visible()){status.textContent='This song could not play just now. Tap Try again.';retry.hidden=false;}});
      audio.addEventListener('playing',()=>{if(currentAudio===audio&&epoch===generation&&visible()){now.textContent='NOW PLAYING';launchSymbol.textContent='Ⅱ';launch.setAttribute('aria-pressed','true');launch.setAttribute('aria-label','Pause song');status.textContent=`Playing ${song.title}.`;shell.classList?.add('is-playing');void reportPlay(song,epoch);}});
      audio.addEventListener('pause',()=>{if(currentAudio===audio&&epoch===generation&&visible()){now.textContent='READY TO PLAY';launchSymbol.textContent='▶';launch.setAttribute('aria-pressed','false');launch.setAttribute('aria-label','Play selected song');status.textContent='Press Play to listen again.';shell.classList?.remove('is-playing');}});
      audio.addEventListener('ended',()=>{if(currentAudio===audio&&epoch===generation&&visible()){now.textContent='READY TO PLAY';launchSymbol.textContent='▶';launch.setAttribute('aria-pressed','false');launch.setAttribute('aria-label','Play selected song');status.textContent='Press Play to listen again.';shell.classList?.remove('is-playing');}});
      currentAudio = audio; player.append(audio); external.hidden = true;
    }
    status.textContent = !song.link ? 'Press Play or use the audio controls.' : song.link.provider === 'apple' ? 'Preview here, or use the blue button to open Apple Music. Full playback may require signing in.' : song.link.provider === 'spotify' ? 'Press Play. Spotify may offer a preview depending on your account and browser.' : 'Press Play to start this song. Playback availability is controlled by YouTube.';
  }
  function move(amount) {
    if (!currentSong || currentSongs.length < 2) return;
    const index = currentSongs.findIndex(song=>song.revision===currentSong.revision); select(currentSongs[(index+amount+currentSongs.length)%currentSongs.length],currentButtons,generation);
  }
  previous.addEventListener('click',()=>move(-1)); next.addEventListener('click',()=>move(1));
  launch.addEventListener('click',()=>{
    if (!currentSong || !visible()) return;
    if (currentAudio) {
      if (!currentAudio.paused) { currentAudio.pause(); return; }
      const audio = currentAudio;
      const started=audio.play();
      if(started?.catch)started.catch(()=>{if(currentAudio===audio)status.textContent='Tap play in the audio controls to start this song.';});
    } else transportController?.toggle();
  });
  // Opening an external app is not proof that somebody listened. Do not inflate play counts.
  async function refresh() {
    if (!visible()) return;
    request?.abort(); releaseCounters(); const epoch = ++generation; const controller = new AbortController(); request = controller;
    const timeout = setTimeout(()=>controller.abort(),15000); releasePlayer(); tracks.replaceChildren(); playCountNodes.clear(); currentSongs=[];currentButtons=[];currentMemberId=null;currentSong=null;root.hidden = false;
    songCount.textContent='0 SONGS';today.textContent='…';total.textContent='…';launch.disabled=true;previous.disabled=true;next.disabled=true;
    root.setAttribute('aria-busy','true'); retry.hidden = true; retry.disabled = true; status.textContent = 'Loading music…'; needsRefresh = false;
    const options = {credentials:'omit',cache:'no-store',redirect:'error',headers:{Accept:'application/json'},signal:controller.signal};
    try {
      const profileResponse = await fetch(`/api/profile?id=${encodeURIComponent(id)}`,options);
      if (epoch !== generation || !visible()) return;
      if (profileResponse.status === 404) {root.hidden=true;status.textContent='';return;}
      if (!profileResponse.ok) throw new Error('Profile unavailable');
      const profileData = await profileResponse.json(); if (epoch !== generation || !visible()) return;
      const observedId = profileData?.profile?.id;
      if (id === 'owner' && observedId === 'owner') {root.hidden=true;status.textContent='';return;}
      const memberId = typeof observedId === 'string' && MEMBER_ID.test(observedId)
        ? observedId.toLowerCase()
        : observedId === 'owner' && MEMBER_ID.test(id) ? id : null;
      if (!memberId || (id !== 'owner' && memberId !== id)) throw new Error('Invalid profile');
      const memberName = typeof profileData?.profile?.name === 'string' ? profileData.profile.name.trim() : '';
      owner.textContent = memberName && memberName.length <= 60 ? memberName : 'ROOSTER MEMBER';
      const response = await fetch(`/api/member-songs?id=${encodeURIComponent(memberId)}`,options); if (epoch !== generation || !visible()) return;
      if (response.status === 404) {root.hidden=true;status.textContent='';return;}
      if (!response.ok) throw new Error('Songs unavailable');
      const songs = songList(await response.json(),memberId); if (epoch !== generation || !visible()) return;
      if (!songs.length) {root.hidden=true;status.textContent='';return;}
      const buttons = songs.map(song=>{
        const item=document.createElement('li'); const button=document.createElement('button'); button.type='button'; button.className='retro-track member-profile-track'; button.dataset.slot=String(song.slot); button.dataset.revision=song.revision;
        button.setAttribute('aria-label',`Select ${song.title}`);
        const number=document.createElement('span'); number.className='retro-track-number member-retro-track-number'; number.textContent=String(song.slot).padStart(2,'0');
        const details=document.createElement('span'); const label=document.createElement('span'); label.className='retro-track-title'; label.textContent=song.title;
        const provider=document.createElement('span'); provider.className='retro-track-artist'; provider.textContent=song.link?PROVIDER_NAMES[song.link.provider]:'MySpace Music'; details.append(label,provider);
        const symbol=document.createElement('span');symbol.className='retro-track-symbol';symbol.setAttribute('aria-hidden','true');symbol.textContent='▶';
        const count=document.createElement('span');count.className='retro-track-plays';count.textContent='…';count.title='Plays recorded on ROOSTER';playCountNodes.set(song.revision,count);
        button.append(number,details,symbol,count); button.addEventListener('click',()=>select(song,buttons,epoch)); item.append(button); tracks.append(item); return button;
      });
      currentMemberId=memberId;currentSongs=songs;currentButtons=buttons;songCount.textContent=`${songs.length} ${songs.length===1?'SONG':'SONGS'}`;
      root.hidden=false; select(songs[0],buttons,epoch); void loadCounts(memberId,songs,epoch);
    } catch {
      if (epoch === generation && visible()) {root.hidden=false;status.textContent='Music could not load just now. Tap Try again.';retry.hidden=false;}
    } finally {
      clearTimeout(timeout); if (epoch === generation) {request=null;retry.disabled=false;root.setAttribute('aria-busy','false');}
    }
  }
  retry.addEventListener('click',()=>void refresh());
  document.addEventListener('visibilitychange',()=>{if(!visible())suspend();else if(needsRefresh)void refresh();});
  window.addEventListener('pagehide',()=>{pageSuspended=true;suspend();});
  window.addEventListener('pageshow',()=>{pageSuspended=false;if(needsRefresh)void refresh();});
  void refresh(); return {refresh};
}

createProfileSongs();
