const MEMBER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDER_NAMES = {apple:'Apple Music',spotify:'Spotify',youtube:'YouTube'};
// Apple Music publishes no transport API for its embed, so ROOSTER never offers a Play button it cannot honour.
const CONTROLLABLE = {apple:false,spotify:true,youtube:true};
const YOUTUBE_API = 'https://www.youtube.com/iframe_api';
const SPOTIFY_API = 'https://open.spotify.com/embed/iframe-api/v1';
const PROVIDER_TIMEOUT = 12000;

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
    return {provider:'spotify',id:match[1],url:`https://open.spotify.com/track/${match[1]}`,embed:`https://open.spotify.com/embed/track/${match[1]}?theme=0`};
  }
  if (song.provider === 'apple' && host === 'music.apple.com') {
    const match = /^\/([a-z]{2})\/(album|song)\/([a-zA-Z0-9._~%-]+)\/(\d+)\/?$/i.exec(input.pathname);
    const songId = input.searchParams.get('i');
    if (!match || (match[2].toLowerCase() === 'album' && (!songId || !/^\d+$/.test(songId))) || [...input.searchParams.keys()].some(key=>key !== 'i')) return null;
    const base = `https://music.apple.com/${match[1].toLowerCase()}/${match[2].toLowerCase()}/${match[3]}/${match[4]}`;
    const url = songId && /^\d+$/.test(songId) ? `${base}?i=${songId}` : base;
    if (url !== song.external_url) return null;
    return {provider:'apple',id:songId || match[4],url,embed:url.replace('https://music.apple.com/','https://embed.music.apple.com/')};
  }
  if (song.provider === 'youtube' && host === 'www.youtube.com' && input.pathname === '/watch') {
    const id = input.searchParams.get('v');
    if (!id || !/^[a-zA-Z0-9_-]{11}$/.test(id) || [...input.searchParams.keys()].some(key=>key !== 'v')) return null;
    const url = `https://www.youtube.com/watch?v=${id}`;
    if (url !== song.external_url) return null;
    return {provider:'youtube',id,url,embed:youtubeEmbed(id)};
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

function catalogSongList(records = []) {
  if (!Array.isArray(records) || records.length > 26) throw new Error('Invalid catalog');
  return records.map(song => {
    const link = linkedSong(song);
    if (!link || link.provider !== 'youtube' || song.status !== 'approved' || song.catalog_video_id !== link.id
      || song.revision !== `catalog:${link.id}` || !Number.isInteger(song.slot) || song.slot < 1 || song.slot > 26
      || typeof song.title !== 'string' || !song.title.trim() || song.title.length > 180) throw new Error('Invalid catalog song');
    return {slot:song.slot,revision:song.revision,title:song.title,source:'link',link,audio:null,catalogVideoId:link.id,
      origin:{member_id:'owner',name:'J.White Did It',slot:song.slot,revision:song.revision}};
  });
}

function featuredSongList(records = []) {
  if (!Array.isArray(records) || records.length > 3) throw new Error('Invalid featured music');
  return records.flatMap(record => {
    if (!MEMBER_ID.test(record?.feature_id || '')) return [];
    if (record.catalog_video_id) return catalogSongList([record]).map(song => ({...song,featureId:record.feature_id}));
    const origin = record.origin;
    if (!MEMBER_ID.test(origin?.member_id || '') || typeof origin.name !== 'string' || origin.name.length > 60) return [];
    return songList({songs:[record],max_songs:3},origin.member_id).map(song => ({...song,origin,featureId:record.feature_id}));
  });
}

function releaseAudio(audio) {
  audio.pause(); audio.removeAttribute('src'); audio.load();
}

// The player never depends on classList so the same code runs in the offline DOM used by the tests.
function toggleClass(node, name, on) {
  const parts = String(node.className || '').split(/\s+/).filter(Boolean).filter(part => part !== name);
  if (on) parts.push(name);
  node.className = parts.join(' ');
}

const scriptLoads = new Map();
// A provider script is fetched at most once per page. A blocked provider is allowed to be retried by a later song.
function loadProviderScript(url) {
  if (scriptLoads.has(url)) return scriptLoads.get(url);
  const pending = new Promise((resolve, reject) => {
    const head = document?.head || document?.body;
    if (!head?.append || typeof document?.createElement !== 'function') { reject(new Error('Provider scripts are unavailable')); return; }
    const element = document.createElement('script');
    element.src = url; element.async = true;
    element.onload = () => resolve();
    element.onerror = () => reject(new Error('Provider script was blocked'));
    head.append(element);
  });
  pending.catch(() => scriptLoads.delete(url));
  scriptLoads.set(url, pending);
  return pending;
}

let youtubeApiReady = null;
function youtubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!youtubeApiReady) {
    youtubeApiReady = new Promise((resolve, reject) => {
      const previous = typeof window.onYouTubeIframeAPIReady === 'function' ? window.onYouTubeIframeAPIReady : null;
      window.onYouTubeIframeAPIReady = () => {
        try { previous?.(); } catch { /* Another player on the page must not block this one. */ }
        if (window.YT?.Player) resolve(window.YT); else reject(new Error('YouTube API is incomplete'));
      };
      loadProviderScript(YOUTUBE_API).catch(reject);
    });
    youtubeApiReady.catch(() => { youtubeApiReady = null; });
  }
  return youtubeApiReady;
}

let spotifyApiReady = null;
function spotifyApi() {
  if (window.SpotifyIframeApi?.createController) return Promise.resolve(window.SpotifyIframeApi);
  if (!spotifyApiReady) {
    spotifyApiReady = new Promise((resolve, reject) => {
      window.onSpotifyIframeApiReady = api => {
        if (api?.createController) { window.SpotifyIframeApi = api; resolve(api); } else reject(new Error('Spotify API is incomplete'));
      };
      loadProviderScript(SPOTIFY_API).catch(reject);
    });
    spotifyApiReady.catch(() => { spotifyApiReady = null; });
  }
  return spotifyApiReady;
}

// Every transport reports only what the provider confirms. handlers.playing means audio is running, never that a button was pressed.
function youtubeTransport(song, frame, handlers) {
  let embedded = null, queued = null, released = false;
  youtubeApi().then(api => {
    if (released) return;
    embedded = new api.Player(frame, {events:{
      onReady() {
        if (released) return;
        handlers.ready();
        if (queued === 'play') { queued = null; embedded?.playVideo?.(); }
      },
      onStateChange(event) {
        if (released) return;
        if (event?.data === 1) handlers.playing();
        else if (event?.data === 2) handlers.paused();
        else if (event?.data === 0) handlers.ended();
        else if (event?.data === 3) handlers.loading();
      },
      onAutoplayBlocked() { if (!released) handlers.needsTap(); },
      onError() { if (!released) handlers.unavailable(); }
    }});
  }).catch(() => { if (!released) handlers.unavailable(); });
  return {
    controllable: true,
    play() { if (embedded?.playVideo) embedded.playVideo(); else queued = 'play'; },
    // A browser that refuses unmuted autoplay still allows a muted start. The sound comes back
    // through unmute() the moment YouTube reports real playback.
    retryMuted() { if (!embedded?.playVideo) return false; try { embedded.mute(); embedded.playVideo(); return true; } catch { return false; } },
    unmute() { try { embedded?.unMute?.(); } catch { /* The member can still use the player controls. */ } },
    pause() { queued = null; embedded?.pauseVideo?.(); },
    release() {
      released = true; queued = null;
      try { embedded?.destroy?.(); } catch { /* The frame is discarded either way. */ }
      embedded = null;
    }
  };
}

function spotifyTransport(song, frame, mount, handlers) {
  let controller = null, queued = null, released = false;
  spotifyApi().then(api => {
    if (released) return;
    // Spotify builds its own iframe in place of the element it is given.
    const host = document.createElement('div');
    host.className = `song-embed song-embed-spotify`;
    mount(host);
    api.createController(host, {uri:`spotify:track:${song.link.id}`, width:'100%', height:'200'}, embed => {
      if (released || !embed) { try { embed?.destroy?.(); } catch { /* Nothing to keep. */ } return; }
      controller = embed;
      embed.addListener?.('ready', () => {
        if (released) return;
        handlers.ready();
        if (queued === 'play') { queued = null; controller?.play?.(); }
      });
      embed.addListener?.('playback_update', event => {
        if (released) return;
        const data = event?.data; if (!data) return;
        if (data.isPaused === true) { handlers.paused(); return; }
        // Spotify keeps isPaused false while it buffers, so a moving position is the proof that audio started.
        if (Number(data.position) > 0) handlers.playing(); else handlers.loading();
      });
      embed.addListener?.('playback_error', () => { if (!released) handlers.unavailable(); });
    });
  }).catch(() => { if (!released) handlers.unavailable(); });
  return {
    controllable: true,
    play() { if (controller?.play) controller.play(); else queued = 'play'; },
    pause() { queued = null; controller?.pause?.(); },
    release() {
      released = true; queued = null;
      try { controller?.destroy?.(); } catch { /* The frame is discarded either way. */ }
      controller = null;
    }
  };
}

function audioTransport(audio, handlers) {
  let released = false;
  audio.addEventListener('play', () => { if (!released) handlers.loading(); });
  audio.addEventListener('playing', () => { if (!released) handlers.playing(); });
  // Some browsers omit playing on a resumed element, so a moving timeline confirms the same thing.
  audio.addEventListener('timeupdate', () => { if (!released && !audio.paused && Number(audio.currentTime) > 0) handlers.playing(); });
  audio.addEventListener('pause', () => { if (!released) handlers.paused(); });
  audio.addEventListener('ended', () => { if (!released) handlers.ended(); });
  audio.addEventListener('error', () => { if (!released) handlers.unavailable(); });
  return {
    controllable: true,
    play() {
      const started = audio.play();
      if (started?.catch) started.catch(() => { if (!released) handlers.needsTap(); });
    },
    retryMuted() {
      audio.muted = true;
      const started = audio.play();
      if (started?.catch) started.catch(() => { if (!released) handlers.needsTap(); });
      return true;
    },
    unmute() { audio.muted = false; },
    pause() { audio.pause(); },
    release() { released = true; }
  };
}

export function createProfileSongs() {
  const root = document.getElementById('profile-songs-root');
  if (!root) return null;
  const id = profileId(); root.hidden = true;
  if (!id) return null;
  root.className = `${root.className || ''} song-public`.trim();

  const heading = document.createElement('div'); heading.className = 'song-heading song-player-heading';
  const headingTitle = document.createElement('h2'); headingTitle.textContent = '▶ Profile Music (Optional)';
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
  const transportBar = document.createElement('div'); transportBar.className = 'retro-transport member-player-transport';
  const previous = document.createElement('button'); previous.type = 'button'; previous.className = 'retro-button'; previous.textContent = '◀◀'; previous.setAttribute('aria-label','Previous song');
  const launch = document.createElement('button'); launch.type = 'button'; launch.className = 'retro-button retro-play member-player-launch'; launch.setAttribute('aria-label','Play selected song'); launch.setAttribute('aria-pressed','false');
  const launchSymbol = document.createElement('span'); launchSymbol.className = 'member-player-play-symbol'; launchSymbol.setAttribute('aria-hidden','true'); launchSymbol.textContent = '▶'; launch.append(launchSymbol);
  const next = document.createElement('button'); next.type = 'button'; next.className = 'retro-button'; next.textContent = '▶▶'; next.setAttribute('aria-label','Next song');
  const controlNote = document.createElement('span'); controlNote.className = 'member-player-control-note'; controlNote.textContent = 'TAP PLAY · NO AUTOPLAY';
  transportBar.append(previous,launch,next,controlNote);
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
  deck.append(transportBar,display,status,external); body.append(player,deck);
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
  const feature = document.createElement('button'); feature.type = 'button'; feature.className = 'member-primary'; feature.textContent = 'Add to my Profile Music'; feature.hidden = true;
  const settings = document.createElement('a'); settings.className = 'song-open-service'; settings.href = '/members.html#member-songs-root'; settings.textContent = 'My music settings';
  const original = document.createElement('a'); original.className = 'song-open-service'; original.hidden = true;
  actions.append(feature,settings,original);
  // A member with no songs gets one short line instead of an empty player.
  const emptyNote = document.createElement('p'); emptyNote.className = 'member-empty-note'; emptyNote.hidden = true;
  root.replaceChildren(heading,shell,actions,emptyNote);

  const playCountNodes = new Map(); const reportControllers = new Set(); const activeReports = new Set(); const confirmedReports = new Set();
  let generation = 0; let counterGeneration = 0; let request = null; let countRequest = null; let currentAudio = null;
  let currentSong = null; let currentSongs = []; let currentButtons = []; let currentMemberId = null; let pageSuspended = false; let needsRefresh = true;
  let transport = null; let playbackState = 'idle'; let currentProvider = null; let providerTimer = null;
  const counterTotals = new Map();
  const songOwner = song => song.catalogVideoId ? 'catalog' : song.origin?.member_id || currentMemberId;
  // One press has to be enough: the plain attempt first, then one muted retry, then an honest
  // instruction. The display never claims playback the provider has not confirmed.
  let pressTimer = null, pressStage = 'idle', pressAutoMuted = false, pressedAt = 0;
  function musicSession() {
    const storageKey = 'jspace-member-music-visit-v1'; let saved = null;
    try { saved = sessionStorage.getItem(storageKey); } catch { /* Session storage can be unavailable. */ }
    if (saved && SESSION_ID.test(saved)) return saved.toLowerCase();
    const value = globalThis.crypto?.randomUUID?.() || '10000000-1000-4000-8000-100000000000'.replace(/[018]/g,digit=>(Number(digit)^Math.random()*16>>Number(digit)/4).toString(16));
    try { sessionStorage.setItem(storageKey,value); } catch { /* In-memory dedupe still protects this page. */ }
    return value;
  }
  const sessionId = musicSession();
  let tabSuspended = Boolean(document.body?.dataset?.profileTabActive && document.body.dataset.profileTabActive !== 'songs');
  const visible = () => !pageSuspended && !tabSuspended && !document.hidden && document.visibilityState !== 'hidden';
  const providerName = () => currentProvider ? PROVIDER_NAMES[currentProvider] : 'the music service';
  function clearProviderTimer() { if (providerTimer !== null) { clearTimeout(providerTimer); providerTimer = null; } }
  // A provider that never answers must not leave the member holding a dead Play button.
  function startProviderTimer(handlers) {
    clearProviderTimer();
    providerTimer = setTimeout(() => { providerTimer = null; handlers.silent(); }, PROVIDER_TIMEOUT);
    // Browsers return a plain id here. Node keeps the offline test run from waiting on this timer.
    providerTimer?.unref?.();
  }
  function clearPressTimer() { if (pressTimer !== null) { clearTimeout(pressTimer); pressTimer = null; } }
  function releasePressMute() {
    if (!pressAutoMuted) return;
    pressAutoMuted = false;
    try { transport?.unmute?.(); } catch { /* The provider controls still work. */ }
  }
  function endPress() { clearPressTimer(); pressStage = 'idle'; }
  function armPressTimer(stage) {
    pressStage = stage; clearPressTimer();
    pressTimer = setTimeout(() => { pressTimer = null; runPressWatchdog(); }, stage === 'first' ? 5000 : 7000);
    pressTimer?.unref?.();
  }
  // Buffering proves the request is alive, so it buys more time rather than tripping the watchdog.
  function extendPress() {
    if (pressStage === 'idle' || Date.now() - pressedAt > 22000) return;
    armPressTimer(pressStage);
  }
  function runPressWatchdog() {
    if (playbackState === 'playing' || pressStage === 'idle') return;
    if (pressStage === 'first' && !pressAutoMuted && transport?.retryMuted?.()) {
      pressAutoMuted = true;
      armPressTimer('muted');
      return;
    }
    releasePressMute();
    pressStage = 'idle';
    setState('needsTap');
  }
  function showEmptyNote(text) {
    releasePlayer();
    shell.hidden = true; actions.hidden = false; feature.hidden = true; original.hidden = true;
    emptyNote.textContent = text; emptyNote.hidden = false;
    status.textContent = ''; root.hidden = false;
  }
  function hideEmptyNote() {
    emptyNote.hidden = true; emptyNote.textContent = '';
    shell.hidden = false; actions.hidden = false;
  }
  function renderTransport() {
    const playing = playbackState === 'playing';
    toggleClass(shell,'is-playing',playing);
    launchSymbol.textContent = playing ? 'Ⅱ' : '▶';
    launch.setAttribute('aria-pressed',String(playing));
    if (!launch.disabled) launch.setAttribute('aria-label',playing ? `Pause ${currentSong?.title ?? 'this song'}` : `Play ${currentSong?.title ?? 'the selected song'}`);
    if (!currentSong) { controlNote.textContent = 'ROOSTER PLAY'; return; }
    if (launch.disabled) controlNote.textContent = currentProvider === 'apple' ? 'APPLE MUSIC' : 'USE PLAYER';
    else controlNote.textContent = playing ? 'ROOSTER PAUSE' : 'ROOSTER PLAY';
  }
  function setState(next) {
    playbackState = next;
    const songTitle = currentSong?.title ?? 'this song';
    if (next === 'ready') { now.textContent = 'READY TO PLAY'; status.textContent = currentSong?.link ? `Press the ROOSTER play button to start this song on ${providerName()}.` : 'Press the ROOSTER play button or use the audio controls.'; }
    else if (next === 'loading') { now.textContent = 'LOADING SONG'; status.textContent = `Starting ${songTitle}…`; }
    else if (next === 'playing') { now.textContent = 'NOW PLAYING'; status.textContent = `Playing ${songTitle}.`; }
    else if (next === 'paused') { now.textContent = 'PAUSED'; status.textContent = 'Paused. Press Play when you are ready.'; }
    else if (next === 'ended') { now.textContent = 'READY TO PLAY'; status.textContent = 'Song finished. Play it again or pick another song.'; }
    else if (next === 'needsTap') { now.textContent = 'TAP PLAY'; status.textContent = `Your browser needs a tap. Use the controls in the ${providerName()} player above.`; }
    else if (next === 'preview') { now.textContent = 'READY TO PLAY'; status.textContent = `${providerName()} may play a short preview unless you are signed in to it in this browser.`; }
    else if (next === 'external') { now.textContent = 'OPEN TO LISTEN'; status.textContent = `${providerName()} does not allow outside play buttons. Press play in the ${providerName()} player above, or open the song below.`; }
    else if (next === 'unavailable') { now.textContent = 'UNAVAILABLE'; status.textContent = currentSong?.link ? `${providerName()} cannot play this song here right now. Use the button below to open it.` : 'This song could not play just now. Tap Try again.'; }
    renderTransport();
  }
  function releasePlayer() {
    clearProviderTimer();
    releasePressMute(); endPress();
    if (transport) { try { transport.release(); } catch { /* The surface is discarded either way. */ } transport = null; }
    if (currentAudio) releaseAudio(currentAudio);
    currentAudio = null; currentProvider = null; playbackState = 'idle';
    player.replaceChildren(); external.hidden = true; external.removeAttribute('href'); external.textContent = '';
    launch.disabled = true; renderTransport();
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
    const catalog = songs[0]?.catalogVideoId;
    if (!data || (!catalog && data.max_songs !== 3) || !data.counts || typeof data.counts !== 'object' || Array.isArray(data.counts) ||
        !Number.isSafeInteger(data.total) || data.total < 0 || !Number.isSafeInteger(data.today) || data.today < 0 || data.today > data.total) throw new Error('Invalid play counts');
    const countKey = song => catalog ? song.catalogVideoId : song.revision;
    const keys = Object.keys(data.counts);
    if (keys.length > (catalog ? 26 : 3) || keys.some(key=>catalog ? !/^[a-zA-Z0-9_-]{11}$/.test(key) : !MEMBER_ID.test(key))) throw new Error('Invalid play counts');
    let sum = 0;
    songs.forEach(song=>{const value=data.counts[countKey(song)];if(!Number.isSafeInteger(value)||value<0)throw new Error('Invalid play counts');sum+=value;});
    if (sum > data.total) throw new Error('Invalid play counts');
    songs.forEach(song=>{const node=playCountNodes.get(song.revision);if(node)node.textContent=playText(data.counts[countKey(song)]);});
    counterTotals.set(songOwner(songs[0]),{today:data.today,total:data.total});
    today.textContent = [...counterTotals.values()].reduce((sum,item)=>sum+item.today,0).toLocaleString('en-US'); total.textContent = [...counterTotals.values()].reduce((sum,item)=>sum+item.total,0).toLocaleString('en-US');
  }
  async function loadCounts(memberId, songs, epoch) {
    countRequest?.abort(); const sequence = ++counterGeneration; const controller = new AbortController(); countRequest = controller;
    try {
      const groups = new Map(); songs.forEach(song=>{const key=songOwner(song);groups.set(key,[...(groups.get(key)||[]),song]);});
      await Promise.all([...groups].map(async ([sourceId,group])=>{
        const response = await fetch(sourceId==='catalog'?'/api/music-plays':`/api/member-music-plays?id=${encodeURIComponent(sourceId)}`,{credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Accept:'application/json'},signal:controller.signal});
        if (!response.ok) throw new Error('Play counts unavailable'); const data = await response.json();
        if (epoch === generation && sequence === counterGeneration && visible()) applyCounts(data,group);
      }));
    } catch { if (epoch === generation && sequence === counterGeneration && visible()) unavailableCounts(); }
    finally { if (countRequest === controller) countRequest = null; }
  }
  // Only a confirmed playback event reaches this function, and a counter outage never interrupts the song.
  async function reportPlay(song, epoch) {
    if (!currentMemberId || epoch !== generation || !visible()) return;
    const sourceId = songOwner(song);
    const key = `${sourceId}:${song.revision}`;
    if (activeReports.has(key) || confirmedReports.has(key)) return;
    activeReports.add(key); countRequest?.abort(); countRequest = null; const sequence = ++counterGeneration;
    const controller = new AbortController(); reportControllers.add(controller);
    try {
      const payload = song.catalogVideoId ? {video_id:song.catalogVideoId,session_id:sessionId} : {member_id:sourceId,slot:song.slot,revision:song.revision,session_id:sessionId};
      const response = await fetch(song.catalogVideoId?'/api/music-plays/post':'/api/member-music-plays/post',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify(payload),signal:controller.signal});
      if (!response.ok) throw new Error('Play count unavailable'); const data = await response.json(); confirmedReports.add(key);
      if (epoch === generation && sequence === counterGeneration && visible()) applyCounts(data,currentSongs.filter(item=>songOwner(item)===sourceId));
    } catch {
      if (epoch === generation && sequence === counterGeneration && visible()) { unavailableCounts(); status.textContent = 'The song is playing. The play counter could not connect just now.'; }
    } finally { activeReports.delete(key); reportControllers.delete(controller); }
  }
  // Events that arrive after the member switched songs, or after the page was hidden, are ignored.
  function transportHandlers(song, epoch) {
    const active = () => epoch === generation && visible() && currentSong?.revision === song.revision;
    return {
      ready() { if (!active()) return; clearProviderTimer(); if (playbackState === 'loading') return; setState(currentProvider === 'spotify' ? 'preview' : 'ready'); },
      loading() { if (!active()) return; clearProviderTimer(); extendPress(); if (playbackState !== 'playing') setState('loading'); },
      playing() {
        if (!active()) return;
        clearProviderTimer();
        endPress(); releasePressMute();
        if (playbackState === 'playing') return;
        setState('playing');
        void reportPlay(song, epoch);
      },
      paused() { if (!active()) return; clearProviderTimer(); releasePressMute(); endPress(); if (playbackState !== 'idle') setState('paused'); },
      ended() { if (!active()) return; releasePressMute(); endPress(); setState('ended'); },
      needsTap() {
        if (!active()) return;
        clearProviderTimer();
        // A blocked start still deserves the muted retry before the member is asked to tap again.
        if (pressStage === 'first' && !pressAutoMuted) { clearPressTimer(); runPressWatchdog(); return; }
        releasePressMute(); endPress(); setState('needsTap');
      },
      silent() { if (!active()) return; releasePressMute(); endPress(); launch.disabled = true; setState('external'); },
      unavailable() {
        if (!active()) return;
        clearProviderTimer(); releasePressMute(); endPress(); launch.disabled = true; setState('unavailable');
        if (!song.link) { retry.hidden = false; retry.disabled = false; }
      }
    };
  }
  function select(song, buttons, epoch) {
    if (epoch !== generation || !visible()) return;
    releasePlayer(); currentSong = song; title.textContent = song.title;
    feature.hidden = false; feature.disabled = false; feature.textContent = 'Add to my Profile Music';
    original.hidden = !song.featureId;
    if (song.featureId) { original.href = `/profile.html?id=${encodeURIComponent(song.origin.member_id)}&view=songs`; original.textContent = `Featured from ${song.origin.name}`; }
    previous.disabled = buttons.length < 2; next.disabled = buttons.length < 2;
    buttons.forEach(button=>button.setAttribute('aria-current',String(button.dataset.revision === song.revision)));
    const handlers = transportHandlers(song, epoch);
    if (song.link) {
      currentProvider = song.link.provider;
      service.textContent = PROVIDER_NAMES[currentProvider];
      const ready = document.createElement('div'); ready.className = 'song-player-ready';
      const readyTitle = document.createElement('strong'); readyTitle.textContent = 'Ready when you are';
      const readyNote = document.createElement('span'); readyNote.textContent = 'Press Play to load this song.';
      ready.append(readyTitle,readyNote); player.append(ready); external.href = song.link.url; external.textContent = `Open in ${PROVIDER_NAMES[currentProvider]} ↗`; external.hidden = false;
      if (!CONTROLLABLE[currentProvider]) { launch.disabled = true; setState('external'); return; }
      launch.disabled = false;
      let loaded = null;
      transport = {
        controllable: true,
        play() {
          if (loaded) { loaded.play(); return; }
          const frame = document.createElement('iframe'); frame.className = `song-embed song-embed-${currentProvider}`; frame.src = song.link.embed;
          frame.title = `${song.title} on ${PROVIDER_NAMES[currentProvider]}`; frame.loading = 'eager';
          frame.setAttribute('allow','clipboard-write; encrypted-media; fullscreen; picture-in-picture'); frame.setAttribute('referrerpolicy','strict-origin-when-cross-origin'); frame.setAttribute('allowfullscreen','');
          frame.addEventListener('error',()=>handlers.unavailable()); player.replaceChildren(frame);
          loaded = currentProvider === 'youtube'
            ? youtubeTransport(song, frame, handlers)
            : spotifyTransport(song, frame, host => player.replaceChildren(host), handlers);
          startProviderTimer(handlers); loaded.play();
        },
        pause() { loaded?.pause?.(); },
        retryMuted() { return loaded?.retryMuted?.() || false; },
        unmute() { loaded?.unmute?.(); },
        release() { loaded?.release?.(); loaded = null; }
      };
      setState('ready');
      return;
    }
    service.textContent = 'ROOSTER Audio';
    const ready = document.createElement('div'); ready.className = 'song-player-ready';
    const readyTitle = document.createElement('strong'); readyTitle.textContent = 'Ready when you are';
    const readyNote = document.createElement('span'); readyNote.textContent = 'Press Play to load this song.';
    ready.append(readyTitle,readyNote); player.append(ready); external.hidden = true;
    launch.disabled = false;
    let loaded = null;
    transport = {
      controllable: true,
      play() {
        if (loaded) { loaded.play(); return; }
        const audio = document.createElement('audio');
        audio.controls = true; audio.preload = 'none';
        audio.setAttribute('aria-label',`Play ${song.title}`);
        audio.src = song.audio;
        currentAudio = audio; player.replaceChildren(audio);
        loaded = audioTransport(audio, handlers); loaded.play();
      },
      pause() { loaded?.pause?.(); },
      retryMuted() { return loaded?.retryMuted?.() || false; },
      unmute() { loaded?.unmute?.(); },
      release() { loaded?.release?.(); loaded = null; }
    };
    setState('ready');
  }
  function move(amount) {
    if (!currentSong || currentSongs.length < 2) return;
    const index = currentSongs.findIndex(song=>song.revision===currentSong.revision); select(currentSongs[(index+amount+currentSongs.length)%currentSongs.length],currentButtons,generation);
  }
  previous.addEventListener('click',()=>move(-1)); next.addEventListener('click',()=>move(1));
  launch.addEventListener('click',()=>{
    if (!currentSong || !visible() || launch.disabled || !transport?.controllable) return;
    if (playbackState === 'playing') { transport.pause(); return; }
    pressedAt = Date.now(); pressAutoMuted = false;
    setState('loading'); armPressTimer('first'); transport.play();
  });
  async function refresh() {
    if (!visible()) return;
    request?.abort(); releaseCounters(); const epoch = ++generation; const controller = new AbortController(); request = controller;
    const timeout = setTimeout(()=>controller.abort(),15000); releasePlayer(); tracks.replaceChildren(); playCountNodes.clear(); currentSongs=[];currentButtons=[];currentMemberId=null;currentSong=null;root.hidden = false;
    counterTotals.clear(); feature.hidden=true; original.hidden=true;
    songCount.textContent='0 SONGS';today.textContent='…';total.textContent='…';launch.disabled=true;previous.disabled=true;next.disabled=true;hideEmptyNote();
    root.setAttribute('aria-busy','true'); retry.hidden = true; retry.disabled = true; status.textContent = 'Loading music…'; needsRefresh = false;
    // /api/profile is inside the invite-only community now, so this section
    // has to send the session cookie as well or the music never resolves.
    const options = {credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Accept:'application/json'},signal:controller.signal};
    try {
      const profileResponse = await fetch(`/api/profile?id=${encodeURIComponent(id)}`,options);
      if (epoch !== generation || !visible()) return;
      if (profileResponse.status === 404) {root.hidden=true;status.textContent='';return;}
      if (!profileResponse.ok) throw new Error('Profile unavailable');
      const profileData = await profileResponse.json(); if (epoch !== generation || !visible()) return;
      const observedId = profileData?.profile?.id;
      const memberId = typeof observedId === 'string' && MEMBER_ID.test(observedId)
        ? observedId.toLowerCase()
        : observedId === 'owner' && (MEMBER_ID.test(id) || id === 'owner') ? id : null;
      if (!memberId || (id !== 'owner' && memberId !== id)) throw new Error('Invalid profile');
      const memberName = typeof profileData?.profile?.name === 'string' ? profileData.profile.name.trim() : '';
      owner.textContent = memberName && memberName.length <= 60 ? memberName : 'ROOSTER MEMBER';
      const response = await fetch(`/api/member-songs?id=${encodeURIComponent(memberId)}`,options); if (epoch !== generation || !visible()) return;
      if (response.status === 404) {root.hidden=true;status.textContent='';return;}
      if (!response.ok) throw new Error('Songs unavailable');
      const music = await response.json();
      const ownSongs = songList(music,memberId).map(song=>({...song,origin:{member_id:memberId,name:memberName,slot:song.slot,revision:song.revision}}));
      const catalog = catalogSongList(music.catalog_songs);
      const featured = featuredSongList(music.featured_songs);
      const seen = new Set();
      const songs = [...ownSongs,...catalog,...featured].filter(song=>{if(seen.has(song.revision))return false;seen.add(song.revision);return true;});
      if (epoch !== generation || !visible()) return;
      limit.textContent = catalog.length ? `${catalog.length} CATALOG SONGS` : featured.length ? 'MUSIC + COMMUNITY PICKS' : '3 SONG MAX';
      // As soon as this member adds a song the full player comes back on its own.
      if (!songs.length) {showEmptyNote('Music is optional. Add YouTube songs or feature a song you love from another member’s Profile Music.');return;}
      const buttons = songs.map(song=>{
        const item=document.createElement('li'); const button=document.createElement('button'); button.type='button'; button.className='retro-track member-profile-track'; button.dataset.slot=String(song.slot); button.dataset.revision=song.revision;
        button.setAttribute('aria-label',`Select ${song.title}`);
        const number=document.createElement('span'); number.className='retro-track-number member-retro-track-number'; number.textContent=String(song.slot).padStart(2,'0');
        const details=document.createElement('span'); const label=document.createElement('span'); label.className='retro-track-title'; label.textContent=song.title;
        const provider=document.createElement('span'); provider.className='retro-track-artist'; provider.textContent=song.featureId?`Featured from ${song.origin.name}`:song.link?PROVIDER_NAMES[song.link.provider]:'ROOSTER Audio'; details.append(label,provider);
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
  feature.addEventListener('click',async()=>{
    const song=currentSong; if(!song || feature.disabled)return;
    const epoch=generation;feature.disabled=true;feature.textContent='Adding…';
    try {
      const payload=song.catalogVideoId?{catalog_video_id:song.catalogVideoId}:{source_member_id:song.origin.member_id,slot:song.slot,revision:song.revision};
      const response=await fetch('/api/profile-music-features',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify(payload)});
      const data=await response.json();if(epoch!==generation||currentSong!==song)return;
      if(response.status===401||response.status===403){settings.href='/members.html#member-login';settings.textContent='Log in to add this song';throw new Error('Log in, then return to this song and tap Add to my Profile Music.');}
      if(!response.ok)throw new Error(typeof data?.error==='string'?data.error:'Could not add this song. Try again.');
      feature.textContent='Added to my Profile Music';status.textContent='Song featured on your page. The original creator keeps the credit and play count.';
    }catch(error){if(epoch===generation&&currentSong===song){feature.disabled=false;feature.textContent='Add to my Profile Music';status.textContent=error.message;}}
  });
  document.addEventListener('visibilitychange',()=>{if(!visible())suspend();else if(needsRefresh)void refresh();});
  window.addEventListener('jwhite:profile-tab',event=>{
    tabSuspended = event.detail?.tab !== 'songs';
    if (tabSuspended) suspend();
    else if (visible() && (needsRefresh || !currentMemberId)) void refresh();
  });
  window.addEventListener('pagehide',()=>{pageSuspended=true;endPress();suspend();});
  window.addEventListener('pageshow',()=>{pageSuspended=false;if(needsRefresh)void refresh();});
  void refresh(); return {refresh};
}

createProfileSongs();
