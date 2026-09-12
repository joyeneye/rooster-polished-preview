import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';

const html = fs.readFileSync(new URL('../members.html', import.meta.url), 'utf8');
const source = fs.readFileSync(new URL('../members.js', import.meta.url), 'utf8')
  .replace(/^import [\s\S]*? from '[^']+';\n/gm, '');
const tick = () => new Promise(resolve => setImmediate(resolve));
const member = {id: 'owner-id', email: 'owner@example.test', confirmedAt: '2026-09-05T10:00:00Z'};

class Element {
  constructor() {
    this.hidden = false;
    this.value = '';
    this.type = '';
    this.textContent = '';
    this.href = '';
    this.dataset = {};
    this.listeners = {};
    this.attributes = {};
    this.queries = {};
    this.open = false;
  }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  setCustomValidity() {}
  focus() {}
  select() {}
  setSelectionRange() {}
  scrollIntoView() {}
  reportValidity() { return true; }
  reset() {}
  querySelectorAll(selector) { return this.queries[selector] || []; }
  querySelector(selector) { return (this.queries[selector] || [])[0] || null; }
  insertBefore(node) { return node; }
}

async function environment({
  loginFailure = false,
  mode = 'invite',
  initialHash = mode === 'invite' ? '#invite_token=test-invite' : '',
  identitySettings = {disableSignup: false, autoconfirm: false},
  approved = true,
} = {}) {
  const ids = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(match => [match[1], new Element()]));
  const passwordInputs = ['login-password', 'signup-password', 'signup-confirm', 'reset-password', 'reset-confirm']
    .map(id => ids[id]);
  for (const input of passwordInputs) input.type = 'password';
  const passwordToggles = [...html.matchAll(/data-toggle-password="([^"]+)"[^>]*>([^<]*)<\/button>/g)].map((match) => {
    const toggle = new Element();
    toggle.dataset.togglePassword = match[1];
    toggle.textContent = match[2].trim();
    toggle.setAttribute('aria-controls', match[1]);
    toggle.setAttribute('aria-pressed', 'false');
    return toggle;
  });
  const loginToggle = passwordToggles.find(toggle => toggle.dataset.togglePassword === 'login-password');
  const formPasswords = new Map([
    [ids['member-login-form'], [ids['login-password']]],
    [ids['member-signup-form'], [ids['signup-password'], ids['signup-confirm']]],
    [ids['member-forgot-form'], []],
    [ids['member-reset-form'], [ids['reset-password'], ids['reset-confirm']]],
  ]);
  for (const [form, inputs] of formPasswords) {
    form.queries['[data-password-input]'] = inputs;
    form.queries['[data-toggle-password]'] = passwordToggles.filter(toggle => inputs.some(input => input === ids[toggle.dataset.togglePassword]));
  }
  const views = [
    ['login', 'member-login'],
    ['signup', 'member-signup'],
    ['invite', 'invite-code'],
    ['request', 'request-invite'],
    ['forgot', 'member-forgot'],
    ['reset', 'member-reset'],
    ['account', 'member-account'],
  ].map(([memberView, id]) => {
    const element = ids[id];
    element.dataset.memberView = memberView;
    return element;
  });
  const calls = [];
  const accountLoads = [];
  const edits = [];
  const chatLink = new Element();
  const editLink = new Element();
  const location = {hash: initialHash, pathname: '/members.html', search: '', origin: 'https://jwhitedidit.net'};
  let authChange;
  let cookieEstablished = mode === 'signedin';
  let finishLogin;
  const loginReady = new Promise(resolve => { finishLogin = resolve; });
  const accessUsers = [];
  const controller = name => ({
    setUser(user) { if (user) accountLoads.push({name, cookieEstablished}); },
    requestEdit() { edits.push(name); },
  });
  vm.runInNewContext(source, {
    document: {
      getElementById: id => ids[id],
      querySelectorAll: selector => selector === '[data-member-view]' ? views
        : selector === '[data-open-chat]' ? [chatLink]
        : selector === '[data-edit-my-profile]' ? [editLink]
        : selector === '[data-toggle-password]' ? passwordToggles
        : selector === '.member-card form' ? [...formPasswords.keys()]
        : [],
      execCommand: () => true,
      addEventListener() {},
      body: {dataset: {}},
    },
    window: {
      location,
      history: {replaceState(state, title, url) {
        const next = new URL(url, location.origin);
        location.pathname = next.pathname;
        location.search = next.search;
        location.hash = next.hash;
      }},
      addEventListener() {},
      dispatchEvent() {},
    },
    navigator: {},
    CustomEvent: class CustomEvent {
      constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
    },
    URLSearchParams,
    encodeURIComponent,
    AUTH_EVENTS: {LOGIN: 'login', LOGOUT: 'logout', RECOVERY: 'recovery'},
    getSettings: async () => identitySettings,
    handleAuthCallback: async () => mode === 'invite' ? ({type: 'invite', token: 'test-invite', user: null}) : null,
    getUser: async () => mode === 'signedin' ? member : null,
    onAuthChange: listener => { authChange = listener; },
    acceptInvite: async (token, password) => {
      calls.push({action: 'acceptInvite', token, password});
      // Matches Identity 2.0: LOGIN is emitted, but nf_jwt is not set.
      authChange('login', member);
      return member;
    },
    login: async (email, password) => {
      calls.push({action: 'login', email, password});
      await loginReady;
      if (loginFailure) throw new Error('Connection unavailable');
      cookieEstablished = true;
      authChange('login', member);
      return member;
    },
    logout: async () => {}, requestPasswordRecovery: async () => {}, signup: async () => {}, updateUser: async () => {},
    createMemberInbox: () => controller('inbox'),
    createMemberProfileEditor: () => controller('profile'),
    createMemberVerification: () => controller('verification'),
    createMemberChat: () => controller('chat'),
    createMemberAlbum: () => controller('album'),
    createMemberMedia: () => controller('media'),
    createMemberClips: () => controller('clips'),
    createMemberSongs: () => controller('songs'),
    createMemberDiscovery: () => controller('discovery'),
    createMemberAnnouncements: () => controller('announcements'),
    createFounderAnnouncements: () => controller('founder-announcements'),
    musicGuideElement: () => new Element(),
    renderMusicGuide: () => null,
    // Stands in for the invite-only gate. The real one asks the server; here
    // the answer is fixed so a test can watch what an unapproved account gets.
    createRosterAccess: () => ({
      state: () => ({approved, signed_in: true, status: approved ? 'approved' : 'pending'}),
      isApproved: () => approved,
      isOwner: () => false,
      heldCode: () => '',
      refresh: async () => {},
      redeem: async () => approved,
      requestInvite: async () => true,
      setUser(user) { accessUsers.push(user?.id || null); },
    }),
  });
  await tick();
  ids['reset-password'].value = ids['reset-confirm'].value = 'test-password-123';
  const submit = () => ids['member-reset-form'].listeners.submit({preventDefault() {}, currentTarget: ids['member-reset-form']});
  return {
    ids, calls, accountLoads, submit, finishLogin, chatLink, editLink, location, edits,
    loginToggle, accessUsers,
  };
}

test('invite acceptance establishes SDK login cookies before opening private account panels', async () => {
  const e = await environment();
  e.submit();
  await tick();
  assert.deepEqual(e.calls.map(call => call.action), ['acceptInvite', 'login']);
  assert.equal(e.calls[1].email, member.email);
  assert.equal(e.calls[1].password, e.calls[0].password);
  assert.equal(e.accountLoads.length, 0);
  e.finishLogin();
  await tick();
  assert.equal(e.ids['member-account'].hidden, false);
  assert.deepEqual(e.accountLoads.map(load => load.name).sort(), ['album','announcements','chat','clips','discovery','founder-announcements','inbox','media','profile','songs','verification']);
  assert.ok(e.accountLoads.every(load => load.cookieEstablished));
});

test('a failed post-invite login returns to login without reusing the consumed invitation', async () => {
  const e = await environment({loginFailure: true});
  e.submit();
  e.finishLogin();
  await tick();
  assert.equal(e.ids['member-login'].hidden, false);
  assert.equal(e.ids['login-email'].value, member.email);
  assert.equal(e.accountLoads.length, 0);
  e.submit();
  await tick();
  assert.equal(e.calls.filter(call => call.action === 'acceptInvite').length, 1);
});

test('Chat Room entry preserves the destination through login and opens only after the verified session',async()=>{
  for(const direct of [true,false]){
    const e=await environment({mode:'login',initialHash:direct?'#member-chat':''});
    if(!direct)e.chatLink.listeners.click({preventDefault(){}});
    assert.equal(e.location.hash,'#member-chat');assert.equal(e.ids['chat-room'].open,false);
    assert.match(e.ids['member-destination-note'].textContent,/Log in to join/);
    e.ids['login-email'].value=member.email;e.ids['login-password'].value='test-only-password';
    e.ids['member-login-form'].listeners.submit({preventDefault(){},currentTarget:e.ids['member-login-form']});
    await tick();assert.equal(e.accountLoads.length,0);assert.equal(e.ids['chat-room'].open,false);
    e.finishLogin();await tick();
    assert.equal(e.ids['member-account'].hidden,false);assert.equal(e.ids['chat-room'].open,true);
    assert.ok(e.accountLoads.every(load=>load.cookieEstablished));
  }
});

test('signed-in shortcuts open the chat and profile editor instead of only scrolling',async()=>{
  const e=await environment({mode:'signedin'});
  e.chatLink.listeners.click({preventDefault(){}});assert.equal(e.ids['chat-room'].open,true);
  e.editLink.listeners.click();assert.deepEqual(e.edits,['profile']);
});

test('login password can be shown and hidden, then submit cleanup clears and conceals it', async () => {
  const e = await environment({mode: 'login'});
  const password = e.ids['login-password'];
  const toggle = e.loginToggle;

  assert.ok(toggle, 'the login Show password control is available');
  assert.equal(password.type, 'password');
  assert.equal(toggle.textContent, 'Show password');
  assert.equal(toggle.getAttribute('aria-pressed'), 'false');

  toggle.listeners.click();
  assert.equal(password.type, 'text');
  assert.equal(toggle.textContent, 'Hide password');
  assert.equal(toggle.getAttribute('aria-pressed'), 'true');

  toggle.listeners.click();
  assert.equal(password.type, 'password');
  assert.equal(toggle.textContent, 'Show password');
  assert.equal(toggle.getAttribute('aria-pressed'), 'false');

  toggle.listeners.click();
  e.ids['login-email'].value = member.email;
  password.value = 'visible-test-password';
  e.ids['member-login-form'].listeners.submit({preventDefault() {}, currentTarget: e.ids['member-login-form']});
  await tick();
  assert.equal(password.type, 'text', 'the shown password stays available while login is pending');

  e.finishLogin();
  await tick();
  assert.equal(password.value, '', 'submit cleanup clears the password value');
  assert.equal(password.type, 'password', 'submit cleanup conceals the password again');
  assert.equal(toggle.textContent, 'Show password');
  assert.equal(toggle.getAttribute('aria-pressed'), 'false');
});

test('the two invite-only front doors each open one simple screen', async () => {
  const request = await environment({mode: 'login', initialHash: '#request-invite'});
  assert.equal(request.ids['request-invite'].hidden, false, 'Request an Invite opens the waiting-list screen');
  assert.equal(request.ids['invite-code'].hidden, true);

  const code = await environment({mode: 'login', initialHash: '#invite-code'});
  assert.equal(code.ids['invite-code'].hidden, false, 'Enter Invite Code opens the code screen');
  assert.equal(code.ids['request-invite'].hidden, true);
});

test('the signed-in launcher has one Requests tab and no invite-sharing tab', () => {
  const launcher = html.match(/<nav\b[^>]*id="member-account-launcher"[^>]*>([\s\S]*?)<\/nav>/)?.[1] || '';
  assert.ok(launcher, 'the account launcher is present');
  assert.equal((launcher.match(/data-account-go="friends"/g) || []).length, 1);
  assert.match(launcher, />Requests<\/a>/);
  assert.doesNotMatch(launcher, /Invite to the Roster|invite-people/);
  assert.doesNotMatch(html, /id="invite-(?:people|share|copy|email|link)"/);

  const ownerAdmin = html.match(/<section\b[^>]*id="roster-access-admin"[^>]*>/)?.[0] || '';
  const connectionRequests = html.match(/<section\b[^>]*id="friend-requests"[^>]*>/)?.[0] || '';
  assert.match(ownerAdmin, /data-account-panel="friends"/);
  assert.match(connectionRequests, /data-account-panel="friends"/);
});

test('a confirmed account that is not approved opens no member tool and is told why', async () => {
  const waiting = await environment({mode: 'signedin', approved: false});

  // Every private module is handed null, so nothing loads, and the tools and
  // the launcher are closed rather than showing a wall of refusals.
  assert.equal(waiting.accountLoads.length, 0, 'no member module receives a user while approval is pending');
  assert.deepEqual(waiting.accessUsers, ['owner-id'], 'the gate is told who is signed in so it can ask the server');

  // Logging out has to stay reachable for somebody stuck at the gate.
  assert.equal(waiting.ids['member-logout'].disabled, false);

  // Approval flips it: the same account, approved, opens every tool.
  const approved = await environment({mode: 'signedin', approved: true});
  assert.ok(approved.accountLoads.length >= 11, 'an approved account opens the member tools');
  assert.ok(approved.accountLoads.every(load => load.cookieEstablished));
});
