import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';

const source = readFileSync(new URL('../owner-access.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const owner = {id:'owner-id', confirmedAt:'2026-09-05T10:00:00Z'};
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
};

async function environment({user = null, data = {can_edit_owner:false}, pending = null, pendingUser = null} = {}) {
  const link = {hidden:true};
  const calls = [];
  const events = {};
  const docEvents = {};
  let authChange;
  const document = {hidden:false, querySelector:() => link, addEventListener:(name, listener) => { docEvents[name] = listener; }};
  vm.runInNewContext(source, {
    document,
    window:{addEventListener:(name, listener) => { events[name] = listener; }},
    AUTH_EVENTS:{LOGOUT:'logout'},
    getUser:() => pendingUser || Promise.resolve(user),
    onAuthChange:listener => { authChange = listener; },
    AbortController, setTimeout, clearTimeout,
    fetch:async (path, options) => {
      calls.push({path, options});
      return pending || {ok:true, json:async () => data};
    },
  });
  await tick();
  return {link, calls, events, docEvents, document, authChange};
}

test('public HTML and CSS keep the edit link hidden before JavaScript loads', () => {
  assert.match(html, /<a\b[^>]*class="profile-edit-link"[^>]*\bhidden(?:\s|>)/);
  assert.match(css, /\.profile-edit-link\[hidden\]\s*\{\s*display\s*:\s*none\s*!important\s*;?\s*\}/);
});

test('visitors and unconfirmed users never request owner access or see the edit link', async () => {
  for (const user of [null, {id:owner.id}, {...owner, confirmedAt:'invalid'}]) {
    const state = await environment({user});
    assert.equal(state.link.hidden, true);
    assert.equal(state.calls.length, 0);
  }
});

test('only server confirmed owner access for the signed in account reveals the edit link', async () => {
  for (const data of [
    {can_edit_owner:false, profile:{id:owner.id}},
    {can_edit_owner:'true', profile:{id:owner.id}},
    {can_edit_owner:true, profile:{id:'another-id'}},
    {can_edit_owner:true},
  ]) {
    const state = await environment({user:owner, data});
    assert.equal(state.link.hidden, true);
  }
  const accepted = await environment({user:owner, data:{can_edit_owner:true, profile:{id:owner.id}}});
  assert.equal(accepted.link.hidden, false);
  assert.equal(accepted.calls[0].path, '/api/profile/me');
  assert.equal(accepted.calls[0].options.credentials, 'same-origin');
  assert.equal(accepted.calls[0].options.cache, 'no-store');
});

test('logout aborts a pending owner check and a late response cannot reveal the edit link', async () => {
  const request = deferred();
  const state = await environment({user:owner, pending:request.promise});
  state.authChange('logout', null);
  assert.equal(state.calls[0].options.signal.aborted, true);
  request.resolve({ok:true, json:async () => ({can_edit_owner:true, profile:{id:owner.id}})});
  await tick();
  assert.equal(state.link.hidden, true);
});

test('leaving the page ignores a late session and immediately hides a visible owner link', async () => {
  const session = deferred();
  const pending = await environment({pendingUser:session.promise});
  pending.events.pagehide();
  session.resolve(owner);
  await tick();
  assert.equal(pending.calls.length, 0);
  assert.equal(pending.link.hidden, true);
  const accepted = await environment({user:owner, data:{can_edit_owner:true, profile:{id:owner.id}}});
  accepted.events.pagehide();
  assert.equal(accepted.link.hidden, true);
});
