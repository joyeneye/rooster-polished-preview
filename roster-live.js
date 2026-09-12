/* ROOSTER LIVE: going live on camera, and live voice rooms, on a phone or a
 * computer.
 *
 * How the media works. The server never carries a broadcast. When two people
 * are in the same room their browsers describe themselves to each other
 * through /api/live/signal, then connect directly and send camera and
 * microphone straight across. A viewer arrives with nothing of their own
 * open, and the browser is only ever asked for a camera or a microphone at
 * the moment somebody chooses to use one.
 *
 * What actually carries the media. Each connection keeps a named transceiver
 * per kind. Somebody with a track to send gets a sending transceiver built
 * around that track; somebody with nothing to send gets a receive-only one.
 * When a track arrives later — a host who turns the camera on after the room
 * opened, a listener the host just promoted — the track is put on that
 * transceiver's sender and the transceiver is switched to sending, which is
 * what starts the renegotiation that carries it. Replacing a track without
 * switching the direction is the difference between a working preview and a
 * broadcast nobody can see.
 *
 * How it survives moving around ROOSTER. A live connection cannot survive a
 * full page load, so while a member is in a room their clicks on ROOSTER links
 * are turned into in-place page swaps and the room keeps running underneath.
 * If a real page load happens anyway — a typed address, a reload, a link this
 * cannot handle — the room key is still in the tab's own storage and the
 * member is put straight back into the room.
 */

/** Where the tab remembers the room it is in. sessionStorage, not
 * localStorage: one tab, one room, and closing the tab is leaving. */
export const LIVE_HOLD = 'roster-live-session';
/** How often a member checks in and collects anything waiting for them. */
export const POLL_MS = 2500;
/** Above this, a microphone is treated as talking. */
export const SPEAKING_LEVEL = 0.045;

/** Every state a member can be told they are in, in the words they read. */
export const LIVE_PHASES = {
  ready: 'Ready',
  permission: 'Waiting for permission',
  connecting: 'Connecting',
  live: 'Live',
  reconnecting: 'Reconnecting',
  ending: 'Ending…',
  ended: 'Ended',
  denied: 'Permission denied',
  failed: 'Connection failed',
};

/** The same camera looks are offered for a preview and for the video track
 * that viewers receive. Keeping this list closed prevents arbitrary CSS from
 * ever being accepted from a button, URL or signal. */
export const LIVE_FILTERS = Object.freeze([
  {id: 'original', name: 'Original', css: 'none'},
  {id:'roster-clean',name:'ROOSTER CLEAN',css:'contrast(1.06) brightness(1.02)'},{id:'main-character',name:'MAIN CHARACTER',css:'contrast(1.24) saturate(1.18) brightness(1.03)'},
  {id:'rich',name:'RICH',css:'contrast(1.27) saturate(1.18) sepia(.06)'},{id:'golden',name:'GOLDEN',css:'brightness(1.06) saturate(1.08) sepia(.17)'},
  {id:'soft-glow',name:'SOFT GLOW',css:'brightness(1.1) contrast(.91) saturate(.96)'},{id:'studio',name:'STUDIO',css:'contrast(1.11) brightness(1.04)'},
  {id:'spotlight',name:'SPOTLIGHT',css:'contrast(1.28) saturate(1.22) brightness(1.05)'},{id:'after-dark',name:'AFTER DARK',css:'contrast(1.2) saturate(1.13) brightness(1.13)'},
  {id:'viral-pop',name:'VIRAL POP',css:'contrast(1.12) saturate(1.3) brightness(1.05)'},{id:'beauty-clean',name:'BEAUTY CLEAN',css:'brightness(1.07) contrast(.98) saturate(1.02)'},
  {id:'barber-fresh',name:'BARBER FRESH',css:'contrast(1.24) saturate(1.06)'},{id:'hair-glow',name:'HAIR GLOW',css:'contrast(1.12) saturate(1.2) brightness(1.04)'},
  {id:'product-pop',name:'PRODUCT POP',css:'contrast(1.17) saturate(1.12) brightness(1.06)'},{id:'street-luxe',name:'STREET LUXE',css:'contrast(1.25) saturate(.96)'},
  {id:'food-heat',name:'FOOD HEAT',css:'contrast(1.12) saturate(1.25) sepia(.12)'},{id:'35mm',name:'35MM',css:'contrast(.94) saturate(.9) sepia(.2)'},
  {id:'disposable',name:'DISPOSABLE',css:'contrast(1.08) brightness(1.12) saturate(.92)'},{id:'vintage-fade',name:'VINTAGE FADE',css:'contrast(.78) saturate(.74) sepia(.18)'},
  {id:'cinema',name:'CINEMA',css:'contrast(1.22) saturate(1.08) hue-rotate(4deg)'},{id:'noir',name:'NOIR',css:'grayscale(1) contrast(1.2) brightness(1.04)'},
  {id:'chrome',name:'CHROME',css:'contrast(1.2) saturate(.9) hue-rotate(12deg)'},{id:'dream',name:'DREAM',css:'brightness(1.12) contrast(.88) saturate(.9)'},
  {id:'vhs',name:'VHS',css:'contrast(1.08) saturate(.88) hue-rotate(8deg)'},{id:'prism',name:'PRISM',css:'contrast(1.12) saturate(1.13) hue-rotate(3deg)'},
]);

export function livePreviewFilter(value) {
  const legacy={mono:'noir',moon:'noir',clarendon:'main-character',juno:'viral-pop',lark:'roster-clean',ludwig:'studio',gingham:'vintage-fade',aden:'dream',valencia:'golden',crema:'35mm',reyes:'soft-glow',slumber:'vintage-fade',perpetua:'roster-clean',amaro:'beauty-clean',mayfair:'rich',rise:'golden',hudson:'chrome',xpro2:'cinema',lofi:'main-character',hefe:'street-luxe'};
  const raw=String(value||'original'),id=legacy[raw]||raw;
  return LIVE_FILTERS.find(filter => filter.id === id)?.css || 'none';
}

const SAFE_KEY = /^[a-z0-9]{12}$/;

export function newSessionId(random = () => Math.random()) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let index = 0; index < 24; index += 1) id += alphabet[Math.floor(random() * alphabet.length) % alphabet.length];
  return id;
}

/** What the tab is holding, or nothing. Anything unrecognisable is dropped
 * rather than sent to the server. */
export function heldSession(storage) {
  try {
    const raw = storage?.getItem(LIVE_HOLD);
    if (!raw) return null;
    const held = JSON.parse(raw);
    if (!held || !SAFE_KEY.test(String(held.key || '')) || typeof held.session !== 'string' || held.session.length < 8) return null;
    return {key: String(held.key), session: String(held.session), title: typeof held.title === 'string' ? held.title : ''};
  } catch { return null; }
}

export function holdSession(storage, value) {
  try {
    if (!value) storage?.removeItem(LIVE_HOLD);
    else storage?.setItem(LIVE_HOLD, JSON.stringify({key: value.key, session: value.session, title: value.title || ''}));
  } catch { /* a tab with storage turned off simply cannot rejoin after a reload */ }
}

/** Who offers first. Both sides work it out from the two member ids alone, so
 * neither has to be told and both always agree. */
export function politeSide(mine, theirs) {
  return String(mine) > String(theirs);
}

/** A listener does not need a connection to another listener: only to the
 * people who are allowed to talk or be seen. This keeps a room with a big
 * audience to a handful of connections each instead of one per person. */
export function shouldConnect(you, them) {
  if (!you || !them || you.member_id === them.member_id) return false;
  return you.role !== 'listener' || them.role !== 'listener';
}

/** What a browser refused, in words a member can act on. A dismissed
 * permission prompt and a denied one arrive the same way, so both get the
 * same explanation and the same retry. */
export function mediaBlame(error) {
  const name = String(error?.name || '');
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return {
      phase: 'denied',
      message: 'ROOSTER does not have permission to use your camera and microphone. Allow them for this site in your browser settings, then press Try Again.',
    };
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return {
      phase: 'failed',
      message: 'No camera or microphone was found. Connect one, or open an audio room from More settings, then press Try Again.',
    };
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return {
      phase: 'failed',
      message: 'Another app is using your camera or microphone. Close it, then press Try Again.',
    };
  }
  return {phase: 'failed', message: 'ROOSTER could not use your camera or microphone. Press Try Again.'};
}

export function createRosterLive({
  doc = document,
  win = window,
  storage = (() => { try { return window.sessionStorage; } catch { return null; } })(),
  fetchImpl = (...args) => fetch(...args),
  peerFactory = (config) => new RTCPeerConnection(config),
  requestMicrophone = (constraints) => navigator.mediaDevices.getUserMedia(constraints),
  listDevices = () => navigator.mediaDevices.enumerateDevices(),
  audioContextFactory = () => new (win.AudioContext || win.webkitAudioContext)(),
  onChange = () => {},
} = {}) {
  const byId = (id) => doc.getElementById(id);
  /* /live.html is video LIVE and /live.html?medium=audio is the audio rooms
     directory. Both are the same page and the same room list; the parameter
     only decides which half of it this visit is asking for, so every existing
     link — /live.html and /live.html?room=<key> — still lands where it did. */
  const wantedMedium = (() => {
    try {
      const value = new URLSearchParams(win.location.search).get('medium');
      return value === 'audio' || value === 'video' ? value : '';
    } catch { return ''; }
  })();

  const state = {
    member_id: '', name: '', rooms: [], ice_servers: [],
    room: null, you: null, participants: [], messages: [], joined: false,
    speaking: new Set(), status: '', tone: '', busy: false, listing: false,
    phase: 'ready',
    camera: false, mic: true, audioOnly: wantedMedium === 'audio', facing: 'user', liveFilter: 'original',
    cameras: [], mics: [], cameraId: '', micId: '',
    tab: 'chat', confirming: false, tapToPlay: false, sending: false, commentsVisible: true, moderationQueue: [], endFailed: false, ending: false,
  };
  /** memberId -> {pc, polite, makingOffer, ignoreOffer, media, stream, tx} */
  const peers = new Map();
  let session = null;
  let localStream = null;
  let filteredStream = null;
  let filterSource = null;
  let filterFrame = null;
  let polling = null;
  let audioContext = null;
  let rejoining = false;
  let starting = false;
  let cancelled = false;
  let pending = null;
  let selfView = null;
  let audioOutputActivated = false;
  const blockedMedia = new Set();

  /* ------------------------------------------------------------ the talking */

  // The member gate is shared with messages, so its "log in" sentence talks
  // about messages. On ROOSTER LIVE a member should read about ROOSTER LIVE.
  const SIGN_IN = 'Log in to ROOSTER to use ROOSTER LIVE. It is invite only.';
  function refusal(status, message) {
    return status === 401 ? SIGN_IN : (message || 'ROOSTER LIVE could not be reached.');
  }

  async function post(payload, {path = '/api/live/room', signal} = {}) {
    const response = await fetchImpl(path, {
      method: 'POST', credentials: 'same-origin',
      headers: {'Content-Type': 'application/json', Accept: 'application/json'},
      body: JSON.stringify(payload), signal,
    });
    let body = null;
    try { body = await response.json(); } catch { body = null; }
    if (!response.ok) {
      const error = new Error(refusal(response.status, body?.error));
      error.status = response.status;
      throw error;
    }
    return body || {};
  }

  function say(message, tone = '') {
    state.status = message;
    state.tone = tone;
    paint();
  }

  /** Move to a named state, and say why in the same breath. */
  function phase(next, message, tone = '') {
    state.phase = next;
    if (message === undefined) paint();
    else say(message, tone);
  }

  /* ------------------------------------------------------- the room listing */

  async function loadRooms() {
    state.listing = true;
    paint();
    try {
      const response = await fetchImpl('/api/live/rooms', {credentials: 'same-origin', headers: {Accept: 'application/json'}});
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(refusal(response.status, body?.error));
      state.member_id = body.member_id || state.member_id;
      state.name = body.name || state.name;
      state.rooms = Array.isArray(body.rooms) ? body.rooms : [];
      state.ice_servers = Array.isArray(body.ice_servers) ? body.ice_servers : [];
      if (state.status && state.tone === 'error' && !state.joined) say('');
    } catch (error) {
      state.rooms = [];
      say(error?.message || 'The live rooms could not be loaded.', 'error');
    } finally {
      state.listing = false;
      paint();
    }
  }

  /* ------------------------------------------------- the camera and the mic

     Nothing here runs on page load. It runs when somebody presses Turn On
     Camera, Go Live or Unmute, and nothing else. */

  function audioConstraints() {
    const base = {echoCancellation: true, noiseSuppression: true, autoGainControl: true};
    return state.micId ? {...base, deviceId: {exact: state.micId}} : base;
  }

  function videoConstraints() {
    const which = state.cameraId ? {deviceId: {exact: state.cameraId}} : {facingMode: state.facing};
    return {...which, width: {ideal: 1280}, height: {ideal: 720}, frameRate: {ideal: 30, max: 30}};
  }

  function localTrack(kind) {
    if (!localStream) return null;
    const [track] = kind === 'video' ? localStream.getVideoTracks() : localStream.getAudioTracks();
    return track || null;
  }

  function outboundStream() {
    return filteredStream || localStream;
  }

  function setVideoEnabled(enabled) {
    for (const track of (localStream?.getVideoTracks?.() || [])) track.enabled = Boolean(enabled);
    for (const track of (filteredStream?.getVideoTracks?.() || [])) track.enabled = Boolean(enabled);
  }

  function stopFilterPipeline() {
    if (filterFrame !== null) {
      if (typeof win.cancelAnimationFrame === 'function') win.cancelAnimationFrame(filterFrame);
      else win.clearTimeout?.(filterFrame);
      filterFrame = null;
    }
    for (const track of (filterSource?.capture?.getTracks?.() || [])) {
      try { track.stop(); } catch { /* already stopped */ }
    }
    try {
      if (filterSource?.video) {
        filterSource.video.srcObject = null;
        filterSource.video.remove();
      }
    } catch { /* already removed */ }
    filterSource = null;
    filteredStream = null;
  }

  /** A selected look is drawn to a canvas and that canvas becomes the outgoing
   * video track. The visible preview stays on the raw camera with the matching
   * CSS filter, so camera controls remain responsive while viewers receive the
   * actual filtered frames. */
  function startFilterPipeline() {
    stopFilterPipeline();
    const sourceTrack = localTrack('video');
    if (!sourceTrack || state.liveFilter === 'original') return true;
    const Stream = win.MediaStream || (typeof MediaStream === 'function' ? MediaStream : null);
    const video = doc.createElement('video');
    const canvas = doc.createElement('canvas');
    const context = canvas.getContext?.('2d', {alpha: false});
    if (!Stream || !context || typeof canvas.captureStream !== 'function') return false;
    const settings = sourceTrack.getSettings?.() || {};
    canvas.width = Math.max(2, Number(settings.width) || 1280);
    canvas.height = Math.max(2, Number(settings.height) || 720);
    video.autoplay = true;
    video.muted = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('aria-hidden', 'true');
    video.className = 'live-filter-source';
    video.srcObject = localStream;
    doc.body?.appendChild(video);
    const capture = canvas.captureStream(30);
    const [filteredTrack] = capture.getVideoTracks?.() || [];
    if (!filteredTrack) { video.remove(); return false; }
    try { filteredTrack.contentHint = 'motion'; } catch { /* optional */ }
    filterSource = {video, canvas, capture};
    filteredStream = new Stream([...localStream.getAudioTracks(), filteredTrack]);
    setVideoEnabled(state.camera);
    const draw = () => {
      if (!filterSource || filterSource.video !== video) return;
      try {
        context.filter = livePreviewFilter(state.liveFilter);
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
      } catch { /* the first camera frame may not be ready yet */ }
      filterFrame = typeof win.requestAnimationFrame === 'function'
        ? win.requestAnimationFrame(draw)
        : win.setTimeout(draw, 33);
    };
    const played = video.play?.();
    if (played?.catch) played.catch(() => {});
    draw();
    return true;
  }

  async function setLiveFilter(value) {
    const wanted = value === 'mono' ? 'noir' : String(value || 'original');
    if (!LIVE_FILTERS.some(filter => filter.id === wanted)) return false;
    state.liveFilter = wanted;
    if (localTrack('video') && !startFilterPipeline()) {
      state.liveFilter = 'original';
      startFilterPipeline();
      say('This browser cannot send camera filters. Original is still ready to broadcast.', 'error');
      return false;
    }
    await attachAll();
    paint();
    return true;
  }

  /** The one door to a camera or a microphone. Everything that needs media
   * comes through here, so there is exactly one place a member is asked. */
  async function openMedia({video = false, force = false} = {}) {
    if (!force && localStream && (!video || localStream.getVideoTracks().length)) return localStream;
    const previous = localStream;
    const wasLive = state.phase === 'live';
    if (!wasLive) phase('permission', 'Your browser is asking about the camera and microphone. Choose Allow.');
    let stream;
    try {
      stream = await requestMicrophone({audio: audioConstraints(), video: video ? videoConstraints() : false});
    } catch (error) {
      if (!wasLive && !previous) closeMedia();
      throw error;
    }
    localStream = stream;
    // Everybody arrives with the microphone off, the host included: it opens
    // when the room says this member may talk and they chose to.
    for (const track of localStream.getAudioTracks()) track.enabled = false;
    if (video) state.camera = true;
    for (const track of localStream.getVideoTracks()) track.enabled = state.camera;
    if (previous && previous !== localStream) {
      for (const track of previous.getTracks()) { track.enabled = false; track.stop(); }
      dropMeter('you');
    }
    meter('you', localStream);
    if (!startFilterPipeline()) state.liveFilter = 'original';
    void readDevices();
    // A track that arrives after the connections were made has to be put on
    // them and switched to sending, which is what actually carries it.
    await attachAll();
    paint();
    return localStream;
  }

  /** Phones, especially iPhones, often cannot open the rear camera while the
   * front camera still owns the hardware. Release only the old video track,
   * keep the working microphone, and then request the next camera. */
  async function replaceCamera({facing = state.facing, deviceId = ''} = {}) {
    if (!localStream) {
      state.facing = facing;
      state.cameraId = deviceId;
      return openMedia({video: true});
    }
    stopFilterPipeline();
    for (const track of localStream.getVideoTracks()) {
      localStream.removeTrack?.(track);
      track.enabled = false;
      track.stop();
    }
    state.facing = facing;
    state.cameraId = deviceId;
    const cameraStream = await requestMicrophone({audio: false, video: videoConstraints()});
    const [nextTrack] = cameraStream.getVideoTracks();
    if (!nextTrack) throw Object.assign(new Error('That camera was not available.'), {name: 'NotFoundError'});
    if (typeof localStream.addTrack === 'function') localStream.addTrack(nextTrack);
    else {
      const Stream = win.MediaStream || (typeof MediaStream === 'function' ? MediaStream : null);
      if (!Stream) throw new Error('This browser could not switch cameras.');
      localStream = new Stream([...localStream.getAudioTracks(), nextTrack]);
    }
    for (const track of cameraStream.getTracks()) if (track !== nextTrack) track.stop();
    const actual = nextTrack.getSettings?.() || {};
    if (actual.facingMode === 'user' || actual.facingMode === 'environment') state.facing = actual.facingMode;
    state.camera = true;
    if (!startFilterPipeline()) state.liveFilter = 'original';
    setVideoEnabled(true);
    await attachAll();
    void readDevices();
    paint();
    return localStream;
  }

  /** Let the camera light go out. Called when a host ends or cancels, when
   * the room says this member may no longer send, and when they leave. */
  function closeMedia() {
    state.camera = false;
    if (selfView) { try { selfView.srcObject = null; selfView.remove(); } catch { /* gone */ } selfView = null; }
    const preview = byId('live-preview');
    if (preview) { try { preview.srcObject = null; } catch { /* gone */ } }
    stopFilterPipeline();
    if (!localStream) { paint(); return; }
    for (const track of localStream.getTracks()) { track.enabled = false; track.stop(); }
    localStream = null;
    dropMeter('you');
    paint();
  }

  async function readDevices() {
    try {
      const devices = await listDevices();
      if (!Array.isArray(devices)) return;
      state.cameras = devices.filter(device => device.kind === 'videoinput');
      state.mics = devices.filter(device => device.kind === 'audioinput');
      paint();
    } catch { /* a browser that will not list devices still works with the defaults */ }
  }

  /* --------------------------------------------------- the speaking indicator

     Reads the level of each microphone in the room and marks whoever is
     actually talking, so the ring goes round the right person. */

  const meters = new Map();

  function meter(id, stream) {
    if (!stream || meters.has(id) || !stream.getAudioTracks?.().length) return;
    try {
      audioContext = audioContext || audioContextFactory();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      meters.set(id, {source, analyser, samples});
    } catch { /* without WebAudio the room still works, just without the ring */ }
  }

  function dropMeter(id) {
    const entry = meters.get(id);
    if (!entry) return;
    try { entry.source.disconnect(); } catch { /* already gone */ }
    meters.delete(id);
    state.speaking.delete(id);
  }

  function readMeters() {
    if (!meters.size) return;
    let changed = false;
    for (const [id, entry] of meters) {
      let level = 0;
      try {
        entry.analyser.getFloatTimeDomainData(entry.samples);
        let sum = 0;
        for (const value of entry.samples) sum += value * value;
        level = Math.sqrt(sum / entry.samples.length);
      } catch { level = 0; }
      // Your own level only counts while your microphone is actually on.
      const live = id === 'you' ? Boolean(localTrack('audio')?.enabled) : true;
      const talking = live && level > SPEAKING_LEVEL;
      const key = id === 'you' ? state.member_id : id;
      if (talking && !state.speaking.has(key)) { state.speaking.add(key); changed = true; }
      if (!talking && state.speaking.has(key)) { state.speaking.delete(key); changed = true; }
    }
    if (changed) paint();
  }

  /* ------------------------------------------------------- the connections */

  function audioSink() {
    let sink = byId('roster-live-audio');
    if (!sink) {
      sink = doc.createElement('div');
      sink.id = 'roster-live-audio';
      sink.className = 'live-audio-sink';
      sink.setAttribute('aria-hidden', 'true');
      doc.body.appendChild(sink);
    }
    // Safari can suppress a media element whose entire ancestor tree is
    // display:none. Keep the sink rendered offscreen instead of hidden.
    sink.hidden = false;
    return sink;
  }

  function stageMedia() {
    return byId('live-stage-media') || audioSink();
  }

  /** Which kinds this room negotiates. An audio room never opens a video
   * line, so the two experiences stay honestly separate on the wire too. */
  function kinds() {
    return state.room?.medium === 'video' ? ['audio', 'video'] : ['audio'];
  }

  /** Anything this member is allowed to send right now. The server's word on
   * their role is the only thing that decides it. */
  function sendable(kind) {
    if (!state.you || state.you.role === 'listener') return null;
    if (kind === 'video') return filteredStream?.getVideoTracks?.()[0] || localTrack(kind);
    return localTrack(kind);
  }

  /** Make one connection carry what this member has, in both directions.
   *
   * This is the part that was broken: a receive-only transceiver stays
   * receive-only no matter what track is put on its sender, so a host's
   * camera and microphone were opened, metered and previewed and never sent.
   * Switching the direction is what triggers the renegotiation that carries
   * the media to the other side. */
  async function attach(id, peer) {
    for (const kind of kinds()) {
      const track = sendable(kind);
      const existing = peer.tx[kind];
      try {
        if (!existing) {
          peer.tx[kind] = track
            ? peer.pc.addTransceiver(track, {direction: 'sendrecv', streams: [outboundStream()]})
            : peer.pc.addTransceiver(kind, {direction: 'recvonly'});
          continue;
        }
        if (track && existing.sender?.track !== track) {
          await existing.sender.replaceTrack(track);
          if (existing.direction !== 'sendrecv') existing.direction = 'sendrecv';
        } else if (!track && existing.sender?.track) {
          await existing.sender.replaceTrack(null);
          existing.direction = 'recvonly';
        }
      } catch { dropPeer(id); return; }
    }
  }

  async function attachAll() {
    for (const [id, peer] of [...peers]) await attach(id, peer);
  }

  function peerFor(id) {
    const existing = peers.get(id);
    if (existing) return existing;
    const pc = peerFactory({iceServers: state.ice_servers});
    const peer = {
      pc, polite: politeSide(state.member_id, id), makingOffer: false, ignoreOffer: false,
      media: null, stream: null, output: null, tx: {audio: null, video: null}, pendingCandidates: [], retryTimer: null,
    };
    peers.set(id, peer);
    void attach(id, peer);

    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        queue({to_id: id, kind: 'offer', payload: {sdp: pc.localDescription.sdp, type: pc.localDescription.type}});
        await flush();
      } catch { dropPeer(id); } finally { peer.makingOffer = false; }
    };
    pc.onicecandidate = ({candidate}) => {
      if (candidate) queue({to_id: id, kind: 'ice', payload: {candidate: candidate.toJSON ? candidate.toJSON() : candidate}});
    };
    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (!stream) return;
      peer.stream = stream;
      mountRemote(id, stream);
      // A host who turns the camera off and on again changes what this
      // stream carries, so the element it plays through is chosen again.
      stream.addEventListener?.('addtrack', () => mountRemote(id, stream));
      stream.addEventListener?.('removetrack', () => mountRemote(id, stream));
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        if (peer.retryTimer) win.clearTimeout(peer.retryTimer);
        peer.retryTimer = null;
      } else if (pc.connectionState === 'failed') {
        schedulePeerRetry(id, peer, 150);
      } else if (pc.connectionState === 'disconnected') {
        schedulePeerRetry(id, peer, 1800);
      }
      watchConnections();
    };
    return peer;
  }

  function schedulePeerRetry(id, peer, delay) {
    if (!state.joined || peer.retryTimer) return;
    phase('reconnecting', 'The connection dropped. ROOSTER is putting both sides back together.', '');
    peer.retryTimer = win.setTimeout(() => {
      peer.retryTimer = null;
      if (peers.get(id) !== peer || !state.joined) return;
      dropPeer(id);
      reconcilePeers();
    }, delay);
  }

  /** One place decides whether this member is live, reconnecting or waiting,
   * from the connections that actually exist. */
  function watchConnections() {
    if (!state.joined) return;
    const states = [...peers.values()].map(peer => peer.pc.connectionState);
    const anyConnected = states.includes('connected');
    const anyTrying = states.some(value => ['new', 'connecting', 'disconnected'].includes(value));
    if (anyConnected && state.phase !== 'live') phase('live', state.status, state.tone);
    else if (!anyConnected && anyTrying && state.phase === 'live') {
      phase('reconnecting', 'The connection dropped. ROOSTER is putting it back.', '');
    } else paint();
  }

  function mountRemote(id, stream) {
    const peer = peers.get(id);
    if (!peer) return;
    const wantVideo = stream.getVideoTracks().some(track => track.readyState === 'live');
    const tag = wantVideo ? 'video' : 'audio';
    if (peer.media && peer.media.tagName.toLowerCase() !== tag) unmount(peer);
    if (!peer.media) {
      const element = doc.createElement(tag);
      element.autoplay = true;
      element.setAttribute('playsinline', '');
      element.setAttribute('preload', 'auto');
      element.dataset.liveMember = id;
      // The site's one-thing-plays-at-a-time bus leaves a live room alone.
      element.dataset.rosterLive = 'stream';
      if (wantVideo) element.className = 'live-stage-video';
      else {
        element.className = 'live-remote-audio';
        element.muted = false;
        element.defaultMuted = false;
        element.volume = 1;
      }
      peer.media = element;
      element.addEventListener?.('playing', () => {
        blockedMedia.delete(element);
        if (!blockedMedia.size) {
          audioOutputActivated = true;
          state.tapToPlay = false;
          paint();
        }
      });
    }
    const holder = wantVideo ? stageMedia() : audioSink();
    if (peer.media.parentNode !== holder) holder.appendChild(peer.media);
    if (peer.media.srcObject !== stream) peer.media.srcObject = stream;
    connectRemoteOutput(peer, stream);
    playMedia(peer.media);
    meter(id, stream);
    if (state.joined && state.phase !== 'live') phase('live', state.status, state.tone);
    else paint();
  }

  function unmount(peer) {
    if (peer.output) {
      try { peer.output.source.disconnect(); } catch { /* already disconnected */ }
      peer.output = null;
    }
    if (!peer.media) return;
    blockedMedia.delete(peer.media);
    try { peer.media.srcObject = null; peer.media.remove(); } catch { /* gone */ }
    peer.media = null;
  }

  /** Start the phone's speaker while the member's tap is still a real browser
   * gesture. The remote stream arrives after the join request, which is too
   * late for iPhone autoplay; a running Web Audio output keeps that tap valid. */
  function primeRoomAudio() {
    audioOutputActivated = true;
    state.tapToPlay = false;
    try {
      audioContext = audioContext || audioContextFactory();
      const resumed = audioContext?.state === 'suspended' ? audioContext.resume?.() : null;
      if (resumed?.catch) resumed.catch(() => { audioOutputActivated = false; });
    } catch { /* regular media-element playback remains the fallback */ }
  }

  function connectRemoteOutput(peer, stream) {
    if (!audioOutputActivated || !audioContext?.createMediaStreamSource || !audioContext?.destination) return false;
    if (peer.output?.stream === stream) return true;
    if (peer.output) {
      try { peer.output.source.disconnect(); } catch { /* already disconnected */ }
      peer.output = null;
    }
    try {
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(audioContext.destination);
      peer.output = {source, stream};
      // Web Audio owns the sound in this path. Muting the matching element
      // avoids an echo when a desktop browser also permits autoplay.
      if (peer.media) peer.media.muted = true;
      return true;
    } catch { return false; }
  }

  /** A phone will not start a stream it was not asked to start. Rather than
   * pretending the room is silent, show one large explicit sound button. */
  function playMedia(element) {
    if (element?.tagName?.toLowerCase?.() === 'audio') {
      element.muted = false;
      element.defaultMuted = false;
      element.volume = 1;
    }
    const played = element.play?.();
    if (played?.then) {
      played.then(() => {
        blockedMedia.delete(element);
        audioOutputActivated = blockedMedia.size === 0;
        state.tapToPlay = blockedMedia.size > 0;
        paint();
      }).catch(() => {
        blockedMedia.add(element);
        audioOutputActivated = false;
        state.tapToPlay = true;
        paint();
      });
    } else {
      blockedMedia.delete(element);
      audioOutputActivated = blockedMedia.size === 0;
      state.tapToPlay = blockedMedia.size > 0;
      paint();
    }
  }

  async function startRoomAudio() {
    primeRoomAudio();
    try {
      audioContext = audioContext || audioContextFactory();
      if (audioContext?.state === 'suspended') await audioContext.resume?.();
    } catch { /* the media elements still carry sound without Web Audio */ }
    let blocked = false;
    for (const peer of peers.values()) if (peer.stream) connectRemoteOutput(peer, peer.stream);
    const media = [...peers.values()].map(peer => peer.media).filter(Boolean);
    if (!media.length) {
      say('Room audio is ready. Waiting for somebody to speak.', 'ok');
      return true;
    }
    await Promise.all(media.map(async element => {
      const peer = [...peers.values()].find(entry => entry.media === element);
      if (!peer?.output && element.tagName?.toLowerCase?.() === 'audio') {
        element.muted = false;
        element.defaultMuted = false;
        element.volume = 1;
      }
      try {
        if (!peer?.output) await element.play?.();
        blockedMedia.delete(element);
      } catch {
        blockedMedia.add(element);
        blocked = true;
      }
    }));
    if (blocked || blockedMedia.size) {
      audioOutputActivated = false;
      state.tapToPlay = true;
      say('Your browser blocked the speaker. Tap to Hear Audio again.', 'error');
      return false;
    }
    say(media.length ? 'Room audio is on.' : 'Room audio is on. Connecting to the room…', 'ok');
    paint();
    return true;
  }

  function dropPeer(id) {
    const peer = peers.get(id);
    if (!peer) return;
    peers.delete(id);
    if (peer.retryTimer) win.clearTimeout(peer.retryTimer);
    peer.retryTimer = null;
    dropMeter(id);
    try { peer.pc.close(); } catch { /* already closed */ }
    unmount(peer);
  }

  function dropEveryPeer() {
    for (const id of [...peers.keys()]) dropPeer(id);
  }

  /* Connection setup goes out in small batches. Trickled network candidates
     arrive a few milliseconds apart, and sending each one on its own would
     mean dozens of requests to set up one conversation. */
  const outbox = [];
  let flushing = null;

  async function send(signals) {
    if (!session) return;
    await post({key: session.key, session: session.session, signals}, {path: '/api/live/signal'});
  }

  function queue(signal) {
    outbox.push(signal);
    if (flushing) return;
    flushing = win.setTimeout(() => {
      flushing = null;
      void flush();
    }, 220);
  }

  async function flush() {
    while (outbox.length && session) {
      const batch = outbox.splice(0, 20);
      try { await send(batch); } catch { /* the other side re-offers; nothing to salvage here */ }
    }
  }

  async function handleSignal({from_id: from, kind, payload}) {
    if (!from || from === state.member_id) return;
    if (kind === 'bye') { dropPeer(from); return; }
    const peer = peerFor(from);
    const pc = peer.pc;
    try {
      if (kind === 'offer' || kind === 'answer') {
        const description = {type: payload?.type, sdp: payload?.sdp};
        if (description.type !== kind) return;
        const collision = kind === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
        peer.ignoreOffer = !peer.polite && collision;
        if (peer.ignoreOffer) return;
        await pc.setRemoteDescription(description);
        const waiting = peer.pendingCandidates.splice(0, peer.pendingCandidates.length);
        for (const candidate of waiting) {
          try { await pc.addIceCandidate(candidate); } catch { /* another candidate can still connect */ }
        }
        // An answer can associate the transceivers this side made, so what it
        // has to send is checked again now the shape is agreed.
        if (kind === 'answer') await attach(from, peer);
        if (kind === 'offer') {
          await attach(from, peer);
          await pc.setLocalDescription();
          queue({to_id: from, kind: 'answer', payload: {sdp: pc.localDescription.sdp, type: pc.localDescription.type}});
          await flush();
        }
      } else if (kind === 'ice' && payload?.candidate) {
        // Trickle ICE can beat the offer through two separate polling cycles.
        // A browser refuses addIceCandidate before setRemoteDescription, so
        // hold it instead of destroying the whole peer and leaving one side
        // with a picture that the other can never receive.
        if (!pc.remoteDescription?.type) peer.pendingCandidates.push(payload.candidate);
        else {
          try { await pc.addIceCandidate(payload.candidate); } catch { /* keep the peer; later candidates may work */ }
        }
      }
    } catch { dropPeer(from); }
  }

  /** Connect to everybody who should be connected, and let go of anybody who
   * has left, been removed or stepped down to listening. */
  function reconcilePeers() {
    const wanted = new Set(
      state.participants.filter(entry => shouldConnect(state.you, entry)).map(entry => entry.member_id),
    );
    for (const id of [...peers.keys()]) if (!wanted.has(id)) dropPeer(id);
    for (const id of wanted) {
      // Only the impolite side opens the connection, so two people never both
      // start one and cancel each other out.
      if (!peers.has(id) && !politeSide(state.member_id, id)) peerFor(id);
    }
  }

  function applyState(body) {
    if (state.ending) return undefined;
    if (body.ended) return leave({ended: true});
    if (body.member_id) state.member_id = body.member_id;
    if (Array.isArray(body.ice_servers) && body.ice_servers.length) state.ice_servers = body.ice_servers;
    if (body.room) state.room = body.room;
    if (body.you) state.you = body.you;
    if (Array.isArray(body.participants)) state.participants = body.participants;
    if (Array.isArray(body.messages)) state.messages = body.messages;
    state.moderationQueue = Array.isArray(body.moderation_queue) ? body.moderation_queue : [];
    // The server is the only word on whether this camera and microphone may
    // be open at all.
    const allowed = state.you && state.you.role !== 'listener';
    if (localStream) {
      for (const track of localStream.getAudioTracks()) track.enabled = Boolean(allowed) && state.you?.muted === false;
      setVideoEnabled(Boolean(allowed) && state.camera);
    }
    if (!allowed && localStream) closeMedia();
    reconcilePeers();
    void attachAll();
    paint();
    if (Array.isArray(body.signals)) for (const signal of body.signals) void handleSignal(signal);
    return undefined;
  }

  /* ------------------------------------------------------- coming and going */

  function startPolling() {
    stopPolling();
    polling = win.setInterval(() => { void tick(); }, POLL_MS);
  }

  function stopPolling() {
    if (polling) win.clearInterval(polling);
    polling = null;
  }

  async function tick() {
    if (!session || state.busy) return;
    readMeters();
    try {
      applyState(await post({action: 'sync', key: session.key, session: session.session}));
      if (state.joined && state.phase === 'reconnecting') watchConnections();
    } catch (error) {
      if (error?.status === 404 || error?.status === 409 || error?.status === 403) {
        // The room ended, the host removed this member, or their place was
        // given up. Either way they are not in a room any more.
        const ended = error.status === 404;
        await leave({quiet: true, ended});
        phase(ended ? 'ended' : 'ready', error.status === 403 ? 'The host removed you from that room.'
          : ended ? 'This broadcast has ended.' : 'You left that room.', 'error');
      } else if (state.joined && state.phase === 'live') {
        phase('reconnecting', 'ROOSTER cannot reach the room right now. It keeps trying.', '');
      }
    }
  }

  /** Join a room. A viewer opens nothing of their own. */
  async function join(key, {announce = true} = {}) {
    if (!SAFE_KEY.test(String(key || ''))) { phase('failed', 'That is not a ROOSTER LIVE room.', 'error'); return false; }
    blockedMedia.clear();
    state.tapToPlay = false;
    state.busy = true;
    if (announce) phase('connecting', 'Joining the room…');
    try {
      const next = {key: String(key), session: session?.session || newSessionId(), title: ''};
      const body = await post({action: 'join', key: next.key, session: next.session});
      session = next;
      session.title = body?.room?.title || '';
      holdSession(storage, session);
      state.joined = true;
      state.tab = 'chat';
      applyState(body);
      // One thing at a time: the music player stops so the room can be heard.
      win.dispatchEvent(new CustomEvent('jwhite:pause-music'));
      startPolling();
      if (announce) {
        phase('connecting', state.room?.medium === 'video'
          ? 'You are in. Waiting for the picture…'
          : 'You are in the room, listening. Your microphone is off.', '');
      }
      return true;
    } catch (error) {
      state.joined = false;
      session = null;
      holdSession(storage, null);
      phase(error?.status === 404 ? 'ended' : 'failed', error?.message || 'That room could not be joined.', 'error');
      return false;
    } finally {
      state.busy = false;
      paint();
    }
  }

  /** Open a room and start sending. One press, one room: a second press
   * while this is running is ignored rather than opening another. */
  async function create(title, {description = '', medium = ''} = {}) {
    if (starting) return false;
    starting = true;
    cancelled = false;
    state.busy = true;
    const video = medium ? medium === 'video' : !state.audioOnly;
    try {
      if (video || state.mic) {
        try {
          await openMedia({video});
        } catch (error) {
          const blame = mediaBlame(error);
          phase(blame.phase, blame.message, 'error');
          return false;
        }
      }
      if (cancelled) { await abandon(); return false; }
      phase('connecting', video ? 'Opening your broadcast…' : 'Opening your room…');
      const body = await post({action: 'create', title, description, medium: video ? 'video' : 'audio'});
      if (Array.isArray(body.ice_servers) && body.ice_servers.length) state.ice_servers = body.ice_servers;
      const key = body?.room?.key;
      pending = {key};
      if (cancelled) { await abandon(); return false; }
      state.busy = false;
      const joined = await join(key, {announce: false});
      pending = null;
      if (!joined) return false;
      if (cancelled) { await abandon(); return false; }
      // The host chose the microphone on before pressing Go Live, so it goes
      // on now that the room says they may talk.
      if (state.mic) {
        const microphoneOn = await setMuted(false, {quiet: true});
        if (!microphoneOn || state.you?.muted !== false || !localTrack('audio')?.enabled) {
          phase('failed', 'The room opened, but your microphone did not turn on. Press Unmute to try again.', 'error');
          return false;
        }
      }
      phase('live', video
        ? 'You are live. Everybody on the roster can watch and comment.'
        : 'Your room is on. You are the host.', 'ok');
      await loadRooms();
      return true;
    } catch (error) {
      phase('failed', error?.message || 'Your room could not be opened. Check your connection and press Try Again.', 'error');
      return false;
    } finally {
      starting = false;
      state.busy = false;
      paint();
    }
  }

  /** Stop before going live, and leave nothing behind: no half-open room in
   * the list, no camera light still on. */
  async function abandon() {
    const key = pending?.key;
    pending = null;
    if (session) {
      try { await post({action: 'host', key: session.key, host_action: 'end_room'}); } catch { /* the room prunes itself */ }
      await leave({quiet: true, ended: true});
    } else if (key) {
      try { await post({action: 'host', key, host_action: 'end_room'}); } catch { /* the room prunes itself */ }
    }
    closeMedia();
    phase('ready', 'You stopped before going live. Nothing was broadcast.', '');
  }

  function cancelStart() {
    if (!starting) return;
    cancelled = true;
    phase('connecting', 'Stopping…');
  }

  async function leave({quiet = false, ended = false} = {}) {
    const held = session;
    stopPolling();
    dropEveryPeer();
    closeMedia();
    session = null;
    outbox.length = 0;
    if (flushing) { win.clearTimeout(flushing); flushing = null; }
    holdSession(storage, null);
    state.joined = false;
    state.room = null;
    state.you = null;
    state.participants = [];
    state.messages = [];
    state.confirming = false;
    state.endFailed = false;
    state.ending = false;
    state.tapToPlay = false;
    audioOutputActivated = false;
    blockedMedia.clear();
    state.speaking.clear();
    state.phase = ended ? 'ended' : 'ready';
    paint();
    if (held && !ended) { try { await post({action: 'leave', key: held.key, session: held.session}); } catch { /* leaving is leaving */ } }
    if (!quiet) say(ended ? 'This broadcast has ended.' : 'You left the room.', '');
    await loadRooms();
  }

  async function endLive() {
    if (state.ending || !session || !state.you?.is_host) return false;
    state.ending = true; state.endFailed = false; state.confirming = true;
    stopPolling(); dropEveryPeer(); closeMedia(); outbox.length = 0;
    if (flushing) { win.clearTimeout(flushing); flushing = null; }
    phase('ending', 'Ending… Video and audio are stopped here.');
    const controller = new AbortController();
    const timer = win.setTimeout(() => controller.abort(), 12_000);
    try {
      const body = await post({action:'host',key:session.key,host_action:'end_room'}, {signal:controller.signal});
      if (!body?.ended) throw new Error('The room did not confirm it ended.');
      await leave({ended:true,quiet:true});
      phase('ended','Live ended. Your camera and microphone are off.','ok');
      return true;
    } catch (error) {
      state.ending = false; state.endFailed = true; state.confirming = true;
      phase('ending','Video stopped here; room is still closing. Retry close room.','error');
      return false;
    } finally { win.clearTimeout(timer); paint(); }
  }

  /* ---------------------------------------------------- what a member presses */

  async function act(payload, {working = 'Working…', quiet = false} = {}) {
    if (!session) return false;
    if (!quiet) say(working);
    try {
      const body = await post({...payload, key: session.key});
      if (body.ended) {
        await leave({ended: true, quiet: true});
        phase('ended', 'You ended the broadcast. Your camera and microphone are off.', 'ok');
        return true;
      }
      applyState(body);
      if (!quiet) say('', '');
      return true;
    } catch (error) {
      say(error?.message || 'That could not be done.', 'error');
      return false;
    }
  }

  /** Unmute is the only place a listener is told how to get on the mic, and
   * the only place somebody who may talk is asked for a microphone. */
  async function setMuted(muted, {quiet = false} = {}) {
    if (!session) return false;
    if (!muted) {
      if (state.you?.role === 'listener') { say('Raise your hand and the host can make you a speaker.', 'error'); return false; }
      try {
        await openMedia({video: state.room?.medium === 'video' && state.camera});
      } catch (error) {
        const blame = mediaBlame(error);
        say(blame.message, 'error');
        return false;
      }
    }
    const changed = await act({action: 'mute', muted}, {working: muted ? 'Muting…' : 'Turning your microphone on…', quiet});
    if (!changed) return false;
    if (localStream) for (const track of localStream.getAudioTracks()) track.enabled = !muted && state.you?.muted === false;
    if (quiet) return muted ? state.you?.muted !== false : state.you?.muted === false && Boolean(localTrack('audio')?.enabled);
    if (muted) say('Your microphone is off.', '');
    else if (state.you?.muted === false) say('You are on. Everybody in the room can hear you.', 'ok');
    return muted ? state.you?.muted !== false : state.you?.muted === false && Boolean(localTrack('audio')?.enabled);
  }

  /** Turn the camera on or off mid-broadcast without dropping the room. */
  async function setCamera(on) {
    state.camera = Boolean(on);
    if (!on) {
      setVideoEnabled(false);
      paint();
      return;
    }
    try {
      await openMedia({video: true});
    } catch (error) {
      state.camera = false;
      const blame = mediaBlame(error);
      say(blame.message, 'error');
      return;
    }
    setVideoEnabled(true);
    paint();
  }

  /** Front to back on a phone that has both. */
  async function flipCamera() {
    if (!localStream?.getVideoTracks?.().length && !state.camera) return;
    const previous = {facing: state.facing, deviceId: state.cameraId};
    const next = state.facing === 'user' ? 'environment' : 'user';
    say('Switching camera…');
    try {
      await replaceCamera({facing: next, deviceId: ''});
      say(`${state.facing === 'environment' ? 'Rear' : 'Front'} camera ready.`, 'ok');
    } catch (error) {
      try {
        await replaceCamera(previous);
        say('That camera was not available. Your previous camera is back on.', 'error');
      } catch {
        state.camera = false;
        const blame = mediaBlame(error);
        say(blame.message, 'error');
      }
    }
  }

  async function comment(body) {
    const text = String(body || '').trim();
    if (!text || !session || state.sending) return false;
    state.sending = true;
    paint();
    try {
      applyState(await post({action: 'say', key: session.key, body: text}));
      return true;
    } catch (error) {
      say(error?.message || 'That comment could not be sent.', 'error');
      return false;
    } finally {
      state.sending = false;
      paint();
    }
  }

  async function liveMona(mode = 'cues', messageId = 0) {
    if (!session || !(state.you?.is_host || mode === 'moderation' && state.you?.is_moderator)) return false;
    const status=byId(mode === 'cues' ? 'live-mona-status' : 'live-moderation-status');
    if(status)status.textContent=mode === 'cues'?'Mona is preparing private cues…':'Reviewing public comments…';
    try{
      const response=await fetchImpl('/api/live/mona',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({key:session.key,mode,context:mode==='cues'?(byId('live-mona-context')?.value||''):undefined,message_id:messageId||undefined})});
      const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'Mona could not finish.');
      if(mode==='cues'){
        const list=byId('live-mona-list');if(list){list.replaceChildren(...(data.cues||[]).map(text=>{const p=doc.createElement('p');p.textContent=text;return p;}));}
        if(status)status.textContent=data.fallback?'AI is unavailable, so these neutral prompts stay local.':'Private cues ready. Nothing was posted.';
      }else{
        const root=byId('live-moderation-flags');if(root){root.replaceChildren(...(data.flags||[]).map(flag=>{const p=doc.createElement('p');p.textContent=`Comment ${flag.message_id}: ${flag.reason} (${flag.confidence}). Suggested: ${flag.suggested_action}; confirm any action yourself.`;return p;}));}
        if(status)status.textContent=data.flags?.length?'Suggestions only. Review context before acting.':'No likely spam, scams, flooding, threats, or harassment found.';
      }
      return true;
    }catch(error){if(status)status.textContent=error.message;return false;}
  }

  /** Give the host one obvious way to bring people in. The link opens the
   * exact room; it never grants camera or microphone access. A guest still
   * presses Request to Join Live and the host still approves them. */
  async function inviteGuest() {
    if (!session || !state.room || !state.you?.is_host) return false;
    const url = new URL('/live.html', win.location.href);
    url.searchParams.set('room', session.key);
    if (state.room.medium === 'audio') url.searchParams.set('medium', 'audio');
    const nav = win.navigator || {};
    const share = {
      title: state.room.title || 'Join me on ROOSTER LIVE',
      text: state.room.medium === 'video' ? 'Join my ROOSTER LIVE broadcast.' : 'Join my ROOSTER audio room.',
      url: url.href,
    };
    if (typeof nav.share === 'function') {
      try {
        await nav.share(share);
        say('Invite ready.', 'ok');
        return true;
      } catch (error) {
        if (error?.name === 'AbortError') return false;
      }
    }
    if (typeof nav.clipboard?.writeText === 'function') {
      try {
        await nav.clipboard.writeText(url.href);
        say('Room link copied. Send it to your guest.', 'ok');
        return true;
      } catch { /* use the visible copy box below */ }
    }
    win.prompt?.('Copy this ROOSTER room link:', url.href);
    say('Send that room link to your guest.', 'ok');
    return true;
  }

  const api = {
    state: () => ({...state, speaking: new Set(state.speaking)}),
    joined: () => state.joined,
    roomKey: () => session?.key || '',
    phase: () => state.phase,
    loadRooms, create, join, leave, endLive, setMuted, setCamera, setLiveFilter, flipCamera, comment, inviteGuest, cancelStart, primeRoomAudio,
    raiseHand: (raised) => act({action: 'hand', raised}, {working: raised ? 'Raising your hand…' : 'Lowering your hand…'}),
    hostAction: (hostAction, memberId, messageId) => act(
      {
        action: 'host', host_action: hostAction,
        member_id: memberId || undefined,
        message_id: messageId || undefined,
      },
      {working: hostAction === 'end_room' ? 'Ending the broadcast…' : 'Working…'},
    ),
    /** Put a member back in the room after a page load they did not choose. */
    async resume() {
      const held = heldSession(storage);
      if (!held || rejoining) return false;
      rejoining = true;
      session = {key: held.key, session: held.session, title: held.title};
      const joined = await join(held.key, {announce: false});
      rejoining = false;
      if (joined) phase('connecting', 'Back in the room. Your camera and microphone are off.', '');
      return joined;
    },
  };

  /* ------------------------------------------------------------ the painting */

  function avatar(entry, className = 'live-face') {
    const wrap = doc.createElement('span');
    wrap.className = className;
    if (entry.photo_url) {
      const image = doc.createElement('img');
      image.src = entry.photo_url;
      image.alt = '';
      image.loading = 'lazy';
      wrap.appendChild(image);
    } else {
      wrap.textContent = (entry.name || '?').trim().charAt(0).toUpperCase();
    }
    return wrap;
  }

  function personCard(entry) {
    const item = doc.createElement('li');
    item.className = 'live-person';
    item.dataset.role = entry.role;
    if (state.speaking.has(entry.member_id)) item.dataset.speaking = 'true';
    if (entry.hand_raised) item.dataset.hand = 'true';
    item.appendChild(avatar(entry));

    const who = doc.createElement('span');
    who.className = 'live-person-who';
    const name = doc.createElement('a');
    name.className = 'live-person-name';
    // A name and a face open that member's profile, and nobody else's.
    name.href = `/profile.html?id=${encodeURIComponent(entry.member_id)}`;
    name.textContent = entry.is_you ? `${entry.name} (you)` : entry.name;
    who.appendChild(name);
    const role = doc.createElement('span');
    role.className = 'live-person-role';
    const videoRoom = state.room?.medium === 'video';
    role.textContent = entry.is_host
      ? 'Host'
      : entry.is_moderator
        ? 'Moderator'
      : entry.role === 'speaker'
        ? (videoRoom ? (entry.muted ? 'Guest · mic off' : 'Guest · live') : (entry.muted ? 'Speaker, muted' : 'Speaking'))
        : entry.hand_raised
          ? (videoRoom ? 'Wants to join live' : 'Hand raised')
          : (videoRoom ? 'Watching' : 'Listening');
    who.appendChild(role);
    item.appendChild(who);

    if ((state.you?.is_host || state.you?.is_moderator) && !entry.is_you) {
      const tools = doc.createElement('span');
      tools.className = 'live-person-tools';
      const control = (label, action, className) => {
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = className;
        button.textContent = label;
        button.addEventListener('click', () => {
          if(['assign_moderator','remove_moderator'].includes(action)&&!win.confirm?.(`${label} for this live room?`))return;
          void api.hostAction(action, entry.member_id);
        });
        tools.appendChild(button);
      };
      if (state.you?.is_host && entry.role === 'listener') {
        control(videoRoom ? (entry.hand_raised ? 'Approve Guest' : 'Invite On Camera') : 'Make Speaker', 'approve_speaker', 'live-ghost');
      }
      else if (state.you?.is_host) {
        if (!entry.muted) control('Mute', 'mute_speaker', 'live-ghost');
        control('Move to Listening', 'step_down_speaker', 'live-ghost');
      }
      if(state.you?.is_host){control(entry.is_moderator?'Remove moderator':'Make moderator',entry.is_moderator?'remove_moderator':'assign_moderator','live-ghost');}
      control('Remove', 'remove_member', 'live-danger');
      item.appendChild(tools);
    }
    return item;
  }

  function messageRow(entry) {
    const item = doc.createElement('li');
    item.className = 'live-comment';
    if (entry.is_you) item.dataset.you = 'true';
    item.appendChild(avatar(entry, 'live-face live-face-small'));
    const body = doc.createElement('span');
    body.className = 'live-comment-body';
    const who = doc.createElement('a');
    who.className = 'live-comment-who';
    who.href = `/profile.html?id=${encodeURIComponent(entry.member_id)}`;
    who.textContent = entry.name;
    body.appendChild(who);
    const text = doc.createElement('span');
    text.className = 'live-comment-text';
    text.textContent = entry.body;
    body.appendChild(text);
    item.appendChild(body);
    if (state.you?.is_host || state.you?.is_moderator) {
      const remove = doc.createElement('button');
      remove.type = 'button';
      remove.className = 'live-comment-remove';
      remove.title = 'Remove this comment';
      remove.setAttribute('aria-label', `Remove the comment from ${entry.name}`);
      remove.textContent = '×';
      remove.addEventListener('click', () => void api.hostAction('remove_message', '', entry.id));
      item.appendChild(remove);
    }
    if(state.you?.is_host){const cue=doc.createElement('button');cue.type='button';cue.className='live-comment-cue';cue.textContent='Cue';cue.setAttribute('aria-label',`Ask Mona for a private reply cue to ${entry.name}`);cue.addEventListener('click',()=>void liveMona('cues',entry.id));item.appendChild(cue);}
    return item;
  }

  function setToggle(id, {on, label, hidden = false}) {
    const node = byId(id);
    if (!node) return;
    node.hidden = hidden;
    node.setAttribute('aria-pressed', String(Boolean(on)));
    node.dataset.on = on ? 'true' : 'false';
    node.setAttribute('aria-label', label);
    const text = node.querySelector('.live-toggle-text');
    if (text) text.textContent = label;
    else node.textContent = label;
  }

  function paintPhase() {
    const node = byId('live-phase');
    if (!node) return;
    node.dataset.phase = state.phase;
    node.textContent = LIVE_PHASES[state.phase] || LIVE_PHASES.ready;
  }

  function paintFilters() {
    for (const control of doc.querySelectorAll('[data-live-filter]')) {
      const selected = control.dataset.liveFilter === state.liveFilter;
      control.setAttribute('aria-pressed', String(selected));
      control.dataset.on = selected ? 'true' : 'false';
    }
    const setupPanel = byId('live-filter-panel');
    if (setupPanel) setupPanel.hidden = state.audioOnly;
    const roomPanel = byId('live-room-filter-panel');
    if (roomPanel) roomPanel.hidden = !state.joined || state.room?.medium !== 'video' || state.you?.role === 'listener';
    const selectedName = LIVE_FILTERS.find(filter => filter.id === state.liveFilter)?.name || 'Original';
    for (const label of doc.querySelectorAll('[data-live-filter-label]')) label.textContent = selectedName;
  }

  function paintSetup() {
    const setup = byId('live-setup');
    if (!setup) return;
    setup.hidden = state.joined;
    const frame = byId('live-preview-frame');
    const preview = byId('live-preview');
    const hasCamera = Boolean(localTrack('video')) && state.camera;
    if (frame) {
      frame.dataset.camera = hasCamera ? 'on' : 'off';
      frame.dataset.facing = state.facing;
      frame.dataset.filter = state.liveFilter;
    }
    if (preview) {
      if (hasCamera && preview.srcObject !== localStream) {
        preview.srcObject = localStream;
        preview.muted = true;
        preview.dataset.rosterLive = 'stream';
        const played = preview.play?.();
        if (played?.catch) played.catch(() => {});
      }
      if (!hasCamera && preview.srcObject) preview.srcObject = null;
    }
    /* An audio room is not a camera broadcast, so the setup for one says so:
       no camera stage, no camera controls, and copy about the microphone. The
       mode comes from the ?medium=audio URL and from the audio-only checkbox,
       and both of them land here. */
    setup.dataset.mode = state.audioOnly ? 'audio' : 'video';
    const note = byId('live-preview-note');
    if (note) note.hidden = hasCamera;
    const noteText = note?.querySelector('p');
    if (noteText) {
      noteText.textContent = state.audioOnly
        ? 'Your microphone is off. ROOSTER asks for it only when the room opens, and nothing goes out until you press Open Audio Room.'
        : 'Your camera is off. ROOSTER asks for the camera and microphone only when you turn them on, and nothing goes out until you press Go Live.';
    }
    const tag = byId('live-preview-tag');
    if (tag) tag.hidden = !hasCamera;

    setToggle('live-camera-toggle', {on: hasCamera, label: hasCamera ? 'Camera on' : 'Camera off', hidden: state.audioOnly});
    setToggle('live-mic-toggle', {on: state.mic, label: state.mic ? 'Microphone on' : 'Microphone off'});
    setToggle('live-camera-flip', {on: false, label: 'Switch camera', hidden: state.audioOnly || !hasCamera});

    const audioOnly = byId('live-audio-only');
    if (audioOnly && audioOnly.checked !== state.audioOnly) audioOnly.checked = state.audioOnly;

    const go = byId('live-go');
    if (go) {
      go.disabled = state.busy || starting;
      go.textContent = starting
        ? (state.phase === 'permission' ? 'Waiting for permission…' : 'Connecting…')
        : state.audioOnly ? 'Open Audio Room' : 'Go Live';
    }
    const cancel = byId('live-cancel');
    if (cancel) cancel.hidden = !starting;
    const retry = byId('live-retry');
    if (retry) retry.hidden = starting || !['denied', 'failed'].includes(state.phase);

    fillDevices('live-camera-pick', state.cameras, state.cameraId, 'Default camera');
    fillDevices('live-mic-pick', state.mics, state.micId, 'Default microphone');
  }

  function fillDevices(id, devices, chosen, fallback) {
    const select = byId(id);
    if (!select) return;
    const signature = `${devices.map(device => device.deviceId).join('|')}::${chosen}`;
    if (select.dataset.signature === signature) return;
    select.dataset.signature = signature;
    const options = [{deviceId: '', label: fallback}, ...devices.map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label || `${fallback.replace('Default ', '')} ${index + 1}`,
    }))];
    select.replaceChildren(...options.map(option => {
      const node = doc.createElement('option');
      node.value = option.deviceId;
      node.textContent = option.label;
      node.selected = option.deviceId === chosen;
      return node;
    }));
  }

  function paintStage() {
    const surface = byId('roster-live-room');
    if (!surface) return;
    surface.hidden = !state.joined;
    if (!state.joined || !state.room) return;
    const video = state.room.medium === 'video';
    const stage = byId('live-stage');
    if (stage) {
      stage.dataset.medium = state.room.medium;
      stage.dataset.phase = state.phase;
    }
    byId('live-room-title').textContent = state.room.title;
    const host = byId('live-room-host');
    if (host) host.textContent = state.you?.is_host ? 'You are hosting' : state.room.host_name;
    const face = byId('live-room-face');
    if (face) {
      const signature = state.room.host_photo_url || state.room.host_name || '';
      if (face.dataset.signature !== signature) {
        face.dataset.signature = signature;
        face.replaceChildren(...avatar({photo_url: state.room.host_photo_url, name: state.room.host_name}).childNodes);
        if (!state.room.host_photo_url) face.textContent = (state.room.host_name || '?').trim().charAt(0).toUpperCase();
      }
    }
    const counts = byId('live-room-counts');
    if (counts) {
      counts.textContent = video
        ? `${state.room.participant_count} watching`
        : state.room.participant_count === 1
          ? '1 in the room'
          : `${state.room.participant_count} in the room · ${state.room.speaker_count} on the mic`;
    }
    const tag = byId('live-live-tag');
    if (tag) tag.dataset.on = state.phase === 'live' ? 'true' : 'false';

    // The host's own picture, so they can see their framing while they host.
    const holder = stageMedia();
    const hostVideo = video && state.you?.role !== 'listener' && Boolean(localTrack('video')) && state.camera;
    if (hostVideo) {
      if (!selfView) {
        selfView = doc.createElement('video');
        selfView.id = 'live-self';
        selfView.className = 'live-stage-video live-self';
        selfView.autoplay = true;
        selfView.muted = true;
        selfView.setAttribute('playsinline', '');
        selfView.dataset.rosterLive = 'stream';
      }
      selfView.dataset.facing = state.facing;
      selfView.dataset.filter = state.liveFilter;
      if (selfView.parentNode !== holder) holder.appendChild(selfView);
      if (selfView.srcObject !== localStream) selfView.srcObject = localStream;
      const played = selfView.play?.();
      if (played?.catch) played.catch(() => {});
    } else if (selfView) {
      try { selfView.srcObject = null; selfView.remove(); } catch { /* gone */ }
      selfView = null;
    }

    const waiting = byId('live-stage-wait');
    if (waiting) {
      const pictures = holder.querySelectorAll('video').length;
      let message = '';
      if (state.tapToPlay) message = 'Tap to Hear Audio below.';
      else if (state.phase === 'reconnecting') message = 'Reconnecting…';
      else if (state.phase === 'connecting' && !pictures) message = video ? 'Connecting to the host…' : 'Connecting…';
      else if (video && !pictures) message = state.you?.is_host ? 'Your camera is off.' : 'Waiting for the host to turn the camera on.';
      else if (!video) message = 'This is an audio room. Who is here is below.';
      waiting.textContent = message;
      waiting.hidden = !message;
    }
    const audioStart = byId('live-audio-start');
    if (audioStart) {
      audioStart.hidden = !(state.tapToPlay || (!video && !audioOutputActivated));
      audioStart.textContent = state.tapToPlay ? 'Tap to Hear Audio' : video ? 'Start Room Sound' : 'Turn On Room Audio';
    }
    const audioState = byId('live-audio-state');
    if (audioState) {
      audioState.hidden = video || !audioOutputActivated;
      audioState.textContent = 'Speaker on · room audio ready';
    }

    const listener = state.you?.role === 'listener';
    const hand = byId('live-hand');
    if (hand) {
      hand.hidden = !listener;
      hand.textContent = state.you?.hand_raised
        ? (video ? 'Cancel Join Request' : 'Lower My Hand')
        : (video ? 'Request to Join Live' : 'Raise Hand');
      hand.setAttribute('aria-pressed', String(Boolean(state.you?.hand_raised)));
    }
    const invite = byId('live-invite');
    if (invite) {
      invite.hidden = !state.you?.is_host;
      invite.textContent = video ? 'Invite Guest' : 'Invite Listener';
    }
    const mute = byId('live-mute');
    if (mute) {
      mute.hidden = listener;
      mute.textContent = state.you?.muted === false ? 'Mute' : 'Unmute';
      mute.className = state.you?.muted === false ? 'live-primary live-live-on' : 'live-primary';
    }
    setToggle('live-cam', {
      on: state.camera, hidden: !video || listener,
      label: state.camera ? 'Camera on' : 'Camera off',
    });
    setToggle('live-flip', {
      on: false, hidden: !video || listener || !hostVideo,
      label: 'Switch camera',
    });
    const end = byId('live-end');
    if (end) {
      end.hidden = !state.you?.is_host;
      end.textContent = state.ending ? 'Ending…' : video ? 'End live' : 'End room';
      end.disabled = state.ending;
    }
    const commentsControl=byId('live-comments-control');if(commentsControl){commentsControl.hidden=!state.you?.is_host;commentsControl.textContent=state.room.comments_enabled===false?'Resume comments':'Pause comments';}
    const monaToggle=byId('live-mona-toggle');if(monaToggle)monaToggle.hidden=!state.you?.is_host;
    const note = byId('live-mic-note');
    if (note) {
      note.textContent = listener
        ? video
          ? state.you?.hand_raised
            ? 'Request sent. The host must approve you before ROOSTER asks for your camera or microphone.'
            : 'You are watching. Press Request to Join Live if you want to be on camera with the host.'
          : 'You are listening. ROOSTER has not asked for your microphone and will not until you are a speaker and press Unmute.'
        : state.you?.muted === false
          ? (video && !state.camera ? 'Your microphone is on. Press the camera button when you are ready to be seen.' : 'Your microphone is on.')
          : video && !state.you?.is_host
            ? 'The host approved you. Press Unmute, then press the camera button when you are ready to join.'
            : 'You can speak. Press Unmute when you are ready and your browser will ask for your microphone.';
    }
    const confirm = byId('live-confirm');
    if (confirm) confirm.hidden = !state.confirming;
    const confirmNote = byId('live-confirm-note');
    if (confirmNote && state.confirming) {
      confirmNote.textContent = video
        ? 'You are hosting. Leaving ends this broadcast for everybody watching and releases your camera and microphone.'
        : 'You are hosting. Leaving ends this room for everybody in it and releases your microphone.';
    }
    const confirmEnd=byId('live-confirm-end');if(confirmEnd){confirmEnd.disabled=state.ending;confirmEnd.textContent=state.ending?'Ending…':state.endFailed?'Retry close room':video?'End live for everyone':'End room for everyone';}
    const leaveScreen=byId('live-confirm-leave-screen');if(leaveScreen)leaveScreen.hidden=!state.endFailed;
    const ended=byId('live-ended');if(ended)ended.hidden=state.phase!=='ended';
    const cues=byId('live-mona-cues');if(cues){const displayTrack=(localStream?.getVideoTracks?.()||[]).some(track=>Boolean(track.getSettings?.().displaySurface));let hidden=false;try{hidden=localStorage.getItem('roster-live-mona-cues-hidden')==='1';}catch{}cues.hidden=!state.you?.is_host||hidden||displayTrack;}
    const moderation=byId('live-moderation');if(moderation)moderation.hidden=!(state.you?.is_host||state.you?.is_moderator);
  }

  function paintPanels() {
    const chat = byId('live-panel-chat');
    const people = byId('live-panel-people');
    if (chat) chat.hidden = state.tab !== 'chat';
    if (people) people.hidden = state.tab !== 'people';
    for (const tab of doc.querySelectorAll('[data-live-tab]')) {
      const selected = tab.dataset.liveTab === state.tab;
      tab.setAttribute('aria-selected', String(selected));
      tab.dataset.on = selected ? 'true' : 'false';
    }
    const list = byId('live-room-people');
    if (list) list.replaceChildren(...state.participants.map(personCard));
    const comments = byId('live-chat');
    if (comments) {
      const signature = `${state.messages.map(entry => entry.id).join(',')}::${state.you?.is_host ? 'host' : 'member'}`;
      if (comments.dataset.signature !== signature) {
        const atBottom = comments.scrollHeight - comments.scrollTop - comments.clientHeight < 40;
        comments.dataset.signature = signature;
        comments.replaceChildren(...state.messages.map(messageRow));
        if (atBottom) comments.scrollTop = comments.scrollHeight;
      }
    }
    const empty = byId('live-chat-empty');
    if (empty) empty.hidden = state.messages.length > 0;
    const send = byId('live-chat-send');
    if (send) send.disabled = state.sending;
    const overlay=byId('live-comment-overlay');if(overlay)overlay.hidden=state.room?.medium!=='video';
    const overlayList=byId('live-overlay-chat');if(overlayList){overlayList.hidden=!state.commentsVisible;overlayList.replaceChildren(...state.messages.slice(-8).map(messageRow));}
    const overlayForm=byId('live-overlay-form');if(overlayForm)overlayForm.hidden=!state.commentsVisible||state.room?.comments_enabled===false;
    const toggle=byId('live-comments-toggle');if(toggle){toggle.textContent=state.commentsVisible?'Hide comments':'Show comments';toggle.setAttribute('aria-pressed',String(state.commentsVisible));}
    const audit=byId('live-moderation-audit');if(audit){audit.replaceChildren(...state.moderationQueue.map(entry=>{const li=doc.createElement('li');li.textContent=`${entry.action.replaceAll('_',' ')} · ${new Date(entry.created_at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})} · room only`;if(entry.action==='remove_message'&&entry.message_id){const undo=doc.createElement('button');undo.type='button';undo.textContent='Undo';undo.addEventListener('click',()=>void api.hostAction('restore_message','',entry.message_id));li.appendChild(undo);}return li;}));}
  }

  function paintList() {
    const list = byId('live-rooms');
    if (!list) return;
    // The directory shows what this visit asked for. Nothing is hidden from
    // the other half of it: the two links sit at the top of the page.
    const rooms = wantedMedium ? state.rooms.filter((room) => room.medium === wantedMedium) : state.rooms;
    const empty = byId('live-rooms-empty');
    if (empty) empty.hidden = state.listing || rooms.length > 0;
    const heading = byId('live-rooms-title');
    if (heading) heading.textContent = wantedMedium === 'audio' ? 'Rooms on right now' : wantedMedium === 'video' ? 'Live on camera right now' : 'On right now';
    const other = byId('live-rooms-other');
    if (other) {
      const elsewhere = wantedMedium ? state.rooms.filter((room) => room.medium !== wantedMedium).length : 0;
      other.hidden = elsewhere === 0;
      other.href = wantedMedium === 'audio' ? '/live.html' : '/live.html?medium=audio';
      other.textContent = wantedMedium === 'audio'
        ? `${elsewhere} live on camera right now \u2014 open ROOSTER LIVE`
        : `${elsewhere} audio ${elsewhere === 1 ? 'room' : 'rooms'} open right now \u2014 open Rooms`;
    }
    const emptyLine = byId('live-rooms-empty');
    if (emptyLine) emptyLine.textContent = wantedMedium === 'audio'
      ? 'No audio room is open right now. Open one above and the roster can come in.'
      : wantedMedium === 'video'
        ? 'Nobody is live on camera right now. Go Live above and the roster can watch.'
        : 'Nothing is on right now. Open a room above and the roster can come in.';
    list.replaceChildren(...rooms.map((room) => {
      const item = doc.createElement('li');
      item.className = 'live-room-card';
      item.dataset.medium = room.medium;
      item.appendChild(avatar({photo_url: room.host_photo_url, name: room.host_name}));
      const body = doc.createElement('div');
      body.className = 'live-room-body';
      const title = doc.createElement('h3');
      title.className = 'live-room-title';
      title.textContent = room.title;
      body.appendChild(title);
      const who = doc.createElement('p');
      who.className = 'live-room-who';
      who.textContent = room.medium === 'video'
        ? `${room.host_name} · ${room.participant_count} watching`
        : `${room.host_name} · ${room.participant_count} in the room · ${room.speaker_count} on the mic`;
      body.appendChild(who);
      if (room.description) {
        const about = doc.createElement('p');
        about.className = 'live-room-about';
        about.textContent = room.description;
        body.appendChild(about);
      }
      item.appendChild(body);
      const kind = doc.createElement('span');
      kind.className = 'live-room-kind';
      kind.textContent = room.medium === 'video' ? 'VIDEO' : 'AUDIO';
      item.appendChild(kind);
      const enter = doc.createElement('button');
      enter.type = 'button';
      enter.className = 'live-primary';
      const here = state.joined && session?.key === room.key;
      enter.textContent = here ? 'You are in this room' : room.medium === 'video' ? 'Watch' : 'Join & Listen';
      enter.disabled = state.busy || here;
      enter.addEventListener('click', () => { primeRoomAudio(); void join(room.key); });
      item.appendChild(enter);
      return item;
    }));
  }

  function paintBar() {
    const bar = byId('roster-live-bar');
    if (!bar) return;
    bar.hidden = !state.joined;
    doc.body.dataset.liveJoined = state.joined ? 'true' : 'false';
    if (!state.joined) doc.body.dataset.liveAudioNeeded = 'false';
    if (!state.joined || !state.room) return;
    byId('live-bar-title').textContent = state.room.title;
    byId('live-bar-count').textContent = String(state.room.participant_count);
    const talking = state.participants.filter(entry => state.speaking.has(entry.member_id));
    byId('live-bar-speaking').textContent = talking.length ? `${talking[0].name} is talking` : 'Nobody is talking';
    const mute = byId('live-bar-mute');
    mute.hidden = state.you?.role === 'listener';
    mute.textContent = state.you?.muted === false ? 'Mute' : 'Unmute';
    mute.dataset.live = state.you?.muted === false ? 'true' : 'false';
    const audio = byId('live-bar-audio');
    if (audio) {
      const needed = state.tapToPlay || (state.room.medium === 'audio' && !audioOutputActivated);
      audio.hidden = !needed;
      audio.dataset.needed = needed ? 'true' : 'false';
      audio.textContent = state.tapToPlay ? 'Tap to Hear Audio' : 'Turn On Audio';
      doc.body.dataset.liveAudioNeeded = needed ? 'true' : 'false';
    }
  }

  function paint() {
    const note = byId('live-status');
    if (note) { note.textContent = state.status; note.dataset.tone = state.tone; }
    const barNote = byId('live-bar-status');
    if (barNote) { barNote.textContent = state.tone === 'error' ? state.status : ''; barNote.hidden = state.tone !== 'error'; }
    paintPhase();
    paintFilters();
    paintBar();
    paintSetup();
    paintStage();
    paintPanels();
    paintList();
    onChange(api.state());
  }

  /* ------------------------------------------------------------- the wiring

     A page swap brings in new buttons while the bar's buttons stay exactly
     where they were, so each node is marked once and never wired twice. */

  function on(id, type, handler) {
    const node = byId(id);
    if (!node || node.dataset.liveWired === 'true') return;
    node.dataset.liveWired = 'true';
    node.addEventListener(type, handler);
  }

  /** The bar lives on every ROOSTER page so a room survives a look at a
   * profile or a reply to a message. It is built here rather than repeated in
   * every page's markup, and it stays out of the way until a room is on. */
  function ensureBar() {
    if (byId('roster-live-bar') || !doc.body) return;
    const bar = doc.createElement('div');
    bar.id = 'roster-live-bar';
    bar.hidden = true;
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'ROOSTER LIVE room');
    bar.innerHTML = [
      '<span class="live-bar-who">',
      '<span class="live-bar-live">LIVE</span>',
      '<strong id="live-bar-title"></strong>',
      '<span class="live-bar-meta"><span id="live-bar-count">0</span> in the room · <span id="live-bar-speaking"></span></span>',
      '</span>',
      '<button type="button" id="live-bar-audio" data-needed="false" hidden>Turn On Audio</button>',
      '<button type="button" id="live-bar-mute" data-live="false">Unmute</button>',
      '<button type="button" id="live-bar-leave">Leave</button>',
      '<p id="live-bar-status" hidden></p>',
    ].join('');
    doc.body.appendChild(bar);
  }

  /** A host walking out takes the broadcast with them, so they are told what
   * leaving does and asked once before it happens. */
  function askToLeave() {
    if (state.you?.is_host && state.joined) { state.confirming = true; paint(); return; }
    void leave();
  }

  /** Point the buttons on whatever page is showing at this one live room. */
  function wire() {
    ensureBar();
    // The two halves of ROOSTER LIVE, and the Review Room beside them. The
    // links are real URLs, so they are shareable and the back button works.
    for (const link of doc.querySelectorAll('[data-live-mode]')) {
      const mine = link.dataset.liveMode === (wantedMedium || 'video');
      if (mine) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    const setupTitle = byId('live-setup-title');
    if (setupTitle && wantedMedium === 'audio') setupTitle.textContent = 'Open an audio room';
    // The field is named for the thing being opened, not for streaming.
    const titleLabel = byId('live-title-label');
    if (titleLabel && wantedMedium === 'audio') titleLabel.textContent = 'Room title';
    // The directory's own start button names the thing this half of LIVE opens.
    const roomsGo = byId('live-rooms-go');
    if (roomsGo && wantedMedium === 'audio') roomsGo.textContent = 'Open a Room';
    on('live-create-form', 'submit', (event) => {
      event.preventDefault();
      primeRoomAudio();
      const form = event.currentTarget;
      void create(form.elements.title?.value || '', {
        description: form.elements.description?.value || '',
        medium: state.audioOnly ? 'audio' : 'video',
      });
    });
    on('live-preview-start', 'click', () => void setCamera(true));
    on('live-camera-toggle', 'click', () => void setCamera(!(localTrack('video') && state.camera)));
    on('live-mic-toggle', 'click', () => { state.mic = !state.mic; paint(); });
    on('live-camera-flip', 'click', () => void flipCamera());
    // Build both swipe rows from the closed, original ROOSTER look list so the
    // preview setup and the in-room controls can never drift apart.
    for (const strip of doc.querySelectorAll('.live-filter-strip')) {
      strip.replaceChildren(...LIVE_FILTERS.map(filter => {
        const control=doc.createElement('button');control.type='button';control.className='live-filter';control.dataset.liveFilter=filter.id;control.setAttribute('aria-pressed',String(filter.id===state.liveFilter));
        const swatch=doc.createElement('span');swatch.className='live-filter-swatch';swatch.setAttribute('aria-hidden','true');swatch.style.filter=filter.css;
        const label=doc.createElement('span');label.textContent=filter.name;control.append(swatch,label);return control;
      }));
    }
    for (const control of doc.querySelectorAll('[data-live-filter]')) {
      if (control.dataset.liveFilterWired === 'true') continue;
      control.dataset.liveFilterWired = 'true';
      control.addEventListener('click', () => void setLiveFilter(control.dataset.liveFilter));
    }
    on('live-audio-only', 'change', (event) => {
      state.audioOnly = Boolean(event.currentTarget.checked);
      if (state.audioOnly && localStream) closeMedia();
      paint();
    });
    on('live-camera-pick', 'change', (event) => {
      const deviceId = event.currentTarget.value || '';
      if (state.camera) {
        const previous = {facing: state.facing, deviceId: state.cameraId};
        void replaceCamera({facing: state.facing, deviceId}).catch(async error => {
          try {
            await replaceCamera(previous);
            say('That camera was not available. Your previous camera is back on.', 'error');
          } catch { say(mediaBlame(error).message, 'error'); }
        });
      }
      else state.cameraId = deviceId;
    });
    on('live-mic-pick', 'change', (event) => {
      state.micId = event.currentTarget.value || '';
      if (localStream) void openMedia({video: Boolean(localTrack('video')), force: true});
    });
    on('live-cancel', 'click', () => cancelStart());
    on('live-retry', 'click', () => {
      const form = byId('live-create-form');
      phase('ready', '', '');
      if (form?.requestSubmit) form.requestSubmit();
      else void create(byId('live-create-title')?.value || '');
    });
    on('live-refresh', 'click', () => void loadRooms());
    on('live-hand', 'click', () => void api.raiseHand(!state.you?.hand_raised));
    on('live-invite', 'click', () => void inviteGuest());
    on('live-comments-control','click',()=>void api.hostAction(state.room?.comments_enabled===false?'comments_on':'comments_off',''));
    on('live-mona-toggle','click',()=>{try{localStorage.removeItem('roster-live-mona-cues-hidden');}catch{}paint();byId('live-mona-cues')?.scrollIntoView?.({block:'nearest'});});
    on('live-mute', 'click', () => void setMuted(state.you?.muted === false));
    on('live-audio-start', 'click', () => void startRoomAudio());
    on('live-cam', 'click', () => void setCamera(!state.camera));
    on('live-flip', 'click', () => void flipCamera());
    on('live-leave', 'click', () => askToLeave());
    on('live-end', 'click', () => { state.confirming = true; paint(); });
    on('live-confirm-end', 'click', () => void endLive());
    on('live-confirm-stay', 'click', () => { state.confirming = false; paint(); });
    on('live-confirm-leave-screen','click',()=>{closeMedia();stopPolling();dropEveryPeer();win.location.href='/#home';});
    on('live-chat-form', 'submit', (event) => {
      event.preventDefault();
      const input = byId('live-chat-input');
      const text = input?.value || '';
      void comment(text).then((sent) => { if (sent && input) input.value = ''; });
    });
    on('live-overlay-form','submit',event=>{event.preventDefault();const input=byId('live-overlay-input'),text=input?.value||'';void comment(text).then(sent=>{if(sent&&input){input.value='';byId('live-overlay-status').textContent='Sent.';}else if(input)byId('live-overlay-status').textContent='Not sent. Your comment is still here; try again.';});});
    on('live-comments-toggle','click',()=>{state.commentsVisible=!state.commentsVisible;paint();});
    on('live-mona-refresh','click',()=>void liveMona('cues'));
    on('live-mona-hide','click',()=>{try{localStorage.setItem('roster-live-mona-cues-hidden','1');}catch{}paint();});
    on('live-moderation-refresh','click',()=>void liveMona('moderation'));
    on('live-bar-mute', 'click', () => void setMuted(state.you?.muted === false));
    on('live-bar-audio', 'click', () => void startRoomAudio());
    on('live-bar-leave', 'click', () => askToLeave());
    for (const tab of doc.querySelectorAll('[data-live-tab]')) {
      if (tab.dataset.liveWired === 'true') continue;
      tab.dataset.liveWired = 'true';
      tab.addEventListener('click', () => { state.tab = tab.dataset.liveTab; paint(); });
    }
  }

  // A member who closes the tab has left, so tell the room rather than making
  // everybody wait for the heartbeat to time out. The camera and microphone
  // are released on the way out too.
  win.addEventListener('pagehide', () => {
    if (!session) return;
    try {
      const payload=state.you?.is_host?{action:'host',key:session.key,host_action:'end_room'}:{action:'leave',key:session.key,session:session.session};
      navigator.sendBeacon?.('/api/live/room', new Blob([JSON.stringify(payload)], {type: 'application/json'}));
    } catch { /* the heartbeat will notice soon enough */ }
    closeMedia();
  });

  wire();
  api.wire = wire;
  api.paint = paint;
  api.readMeters = readMeters;
  return api;
}

/* ---------------------------------------------------------------------------
   Moving around ROOSTER without dropping the room.

   While a member is in a room, a click on a ROOSTER link fetches that page and
   swaps it in place, so the media underneath is untouched. Anything this
   cannot handle falls through to an ordinary page load, and the tab's held
   room key puts the member straight back in on the other side.
--------------------------------------------------------------------------- */

export function createLiveNavigation({doc = document, win = window, fetchImpl = (...args) => fetch(...args), isLive = () => false} = {}) {
  let swaps = 0;

  const sameSite = (url) => url.origin === win.location.origin && /\.html$|\/$/.test(url.pathname);

  function keepers() {
    // The bar, the media elements and this script itself have to survive.
    return [doc.getElementById('roster-live-bar'), doc.getElementById('roster-live-audio')].filter(Boolean);
  }

  function rerun(script, index) {
    const fresh = doc.createElement('script');
    for (const {name, value} of [...script.attributes]) fresh.setAttribute(name, value);
    if (script.src) {
      // A module the browser already ran will not run again for a new page
      // unless its address changes, and these pages set themselves up on the
      // way in, so each swap asks for a fresh copy.
      const url = new URL(script.src, win.location.href);
      url.searchParams.set('live', String(index));
      fresh.src = url.pathname + url.search + url.hash;
    } else fresh.textContent = script.textContent;
    return fresh;
  }

  async function swap(href, {push = true} = {}) {
    const url = new URL(href, win.location.href);
    const response = await fetchImpl(url.href, {credentials: 'same-origin', headers: {Accept: 'text/html'}});
    if (!response.ok) throw new Error('That page could not be opened.');
    const next = new DOMParser().parseFromString(await response.text(), 'text/html');
    swaps += 1;

    // Bring in any stylesheet the new page needs; leaving the old ones is
    // harmless and avoids a flash of unstyled ROOSTER.
    const have = new Set([...doc.head.querySelectorAll('link[rel="stylesheet"]')].map(link => new URL(link.href, win.location.href).pathname));
    for (const link of next.head.querySelectorAll('link[rel="stylesheet"]')) {
      if (!have.has(new URL(link.getAttribute('href'), url).pathname)) doc.head.appendChild(doc.importNode(link, true));
    }
    doc.title = next.title;

    const survivors = keepers();
    for (const node of survivors) node.remove();
    const scripts = [...next.head.querySelectorAll('script'), ...next.body.querySelectorAll('script')];
    for (const script of scripts) script.remove();
    doc.body.replaceChildren(...[...next.body.childNodes].map(node => doc.importNode(node, true)));
    for (const node of survivors) doc.body.appendChild(node);
    if (push) win.history.pushState({rosterLive: true}, '', url.href);
    else win.history.replaceState({rosterLive: true}, '', url.href);
    win.scrollTo?.(0, 0);
    for (const script of scripts) doc.body.appendChild(rerun(script, swaps));
    doc.dispatchEvent(new Event('DOMContentLoaded', {bubbles: true}));
    win.dispatchEvent(new Event('load'));
  }

  doc.addEventListener('click', (event) => {
    if (!isLive() || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target?.closest?.('a[href]');
    if (!link || link.target === '_blank' || link.hasAttribute('download') || link.dataset.liveHardNav === 'true') return;
    let url;
    try { url = new URL(link.getAttribute('href'), win.location.href); } catch { return; }
    if (!sameSite(url)) return;
    if (url.pathname === win.location.pathname && url.hash) return; // an anchor on this page is not a page change
    event.preventDefault();
    swap(url.href).catch(() => { win.location.href = url.href; });
  }, true);

  win.addEventListener('popstate', () => {
    if (!isLive()) return;
    swap(win.location.href, {push: false}).catch(() => win.location.reload());
  });

  return {swap};
}

/* ------------------------------------------------------------------- boot */

if (typeof document !== 'undefined' && document.body) {
  if (document.body.dataset.liveBooted === 'true' && window.RosterLive) {
    // A page swap: the room is already running, so this new page's buttons
    // just need pointing at it.
    window.RosterLive.wire();
    window.RosterLive.paint();
    if (!window.RosterLive.joined() && document.getElementById('live-rooms')) void window.RosterLive.loadRooms();
  } else {
    document.body.dataset.liveBooted = 'true';
    const live = createRosterLive();
    createLiveNavigation({isLive: () => live.joined()});
    const invitedRoom = (() => {
      try { return new URLSearchParams(window.location.search).get('room') || ''; }
      catch { return ''; }
    })();
    // A member who was in a room a moment ago goes straight back in;
    // an invited member goes straight to the shared room; everybody else
    // gets the directory, and only if this page shows one.
    void live.resume().then((back) => {
      if (back) return;
      if (invitedRoom) { void live.join(invitedRoom); return; }
      if (document.getElementById('live-rooms')) void live.loadRooms();
    });
    window.RosterLive = live;
  }
}
