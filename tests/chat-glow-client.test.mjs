import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';

const source = fs.readFileSync(new URL('../chat-glow.js', import.meta.url), 'utf8');
const glowCss = fs.readFileSync(new URL('../community.css', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

class Element {
  constructor(className = '', text = '') {
    this.className = className; this.dataset = {}; this.textContent = text; this.children = [];
    this.attributes = {}; this.hidden = false;
  }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  setAttribute(key, value) { this.attributes[key] = value; }
  querySelector(selector) {
    const wanted = selector.replace('.', '');
    for (const child of this.children) {
      if (child.className === wanted) return child;
      const nested = child.querySelector(selector);
      if (nested) return nested;
    }
    return null;
  }
  get badge() { return this.querySelector('.chat-glow-state'); }
  get full() { return this.querySelector('.chat-glow-full')?.textContent ?? null; }
  get short() { return this.querySelector('.chat-glow-short')?.textContent ?? null; }
  get label() { return this.attributes['aria-label']; }
  get glow() { return this.dataset.chatGlow; }
}

const member = {id: randomUUID()};
const status = (over = {}) => ({room: 'The Listening Room', inside: 0, owner_inside: false, owner_identified: true,
  heartbeat_seconds: 15, expires_in_seconds: 45, measured_at: new Date().toISOString(), ...over});

function environment(first = status(), seededSession = null) {
  const desktop = new Element('nav-chat', '● Chat Room');
  const mobile = new Element('mobile-nav-chat', '● Chat');
  const quick = new Element('member-chat-link', 'Chat Room');
  const nodes = [desktop, mobile, quick];
  const events = {}; const pageEvents = {}; const intervals = new Map(); let intervalId = 0;
  const store = new Map();
  const document = {
    visibilityState: 'visible', readyState: 'complete',
    createElement: () => new Element(),
    querySelectorAll: selector => nodes.filter(node => selector.split(',').some(part =>
      part.trim() === `.${node.className}` || (part.trim() === '[data-chat-glow]' && 'chatGlow' in node.dataset))),
    addEventListener: (type, fn) => { events[type] = fn; },
  };
  const calls = []; const queue = [];
  const fetch = async (path, options) => {
    calls.push({path, options, body: options?.body ? JSON.parse(options.body) : null});
    const next = queue.shift();
    if (!next) throw Error('Test did not enqueue a response');
    return next();
  };
  const enqueue = (data, ok = 200) => queue.push(() => ({ok: ok >= 200 && ok < 300, status: ok, json: async () => data}));
  const fail = () => queue.push(() => { throw Error('offline'); });
  const context = vm.createContext({
    document,
    window: {addEventListener: (type, fn) => { pageEvents[type] = fn; }},
    sessionStorage: {getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value)},
    fetch, AbortController, setTimeout, clearTimeout,
    setInterval: (fn, delay) => { const id = ++intervalId; intervals.set(id, {fn, delay}); return id; },
    clearInterval: id => intervals.delete(id),
    crypto: {randomUUID},
  });
  // The first status read happens as the script starts, before any test line runs.
  if (seededSession) store.set('jspace-chat-room-session-v1', seededSession);
  enqueue(first);
  vm.runInContext(source, context);
  return {desktop, mobile, quick, document, events, pageEvents, intervals, calls, enqueue, fail, store,
    glow: context.window.RosterChatGlow,
    reads: () => calls.filter(call => !call.options?.method),
    posts: () => calls.filter(call => call.options?.method === 'POST' || call.options?.keepalive)};
}

async function loaded(over = {}) { const e = environment(status(over)); await tick(); return e; }

test('the glow reads the room status endpoint and paints every chat tab in the app', async () => {
  const e = await loaded({inside: 6});
  assert.equal(e.reads().length, 1);
  assert.equal(e.reads()[0].path, '/api/chat-room-presence');
  assert.equal(e.reads()[0].options.cache, 'no-store');
  assert.equal(e.reads()[0].options.credentials, 'same-origin');
  for (const node of [e.desktop, e.mobile, e.quick]) assert.equal(node.glow, 'green');
});

test('an empty room leaves the tab normal with no glow and no count', async () => {
  const e = await loaded({inside: 0});
  assert.equal(e.desktop.glow, 'quiet');
  assert.equal(e.desktop.badge.hidden, true);
  assert.equal(e.desktop.full, '');
  assert.equal(e.desktop.label, 'Chat Room, nobody inside right now');
});

test('members inside show the green state with the number in the room', async () => {
  const e = await loaded({inside: 6});
  assert.equal(e.desktop.glow, 'green');
  assert.equal(e.desktop.badge.hidden, false);
  assert.equal(e.desktop.full, '· 6 inside');
  assert.equal(e.desktop.label, 'Chat Room, 6 people inside');
  assert.equal(e.mobile.short, '6');
  const one = await loaded({inside: 1});
  assert.equal(one.desktop.label, 'Chat Room, 1 person inside');
});

test('the owner inside shows gold and takes priority over green', async () => {
  const e = await loaded({inside: 6, owner_inside: true});
  assert.equal(e.desktop.glow, 'gold');
  assert.equal(e.desktop.full, '· J.White is in the chat');
  assert.equal(e.desktop.label, 'Chat Room, J.White is in the chat');
  assert.equal(e.mobile.short, 'J.White');
});

test('gold is withheld when the server could not identify the owner account', async () => {
  const e = await loaded({inside: 4, owner_inside: true, owner_identified: false});
  assert.equal(e.desktop.glow, 'green');
  assert.equal(e.desktop.full, '· 4 inside');
});

test('the tab follows the room through gold, back to green, and back to normal', async () => {
  const e = await loaded({inside: 3, owner_inside: true});
  assert.equal(e.desktop.glow, 'gold');
  const [poll] = [...e.intervals.values()];
  e.enqueue(status({inside: 2}));
  poll.fn(); await tick();
  assert.equal(e.desktop.glow, 'green');
  assert.equal(e.desktop.full, '· 2 inside');
  e.enqueue(status({inside: 0}));
  poll.fn(); await tick();
  assert.equal(e.desktop.glow, 'quiet');
  assert.equal(e.desktop.badge.hidden, true);
});

test('repainting never accumulates label or badge nodes', async () => {
  const e = await loaded({inside: 2});
  const [poll] = [...e.intervals.values()];
  for (const inside of [3, 4, 5]) { e.enqueue(status({inside})); poll.fn(); await tick(); }
  assert.equal(e.desktop.children.filter(child => child.className === 'chat-glow-state').length, 1);
  assert.equal(e.desktop.label, 'Chat Room, 5 people inside');
  assert.equal(e.desktop.full, '· 5 inside');
});

test('a failed status read keeps the last known room state instead of clearing it', async () => {
  const e = await loaded({inside: 5, owner_inside: true});
  const [poll] = [...e.intervals.values()];
  e.fail(); poll.fn(); await tick();
  assert.equal(e.desktop.glow, 'gold');
  e.enqueue({error: 'nope'}, 503); poll.fn(); await tick();
  assert.equal(e.desktop.glow, 'gold');
  e.enqueue({inside: -1}); poll.fn(); await tick();
  assert.equal(e.desktop.glow, 'gold');
});

test('presence is only posted for a signed in member who actually opens the room', async () => {
  const e = await loaded({inside: 0});
  e.glow.enter();
  assert.equal(e.posts().length, 0, 'a visitor with no session posts nothing');
  e.glow.setUser({id: 'not-a-uuid'});
  e.glow.enter();
  assert.equal(e.posts().length, 0);
  e.glow.setUser(member);
  assert.equal(e.posts().length, 0, 'signing in is not entering the room');
  e.enqueue({ok: true}); e.enqueue(status({inside: 1}));
  e.glow.enter(); await tick();
  const [post] = e.posts();
  assert.equal(post.path, '/api/chat-room-presence');
  assert.equal(post.options.credentials, 'same-origin');
  assert.equal(post.body.state, 'inside');
  assert.match(post.body.session_id, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
  assert.deepEqual(Object.keys(post.body).sort(), ['session_id', 'state']);
});

test('the posted seat carries no name, id or message content of its own', async () => {
  const e = await loaded({inside: 0});
  e.glow.setUser(member);
  e.enqueue({ok: true}); e.enqueue(status({inside: 1}));
  e.glow.enter(); await tick();
  const body = JSON.stringify(e.posts()[0].body);
  assert.ok(!body.includes(member.id), 'the server reads the member from the verified session');
  assert.ok(!/J\.White|name|email/i.test(body));
});

test('several tabs of one browser share a single seat, so one member counts once', async () => {
  const first = await loaded({inside: 0});
  first.glow.setUser(member);
  first.enqueue({ok: true}); first.enqueue(status({inside: 1}));
  first.glow.enter(); await tick();
  const seat = first.posts()[0].body.session_id;

  // A second and third tab reuse the browser session id, so the server writes
  // the same seat key rather than three of them.
  for (const label of ['second tab', 'third tab']) {
    const tab = environment(status({inside: 1}), seat);
    await tick();
    tab.glow.setUser(member);
    tab.enqueue({ok: true}); tab.enqueue(status({inside: 1}));
    tab.glow.enter(); await tick();
    assert.equal(tab.posts()[0].body.session_id, seat, label);
    assert.equal(tab.desktop.full, '\u00b7 1 inside', label);
  }

  // A different browser gets its own seat id.
  const other = environment(status({inside: 1}));
  await tick();
  other.glow.setUser(member);
  other.enqueue({ok: true}); other.enqueue(status({inside: 1}));
  other.glow.enter(); await tick();
  assert.notEqual(other.posts()[0].body.session_id, seat);
});

test('leaving the room, hiding the page and closing it all release the seat', async () => {
  const e = await loaded({inside: 0});
  e.glow.setUser(member);
  e.enqueue({ok: true}); e.enqueue(status({inside: 1}));
  e.glow.enter(); await tick();
  e.enqueue({ok: true});
  e.glow.leave(); await tick();
  assert.equal(e.posts().at(-1).body.state, 'left');

  e.enqueue({ok: true}); e.enqueue(status({inside: 1}));
  e.glow.enter(); await tick();
  e.enqueue({ok: true});
  e.document.visibilityState = 'hidden';
  e.events.visibilitychange(); await tick();
  assert.equal(e.posts().at(-1).body.state, 'left');

  e.document.visibilityState = 'visible';
  e.enqueue({ok: true}); e.enqueue(status({inside: 1}));
  e.events.visibilitychange(); await tick();
  assert.equal(e.posts().at(-1).body.state, 'inside');

  e.enqueue({ok: true});
  e.pageEvents.pagehide(); await tick();
  const closing = e.posts().at(-1);
  assert.equal(closing.body.state, 'left');
  assert.equal(closing.options.keepalive, true);
});

test('a heartbeat keeps the seat alive on the cadence the server asks for', async () => {
  const e = await loaded({inside: 0});
  e.glow.setUser(member);
  e.enqueue({ok: true}); e.enqueue(status({inside: 1}));
  e.glow.enter(); await tick();
  const beat = [...e.intervals.values()].find(entry => entry.delay === 15_000);
  assert.ok(beat, 'the heartbeat runs on the 15 second cadence the status reports');
  e.enqueue({ok: true}); e.enqueue(status({inside: 1}));
  beat.fn(); await tick();
  assert.equal(e.posts().at(-1).body.state, 'inside');
  e.enqueue({ok: true});
  e.glow.leave(); await tick();
  const posted = e.posts().length;
  beat.fn(); await tick();
  assert.equal(e.posts().length, posted, 'the heartbeat stops once the room is closed');
});

test('signing out releases the seat and stops claiming presence', async () => {
  const e = await loaded({inside: 0});
  e.glow.setUser(member);
  e.enqueue({ok: true}); e.enqueue(status({inside: 1}));
  e.glow.enter(); await tick();
  e.enqueue({ok: true});
  e.glow.setUser(null); await tick();
  assert.equal(e.posts().at(-1).body.state, 'left');
  const posted = e.posts().length;
  e.glow.enter(); await tick();
  assert.equal(e.posts().length, posted);
});

test('the chat room panel is what enters the room, not being signed in', () => {
  const chat = fs.readFileSync(new URL('../member-chat.js', import.meta.url), 'utf8');
  assert.match(chat, /function startPolling\(\) \{\s*if \(!user \|\| !isVisible\(\)\) return;\s*\/\/[^\n]*\n\s*window\.RosterChatGlow\?\.enter\(\);/);
  assert.match(chat, /function suspendRead\(\) \{\s*window\.RosterChatGlow\?\.leave\(\);/);
  assert.match(chat, /function clear\(\) \{\s*window\.RosterChatGlow\?\.leave\(\);/);
  assert.match(chat, /const isVisible = \(\) => document\.visibilityState !== 'hidden' && room\.open;/);
});

test('the glow is gentle, readable without colour and stands still for reduced motion', () => {
  assert.match(glowCss, /\[data-chat-glow=green\][^{]*\{color:#8ef0a0\}/);
  assert.match(glowCss, /\[data-chat-glow=gold\][^{]*\{color:#ffe28a\}/);
  const green = /@keyframes chat-glow-green\{[^}]*\}[^}]*\}/.exec(glowCss)?.[0];
  const gold = /@keyframes chat-glow-gold\{[^}]*\}[^}]*\}/.exec(glowCss)?.[0];
  assert.ok(green && gold, 'both states animate');
  for (const rule of glowCss.match(/animation:chat-glow-\w+ ([\d.]+)s/g) ?? []) {
    assert.ok(Number(/([\d.]+)s/.exec(rule)[1]) >= 3, 'the pulse is slow, never a flash');
  }
  const reduced = glowCss.slice(glowCss.indexOf('@media(prefers-reduced-motion:reduce)'));
  assert.match(reduced, /animation:none/);
  assert.ok(reduced.includes('data-chat-glow'), 'the chat glow itself is covered by the reduced motion rule');
});

test('every page that carries the chat tab also loads the glow', () => {
  for (const page of ['index.html', 'members.html', 'people.html', 'profile.html', 'photos.html', 'top25.html',
    'member-photos.html', 'edit-profile.html']) {
    const html = fs.readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
    assert.match(html, /<script src="\/chat-glow\.js\?v=[^"]+" defer><\/script>/, page);
    assert.ok(/nav-chat/.test(html), `${page} shows a chat tab`);
  }
  const build = fs.readFileSync(new URL('../build.mjs', import.meta.url), 'utf8');
  assert.ok(build.includes("'chat-glow.js'"), 'the glow ships with the site');
});
