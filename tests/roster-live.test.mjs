import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  HOST_ACTIONS, LIVE_ROLES, PRESENT_WINDOW_MS, ROOM_KEY_SHAPE, SIGNAL_KINDS,
  iceServers, liveFailure, normalizeRoomKey, normalizeSession, normalizeTitle, readLiveBody,
} from '../netlify/functions/_shared/roster-live.mts';
import {
  LIVE_FILTERS, LIVE_HOLD, LIVE_PHASES, POLL_MS, heldSession, holdSession, livePreviewFilter,
  mediaBlame, newSessionId, politeSide, shouldConnect,
} from '../roster-live.js';

const source = fs.readFileSync(new URL('../netlify/functions/_shared/roster-live.mts', import.meta.url), 'utf8');
const client = fs.readFileSync(new URL('../roster-live.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../live.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../roster-live.css', import.meta.url), 'utf8');
const bus = fs.readFileSync(new URL('../roster-media-bus.js', import.meta.url), 'utf8');

const json = (body) => new Request('https://roster.test/api/live/room', {
  method: 'POST', headers: {'Content-Type': 'application/json'}, body,
});

test('a room key, a room name and a connection are all checked before anything is stored', () => {
  assert.equal(normalizeRoomKey(' ABCDEFGH2345 '), 'abcdefgh2345');
  for (const bad of ['', 'short', 'ABCDEFGH23456', 'abcdefgh234!', null, 12, {}]) {
    assert.throws(() => normalizeRoomKey(bad), /not a ROOSTER LIVE room/);
  }
  assert.equal(normalizeTitle('  Friday   Night   Roster '), 'Friday Night Roster');
  assert.throws(() => normalizeTitle('ab'), /at least 3 characters/);
  assert.throws(() => normalizeTitle('x'.repeat(61)), /60 characters or fewer/);
  // A room name is shown to everybody in the room, so no markup and no
  // control characters get in.
  assert.throws(() => normalizeTitle('<script>alert(1)</script>'), /cannot contain/);
  assert.throws(() => normalizeTitle(`bell${String.fromCharCode(7)}room`), /cannot contain/);
  assert.equal(normalizeSession('abcd-1234_EFGH'), 'abcd-1234_EFGH');
  for (const bad of ['short', 'x'.repeat(65), 'has spaces here', '../../etc', null]) {
    assert.throws(() => normalizeSession(bad), /could not be identified/);
  }
});

test('the roles, the host controls and the connection messages are a closed list', () => {
  assert.deepEqual([...LIVE_ROLES], ['host', 'speaker', 'listener']);
  assert.deepEqual([...HOST_ACTIONS], ['approve_speaker', 'mute_speaker', 'step_down_speaker', 'remove_member', 'remove_message', 'restore_message', 'end_room', 'assign_moderator', 'remove_moderator', 'comments_on', 'comments_off']);
  assert.deepEqual([...SIGNAL_KINDS], ['offer', 'answer', 'ice', 'bye']);
  // Anything a browser sends that is not on the list is refused rather than
  // guessed at.
  assert.match(source, /HOST_ACTIONS as readonly unknown\[\]\)\.includes\(action\)/);
  assert.match(source, /SIGNAL_KINDS as readonly unknown\[\]\)\.includes\(kind\)/);
});

test('a request body is read with a real limit and only as JSON', async () => {
  assert.deepEqual(await readLiveBody(json('{"action":"join","key":"abcdefgh2345"}')), {action: 'join', key: 'abcdefgh2345'});
  await assert.rejects(readLiveBody(json('not json')), /could not be read/);
  await assert.rejects(readLiveBody(json('[1,2,3]')), /could not be read/);
  await assert.rejects(readLiveBody(new Request('https://roster.test/api/live/room', {
    method: 'POST', headers: {'Content-Type': 'text/plain'}, body: '{}',
  })), /could not be read/);
  // Bytes are counted as they arrive, not taken from a header a client wrote.
  const room = await readLiveBody(json(JSON.stringify({payload: 'x'.repeat(600)})));
  assert.equal(room.payload.length, 600);
  await assert.rejects(readLiveBody(json(JSON.stringify({payload: 'x'.repeat(200 * 1024)}))), /could not be read/);
});

test('connection servers are STUN by default and a relay only when one is configured', () => {
  const plain = iceServers(() => undefined);
  assert.equal(plain.length, 1);
  assert.deepEqual(plain[0].urls, ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302']);
  const configured = iceServers(key => ({
    ROSTER_LIVE_TURN_URL: 'turns:relay.example:5349',
    ROSTER_LIVE_TURN_USERNAME: 'roster',
    ROSTER_LIVE_TURN_CREDENTIAL: 'placeholder-for-this-test',
  })[key]);
  assert.equal(configured.length, 2);
  assert.equal(configured[1].urls, 'turns:relay.example:5349');
  // A half-configured or non-relay address is ignored rather than handed out.
  assert.equal(iceServers(key => (key === 'ROSTER_LIVE_TURN_URL' ? 'turns:relay.example:5349' : undefined)).length, 1);
  assert.equal(iceServers(key => ({
    ROSTER_LIVE_TURN_URL: 'https://relay.example',
    ROSTER_LIVE_TURN_USERNAME: 'roster',
    ROSTER_LIVE_TURN_CREDENTIAL: 'placeholder-for-this-test',
  })[key]).length, 1);
});

test('a failure tells a member what happened without leaking anything else', async () => {
  // Anything that is not a plain member-facing error becomes the same short
  // sentence, with no internal detail carried out to the browser.
  const unknown = liveFailure(new Error('column "secret_column" does not exist'));
  assert.equal(unknown.status, 503);
  const body = await unknown.json();
  assert.doesNotMatch(JSON.stringify(body), /secret_column/);
});

test('every ROOSTER LIVE room rule is enforced where the data is written', () => {
  // Only an invited and approved member reaches any of it.
  for (const file of ['live-rooms.mts', 'live-room.mts', 'live-signal.mts']) {
    const endpoint = fs.readFileSync(new URL(`../netlify/functions/${file}`, import.meta.url), 'utf8');
    assert.match(endpoint, /resolveCommunityProfileMember/, `${file} must take its member from the invite-only gate`);
    assert.match(endpoint, /assertSameOrigin\(req\)/, `${file} must refuse another site's request`);
  }
  // Everybody arrives as a listener, and coming back never promotes anybody.
  assert.match(source, /case when \$\{liveParticipants\.role\} = 'speaker' then 'speaker' else 'listener' end/);
  // A listener is reported muted whatever their stored row says.
  assert.match(source, /muted: role === "listener" \? true : row\.muted/);
  // A member can only ever unmute themselves if they are allowed to talk.
  assert.match(source, /case when \$\{liveParticipants\.role\} in \('host', 'speaker'\) then false else true end/);
  // Somebody the host removed cannot come back in.
  assert.match(source, /existing\?\.removed\) throw new MemberError\(403/);
  // A second device using the same account gets a clear answer instead of a
  // silent room, and an old session cannot steal the active device's seat.
  assert.match(source, /already in this room on another phone or computer/);
  assert.match(source, /eq\(liveParticipants\.sessionId, sessionId\)/);
  // The host controls work in that host's own room and never on themselves.
  assert.match(source, /if \(!host && !\(isModerator/);
  assert.match(source, /Only the host can end this broadcast/);
  assert.match(source, /target === member\.id\) throw new MemberError\(400/);
  assert.match(source, /ne\(liveParticipants\.memberId, room\.hostId\)/);
  // Connection setup is delivered once and only to somebody in that room.
  assert.match(source, /\.delete\(liveSignals\)[\s\S]{0,300}?eq\(liveSignals\.toId, member\.id\)\)\)\.returning\(\)/);
  assert.match(source, /!present\.has\(to\)\) throw new MemberError\(409/);
});

test('a browser only ever holds a room it can actually rejoin', () => {
  assert.equal(LIVE_HOLD, 'roster-live-session');
  assert.ok(POLL_MS < PRESENT_WINDOW_MS / 3, 'a member must check in well inside the window that keeps them present');
  const store = new Map();
  const storage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, value),
    removeItem: key => store.delete(key),
  };
  assert.equal(heldSession(storage), null);
  holdSession(storage, {key: 'abcdefgh2345', session: 'session-one', title: 'Friday Night'});
  assert.equal(heldSession(storage).key, 'abcdefgh2345');
  assert.equal(heldSession(storage).session, 'session-one');
  // Anything a page or an extension could have written over it is dropped
  // rather than sent to the server.
  for (const junk of ['not json', '{}', '{"key":"../../etc","session":"session-one"}', '{"key":"abcdefgh2345","session":"tiny"}']) {
    store.set(LIVE_HOLD, junk);
    assert.equal(heldSession(storage), null, junk);
  }
  holdSession(storage, null);
  assert.equal(store.has(LIVE_HOLD), false);
  // A tab with storage turned off is a room that cannot be resumed, not a crash.
  const refuses = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
    removeItem() { throw new Error('denied'); },
  };
  assert.equal(heldSession(refuses), null);
  assert.doesNotThrow(() => holdSession(refuses, {key: 'abcdefgh2345', session: 'session-one'}));
  assert.match(newSessionId(() => 0.5), /^[a-z0-9]{24}$/);
  assert.ok(ROOM_KEY_SHAPE.test('abcdefgh2345'));
});

test('two browsers agree on who offers, and listeners do not connect to each other', () => {
  // Both sides work it out from the ids alone, so exactly one of them offers.
  assert.equal(politeSide('bbbb', 'aaaa'), true);
  assert.equal(politeSide('aaaa', 'bbbb'), false);
  assert.notEqual(politeSide('aaaa', 'bbbb'), politeSide('bbbb', 'aaaa'));
  const host = {member_id: 'host-1', role: 'host'};
  const speaker = {member_id: 'speaker-1', role: 'speaker'};
  const listenerA = {member_id: 'listen-a', role: 'listener'};
  const listenerB = {member_id: 'listen-b', role: 'listener'};
  assert.equal(shouldConnect(listenerA, host), true);
  assert.equal(shouldConnect(listenerA, speaker), true);
  assert.equal(shouldConnect(host, listenerA), true);
  // A big audience stays cheap: somebody listening carries one connection per
  // person on the mic, not one per person in the room.
  assert.equal(shouldConnect(listenerA, listenerB), false);
  assert.equal(shouldConnect(listenerA, listenerA), false);
  assert.equal(shouldConnect(null, host), false);
});

test('a host\'s camera and microphone are actually put on the wire', () => {
  // The defect this replaces: a track was put on a sender that belonged to a
  // receive-only transceiver, so a host saw their own preview and nobody ever
  // received it. A transceiver has to be switched to sending, which is what
  // starts the renegotiation that carries the media.
  assert.match(client, /addTransceiver\(track, \{direction: 'sendrecv', streams: \[outboundStream\(\)\]\}\)/);
  assert.match(client, /addTransceiver\(kind, \{direction: 'recvonly'\}\)/);
  assert.match(client, /await existing\.sender\.replaceTrack\(track\);[\s\S]{0,160}existing\.direction = 'sendrecv';/);
  // Nothing is left sending after somebody stops being allowed to.
  assert.match(client, /await existing\.sender\.replaceTrack\(null\);[\s\S]{0,80}existing\.direction = 'recvonly';/);
  // The transceivers are kept per connection and per kind, not searched for.
  assert.match(client, /tx: \{audio: null, video: null\}/);
  assert.doesNotMatch(client, /__live/);
  // An audio room never negotiates a video line, so the two experiences stay
  // separate on the wire as well as on the page.
  assert.match(client, /state\.room\?\.medium === 'video' \? \['audio', 'video'\] : \['audio'\]/);
  // Only what the server says this member may send is ever sent.
  assert.match(client, /if \(!state\.you \|\| state\.you\.role === 'listener'\) return null;/);
});

test('one press opens one room, and a member can stop before anything goes out', () => {
  // A second press while the first is still going does not open a second room.
  assert.match(client, /if \(starting\) return false;/);
  // Cancelling mid-connection ends the room that was opened and lets the
  // camera light go out, rather than leaving either behind.
  assert.match(client, /async function abandon\(\)/);
  assert.match(client, /host_action: 'end_room'/);
  assert.match(client, /You stopped before going live\. Nothing was broadcast\./);
  // Every state a member can be in has words they can read.
  assert.deepEqual(Object.keys(LIVE_PHASES), [
    'ready', 'permission', 'connecting', 'live', 'reconnecting', 'ending', 'ended', 'denied', 'failed',
  ]);
  // A refusal explains itself and offers another go instead of spinning.
  assert.equal(mediaBlame({name: 'NotAllowedError'}).phase, 'denied');
  assert.match(mediaBlame({name: 'NotAllowedError'}).message, /Try Again/);
  assert.equal(mediaBlame({name: 'NotFoundError'}).phase, 'failed');
  assert.equal(mediaBlame({name: 'NotReadableError'}).phase, 'failed');
  assert.equal(mediaBlame({}).phase, 'failed');
  // A host leaving is asked once, because it takes the broadcast with them.
  assert.match(client, /function askToLeave\(\)/);
  assert.match(html, /Leave and end this broadcast\?/);
  assert.match(html, /releases your camera and microphone/);
  // A phone that blocks autoplay keeps one explicit retry button available.
  assert.match(client, /Tap to Hear Audio/);
});

test('the one-thing-plays-at-a-time bus leaves a live room alone', () => {
  // A live room carries somebody else's microphone: pausing it drops their
  // voice, and there is nothing to come back to.
  assert.match(bus, /function isLive\(el\)/);
  assert.match(bus, /rosterLive === 'stream'/);
  assert.match(bus, /typeof source\.getTracks === 'function'/);
  // Hiding the tab pauses recordings, not the room.
  assert.match(bus, /if \(isLive\(all\[i\]\)\) continue;/);
  // The room never becomes the bus's current player, so leaving it never
  // resumes anything the member had stopped.
  assert.match(bus, /if \(!isLive\(el\)\) current = el;/);
  assert.match(client, /element\.dataset\.rosterLive = 'stream';/);
});

test('the ROOSTER LIVE page and its client keep the promises made to a member', () => {
  // Every media permission goes through the injectable browser door. Initial
  // setup may ask for audio, while switching lenses explicitly asks for video
  // only so it cannot make the microphone pulse or duplicate its track.
  assert.equal((client.match(/navigator\.mediaDevices\.getUserMedia/g) || []).length, 1,
    'camera and microphone permissions must use one guarded browser door');
  assert.match(client, /requestMicrophone\(\{audio: false, video: videoConstraints\(\)\}\)/);
  assert.match(client, /for \(const track of localStream\.getAudioTracks\(\)\) track\.enabled = false;/);
  // A listener pressing Unmute is told how to become a speaker, and is never
  // asked for a microphone.
  assert.match(client, /Raise your hand and the host can make you a speaker/);
  // Joining a room stops the site's music.
  assert.match(client, /new CustomEvent\('jwhite:pause-music'\)/);
  // The bar that keeps a room while a member moves around ROOSTER.
  assert.match(client, /roster-live-bar/);
  assert.match(client, /'live-bar-mute'/);
  assert.match(client, /'live-bar-audio'/);
  assert.match(client, /'live-bar-leave'/);
  // Names and faces open that member's own profile and nobody else's.
  assert.match(client, /\/profile\.html\?id=\$\{encodeURIComponent\(entry\.member_id\)\}/);
  // The page itself says who ROOSTER LIVE is for.
  assert.match(html, /nvite only/);
  for (const id of [
    'live-mute', 'live-leave', 'live-hand', 'live-end', 'live-room-people', 'live-rooms',
    'live-create-form', 'live-preview', 'live-preview-start', 'live-phase', 'live-cancel',
    'live-retry', 'live-stage-media', 'live-chat', 'live-chat-form', 'live-confirm', 'live-filter-panel',
    'live-audio-start', 'live-audio-state',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `live.html needs #${id}`);
  }
  // Going live is one column in one order: the heading, the picture, the
  // title, the controls, who can watch, then the one button that starts it.
  const order = ['live-setup-title', 'live-preview', 'live-create-title', 'live-devices', 'live-audience', 'live-go', 'More settings'];
  let at = -1;
  for (const mark of order) {
    const next = html.indexOf(mark);
    assert.ok(next > at, `${mark} is out of order on the Go Live page`);
    at = next;
  }
  // Nothing is asked for and nothing is sent on the way in.
  assert.doesNotMatch(html, /autoplay[^>]*src=/);
  assert.match(html, /Your camera is off/);
  assert.equal(LIVE_FILTERS.length, 25);
  assert.match(livePreviewFilter('noir'), /grayscale/);
  assert.equal(livePreviewFilter('not-a-filter'), 'none');
  assert.match(client, /canvas\.captureStream\(30\)/, 'the selected look is sent on the outgoing track');
  assert.match(client, /async function startRoomAudio/);
  assert.match(client, /audioContext\.resume/);
  assert.match(client, /element\.muted = false/);
  assert.doesNotMatch(client, /Tap anywhere to start this room/);
  assert.match(css, /\.live-audio-sink\{position:fixed/);
  // Red, gold and orange, and reachable thumbs on a phone.
  for (const token of ['--rs-red', '--rs-gold', '--rs-orange']) assert.ok(css.includes(token), `roster-live.css needs ${token}`);
  assert.match(css, /min-height: 4[4-9]px/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /env\(safe-area-inset-bottom/);
});

test('ROOSTER LIVE ships with the site and is reachable from every page', () => {
  const build = fs.readFileSync(new URL('../build.mjs', import.meta.url), 'utf8');
  // The page and its styles are copied, and the client is bundled.
  assert.match(build, /'live\.html'/);
  assert.match(build, /'roster-live\.css'/);
  assert.match(build, /entryPoints:\[[^\]]*roster-live\.js[^\]]*\][\s\S]{0,200}public\/roster-live\.js/);
  // A member in a room keeps that room while they move around ROOSTER, so the
  // bar and the client have to exist on every page they can reach.
  const pages = [
    'index.html', 'members.html', 'opportunities.html', 'apply.html', 'people.html',
    'profile.html', 'member-photos.html', 'edit-profile.html', 'photos.html',
    'top25.html', 'about.html', 'morespace.html', 'live.html',
  ];
  for (const page of pages) {
    const markup = fs.readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
    assert.match(markup, /href="\/live\.html"[^>]*>(?:(?:ROOSTER )?LIVE|ROOMS|Rooms)/, `${page} needs the unified Rooms link`);
    assert.match(markup, /roster-live\.css/, `${page} needs the ROOSTER LIVE styles`);
    assert.match(markup, /src="\/roster-live\.js/, `${page} needs the ROOSTER LIVE client`);
  }
});
