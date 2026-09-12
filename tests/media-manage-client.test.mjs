import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';

const read = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const source = read('member-media.js').replace('export function createMemberMedia', 'function createMemberMedia');
const tick = () => new Promise(resolve => setImmediate(resolve));
const settled = async () => { for (let i = 0; i < 8; i++) await tick(); };
// The panel runs inside a vm, so its arrays and objects belong to another
// realm. Compare their contents rather than their prototypes.
const plain = value => JSON.parse(JSON.stringify(value));
const mine = '11111111-1111-4111-8111-111111111111';
const theirs = '22222222-2222-4222-8222-222222222222';
const photoId = 'a'.repeat(64);
const clipId = 'b'.repeat(64);
const otherPhotoId = 'c'.repeat(64);

const listing = (overrides = {}) => ({
  member_id: mine, is_admin: false, viewer_id: mine, photo_limit: 10, undo_seconds: 8, purge_after_seconds: 31,
  photos: [
    {kind: 'photo', id: photoId, member_id: mine, url: `/api/member-album-photo/${mine}/0/${photoId}`, caption: 'Studio night', created_at: '2026-09-05T22:00:00Z', width: 24, height: 24},
    {kind: 'photo', id: otherPhotoId, member_id: mine, url: `/api/member-album-photo/${mine}/1/${otherPhotoId}`, caption: '', created_at: '2026-09-05T22:05:00Z', width: 24, height: 24},
  ],
  videos: [
    {kind: 'video', id: clipId, member_id: mine, name: 'Alice', caption: 'A little inspiration', created_at: '2026-09-06T10:00:00Z', video_url: `/api/clip-video/${clipId}`, width: 720, height: 1280, duration: 12, published: true, status: 'approved'},
  ],
  ...overrides,
});

function environment() {
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag; this.children = []; this.parentNode = null; this.className = ''; this.textContent = '';
      this.hidden = false; this.disabled = false; this.checked = false; this.value = ''; this.dataset = {};
      this.attrs = {}; this.listeners = {}; this.paused = 0;
    }
    append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } }
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
    remove() { const list = this.parentNode?.children; if (list) list.splice(list.indexOf(this), 1); this.parentNode = null; }
    setAttribute(key, value) { this.attrs[key] = String(value); }
    removeAttribute(key) { delete this.attrs[key]; }
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
    focus() {}
    pause() { this.paused += 1; }
    load() {}
    get descendants() { return this.children.flatMap(child => [child, ...child.descendants]); }
    querySelector(selector) {
      const cls = selector.replace(':scope > ', '').replace('.', '');
      return (selector.startsWith(':scope > ') ? this.children : this.descendants).find(node => node.className === cls) || null;
    }
    fire(type, event = {}) { for (const fn of [...(this.listeners[type] ?? [])]) fn({preventDefault() {}, stopPropagation() {}, target: this, ...event}); }
  }
  const root = new Element('section');
  const document = {createElement: tag => new Element(tag), getElementById: id => (id === 'member-media-manage' ? root : null), addEventListener() {}};
  const calls = []; const queue = [];
  const respond = (data, status = 200) => ({ok: status >= 200 && status < 300, status, json: async () => data});
  const fetch = async (path, options = {}) => { calls.push({path, options}); const next = queue.shift(); if (!next) throw new Error(`No queued response for ${path}`); return next; };
  const enqueue = (data, status = 200) => queue.push(respond(data, status));
  const removals = [];
  const media = {attached: [], attach(hostNode, item, options) { this.attached.push({hostNode, item, options}); return null; },
    remove(items, options) { removals.push({items, options}); return Promise.resolve({}); }};
  const context = vm.createContext({window: {RosterMedia: media}, document, fetch, AbortController, setTimeout, clearTimeout, Promise});
  vm.runInContext(`${source}\nthis.panel=createMemberMedia();`, context);
  const find = cls => root.descendants.find(node => node.className === cls) || null;
  const button = text => root.descendants.find(node => node.tagName === 'button' && node.textContent === text) || null;
  const cards = () => root.descendants.filter(node => node.className === 'media-manage-card');
  return {panel: context.panel, root, calls, enqueue, media, removals, find, button, cards, Element};
}
async function loaded(env = environment(), data = listing()) {
  env.enqueue(data);
  env.panel.setUser({id: mine, confirmedAt: '2026-09-01T00:00:00Z'});
  await settled();
  return env;
}

test('Manage Media lists every photo and video the member uploaded', async () => {
  const env = await loaded();
  assert.equal(env.calls[0].path, '/api/media/manage');
  assert.equal(env.cards().length, 3);
  assert.equal(env.find('media-manage-grid').children.length, 2);
  assert.match(env.find('media-manage-status').textContent, /^3 items\. Tick anything you want gone/);
  assert.deepEqual(env.media.attached.map(entry => entry.item.id), [photoId, otherPhotoId, clipId]);
});

test('Select All then Remove Selected sends the whole selection once', async () => {
  const env = await loaded();
  env.button('Select All').fire('click');
  assert.equal(env.find('media-manage-count').textContent, '3 selected.');
  env.button('Remove Selected').fire('click');
  await settled();
  assert.equal(env.removals.length, 1);
  assert.deepEqual(plain(env.removals[0].items), [
    {kind: 'photo', id: photoId, member_id: mine},
    {kind: 'photo', id: otherPhotoId, member_id: mine},
    {kind: 'video', id: clipId, member_id: mine},
  ]);
});

test('only the ticked photos and videos are removed', async () => {
  const env = await loaded();
  const boxes = env.cards().map(card => card.children[0].children[0]);
  boxes[0].checked = true; boxes[0].fire('change');
  boxes[2].checked = true; boxes[2].fire('change');
  assert.equal(env.find('media-manage-count').textContent, '2 selected.');
  env.button('Remove Selected').fire('click');
  await settled();
  assert.deepEqual(plain(env.removals[0].items).map(item => item.id), [photoId, clipId]);

  env.button('Clear').fire('click');
  assert.equal(env.find('media-manage-count').textContent, 'Nothing selected.');
  assert.equal(env.button('Remove Selected').disabled, true);
});

test('Remove Selected does nothing until something is ticked', async () => {
  const env = await loaded();
  assert.equal(env.button('Remove Selected').disabled, true);
  env.button('Remove Selected').fire('click');
  await settled();
  assert.deepEqual(plain(env.removals), []);
});

test('a removal refreshes the list so nothing removed comes back', async () => {
  const env = await loaded();
  env.button('Select All').fire('click');
  env.button('Remove Selected').fire('click');
  await settled();
  env.enqueue(listing({photos: [], videos: []}));
  env.removals[0].options.onChanged();
  await settled();
  assert.equal(env.cards().length, 0);
  assert.match(env.find('media-manage-status').textContent, /have not uploaded any photos or videos/);
});

test('the admin can load another member’s uploads; a member cannot', async () => {
  const member = await loaded();
  assert.equal(member.find('media-manage-admin').hidden, true);

  const admin = await loaded(environment(), listing({is_admin: true}));
  const panel = admin.find('media-manage-admin');
  assert.equal(panel.hidden, false);
  const field = panel.descendants.find(node => node.tagName === 'input');
  field.value = `https://jwhitedidit.net/profile.html?id=${theirs}`;
  admin.enqueue(listing({member_id: theirs, is_admin: true, viewer_id: mine, videos: []}));
  admin.button('Open Their Media').fire('click');
  await settled();
  assert.equal(admin.calls.at(-1).path, `/api/media/manage?member=${theirs}`);
  assert.match(admin.find('media-manage-status').textContent, /somebody else’s uploads as the admin/);
});

test('a rubbish member reference is refused before any request is made', async () => {
  const admin = await loaded(environment(), listing({is_admin: true}));
  const before = admin.calls.length;
  admin.find('media-manage-admin').descendants.find(node => node.tagName === 'input').value = 'somebody';
  admin.button('Open Their Media').fire('click');
  await settled();
  assert.equal(admin.calls.length, before);
  assert.match(admin.find('media-manage-status').textContent, /Paste a member ID or a link/);
});

test('a list that cannot load says so and offers a refresh', async () => {
  const env = environment();
  env.enqueue({error: 'Your photos and videos could not connect. Please try again in a moment.'}, 503);
  env.panel.setUser({id: mine, confirmedAt: '2026-09-01T00:00:00Z'});
  await settled();
  assert.equal(env.find('media-manage-status').textContent, 'Your photos and videos could not connect. Please try again in a moment.');
  assert.equal(env.cards().length, 0);
  env.enqueue(listing());
  env.button('Refresh').fire('click');
  await settled();
  assert.equal(env.cards().length, 3);
});

test('signing out empties the panel and asks the visitor to log in', async () => {
  const env = await loaded();
  env.panel.setUser(null);
  assert.equal(env.cards().length, 0);
  assert.equal(env.find('media-manage-status').textContent, 'Log in to manage your photos and videos.');
});

test('the delete menu and Manage Media ship with the site', () => {
  const build = read('build.mjs');
  for (const file of ['media-menu.js', 'media-manage.css']) assert(build.includes(`'${file}'`), file);
  for (const page of ['members.html', 'profile.html', 'member-photos.html', 'index.html']) {
    const html = read(page);
    assert(html.includes('media-menu.js'), `${page} loads the delete menu`);
    assert(html.includes('media-manage.css'), `${page} loads the media styles`);
  }
  const members = read('members.html');
  assert(members.includes('data-account-go="media" href="#member-media-manage"'));
  assert(members.includes('id="member-media-manage"'));
  assert(members.includes('>Manage Media<'));
  const script = read('members.js');
  assert(script.includes("media: 'member-media-manage'"));
  assert(script.includes("media: '#member-media-manage'"));
  assert(script.includes('mediaManager.setUser'));
  assert(read('members.css').includes('[data-account-tool="media"]>[data-account-panel="media"]'));
  // The old confirm() prompt and the standalone Remove Photo button are gone.
  assert(!read('member-album.js').includes('Remove this photo from your album?'));
  assert(read('member-album.js').includes('RosterMedia?.attach'));
  assert(read('profile-album.js').includes('RosterMedia?.attach'));
  assert(read('short-clips.js').includes('RosterMedia?.attach'));
});
