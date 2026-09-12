/* A host and a viewer, both offline, both real ROOSTER LIVE clients.
 *
 * This is the test that would have caught the broadcast defect. The old
 * client opened a camera, metered it, previewed it and put the track on a
 * sender belonging to a receive-only transceiver — so a host saw themselves
 * and nobody ever received a frame. Here two clients are driven against a
 * stand-in server and a stand-in browser, and the assertions are about what
 * the second account actually receives.
 *
 * Nothing here reaches a network, a database, a camera or a provider. */
import assert from 'node:assert/strict';
import test from 'node:test';

import {createRosterLive} from '../roster-live.js';

/* --------------------------------------------------------- a stand-in browser */

class FakeTrack {
  constructor(kind, id) { this.kind = kind; this.id = id; this.enabled = true; this.readyState = 'live'; }
  stop() { this.readyState = 'ended'; }
}

let streamCount = 0;
class FakeStream {
  constructor(tracks) { this.id = `stream-${streamCount += 1}`; this.tracks = tracks; this.listeners = {}; }
  getTracks() { return [...this.tracks]; }
  getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio'); }
  getVideoTracks() { return this.tracks.filter(track => track.kind === 'video'); }
  addEventListener(name, handler) { (this.listeners[name] ??= []).push(handler); }
  add(track) { this.tracks.push(track); for (const handler of this.listeners.addtrack ?? []) handler({track}); }
}

class FakeElement {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.attrs = {};
    this.listeners = {};
    this.className = '';
    this.textContent = '';
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.srcObject = null;
    this.muted = false;
    this.autoplay = false;
    this.scrollTop = 0;
    this.scrollHeight = 0;
    this.clientHeight = 0;
    this.playCalls = 0;
    this.playPlan = [];
    this.elements = {};
  }
  /* A span carrying only text still has one child node to move, the way a
     text node does in a browser. */
  get childNodes() {
    if (this.children.length) return [...this.children];
    if (!this.textContent) return [];
    const text = new FakeElement('#text');
    text.textContent = this.textContent;
    return [text];
  }
  appendChild(node) { if (node.parentNode) node.parentNode.remove_(node); node.parentNode = this; this.children.push(node); return node; }
  remove_(node) { this.children = this.children.filter(child => child !== node); }
  remove() { this.parentNode?.remove_(this); this.parentNode = null; }
  replaceChildren(...nodes) { this.children = nodes; for (const node of nodes) node.parentNode = this; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return this.attrs[name] ?? null; }
  addEventListener(name, handler) { (this.listeners[name] ??= []).push(handler); }
  removeEventListener(name, handler) { this.listeners[name] = (this.listeners[name] ?? []).filter(entry => entry !== handler); }
  fire(name, event = {}) { for (const handler of [...(this.listeners[name] ?? [])]) handler({currentTarget: this, target: this, preventDefault() {}, ...event}); }
  descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
  querySelectorAll(selector) {
    const nodes = this.descendants();
    if (selector.startsWith('[')) {
      const name = selector.slice(1, -1).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      return nodes.filter(node => node.dataset[name.replace(/^data/, '').replace(/^./, letter => letter.toLowerCase())] !== undefined);
    }
    return nodes.filter(node => node.tagName === selector.toUpperCase());
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  play() {
    this.playCalls += 1;
    return this.playPlan.shift() === 'reject'
      ? Promise.reject(Object.assign(new Error('autoplay blocked'), {name: 'NotAllowedError'}))
      : Promise.resolve();
  }
}

function fakeBrowser({playPlan = []} = {}) {
  const byId = new Map();
  const body = new FakeElement('body');
  const doc = {
    body,
    getElementById(id) {
      if (!byId.has(id)) {
        const node = new FakeElement('div');
        node.id = id;
        byId.set(id, node);
      }
      return byId.get(id);
    },
    createElement(tag) {
      const node = new FakeElement(tag);
      if (['audio', 'video'].includes(String(tag).toLowerCase())) node.playPlan = playPlan;
      return node;
    },
    querySelectorAll(selector) { return body.querySelectorAll(selector); },
    addEventListener() {},
    removeEventListener() {},
  };
  const timers = [];
  const beats = [];
  const win = {
    addEventListener() {},
    dispatchEvent() {},
    setTimeout(handler) { timers.push(handler); return timers.length; },
    clearTimeout() {},
    setInterval(handler) { beats.push(handler); return beats.length; },
    clearInterval() { beats.length = 0; },
    location: {origin: 'https://roster.test', href: 'https://roster.test/live.html', pathname: '/live.html'},
  };
  return {doc, win, timers, beats, byId};
}

/* ------------------------------------------------------- a stand-in wire

   Each connection describes itself as a short list of lines, which is all
   this needs from SDP: what kind each line is, and whether that side is
   sending on it. A description that says it is sending is what makes the
   other side receive a track. */

const wireTracks = new Map();

class FakePeerConnection {
  constructor() {
    this.transceivers = [];
    this.signalingState = 'stable';
    this.connectionState = 'new';
    this.localDescription = null;
    this.remoteDescription = null;
    this.negotiating = false;
    this.onnegotiationneeded = null;
    this.onicecandidate = null;
    this.ontrack = null;
    this.onconnectionstatechange = null;
  }
  addTransceiver(trackOrKind, init = {}) {
    const kind = typeof trackOrKind === 'string' ? trackOrKind : trackOrKind.kind;
    const track = typeof trackOrKind === 'string' ? null : trackOrKind;
    const pc = this;
    const transceiver = {
      kind,
      here: init.direction || 'sendrecv',
      sender: {
        track,
        async replaceTrack(next) { this.track = next; },
      },
      get direction() { return this.here; },
      set direction(value) { this.here = value; pc.needsNegotiation(); },
    };
    this.transceivers.push(transceiver);
    this.needsNegotiation();
    return transceiver;
  }
  getTransceivers() { return [...this.transceivers]; }
  needsNegotiation() {
    if (this.negotiating) return;
    this.negotiating = true;
    queueMicrotask(() => {
      this.negotiating = false;
      if (this.signalingState === 'stable') void this.onnegotiationneeded?.();
    });
  }
  describe() {
    return JSON.stringify(this.transceivers.map((transceiver, index) => {
      const sending = ['sendrecv', 'sendonly'].includes(transceiver.direction) && Boolean(transceiver.sender.track);
      if (sending) wireTracks.set(transceiver.sender.track.id, transceiver.sender.track);
      return {
        index, kind: transceiver.kind, sending,
        track: sending ? transceiver.sender.track.id : null,
      };
    }));
  }
  async setLocalDescription() {
    const type = this.signalingState === 'have-remote-offer' ? 'answer' : 'offer';
    this.localDescription = {type, sdp: this.describe()};
    this.signalingState = type === 'offer' ? 'have-local-offer' : 'stable';
    this.connectionState = 'connected';
    this.onconnectionstatechange?.();
    return undefined;
  }
  async setRemoteDescription(description) {
    this.remoteDescription = description;
    this.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable';
    const lines = JSON.parse(description.sdp);
    // Anything the other side says it is sending arrives here, in one stream,
    // the way a browser delivers it.
    const arriving = lines.filter(line => line.sending).map(line => wireTracks.get(line.track)).filter(Boolean);
    for (const line of lines) {
      while (this.transceivers.length <= line.index) this.addTransceiver(line.kind, {direction: 'recvonly'});
    }
    if (arriving.length) {
      this.remoteStream = this.remoteStream || new FakeStream([]);
      for (const track of arriving) {
        if (!this.remoteStream.getTracks().includes(track)) this.remoteStream.add(track);
      }
      this.ontrack?.({track: arriving[arriving.length - 1], streams: [this.remoteStream]});
    }
    this.connectionState = 'connected';
    this.onconnectionstatechange?.();
    return undefined;
  }
  async addIceCandidate() {}
  close() { this.connectionState = 'closed'; }
}

/* ------------------------------------------------------- a stand-in server

   The same shape the real endpoints return, with the same rules this test
   depends on: a host runs one room, everybody arrives muted and listening,
   and connection setup is delivered once to the member it is addressed to. */

function fakeRoster() {
  const rooms = new Map();
  const signals = [];
  const names = {'host-1': 'Test Host', 'view-1': 'Test Viewer'};

  const view = (room, memberId) => ({
    key: room.key, title: room.title, description: room.description, medium: room.medium,
    host_id: room.hostId, host_name: names[room.hostId], host_photo_url: null,
    created_at: new Date(0).toISOString(), last_active_at: new Date(0).toISOString(),
    listener_count: [...room.people.values()].filter(person => person.role === 'listener').length,
    speaker_count: [...room.people.values()].filter(person => person.role !== 'listener').length,
    participant_count: room.people.size,
    you_are_host: room.hostId === memberId,
  });

  const people = (room, memberId) => [...room.people.entries()].map(([id, person]) => ({
    member_id: id, name: names[id], photo_url: null, role: person.role,
    hand_raised: person.hand, muted: person.role === 'listener' ? true : person.muted,
    is_host: id === room.hostId, is_you: id === memberId,
  }));

  const state = (room, memberId) => {
    const mine = signals.filter(signal => signal.room === room.key && signal.to === memberId);
    for (const signal of mine) signals.splice(signals.indexOf(signal), 1);
    return {
      room: view(room, memberId),
      you: people(room, memberId).find(entry => entry.is_you),
      participants: people(room, memberId),
      messages: room.messages.map(message => ({...message, is_you: message.member_id === memberId})),
      signals: mine.map(signal => ({from_id: signal.from, kind: signal.kind, payload: signal.payload})),
      member_id: memberId,
      ice_servers: [{urls: ['stun:stun.l.google.com:19302']}],
    };
  };

  let keys = 0;
  const fetchFor = (memberId) => async (path, options) => {
    const body = options?.body ? JSON.parse(options.body) : {};
    const ok = (payload) => ({ok: true, status: 200, json: async () => payload});
    const bad = (status, error) => ({ok: false, status, json: async () => ({error})});
    if (path === '/api/live/rooms') {
      return ok({member_id: memberId, name: names[memberId], rooms: [...rooms.values()].map(room => view(room, memberId)), ice_servers: []});
    }
    if (path === '/api/live/signal') {
      for (const signal of body.signals || []) {
        signals.push({room: body.key, from: memberId, to: signal.to_id, kind: signal.kind, payload: signal.payload});
      }
      return ok({sent: (body.signals || []).length});
    }
    const room = body.key ? rooms.get(body.key) : null;
    switch (body.action) {
      case 'create': {
        for (const [key, existing] of rooms) if (existing.hostId === memberId) rooms.delete(key);
        keys += 1;
        const key = `roomkey${String(keys).padStart(5, '0')}`;
        const opened = {
          key, title: body.title, description: body.description || '', medium: body.medium === 'video' ? 'video' : 'audio',
          hostId: memberId, people: new Map([[memberId, {role: 'host', muted: true, hand: false}]]), messages: [],
        };
        rooms.set(key, opened);
        return ok({room: view(opened, memberId), member_id: memberId, ice_servers: []});
      }
      case 'join': {
        if (!room) return bad(404, 'That room has ended.');
        if (!room.people.has(memberId)) room.people.set(memberId, {role: room.hostId === memberId ? 'host' : 'listener', muted: true, hand: false});
        return ok(state(room, memberId));
      }
      case 'sync':
        if (!room) return bad(404, 'That room has ended.');
        return ok(state(room, memberId));
      case 'mute': {
        if (!room) return bad(404, 'That room has ended.');
        const person = room.people.get(memberId);
        if (person.role === 'listener') return bad(403, 'Only a speaker can unmute.');
        person.muted = Boolean(body.muted);
        return ok(state(room, memberId));
      }
      case 'say': {
        if (!room) return bad(404, 'That room has ended.');
        if (!room.people.has(memberId)) return bad(409, 'Join the room before you comment.');
        room.messages.push({id: room.messages.length + 1, member_id: memberId, name: names[memberId], photo_url: null, body: body.body, created_at: new Date(0).toISOString()});
        return ok(state(room, memberId));
      }
      case 'host': {
        if (!room) return bad(404, 'That room has ended.');
        if (room.hostId !== memberId) return bad(403, 'Only the host can do that.');
        if (body.host_action === 'end_room') { rooms.delete(room.key); return ok({ended: true}); }
        if (body.host_action === 'remove_message') {
          room.messages = room.messages.filter(message => message.id !== body.message_id);
          return ok(state(room, memberId));
        }
        if (body.host_action === 'approve_speaker') {
          room.people.get(body.member_id).role = 'speaker';
          return ok(state(room, memberId));
        }
        return bad(400, 'That is not a host control.');
      }
      case 'leave':
        if (room) room.people.delete(memberId);
        return ok({left: true});
      default:
        return bad(400, 'That ROOSTER LIVE action is not available.');
    }
  };
  return {rooms, fetchFor};
}

function member(id, roster, {video = true, playPlan = []} = {}) {
  const browser = fakeBrowser({playPlan});
  const opened = [];
  const live = createRosterLive({
    doc: browser.doc,
    win: browser.win,
    storage: null,
    fetchImpl: roster.fetchFor(id),
    peerFactory: () => new FakePeerConnection(),
    requestMicrophone: async (constraints) => {
      const tracks = [new FakeTrack('audio', `${id}-audio-${opened.length}`)];
      if (constraints.video) tracks.push(new FakeTrack('video', `${id}-video-${opened.length}`));
      const stream = new FakeStream(tracks);
      opened.push({constraints, stream});
      return stream;
    },
    listDevices: async () => ([{kind: 'videoinput', deviceId: 'front', label: 'Front'}, {kind: 'videoinput', deviceId: 'back', label: 'Back'}, {kind: 'audioinput', deviceId: 'mic', label: 'Mic'}]),
    audioContextFactory: () => { throw new Error('no WebAudio offline'); },
  });
  return {id, live, browser, opened, video};
}

/** Let every queued timer and microtask settle, without a heartbeat. */
async function settle(...members) {
  for (let round = 0; round < 4; round += 1) {
    for (const entry of members) {
      const timers = entry.browser.timers.splice(0, entry.browser.timers.length);
      for (const timer of timers) timer();
    }
    for (let step = 0; step < 6; step += 1) await new Promise(resolve => setImmediate(resolve));
  }
}

/** Run the check-ins that carry connection setup, the way the page's own
 * heartbeat does, until both sides have everything addressed to them. */
async function handshake(...members) {
  for (let round = 0; round < 12; round += 1) {
    for (const entry of members) {
      const timers = entry.browser.timers.splice(0, entry.browser.timers.length);
      for (const timer of timers) timer();
      for (const beat of [...entry.browser.beats]) beat();
    }
    for (let step = 0; step < 8; step += 1) await new Promise(resolve => setImmediate(resolve));
  }
}

test('a second authorized account receives the host camera and microphone', async () => {
  const roster = fakeRoster();
  const host = member('host-1', roster);
  const viewer = member('view-1', roster);

  // The host turns the camera on, which is the only moment permission is
  // asked for, and nothing is broadcast yet.
  await host.live.setCamera(true);
  await settle(host);
  assert.equal(host.opened.length, 1, 'the camera is opened once, by a press');
  assert.equal(Boolean(host.opened[0].constraints.video), true);
  assert.equal(host.live.phase(), 'permission');
  assert.equal(roster.rooms.size, 0, 'a preview is not a broadcast');

  // Two presses on Go Live open one room.
  const first = host.live.create('Friday Night Roster', {medium: 'video'});
  const second = host.live.create('Friday Night Roster', {medium: 'video'});
  assert.equal(await second, false, 'a second press while connecting is ignored');
  await first;
  await settle(host);
  assert.equal(roster.rooms.size, 1);
  const [key] = [...roster.rooms.keys()];
  assert.equal(host.live.phase(), 'live');

  // The viewer joins with nothing of their own open.
  await viewer.live.join(key);
  assert.equal(viewer.opened.length, 0, 'watching never asks for a camera or a microphone');

  await handshake(host, viewer);

  // What the viewer actually received: the host's camera and microphone, on a
  // video element mounted on the stage.
  const stage = viewer.browser.doc.getElementById('live-stage-media');
  const pictures = stage.children.filter(node => node.tagName === 'VIDEO');
  assert.equal(pictures.length, 1, 'the host arrives as one picture on the stage');
  const received = pictures[0].srcObject;
  assert.ok(received, 'the picture has a stream on it');
  assert.deepEqual(received.getVideoTracks().map(track => track.id), ['host-1-video-0']);
  assert.deepEqual(received.getAudioTracks().map(track => track.id), ['host-1-audio-0']);
  assert.equal(pictures[0].dataset.rosterLive, 'stream', 'a live element is exempt from the media bus');
  assert.ok(pictures[0].playCalls > 0, 'the stream is started rather than left paused');
  assert.equal(viewer.live.phase(), 'live');

  // And the host is sending, not merely holding a track.
  const sending = host.live.state();
  assert.equal(sending.joined, true);
  assert.equal(sending.room.medium, 'video');
});

test('the host microphone only carries once the room says it may', async () => {
  const roster = fakeRoster();
  const host = member('host-1', roster);
  const viewer = member('view-1', roster);
  await host.live.setCamera(true);
  await host.live.create('Mic Check', {medium: 'video'});
  await settle(host);
  await viewer.live.join([...roster.rooms.keys()][0]);
  await handshake(host, viewer);

  // The host chose the microphone on before pressing Go Live, so it is on.
  const stage = viewer.browser.doc.getElementById('live-stage-media');
  const received = stage.children.find(node => node.tagName === 'VIDEO').srcObject;
  const audio = received.getAudioTracks()[0];
  assert.equal(audio.enabled, true, 'a host who went live with the mic on is audible');

  // Muting stops the sound without dropping the connection.
  await host.live.setMuted(true);
  await settle(host);
  assert.equal(audio.enabled, false);
  assert.equal(host.live.joined(), true);
});

test('an audio room captures no camera and a listener gets one simple autoplay retry', async () => {
  const roster = fakeRoster();
  const host = member('host-1', roster, {video: false});
  const viewer = member('view-1', roster, {video: false, playPlan: ['reject']});

  await host.live.create('Audio Check', {medium: 'audio'});
  await settle(host);
  assert.equal(host.opened.length, 1);
  assert.equal(host.opened[0].constraints.video, false, 'an audio room never requests a camera');
  assert.equal(host.opened[0].stream.getVideoTracks().length, 0);
  assert.equal(host.opened[0].stream.getAudioTracks().length, 1);

  const [key] = [...roster.rooms.keys()];
  await viewer.live.join(key);
  await handshake(host, viewer);

  const sink = viewer.browser.doc.getElementById('roster-live-audio');
  const remote = sink.children.find(node => node.tagName === 'AUDIO');
  assert.ok(remote, 'audio-only rooms mount the host in a real audio element');
  assert.equal(remote.muted, false);
  assert.equal(remote.srcObject.getAudioTracks()[0].enabled, true);
  assert.equal(viewer.live.state().tapToPlay, true, 'a blocked browser keeps the sound action visible');

  const hear = viewer.browser.doc.getElementById('live-audio-start');
  assert.equal(hear.hidden, false);
  hear.fire('click');
  await settle(viewer);
  assert.equal(viewer.live.state().tapToPlay, false, 'a successful explicit press clears the block');
  assert.equal(hear.hidden, true);
  assert.match(viewer.live.state().status, /audio is on/i);
});

test('a second blocked audio press stays actionable', async () => {
  const roster = fakeRoster();
  const host = member('host-1', roster, {video: false});
  const viewer = member('view-1', roster, {video: false, playPlan: ['reject', 'reject']});
  await host.live.create('Blocked Audio', {medium: 'audio'});
  await settle(host);
  await viewer.live.join([...roster.rooms.keys()][0]);
  await handshake(host, viewer);
  const hear = viewer.browser.doc.getElementById('live-audio-start');
  hear.fire('click');
  await settle(viewer);
  assert.equal(viewer.live.state().tapToPlay, true);
  assert.equal(hear.hidden, false, 'the retry never disappears while playback is still blocked');
  assert.match(viewer.live.state().status, /Tap to Hear Audio again/i);
});

test('a comment from a viewer reaches the room, and the host can take it down', async () => {
  const roster = fakeRoster();
  const host = member('host-1', roster);
  const viewer = member('view-1', roster);
  await host.live.create('Comments', {medium: 'video'});
  await settle(host);
  await viewer.live.join([...roster.rooms.keys()][0]);
  await settle(viewer);

  assert.equal(await viewer.live.comment('  '), false, 'an empty comment is not sent');
  assert.equal(await viewer.live.comment('this is real'), true);
  await settle(viewer);
  const list = viewer.browser.doc.getElementById('live-chat');
  assert.equal(list.children.length, 1);
  assert.match(list.children[0].children.map(child => child.children.map(leaf => leaf.textContent).join(' ')).join(' '), /this is real/);

  await handshake(host, viewer);
  const hostState = host.live.state();
  assert.equal(hostState.messages.length, 1);
  await host.live.hostAction('remove_message', '', hostState.messages[0].id);
  await settle(host);
  assert.equal(host.live.state().messages.length, 0, 'the host can take a comment down');
});

test('ending a broadcast tells the viewer and lets the camera light go out', async () => {
  const roster = fakeRoster();
  const host = member('host-1', roster);
  const viewer = member('view-1', roster);
  await host.live.setCamera(true);
  await host.live.create('The End', {medium: 'video'});
  await settle(host);
  const opened = host.opened[0].stream;
  await viewer.live.join([...roster.rooms.keys()][0]);
  await handshake(host, viewer);

  await host.live.hostAction('end_room', '');
  await settle(host);
  assert.equal(host.live.joined(), false);
  assert.equal(host.live.phase(), 'ended');
  for (const track of opened.getTracks()) {
    assert.equal(track.readyState, 'ended', 'the camera and microphone are released');
    assert.equal(track.enabled, false);
  }

  // The viewer's next check-in is told the room is gone rather than spinning.
  await handshake(viewer);
  assert.equal(viewer.live.joined(), false);
  assert.equal(viewer.live.phase(), 'ended');
});
