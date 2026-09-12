import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';

const source = fs.readFileSync(new URL('../media-menu.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const settled = async () => { for (let i = 0; i < 8; i++) await tick(); };
const photoId = 'a'.repeat(64);
const mine = '11111111-1111-4111-8111-111111111111';
const theirs = '22222222-2222-4222-8222-222222222222';

function environment({viewer = {profile: {id: mine}, can_edit_owner: false}, viewerStatus = 200} = {}) {
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag; this.children = []; this.parentNode = null; this.className = ''; this.textContent = '';
      this.hidden = false; this.disabled = false; this.open = false; this.attrs = {}; this.listeners = {}; this.focused = 0;
    }
    append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } }
    remove() { const list = this.parentNode?.children; if (list) list.splice(list.indexOf(this), 1); this.parentNode = null; }
    setAttribute(key, value) { this.attrs[key] = String(value); }
    getAttribute(key) { return Object.hasOwn(this.attrs, key) ? this.attrs[key] : null; }
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
    focus() { this.focused += 1; }
    contains(node) { for (let walk = node; walk; walk = walk.parentNode) if (walk === this) return true; return false; }
    get descendants() { return this.children.flatMap(child => [child, ...child.descendants]); }
    querySelector(selector) {
      const direct = selector.startsWith(':scope > ');
      const cls = selector.replace(':scope > ', '').replace('.', '');
      return (direct ? this.children : this.descendants).find(node => node.className === cls) || null;
    }
    showModal() { this.open = true; }
    close() { if (!this.open) return; this.open = false; this.fire('close'); }
    fire(type, event = {}) {
      for (const fn of [...(this.listeners[type] ?? [])]) fn({preventDefault() {}, stopPropagation() {}, target: this, ...event});
    }
  }
  const body = new Element('body');
  const documentListeners = {};
  const document = {
    body,
    createElement: tag => new Element(tag),
    addEventListener: (type, fn) => { (documentListeners[type] ??= []).push(fn); },
  };
  let now = 0; let token = 0; const timers = new Map();
  const clock = {
    setTimeout: (fn, ms) => { timers.set(++token, {fn, at: now + ms, every: null}); return token; },
    setInterval: (fn, ms) => { timers.set(++token, {fn, at: now + ms, every: ms}); return token; },
    clear: id => timers.delete(id),
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, entry] = due;
        now = entry.at;
        if (entry.every) entry.at = now + entry.every; else timers.delete(id);
        entry.fn();
      }
      now = until;
    },
  };
  const calls = []; const queue = [];
  const respond = (data, status = 200) => ({ok: status >= 200 && status < 300, status, json: async () => data});
  const fetch = async (path, options = {}) => {
    calls.push({path, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null});
    if (path === '/api/profile/me') return respond(viewer, viewerStatus);
    const next = queue.shift();
    if (!next) throw new Error(`No queued response for ${path}`);
    return next;
  };
  const enqueue = (data, status = 200) => queue.push(respond(data, status));
  const win = {};
  const context = vm.createContext({
    window: win, document, fetch, AbortController, Promise,
    setTimeout: clock.setTimeout, clearTimeout: clock.clear, setInterval: clock.setInterval, clearInterval: clock.clear,
    HTMLDialogElement: class {},
  });
  vm.runInContext(source, context);
  const find = cls => body.descendants.find(node => node.className === cls) || null;
  const menuOf = host => host.children.find(node => node.className === 'media-menu');
  return {media: win.RosterMedia, document, documentListeners, body, calls, enqueue, clock, find, menuOf, Element};
}
const host = env => { const node = new env.Element('figure'); env.body.append(node); return node; };
const photo = (member = mine) => ({kind: 'photo', id: photoId, member_id: member});

async function attached(env, item = photo()) {
  const card = host(env);
  env.media.attach(card, item);
  await settled();
  const menu = env.menuOf(card);
  return {card, menu, del: menu.children[0]};
}
async function asked(env, item = photo()) {
  const parts = await attached(env, item);
  parts.del.fire('click');
  await settled();
  return {...parts, dialog: env.find('media-confirm')};
}
const removal = () => ({removed: [{kind: 'photo', id: photoId, member_id: mine, label: 'Photo'}], failed: [], undo_seconds: 8, purge_after_seconds: 31});

test('a clear Delete button appears directly on a member’s own photo', async () => {
  const env = environment();
  const {menu, del} = await attached(env);
  assert.equal(menu.hidden, false);
  assert.equal(del.attrs['aria-label'], 'Delete this photo');
  assert.equal(del.className, 'media-delete-direct');
  assert.equal(del.textContent, 'Delete');
});

test('the menu stays away from another member’s photo and appears for the admin', async () => {
  const guest = environment();
  const card = host(guest);
  guest.media.attach(card, photo(theirs));
  await settled();
  assert.equal(guest.menuOf(card).hidden, true);

  const admin = environment({viewer: {profile: {id: mine}, can_edit_owner: true}});
  const theirCard = host(admin);
  admin.media.attach(theirCard, photo(theirs));
  await settled();
  assert.equal(admin.menuOf(theirCard).hidden, false);
});

test('a signed out visitor is never shown a Delete button', async () => {
  const env = environment({viewer: null, viewerStatus: 401});
  const card = host(env);
  env.media.attach(card, photo());
  await settled();
  assert.equal(env.menuOf(card).hidden, true);
  assert.deepEqual(env.calls.map(call => call.path), ['/api/profile/me']);
});

test('Delete asks "Are you sure you want to remove this?" with Remove and Cancel', async () => {
  const env = environment();
  const {dialog} = await asked(env);
  assert.equal(dialog.open, true);
  assert.equal(dialog.children[0].textContent, 'Are you sure you want to remove this?');
  const [remove, cancel] = dialog.children[2].children;
  assert.equal(remove.textContent, 'Remove');
  assert.equal(cancel.textContent, 'Cancel');
  assert.equal(env.calls.length, 1);
});

test('Cancel keeps the photo and sends nothing', async () => {
  const env = environment();
  const {dialog} = await asked(env);
  dialog.children[2].children[1].fire('click');
  await settled();
  assert.equal(dialog.open, false);
  assert.deepEqual(env.calls.map(call => call.path), ['/api/profile/me']);
});

test('Remove sends the removal, offers Undo, and tells the page to reload', async () => {
  const env = environment();
  let changed = 0;
  const card = host(env);
  env.media.attach(card, photo(), {onChanged: () => { changed += 1; }});
  await settled();
  const menu = env.menuOf(card);
  menu.children[0].fire('click');
  await settled();
  env.enqueue(removal());
  env.find('media-confirm').children[2].children[0].fire('click');
  await settled();

  const sent = env.calls.find(call => call.path === '/api/media/remove');
  assert.deepEqual(sent.body, {items: [{kind: 'photo', id: photoId, member_id: mine}]});
  assert.equal(sent.method, 'POST');
  assert.equal(changed, 1);
  const toast = env.find('media-toast');
  assert.equal(toast.hidden, false);
  assert.equal(toast.children[0].textContent, 'Photo removed.');
  assert.equal(toast.children[1].textContent, 'Undo (8)');
});

test('Undo puts the photo back and never clears the stored file', async () => {
  const env = environment();
  const {dialog} = await asked(env);
  env.enqueue(removal());
  dialog.children[2].children[0].fire('click');
  await settled();
  env.enqueue({restored: [{kind: 'photo', id: photoId}], failed: [], undo_seconds: 8, purge_after_seconds: 31});
  env.find('media-toast').children[1].fire('click');
  await settled();
  env.clock.advance(120000);
  await settled();

  const paths = env.calls.map(call => call.path);
  assert.deepEqual(paths.filter(path => path.startsWith('/api/media')), ['/api/media/remove', '/api/media/restore']);
  assert.equal(env.find('media-toast').hidden, true);
});

test('once the Undo offer goes the stored file is cleared', async () => {
  const env = environment();
  const {dialog} = await asked(env);
  env.enqueue(removal());
  dialog.children[2].children[0].fire('click');
  await settled();
  const toast = env.find('media-toast');

  env.clock.advance(5000);
  assert.equal(toast.hidden, false);
  assert.equal(toast.children[1].textContent, 'Undo (3)');

  env.enqueue({purged: 1, failed: [], undo_seconds: 8, purge_after_seconds: 31});
  env.clock.advance(4000);
  assert.equal(toast.hidden, true);
  env.clock.advance(31000);
  await settled();
  const purge = env.calls.find(call => call.path === '/api/media/purge');
  assert.deepEqual(purge.body, {items: [{kind: 'photo', id: photoId, member_id: mine}]});
});

test('a refused removal shows the reason the server gave', async () => {
  const env = environment();
  const {dialog} = await asked(env);
  env.enqueue({removed: [], failed: [{kind: 'photo', id: photoId, error: 'You can only remove your own photos.'}]}, 403);
  const messages = [];
  const card = host(env);
  env.media.attach(card, photo(), {onStatus: text => messages.push(text)});
  dialog.children[2].children[0].fire('click');
  await settled();
  assert.equal(env.find('media-toast').children[0].textContent, 'You can only remove your own photos.');
  assert.equal(env.find('media-toast').children[1].hidden, true);
  assert.ok(!messages.includes('Back in place. Nothing was lost.'));
});

test('several items are removed together and counted in the notice', async () => {
  const env = environment();
  const videoId = 'b'.repeat(64);
  const items = [photo(), {kind: 'video', id: videoId, member_id: mine}];
  const done = env.media.remove(items, {});
  await settled();
  env.enqueue({removed: [{kind: 'photo', id: photoId}, {kind: 'video', id: videoId}], failed: [], undo_seconds: 8, purge_after_seconds: 31});
  env.find('media-confirm').children[2].children[0].fire('click');
  await done;
  const dialog = env.find('media-confirm');
  assert.equal(dialog.children[0].textContent, 'Are you sure you want to remove these 2 items?');
  assert.equal(env.find('media-toast').children[0].textContent, '2 items removed.');
  const sent = env.calls.find(call => call.path === '/api/media/remove');
  assert.deepEqual(sent.body.items.map(item => item.kind), ['photo', 'video']);
});

test('nothing chosen means nothing asked', async () => {
  const env = environment();
  assert.equal(await env.media.remove([], {}), null);
  assert.equal(await env.media.remove([{kind: 'photo', id: 'not-a-real-id'}], {}), null);
  assert.equal(env.find('media-confirm'), null);
  assert.deepEqual(env.calls, []);
});
