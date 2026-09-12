import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync, readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = name => readFileSync(resolve(root, name), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const member = {id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', verified_owner: false};

class Node {
  constructor(kind) {this.kind = kind; this.hidden = false; this.children = []; this.attributes = {}; this.dataset = {};}
  append(node) {this.children.push(node);}
  querySelector() {return null;}
  setAttribute(name, value) {this.attributes[name] = value;}
  removeAttribute(name) {delete this.attributes[name];}
}

// The header is built from four kinds of link: the desktop and mobile door
// buttons, footer door links, and the account links. Every one of them has to
// agree about who is looking at the page.
function header(reply, remembered = null, page = 'https://jwhitedidit.net/profile.html') {
  const store = new Map(remembered ? [['roster-session-hint-v1', remembered]] : []);
  const nodes = {
    navJoin: new Node('.nav-join'),
    mobileJoin: new Node('.mobile-nav-join'),
    footerJoin: new Node('[data-roster-join]'),
    account: new Node('[data-roster-account]'),
  };
  nodes.account.hidden = true;
  const body = new Node('body');
  let ready;
  const document = {
    body, readyState: 'loading', visibilityState: 'visible',
    querySelector: () => null,
    querySelectorAll: selector => selector.includes('nav-join')
      ? [nodes.navJoin, nodes.mobileJoin, nodes.footerJoin]
      : selector === '[data-roster-account]' ? [nodes.account] : [],
    addEventListener(type, listener) {if (type === 'DOMContentLoaded') ready = listener;},
    createElement: () => new Node('created'),
  };
  const current = new URL(page);
  const replacements = [];
  const location = {
    href: current.href, pathname: current.pathname, search: current.search,
    origin: current.origin, replace(value) {replacements.push(value);},
  };
  const context = {
    window: {addEventListener() {}}, document,
    location,
    sessionStorage: {getItem: () => null, setItem() {}},
    localStorage: {getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value)},
    crypto: {randomUUID: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},
    AbortController, URL, URLSearchParams, encodeURIComponent,
    fetch: async () => reply(),
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1,
  };
  vm.runInNewContext(read('community.js'), context);
  ready();
  return {nodes, body, context, store, replacements};
}

const conflict = nodes => nodes.account.hidden === false
  && [nodes.navJoin, nodes.mobileJoin, nodes.footerJoin].some(node => node.hidden === false);

test('an approved member sees their account and never the invite door beside it', async () => {
  const env = header(() => ({ok: true, status: 200, json: async () => ({profile: member})}));
  assert.equal(conflict(env.nodes), false, 'not even the first paint may show both');
  await tick(); await tick();
  assert.equal(env.body.dataset.rosterSession, 'member');
  assert.equal(env.nodes.account.hidden, false, 'a member must be able to reach their account');
  for (const key of ['navJoin', 'mobileJoin', 'footerJoin']) assert.equal(env.nodes[key].hidden, true, `${key} must be hidden from a member`);
  assert.equal(conflict(env.nodes), false);
});

test('approved login returns to My Profile from both clean and html member URLs', async () => {
  for (const path of ['/members?open=profile', '/members.html?open=profile']) {
    const env = header(() => ({ok:true,status:200,json:async()=>({profile:member})}), null, `https://jwhitedidit.net${path}`);
    await tick(); await tick();
    assert.deepEqual(env.replacements, ['/my-profile.html'], path);
  }
  for (const path of ['/members?open=photos', '/members.html?open=photos']) {
    const env = header(() => ({ok:true,status:200,json:async()=>({profile:member})}), null, `https://jwhitedidit.net${path}`);
    await tick(); await tick();
    assert.deepEqual(env.replacements, ['/my-profile.html?view=photos'], path);
  }
});

test('a signed out visitor keeps a way in and is never offered an account', async () => {
  const env = header(() => ({ok: false, status: 401, json: async () => ({error: 'Please log in to open your messages.'})}));
  await tick(); await tick();
  assert.equal(env.body.dataset.rosterSession, 'guest');
  for (const key of ['navJoin', 'mobileJoin', 'footerJoin']) assert.equal(env.nodes[key].hidden, false, `${key} is how a visitor gets in`);
  assert.equal(env.nodes.account.hidden, true);
  assert.equal(conflict(env.nodes), false);
});

test('non-JSON gate responses still clear a stale signed-in header', async () => {
  for (const status of [401, 403]) {
    const env = header(() => ({
      ok:false, status,
      json:async () => { throw new SyntaxError('edge response was not JSON'); },
    }), 'member');
    await tick(); await tick();
    assert.equal(env.body.dataset.rosterSession, 'guest', String(status));
    assert.equal(env.nodes.navJoin.hidden, false, String(status));
    assert.equal(env.nodes.account.hidden, true, String(status));
    assert.equal(conflict(env.nodes), false);
  }
});

test('a member awaiting approval is sent to the door, not to an account they do not have', async () => {
  const env = header(() => ({ok: false, status: 403, json: async () => ({error: 'Your request to join ROOSTER is waiting on approval.'})}));
  await tick(); await tick();
  assert.equal(env.body.dataset.rosterSession, 'guest');
  assert.equal(env.nodes.navJoin.hidden, false);
  assert.equal(env.nodes.account.hidden, true);
});

test('a session outage still resolves to one honest header instead of both', async () => {
  const env = header(() => ({ok: false, status: 503, json: async () => ({error: 'Service unavailable'})}));
  await tick(); await tick();
  assert.equal(env.nodes.account.hidden, true, 'an unproven session cannot claim an account');
  assert.equal(conflict(env.nodes), false);

  // An outage is not an answer: it must not log a member out of their header,
  // and it must not overwrite what the last real answer established.
  const known = header(() => ({ok: false, status: 503, json: async () => ({error: 'Service unavailable'})}), 'member');
  await tick(); await tick();
  assert.equal(known.body.dataset.rosterSession, 'member');
  assert.equal(known.nodes.navJoin.hidden, true);
  assert.equal(known.store.get('roster-session-hint-v1'), 'member');
  assert.equal(conflict(known.nodes), false);
  // Logging in later has to repair the header without a page reload.
  env.context.window.JWhiteCommunity.setUser(member);
  assert.equal(env.body.dataset.rosterSession, 'member');
  assert.equal(env.nodes.navJoin.hidden, true);
  assert.equal(env.nodes.account.hidden, false);
  env.context.window.JWhiteCommunity.setUser(null);
  assert.equal(env.nodes.account.hidden, true);
  assert.equal(env.nodes.navJoin.hidden, false);
});

test('a returning member gets their own header on the first paint, and a stale guess self corrects', async () => {
  const known = header(() => ({ok: true, status: 200, json: async () => ({profile: member})}), 'member');
  assert.equal(known.body.dataset.rosterSession, 'member', 'a returning member should not watch the door flash by');
  assert.equal(known.nodes.navJoin.hidden, true);
  assert.equal(conflict(known.nodes), false);
  await tick(); await tick();
  assert.equal(known.store.get('roster-session-hint-v1'), 'member');

  // Signing out elsewhere leaves the guess behind; the server answer wins.
  const stale = header(() => ({ok: false, status: 401, json: async () => ({error: 'Please log in.'})}), 'member');
  assert.equal(stale.nodes.account.hidden, false);
  assert.equal(conflict(stale.nodes), false);
  await tick(); await tick();
  assert.equal(stale.body.dataset.rosterSession, 'guest');
  assert.equal(stale.nodes.account.hidden, true);
  assert.equal(stale.nodes.navJoin.hidden, false);
  assert.equal(stale.store.get('roster-session-hint-v1'), 'guest', 'the corrected answer replaces the guess');
});

test('a first time visitor sees the door immediately with no nav jump', async () => {
  const env = header(() => ({ok: false, status: 401, json: async () => ({error: 'Please log in.'})}));
  assert.equal(env.body.dataset.rosterSession, 'guest');
  for (const key of ['navJoin', 'mobileJoin', 'footerJoin']) assert.equal(env.nodes[key].hidden, false, `${key} must be there on the first paint`);
  assert.equal(env.nodes.account.hidden, true);
  await tick(); await tick();
  for (const key of ['navJoin', 'mobileJoin', 'footerJoin']) assert.equal(env.nodes[key].hidden, false, `${key} must not move once the session resolves`);
});

test('every page carrying a door link loads the script that resolves the session', () => {
  const pages = readdirSync(root).filter(name => name.endsWith('.html') && name !== 'music-player-fragment.html');
  let doors = 0;
  for (const page of pages) {
    const source = read(page);
    if (!/nav-join|data-roster-join|data-roster-account/.test(source)) continue;
    doors += 1;
    assert.match(source, /community\.js/, `${page} shows a door or account link with nothing to decide which`);
  }
  assert.ok(doors > 0, 'at least one door page must be exercised; every matching page is checked above');
  // Account links ship hidden so a page with broken JavaScript shows the door
  // rather than an account the visitor may not have.
  for (const page of pages) {
    for (const tag of read(page).match(/<a[^>]*data-roster-account[^>]*>/g) ?? []) {
      assert.match(tag, /\bhidden\b/, `${page}: ${tag} must start hidden`);
    }
  }
});

test('the hidden state actually removes the door, overriding the mobile display rule', () => {
  const css = read('style.css');
  assert.match(css, /\.nav-join\[hidden\][^{]*\{display:none!important\}/);
  for (const selector of ['.mobile-nav-join[hidden]', '[data-roster-join][hidden]', '[data-roster-account][hidden]']) {
    assert.ok(css.includes(selector), `style.css must enforce ${selector}`);
  }
});
