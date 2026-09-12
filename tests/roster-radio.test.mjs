import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const root = new URL('../', import.meta.url);
const navigationPages = [
  'about.html','apply.html','edit-profile.html','index.html','live.html',
  'member-photos.html','members.html','morespace.html','opportunities.html',
  'people.html','photos.html','profile.html','top25.html'
];

test('ORBIT ships eight real Live365 broadcast choices', async () => {
  const page = await readFile(new URL('radio.html', root), 'utf8');
  const script = await readFile(new URL('radio.js', root), 'utf8');
  assert.match(page, /<h1 id="radio-heading">ORBIT<\/h1>/);
  assert.match(page, /https:\/\/live365\.com\/embed\/player\.html\?station=a41301&amp;s=md&amp;m=dark/);
  assert.match(page, /allow="autoplay"/);
  assert.match(page, /role="tablist" aria-label="ROOSTER RADIO stations"/);
  for (const key of ['all', 'hiphop', 'pop', 'sports', 'throwbacks', 'gospel', 'jazz', 'country']) {
    assert.match(page, new RegExp(`data-radio-channel="${key}"`));
  }
  for (const station of ['a41301', 'a41306', 'a67989', 'a83286', 'a30553', 'a45349', 'a74112', 'a01458']) {
    assert.match(script, new RegExp(`station: '${station}'`));
  }
  assert.match(script, /window\.history\.replaceState/);
  assert.match(script, /ArrowRight/);
  assert.doesNotMatch(page, /placeholder|demo audio/i);
});

test('ORBIT is live radio only and personal songs live on Profile Music', async () => {
  const [page, home, profile] = await Promise.all([
    readFile(new URL('radio.html', root), 'utf8'),
    readFile(new URL('index.html', root), 'utf8'),
    readFile(new URL('profile.html', root), 'utf8'),
  ]);
  assert.doesNotMatch(page, /id="music-library"|id="retro-player"|src="\/music\.js/);
  assert.match(page, /ROOSTER LIVE RADIO/);
  assert.doesNotMatch(home, /src="\/roster-player\.js/);
  assert.match(home, /href="\/my-profile\.html\?view=songs">Profile Music/);
  assert.match(profile, /data-profile-tab="songs"[^>]*>Profile Music/);
  assert.match(profile, /profile-songs\.js/);
});

test('choosing a channel replaces the player, labels, source and shareable URL together', async () => {
  const source = await readFile(new URL('radio.js', root), 'utf8');
  const listeners = new Map();
  const buttons = ['all', 'hiphop', 'pop', 'sports', 'throwbacks', 'gospel', 'jazz', 'country'].map(key => ({
    id: `radio-channel-${key}`,
    dataset: {radioChannel: key},
    tabIndex: key === 'all' ? 0 : -1,
    attributes: {},
    classList: {toggle() {}},
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(type, listener) { listeners.set(`${key}:${type}`, listener); },
    focus() { this.focused = true; },
  }));
  const nodes = {
    '#radio-player': {dataset: {station: 'a41301'}, src: '', title: ''},
    '#radio-station-panel': {setAttribute(name, value) { this[name] = value; }},
    '#radio-format-label': {textContent: ''},
    '#radio-mix-heading': {textContent: ''},
    '#radio-description-copy': {textContent: ''},
    '#radio-popout': {href: ''},
    '#radio-source-name': {textContent: ''},
  };
  const history = [];
  const window = {
    location: {href: 'https://jwhitedidit.net/radio'},
    history: {replaceState(_state, _title, url) { history.push(String(url)); }},
  };
  const document = {
    querySelectorAll(selector) { return selector === '[data-radio-channel]' ? buttons : []; },
    querySelector(selector) { return nodes[selector] || null; },
  };

  runInNewContext(source, {document, window, URL, URLSearchParams, encodeURIComponent, Object});
  listeners.get('hiphop:click')();

  assert.equal(nodes['#radio-player'].dataset.station, 'a41306');
  assert.match(nodes['#radio-player'].src, /station=a41306/);
  assert.equal(nodes['#radio-format-label'].textContent, 'HIP-HOP + R&B');
  assert.equal(nodes['#radio-mix-heading'].textContent, 'WIRE 2 WIRE');
  assert.equal(nodes['#radio-source-name'].textContent, 'WIRE 2 WIRE RADIO');
  assert.match(nodes['#radio-popout'].href, /a41306/);
  assert.equal(buttons[1].attributes['aria-selected'], 'true');
  assert.match(history.at(-1), /station=hiphop/);
});

test('every full navigation includes the permanent RADIO tab', async () => {
  for (const file of navigationPages) {
    const page = await readFile(new URL(file, root), 'utf8');
    const links = page.match(/(?:class="nav-radio" )?href="\/radio\.html"/g) || [];
    assert.ok(links.length >= 1, `${file} includes the radio tab`);
  }
});

test('production build copies the radio page and styling', async () => {
  const build = await readFile(new URL('build.mjs', root), 'utf8');
  assert.match(build, /'radio\.html'/);
  assert.match(build, /'radio\.css'/);
  assert.match(build, /'radio\.js'/);
});
