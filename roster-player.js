(function () {
  'use strict';
  if (window.RosterPlayer) return;
  var KEY = 'roster-player-session-v1';
  var audio = new Audio();
  audio.autoplay = false;
  audio.preload = 'metadata';
  var queue = [];
  var current = null;
  var mounted = false;
  var ui = {};

  function safe(value) { return typeof value === 'string' ? value : ''; }
  function time(value) { if (!Number.isFinite(value) || value < 0) return '0:00'; var minutes = Math.floor(value / 60); return minutes + ':' + String(Math.floor(value % 60)).padStart(2, '0'); }
  function save() {
    if (!current) return;
    try { sessionStorage.setItem(KEY, JSON.stringify({ track: current, time: audio.currentTime || 0, volume: audio.volume, muted: audio.muted })); } catch (error) {}
  }
  function loadSaved() {
    try {
      var value = JSON.parse(sessionStorage.getItem(KEY) || 'null');
      return value && value.track && value.track.url ? value : null;
    } catch (error) { return null; }
  }
  function icon(name) {
    return {previous:'↶',next:'↷',play:'▶',pause:'Ⅱ',mute:'⌁',volume:'◖',queue:'≡',listen:'▶'}[name] || '';
  }
  function mount() {
    if (mounted || !document.body) return;
    mounted = true;
    var root = document.createElement('section');
    root.className = 'roster-global-player'; root.hidden = true; root.setAttribute('aria-label', 'Persistent ROOSTER song player');
    root.innerHTML = '<img class="global-player-art" alt=""><div class="global-player-main"><div class="global-player-title-row"><div><b data-player-title>Choose a song</b><span data-player-artist>ROOSTER</span></div><span class="global-player-count" data-player-count aria-label="0 listens">▶ 0</span></div><div class="global-player-progress"><span data-player-elapsed>0:00</span><input data-player-progress type="range" min="0" max="100" value="0" step="0.1" aria-label="Song progress"><span data-player-duration>0:00</span></div></div><div class="global-player-controls"><button type="button" data-player-prev aria-label="Previous song">'+icon('previous')+'</button><button class="global-player-play" type="button" data-player-play aria-label="Play">'+icon('play')+'</button><button type="button" data-player-next aria-label="Next song">'+icon('next')+'</button><button type="button" data-player-mute aria-label="Mute">'+icon('volume')+'</button><input class="global-player-volume" data-player-volume type="range" min="0" max="1" value="1" step="0.05" aria-label="Volume"><button type="button" data-player-expand aria-label="Show queue and music links">'+icon('queue')+'</button><span class="global-player-links" data-player-links></span></div><span class="global-player-status" data-player-status role="status" aria-live="polite"></span>';
    document.body.appendChild(root);
    ui = {root:root,art:root.querySelector('.global-player-art'),title:root.querySelector('[data-player-title]'),artist:root.querySelector('[data-player-artist]'),count:root.querySelector('[data-player-count]'),elapsed:root.querySelector('[data-player-elapsed]'),duration:root.querySelector('[data-player-duration]'),progress:root.querySelector('[data-player-progress]'),play:root.querySelector('[data-player-play]'),mute:root.querySelector('[data-player-mute]'),volume:root.querySelector('[data-player-volume]'),links:root.querySelector('[data-player-links]'),status:root.querySelector('[data-player-status]')};
    root.querySelector('[data-player-prev]').addEventListener('click', function () { step(-1); });
    root.querySelector('[data-player-next]').addEventListener('click', function () { step(1); });
    ui.play.addEventListener('click', toggle);
    ui.mute.addEventListener('click', function () { audio.muted = !audio.muted; paint(); save(); });
    ui.volume.addEventListener('input', function () { audio.volume = Number(ui.volume.value); audio.muted = false; paint(); save(); });
    ui.progress.addEventListener('input', function () { if (Number.isFinite(audio.duration)) audio.currentTime = Number(ui.progress.value) / 100 * audio.duration; });
    root.querySelector('[data-player-expand]').addEventListener('click', function () { root.classList.toggle('is-expanded'); ui.status.textContent = root.classList.contains('is-expanded') ? ((queue.length || 1) + ' songs ready') : ''; });
    audio.addEventListener('play', function () { window.RosterMediaBus?.claim?.(audio); paint(); });
    audio.addEventListener('pause', paint);
    audio.addEventListener('timeupdate', function () { if (Number.isFinite(audio.duration)) ui.progress.value = String(audio.currentTime / audio.duration * 100); ui.elapsed.textContent = time(audio.currentTime); save(); });
    audio.addEventListener('durationchange', function () { ui.duration.textContent = time(audio.duration); });
    audio.addEventListener('ended', function () { ui.status.textContent = 'Song ended. Press play or choose another song.'; paint(); });
    audio.addEventListener('waiting', function () { ui.status.textContent = 'Loading audio…'; });
    audio.addEventListener('playing', function () { ui.status.textContent = ''; });
    audio.addEventListener('error', function () { ui.status.textContent = 'This song could not play. Try its music link.'; paint(); });
    var saved = loadSaved();
    if (saved) { open(saved.track, false, saved.time); audio.volume = Number.isFinite(saved.volume) ? saved.volume : 1; audio.muted = saved.muted === true; }
  }
  function normalize(input) {
    return {id:safe(input.id)||safe(input.url),url:safe(input.url),title:safe(input.title)||'Untitled song',artist:safe(input.artist)||'ROOSTER artist',art:safe(input.art)||'/roster-icon-192.png',count:Number.isFinite(Number(input.count))?Number(input.count):0,apple:safe(input.apple),spotify:safe(input.spotify),youtube:safe(input.youtube)};
  }
  function links(track) {
    return [['apple','Apple'],['spotify','Spotify'],['youtube','YouTube']].filter(function (entry) { return track[entry[0]]; }).map(function (entry) { return '<a href="'+track[entry[0]].replace(/"/g,'&quot;')+'" target="_blank" rel="noopener" aria-label="Open on '+entry[1]+'">'+entry[1].slice(0,2)+'</a>'; }).join('');
  }
  function paint() {
    if (!mounted || !current) return;
    ui.root.hidden = false; ui.art.src = current.art; ui.art.alt = current.title + ' artwork'; ui.title.textContent = current.title; ui.artist.textContent = current.artist;
    ui.count.textContent = icon('listen') + ' ' + current.count; ui.count.setAttribute('aria-label', current.count + ' listens'); ui.play.textContent = audio.paused ? icon('play') : icon('pause'); ui.play.setAttribute('aria-label', audio.paused ? 'Play' : 'Pause');
    ui.mute.textContent = audio.muted ? icon('mute') : icon('volume'); ui.mute.setAttribute('aria-label', audio.muted ? 'Unmute' : 'Mute'); ui.volume.value = String(audio.volume); ui.links.innerHTML = links(current);
  }
  function open(input, autoplay, resumeAt) {
    mount(); var track = normalize(input); if (!track.url) return;
    if (!queue.some(function (item) { return item.id === track.id; })) queue.push(track);
    var changed = !current || current.url !== track.url; current = track;
    if (changed) { audio.src = track.url; audio.load(); }
    var seek = function () { if (Number.isFinite(resumeAt) && resumeAt > 0 && Number.isFinite(audio.duration)) audio.currentTime = Math.min(resumeAt, Math.max(0, audio.duration - .25)); };
    if (audio.readyState >= 1) seek(); else audio.addEventListener('loadedmetadata', seek, {once:true});
    paint(); save();
    if (autoplay) audio.play().catch(function () { ui.status.textContent = 'Tap play to start this song.'; });
  }
  function toggle() { if (!current) return; if (audio.paused) audio.play().catch(function () { ui.status.textContent = 'Tap again or use the music link.'; }); else audio.pause(); }
  function step(direction) { if (!queue.length || !current) return; var index = queue.findIndex(function (item) { return item.id === current.id; }); open(queue[(index + direction + queue.length) % queue.length], true, 0); }
  document.addEventListener('click', function (event) {
    var trigger = event.target.closest('[data-roster-song]'); if (!trigger) return;
    event.preventDefault();
    var data = trigger.dataset;
    open({id:data.songId,url:data.songUrl,title:data.songTitle,artist:data.songArtist,art:data.songArt,count:data.songCount,apple:data.songApple,spotify:data.songSpotify,youtube:data.songYoutube}, true, 0);
  });
  window.addEventListener('pagehide', save);
  document.addEventListener('DOMContentLoaded', mount, {once:true});
  window.RosterPlayer = {open:open,pause:function(){audio.pause();},current:function(){return current;}};
})();
