(() => {
  'use strict';
  const tracks = [
    {title:'Spend Dat', artist:'Yung Miami', video:'NSZ26l3DIKE'},
    {title:'What It Is (Block Boy)', artist:'Doechii feat. Kodak Black', video:'phtcAd8j6Ro'},
    {title:'YOU', artist:'SiR', video:'GEsObsmLS8U'},
    {title:'Money', artist:'Cardi B', video:'Zj2cK8wymIA'},
    {title:'Able', artist:'Kirk Franklin', video:'iMQKzsOIFbM'},
    {title:'Pretty Eyes', artist:'sunkis feat. FLO', video:'fioIdmPrQIg'},
    {title:'Big Booty', artist:'Gucci Mane feat. Megan Thee Stallion', video:'b_Kx8tx88oQ'},
    {title:'Love Thru The Computer', artist:'Gucci Mane feat. Justin Bieber', video:'XvinPCCGSxc'},
    {title:'A Thousand Times', artist:'Honey Bxby & JID', video:'M5ApFrZSFh0'},
    {title:'High Key', artist:'Ari Lennox', video:'is7I3xqVnQo'},
    {title:'Stop By', artist:'Ari Lennox', video:'cyhbvJtNqv4'},
    {title:'Blackberry Sap', artist:'Dreamville & Ari Lennox', video:'1nq1ZLYYxx4'},
    {title:'Plays of the Week', artist:'BossMan Dlow', video:'jUEyjE92fG4'},
    {title:'Is It The Way', artist:'Saweetie', video:'kjfSPX3JW_4'},
    {title:'boffum', artist:'Saweetie & J.White Did It', video:'2BMZNs_BQDo'},
    {title:'Bodak Yellow', artist:'Cardi B', video:'PEGccV-NOm8'},
    {title:'I Like It', artist:'Cardi B, Bad Bunny & J Balvin', video:'xTlNMmZKwpA'},
    {title:'Savage Remix', artist:'Megan Thee Stallion feat. Beyoncé', video:'lEIqjoO0-Bs'},
    {title:'a lot', artist:'21 Savage feat. J. Cole', video:'DmWWqogr_r8'},
    {title:'30 For 30', artist:'SZA feat. Kendrick Lamar', video:'NEnephbahLA'},
    {title:'Muwop', artist:'Latto feat. Gucci Mane', video:'meFxq3-mNEc'},
    {title:'Sally Walker', artist:'Iggy Azalea', video:'2Gy8eGr7AfM'},
    {title:'Started', artist:'Iggy Azalea', video:'flPCk8Z5XS0'},
    {title:'Weak', artist:'Flo Milli', video:'8B2iv-7bNDQ'},
    {title:'Valet', artist:'Eric Bellinger feat. Fetty Wap & 2 Chainz', video:'qONfVYziSZw'},
    {title:'Ooh La La', artist:'Tinashe', video:'LtCfBdmxR_M'}
  ];
  const byId = id => document.getElementById(id);
  const shell = byId('retro-player');
  if (!shell) return;
  byId('music-count').textContent = tracks.length + ' SONGS';
  byId('music-playlist-label').textContent = tracks.length + ' songs';
  const list = byId('music-tracks');
  const play = byId('music-play');
  const seek = byId('music-seek');
  const volume = byId('music-volume');
  const mute = byId('music-mute');
  const mobileVolumeNote = byId('music-mobile-volume-note');
  const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const frame = byId('music-video');
  const playCountNodes = new Map();
  const initialIndex = tracks.findIndex(track => track.video === 'XvinPCCGSxc');
  let player, ready = false, index = initialIndex, playing = false;
  let playRequested = false, pendingPlay = true, userStopped = false;
  let timer, playbackTimeout, connectionTimeout, readyGrace;
  // A press is answered in stages: the plain attempt first, then one muted retry for browsers
  // that block unmuted autoplay. The meter still only moves on YouTube's own PLAYING event.
  let playStage = 'idle', autoMuted = false, userMuted = false, pressedByUser = false, pressedAt = 0;
  // When the YouTube frame API cannot be reached, the transport drives the video frame directly.
  let fallbackMode = false, fallbackPlaying = false;
  const formatTime = value => {
    const seconds = Math.max(0, Math.floor(value || 0));
    return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
  };
  const watchUrl = track => 'https://www.youtube.com/watch?v=' + track.video;
  const embedUrl = (track, autoplay) => {
    const url = new URL('https://www.youtube.com/embed/' + track.video);
    url.searchParams.set('enablejsapi', '1');
    url.searchParams.set('playsinline', '1');
    url.searchParams.set('rel', '0');
    url.searchParams.set('origin', location.origin);
    if (autoplay) url.searchParams.set('autoplay', '1');
    return url.href;
  };
  const knownVideos = new Set(tracks.map(track => track.video));
  const playedMilliseconds = new Map();
  const confirmedPlays = new Set();
  const activeReports = new Set();
  const failedReports = new Set();
  const reportTimers = new Set();
  const storageKey = 'jwhite-music-visit-v1';
  const now = () => typeof performance !== 'undefined' ? performance.now() : Date.now();
  let visitId, listeningVideo = null, listeningSince = 0;
  const uuid = () => globalThis.crypto?.randomUUID?.() || '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, digit => (Number(digit) ^ Math.random() * 16 >> Number(digit) / 4).toString(16));
  try {
    const stored = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
    if (stored && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stored.id)) {
      visitId = stored.id;
      if (Array.isArray(stored.reported)) stored.reported.filter(video => knownVideos.has(video)).forEach(video => confirmedPlays.add(video));
    }
  } catch { /* A private browser may disable session storage. */ }
  if (!visitId) visitId = uuid();
  function persistVisit() {
    try { sessionStorage.setItem(storageKey, JSON.stringify({id:visitId, reported:[...confirmedPlays]})); } catch { /* This page still deduplicates in memory. */ }
  }
  persistVisit();
  function showPlayCounts(data) {
    if (!data || !data.counts || typeof data.counts !== 'object' || !Number.isSafeInteger(data.total) || data.total < 0 || !Number.isSafeInteger(data.today) || data.today < 0) throw new Error('Invalid play counts');
    const counts = tracks.map(track => {
      const value = data.counts[track.video] ?? 0;
      if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid play count');
      return [track.video, value];
    });
    counts.forEach(([video, value]) => {
      const node = playCountNodes.get(video);
      if (node) node.textContent = value.toLocaleString('en-US') + (value === 1 ? ' play' : ' plays');
    });
    byId('music-total').textContent = data.total.toLocaleString('en-US');
    byId('music-today').textContent = data.today.toLocaleString('en-US');
  }
  function countsUnavailable() {
    playCountNodes.forEach(node => { node.textContent = 'Unavailable'; });
    byId('music-total').textContent = 'Unavailable';
    byId('music-today').textContent = 'Unavailable';
  }
  async function countRequest(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(path, {...options, credentials:'same-origin', cache:'no-store', signal:controller.signal});
      if (!response.ok) throw new Error('Play counts unavailable');
      const data = await response.json();
      showPlayCounts(data);
    } finally { clearTimeout(timeout); }
  }
  function reportPlay(video) {
    if (confirmedPlays.has(video) || activeReports.has(video) || failedReports.has(video)) return;
    activeReports.add(video);
    const send = async (attempt = 0) => {
      try {
        await countRequest('/api/music-plays/post', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({video_id:video, session_id:visitId})});
        confirmedPlays.add(video);
        persistVisit();
        activeReports.delete(video);
      } catch {
        if (attempt < 2) {
          const retry = setTimeout(() => { reportTimers.delete(retry); send(attempt + 1); }, attempt === 0 ? 2000 : 6000);
          reportTimers.add(retry);
        } else {
          activeReports.delete(video);
          failedReports.add(video);
        }
      }
    };
    send();
  }
  function finishListeningSlice() {
    if (!listeningVideo) return;
    const video = listeningVideo;
    const duration = (playedMilliseconds.get(video) || 0) + Math.max(0, now() - listeningSince);
    playedMilliseconds.set(video, duration);
    listeningVideo = null;
    if (duration >= 10000) reportPlay(video);
  }
  function startListeningSlice() {
    const video = player?.getVideoData?.().video_id;
    if (!video || !knownVideos.has(video) || video !== tracks[index].video || player.getPlayerState?.() !== 1) return;
    listeningVideo = video;
    listeningSince = now();
  }
  function sampleListening() {
    const video = player?.getVideoData?.().video_id;
    if (player?.getPlayerState?.() === 1 && video === tracks[index].video) {
      if (listeningVideo === video) finishListeningSlice();
      else listeningVideo = null;
      startListeningSlice();
    } else {
      // If playback stopped without a state event, do not count the uncertain interval.
      listeningVideo = null;
    }
  }


  function paintMute(muted) {
    if (!mute) return;
    mute.setAttribute('aria-pressed', String(muted));
    mute.textContent = muted ? 'UNMUTE' : 'MUTE';
  }
  // A retry that muted the player on its own gives the sound back the moment playback is real.
  function releaseAutoMute() {
    if (!autoMuted) return;
    autoMuted = false;
    if (userMuted || Number(volume.value) === 0) return;
    try { player.unMute(); player.setVolume(Number(volume.value)); } catch { /* the mute button still works */ }
    paintMute(false);
  }
  function showStatus(state, message) {
    byId('music-state').textContent = state;
    byId('music-status').textContent = message;
  }
  function renderControls() {
    // Only YouTube's PLAYING event activates the meter, so the display never claims playback it cannot confirm.
    shell.classList.toggle('is-playing', playing);
    const stoppable = playing || (fallbackMode && fallbackPlaying);
    play.setAttribute('aria-pressed', String(stoppable));
    play.setAttribute('aria-label', stoppable ? 'Pause music' : playRequested ? 'Cancel playback' : 'Play music');
    byId('music-play-label').textContent = stoppable ? 'PAUSE' : playRequested ? 'STOP' : 'PLAY';
    byId('music-play-symbol').textContent = stoppable ? 'Ⅱ' : playRequested ? '■' : '▶';
  }
  function loadFallback(autoplay) {
    frame.src = embedUrl(tracks[index], autoplay);
    fallbackPlaying = Boolean(autoplay);
    renderControls();
    if (autoplay) showStatus('PLAYING IN VIDEO', 'Playing ' + tracks[index].title + ' in the YouTube player. Use Pause here or the controls in the video.');
    else showStatus('TAP PLAY', 'Tap Play to start ' + tracks[index].title + ', or open it on YouTube.');
  }
  // The Play button must never stay dead just because the frame API is blocked or slow.
  function enterFallback(message, startNow = false) {
    if (ready || fallbackMode) return;
    fallbackMode = true;
    clearTimeout(connectionTimeout); clearTimeout(playbackTimeout); clearTimeout(readyGrace);
    playRequested = false; pendingPlay = false; play.disabled = false;
    if (startNow && !userStopped) { loadFallback(true); return; }
    fallbackPlaying = false;
    renderControls();
    showStatus('USE VIDEO CONTROLS', message);
  }
  function finishRequest() {
    clearTimeout(playbackTimeout);
    playStage = 'idle';
    playRequested = false;
    renderControls();
  }
  function showTrack() {
    const track = tracks[index];
    byId('music-title').textContent = track.title;
    byId('music-artist').textContent = track.artist;
    frame.title = track.title + ' by ' + track.artist + ', music video';
    byId('music-external').href = watchUrl(track);
    list.querySelectorAll('button').forEach((button, i) => {
      button.setAttribute('aria-current', String(i === index));
      button.querySelector('.retro-track-symbol').textContent = i === index ? '▶' : '+';
      if (i === index) list.scrollTop = button.offsetTop;
    });
    byId('music-elapsed').textContent = '0:00';
    byId('music-duration').textContent = '0:00';
    seek.value = 0;
    seek.disabled = true;
  }
  function armWatchdog(stage) {
    playStage = stage;
    clearTimeout(playbackTimeout);
    playbackTimeout = setTimeout(runWatchdog, stage === 'first' ? 4500 : 7000);
  }
  // Buffering is real progress, so it buys more time instead of tripping the watchdog.
  function extendWatchdog() {
    if (!playRequested || playStage === 'idle') return;
    if (now() - pressedAt > 22000) return;
    armWatchdog(playStage);
  }
  function runWatchdog() {
    if (playing || userStopped || !playRequested) return;
    if (playStage === 'first' && ready && pressedByUser && !autoMuted) {
      // Browsers that refuse unmuted autoplay still allow a muted start, and the sound comes
      // straight back in onStateChange as soon as YouTube confirms playback.
      autoMuted = true;
      paintMute(true);
      try { player.mute(); startSelected(); } catch { /* the give-up stage handles it */ }
      showStatus('LOADING SONG', 'Still starting ' + tracks[index].title + '…');
      armWatchdog('muted');
      return;
    }
    releaseAutoMute();
    playStage = 'idle';
    playRequested = false;
    renderControls();
    showStatus('TAP PLAY', 'Tap Play to start. If the song does not load, open it on YouTube.');
  }
  const loadedVideo = () => { try { return player?.getVideoData?.().video_id || ''; } catch { return ''; } };
  // One press has to be enough, whichever song is already sitting in the frame.
  function startSelected() {
    if (loadedVideo() === tracks[index].video) player.playVideo();
    else player.loadVideoById(tracks[index].video);
  }
  function requestPlayback(loadSelected = false, automatic = false) {
    if (fallbackMode) { userStopped = false; loadFallback(true); return; }
    if (!ready) {
      pendingPlay = true;
      // A tap deserves an answer, so a silent API gets a short grace period and then the video frame takes over.
      if (!automatic) {
        showStatus('CONNECTING', 'Connecting the player for ' + tracks[index].title + '…');
        clearTimeout(readyGrace);
        readyGrace = setTimeout(() => enterFallback('Playing in the YouTube video instead.', true), 2500);
      }
      return;
    }
    userStopped = false;
    pendingPlay = false;
    playRequested = true;
    pressedByUser = !automatic;
    pressedAt = now();
    renderControls();
    showStatus(automatic ? 'STARTING YOUR SONG' : 'LOADING SONG', automatic ? 'Starting ' + tracks[index].title + '. Your browser may ask you to tap Play.' : 'Loading ' + tracks[index].title + '…');
    armWatchdog('first');
    startSelected();
  }
  function pausePlayback() {
    finishListeningSlice();
    releaseAutoMute();
    userStopped = true;
    pendingPlay = false;
    playing = false;
    clearTimeout(readyGrace);
    finishRequest();
    if (fallbackMode) loadFallback(false);
    else if (ready) player.pauseVideo();
    showStatus('PAUSED', 'Paused. Press Play when you are ready.');
  }
  function choose(next) {
    finishListeningSlice();
    index = (next + tracks.length) % tracks.length;
    playing = false;
    userStopped = false;
    pendingPlay = true;
    finishRequest();
    showTrack();
    requestPlayback(true);
  }

  tracks.forEach((track, i) => {
    const row = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'retro-track';
    button.setAttribute('aria-label', 'Play ' + track.title + ' by ' + track.artist);
    const number = document.createElement('span');
    number.className = 'retro-track-number';
    number.textContent = String(i + 1).padStart(2, '0');
    const details = document.createElement('span');
    const title = document.createElement('span');
    title.className = 'retro-track-title';
    title.textContent = track.title;
    const artist = document.createElement('span');
    artist.className = 'retro-track-artist';
    artist.textContent = track.artist;
    const symbol = document.createElement('span');
    symbol.className = 'retro-track-symbol';
    symbol.setAttribute('aria-hidden', 'true');
    details.append(title, artist);
    const count = document.createElement('span');
    count.className = 'retro-track-plays';
    count.textContent = '…';
    count.title = 'Plays recorded on this site';
    playCountNodes.set(track.video, count);
    button.append(number, details, symbol, count);
    row.append(button);
    list.append(row);
    button.addEventListener('click', () => choose(i));
  });
  showTrack();
  countRequest('/api/music-plays').catch(countsUnavailable);
  document.querySelectorAll('[data-track]').forEach(link => {
    const selected = tracks.findIndex(track => track.video === link.dataset.track);
    if (selected >= 0) link.addEventListener('click', () => choose(selected));
  });
  // Joining ROOSTER LIVE stops the music. Two things talking at once is no
  // way to hear a live room, and the member should not have to go hunting for
  // the pause button while a host is introducing them.
  window.addEventListener('jwhite:pause-music', () => {
    if (playing || playRequested || pendingPlay || fallbackPlaying) pausePlayback();
  });
  byId('music-prev').addEventListener('click', () => choose(index - 1));
  byId('music-next').addEventListener('click', () => choose(index + 1));
  play.addEventListener('click', () => {
    if (fallbackMode) {
      if (fallbackPlaying) pausePlayback(); else requestPlayback();
      return;
    }
    if (playing || playRequested) pausePlayback();
    else requestPlayback();
  });
  seek.addEventListener('input', () => {
    if (ready) player.seekTo(Number(seek.value), true);
  });
  function applyVolume() {
    if (!ready || isiOS) return;
    player.setVolume(Number(volume.value));
    if (Number(volume.value) > 0) {
      userMuted = false;
      autoMuted = false;
      player.unMute();
      paintMute(false);
    } else paintMute(true);
  }
  volume.addEventListener('input', applyVolume);
  volume.addEventListener('change', applyVolume);
  mute?.addEventListener('click', () => {
    if (!ready) return;
    const muted = player.isMuted?.() === true;
    if (muted) { player.unMute(); if (Number(volume.value) === 0) { volume.value = 70; player.setVolume(70); } }
    else player.mute();
    userMuted = !muted;
    autoMuted = false;
    paintMute(userMuted);
  });
  if (isiOS) {
    volume.disabled = true;
    volume.setAttribute('aria-describedby', 'music-mobile-volume-note');
    if (mobileVolumeNote) mobileVolumeNote.hidden = false;
  }
  const titleAliases = {'SAVAGE':'Savage Remix', 'WHAT IT IS':'What It Is (Block Boy)', 'OH LA LA':'Ooh La La'};
  const trackIndex = title => tracks.findIndex(track => track.title.toLowerCase() === (titleAliases[title.trim()] || title.trim()).toLowerCase());
  document.querySelectorAll('.steps > div').forEach(step => {
    const i = trackIndex(step.textContent);
    if (i < 0) return;
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'step-song'; button.textContent = step.textContent;
    if (tracks[i].title === 'Ooh La La') button.textContent = 'OOH LA LA';
    button.setAttribute('aria-label', 'Play ' + tracks[i].title);
    button.addEventListener('click', () => {
      choose(i);
      byId('music').scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
    });
    step.replaceChildren(button);
  });
  document.querySelectorAll('.diamond article').forEach(card => {
    const i = trackIndex(card.querySelector('h3').textContent);
    if (i < 0) return;
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'record-play'; button.textContent = '▶ PLAY RECORD';
    button.setAttribute('aria-label', 'Play ' + tracks[i].title);
    button.addEventListener('click', () => {
      choose(i);
      byId('music').scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
    });
    card.append(button);
  });

  // The markup already points the frame at the opening song. Only rewrite it when the origin
  // differs, so the frame is never reloaded underneath the player the API is attaching to.
  const openingEmbed = embedUrl(tracks[index], false);
  if (frame.src !== openingEmbed) frame.src = openingEmbed;
  connectionTimeout = setTimeout(() => {
    enterFallback('The player is taking a moment. Tap Play to use the YouTube video, or open the song on YouTube.');
  }, 12000);
  window.onYouTubeIframeAPIReady = () => {
    if (player) return;
    player = new window.YT.Player('music-video', {
      events: {
        onReady(event) {
          if (ready) return;
          ready = true;
          fallbackMode = false; fallbackPlaying = false;
          clearTimeout(connectionTimeout);
          clearTimeout(readyGrace);
          play.disabled = false;
          volume.disabled = isiOS;
          if (mute) mute.disabled = false;
          if (!isiOS) event.target.setVolume(Number(volume.value));
          // One unmuted attempt on arrival. No retries after a pause or a block.
          if (pendingPlay && !userStopped) requestPlayback(index !== initialIndex, index === initialIndex);
          else showStatus('TAP PLAY', 'Tap Play to listen.');
          timer = setInterval(() => {
            if (!ready) return;
            sampleListening();
            const duration = player.getDuration();
            const elapsed = player.getCurrentTime();
            if (duration > 0) {
              seek.disabled = false; seek.max = duration;
              byId('music-duration').textContent = formatTime(duration);
            }
            if (document.activeElement !== seek) seek.value = elapsed || 0;
            byId('music-elapsed').textContent = formatTime(elapsed);
          }, 500);
        },
        onStateChange(event) {
          finishListeningSlice();
          playing = event.data === 1;
          if (event.data === 1) {
            startListeningSlice();
            userStopped = false;
            releaseAutoMute();
            finishRequest();
            showStatus('NOW PLAYING', 'Playing: ' + tracks[index].title);
          } else if (event.data === 2) {
            userStopped = true;
            pendingPlay = false;
            finishRequest();
            showStatus('PAUSED', 'Paused. Press Play when you are ready.');
          } else if (event.data === 3) {
            // Buffering is not proof that audio has started, but it does prove the request is alive.
            renderControls();
            if (!userStopped) {
              showStatus('LOADING SONG', 'Loading ' + tracks[index].title + '…');
              extendWatchdog();
            }
          } else if (event.data === 0) {
            releaseAutoMute();
            finishRequest();
            showStatus('SONG FINISHED', 'Play it again or pick another song.');
          } else {
            renderControls();
            if (!playRequested && !userStopped) showStatus('TAP PLAY', 'Tap Play to listen.');
          }
        },
        onAutoplayBlocked() {
          listeningVideo = null;
          playing = false;
          if (!userStopped && playRequested && pressedByUser && playStage === 'first' && !autoMuted) {
            // The press was real, so go straight to the muted retry instead of waiting it out.
            clearTimeout(playbackTimeout);
            runWatchdog();
            return;
          }
          pendingPlay = false;
          releaseAutoMute();
          finishRequest();
          if (userStopped) return;
          showStatus('TAP PLAY', 'Your browser needs a tap. Press Play here or in the video.');
        },
        onError() {
          finishListeningSlice();
          playing = false;
          pendingPlay = false;
          releaseAutoMute();
          finishRequest();
          showStatus('OPEN ON YOUTUBE', 'This song cannot play here right now. Open it on YouTube below.');
        }
      }
    });
  };
  if (window.YT && window.YT.Player) window.onYouTubeIframeAPIReady();
  else {
    const api = document.createElement('script');
    api.src = 'https://www.youtube.com/iframe_api'; api.async = true;
    api.onerror = () => {
      enterFallback('The YouTube player could not load. Tap Play to use the video, or open the song on YouTube.');
    };
    document.head.append(api);
  }
  window.addEventListener('pagehide', () => {
    finishListeningSlice();
    reportTimers.forEach(clearTimeout);
    clearInterval(timer);
    clearTimeout(playbackTimeout);
    clearTimeout(connectionTimeout);
    clearTimeout(readyGrace);
  });
})();
