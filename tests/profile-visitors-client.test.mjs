import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';

const read = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const visitorsSource = read('visitors.js');
const chartSource = read('top25.js');
const weekSource = read('roster-week.js');
const tick = () => new Promise(resolve => setImmediate(resolve));
const settle = async () => {await tick(); await new Promise(resolve => setTimeout(resolve, 320)); await tick();};
const MEMBER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/* A very small DOM: attribute selectors and ids are all these scripts use. */
class Element {
  constructor(tag = 'div') {
    this.tagName = tag; this.hidden = false; this.textContent = ''; this.className = '';
    this.children = []; this.attrs = {}; this.listeners = {};
    this.classList = {add: name => {this.className = `${this.className} ${name}`.trim();}, remove: () => {}};
  }
  set id(value) {this._id = value; if (this.owner) this.owner.ids[value] = this;}
  get id() {return this._id;}
  append(...nodes) {this.children.push(...nodes);}
  replaceChildren(...nodes) {this.children = [...nodes];}
  setAttribute(key, value) {this.attrs[key] = String(value);}
  getAttribute(key) {return key in this.attrs ? this.attrs[key] : null;}
  addEventListener(type, fn) {(this.listeners[type] ??= []).push(fn);}
  fire(type) {for (const fn of this.listeners[type] ?? []) fn({preventDefault() {}, currentTarget: this});}
  get firstElementChild() {return this.children.find(node => node instanceof Element) ?? null;}
  get text() {
    return this.children.length
      ? this.children.map(node => (node instanceof Element ? node.text : String(node))).join('')
      : this.textContent;
  }
  descendants() {return this.children.flatMap(node => (node instanceof Element ? [node, ...node.descendants()] : []));}
  matches(selector) {
    const attribute = selector.match(/^\[([a-z0-9-]+)\]$/i);
    if (attribute) return attribute[1] in this.attrs;
    const id = selector.match(/^#([\w-]+)$/);
    return id ? this._id === id[1] : false;
  }
  querySelector(selector) {return this.descendants().find(node => node.matches(selector)) ?? null;}
}

function node(tag, attributes = {}, id = '') {
  const element = new Element(tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  if (id) element._id = id;
  return element;
}

function harness({markup, source, profile = undefined, saved = null, clock = false, responses = []}) {
  const page = new Element('body');
  page.append(...markup);
  const ids = {};
  for (const element of [page, ...page.descendants()]) if (element._id) ids[element._id] = element;
  const store = new Map(saved ? [['jspace.visitor', saved]] : []);
  const documentEvents = {}; const windowEvents = {};
  const document = {
    visibilityState: 'visible',
    querySelector: selector => page.querySelector(selector),
    getElementById: id => ids[id] ?? null,
    createElement: tag => new Element(tag),
    addEventListener: (type, fn) => {(documentEvents[type] ??= []).push(fn);},
  };
  const calls = []; const queue = [];
  const response = (data, status = 200) => ({ok: status >= 200 && status < 300, status, json: async () => data});
  const enqueue = (data, status = 200) => queue.push(() => Promise.resolve(response(data, status)));
  const fetch = async (path, options) => {
    calls.push({path, options, body: options?.body ? JSON.parse(options.body) : null});
    const next = queue.shift();
    if (!next) throw Error(`Unexpected request ${path}`);
    return next();
  };
  let now = 1_700_000_000_000; let serial = 0;
  const intervals = new Map();
  const timers = clock
    ? {
      setInterval: (fn, ms) => {const id = ++serial; intervals.set(id, {fn, ms}); return id;},
      clearInterval: id => intervals.delete(id),
      setTimeout: () => 0, clearTimeout: () => {},
      Date: {now: () => now},
    }
    : {setInterval, clearInterval, setTimeout, clearTimeout, Date};
  const context = vm.createContext({
    document, fetch, AbortController, URLSearchParams, Number, Math, JSON, String, Array, Object, Error,
    encodeURIComponent, console,
    localStorage: {getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value)},
    ...timers,
    window: {
      crypto: {randomUUID}, addEventListener: (type, fn) => {(windowEvents[type] ??= []).push(fn);},
      JWhitePublicProfile: profile,
    },
  });
  context.window.document = document;
  context.crypto = {randomUUID};
  context.globalThis = context;
  for (const [data, status] of responses) enqueue(data, status);
  vm.runInContext(source, context);
  return {
    page, ids, calls, enqueue, store, document, documentEvents, windowEvents,
    box: page.querySelector('[data-visitors-box]'),
    async advance(ms) {
      for (let step = 0; step < ms / 1000; step++) {
        now += 1000;
        for (const {fn} of [...intervals.values()]) fn();
        await tick();
      }
    },
    emit(type, target = 'window', detail = undefined) {
      for (const fn of (target === 'window' ? windowEvents : documentEvents)[type] ?? []) fn({detail});
    },
  };
}

const visitorsMarkup = subject => {
  const box = node('section', subject ? {'data-visitors-box': '', 'data-visitors-subject': subject} : {'data-visitors-box': ''}, 'profile-visitors');
  box.hidden = true;
  const rows = node('dl', {'data-visitors-rows': ''}); rows.hidden = true;
  const today = node('dd', {'data-visitors-today': ''});
  const week = node('dd', {'data-visitors-week': ''});
  const all = node('dd', {'data-visitors-all': ''});
  rows.append(today, week, all);
  const rank = node('a', {'data-visitors-rank': ''}); rank.hidden = true;
  const place = node('b', {'data-visitors-position': ''});
  rank.append(place);
  const note = node('p', {'data-visitors-note': ''}); note.hidden = true;
  note.textContent = 'Estimated unique visitors, counted once each.';
  box.append(rows, rank, note);
  return [box];
};

const counted = (extra = {}) => ({
  profile_id: MEMBER, name: 'Music Friend', today: 3, this_week: 12, all_time: 148,
  position: null, chart_eligible: true, chart_size: 25, chart_url: '/top25.html',
  week_start: '2026-09-07', day: '2026-09-08', estimated: true, ...extra,
});

const digits = box => box.querySelector('[data-visitors-today]').firstElementChild;
const dialText = (box, hook) => box.querySelector(`[data-visitors-${hook}]`).firstElementChild.text;

function visitors({subject = '', profile, saved = null, responses = []} = {}) {
  return harness({markup: visitorsMarkup(subject === 'owner' ? 'owner' : ''), source: visitorsSource, clock: true, profile, saved, responses});
}

test('the counter stays hidden until real numbers arrive and then reads like a drum', async () => {
  const view = visitors({subject: MEMBER});
  assert.equal(view.box.hidden, true, 'nothing is shown before the server answers');
  view.enqueue(counted());
  view.emit('jwhite:profile-ready', 'window', {id: MEMBER});
  await tick();
  assert.equal(view.box.hidden, false);
  assert.equal(view.box.querySelector('[data-visitors-rows]').hidden, false);
  assert.equal(dialText(view.box, 'today'), '0003');
  assert.equal(dialText(view.box, 'week'), '0012');
  assert.equal(dialText(view.box, 'all'), '0148');
  const drum = digits(view.box);
  assert.equal(drum.className, 'odometer');
  assert.deepEqual(drum.children.map(cell => cell.className), ['is-lead', 'is-lead', 'is-lead', '']);
  assert.equal(drum.attrs['aria-label'], '3 visitors');
  assert.equal(view.calls[0].path, `/api/visitors?id=${MEMBER}`);
  assert.equal(view.calls[0].options.cache, 'no-store');
});

test('a chart place shows in the box and opens Top Rosters', async () => {
  const view = visitors({subject: MEMBER, profile: {id: MEMBER}, responses: [[counted({position: 7})]]});
  await tick();
  const rank = view.box.querySelector('[data-visitors-rank]');
  assert.equal(rank.hidden, false);
  assert.equal(rank.href, '/top25.html');
  assert.equal(view.box.querySelector('[data-visitors-position]').textContent, '#7');
});

test('a profile outside the chart shows no place at all', async () => {
  const view = visitors({subject: 'owner', responses: [[counted({profile_id: 'owner', name: 'J.White Did It', position: null, chart_eligible: false})]]});
  await tick();
  assert.equal(view.box.querySelector('[data-visitors-rows]').hidden, false);
  assert.equal(view.box.querySelector('[data-visitors-rank]').hidden, true);
  assert.equal(view.calls[0].path, '/api/visitors?id=owner');
});

test('a visit is only sent after the page has really been looked at, and only once', async () => {
  const view = visitors({subject: MEMBER});
  view.enqueue(counted());
  view.emit('jwhite:profile-ready', 'window', {id: MEMBER});
  await tick();
  await view.advance(3000);
  assert.equal(view.calls.length, 1, 'a bounce sends nothing');
  view.enqueue(counted({today: 4, this_week: 13, all_time: 149, counted: true}), 201);
  await view.advance(2000);
  assert.equal(view.calls.length, 2);
  const visit = view.calls[1];
  assert.equal(visit.path, '/api/visitors/visit');
  assert.equal(visit.options.method, 'POST');
  assert.ok(visit.body.dwell_ms >= 2500, `dwell ${visit.body.dwell_ms} is a real look at the page`);
  assert.equal(dialText(view.box, 'all'), '0149');
  await view.advance(20000);
  assert.equal(view.calls.length, 2, 'the page never sends a second visit');
});

test('time in a hidden tab does not add up to a visit', async () => {
  const view = visitors({subject: MEMBER});
  view.enqueue(counted());
  view.emit('jwhite:profile-ready', 'window', {id: MEMBER});
  await tick();
  view.document.visibilityState = 'hidden';
  await view.advance(30000);
  assert.equal(view.calls.length, 1, 'a background tab is not a visitor');
  view.document.visibilityState = 'visible';
  view.enqueue(counted({counted: true}), 201);
  await view.advance(5000);
  assert.equal(view.calls.length, 2);
});

test('a guest keeps one random id and the visit carries nothing else', async () => {
  const view = visitors({subject: MEMBER});
  view.enqueue(counted());
  view.emit('jwhite:profile-ready', 'window', {id: MEMBER});
  await tick();
  view.enqueue(counted({counted: true}), 201);
  await view.advance(5000);
  const body = view.calls[1].body;
  assert.deepEqual(Object.keys(body).sort(), ['dwell_ms', 'profile_id', 'visitor_id']);
  assert.match(body.visitor_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(view.store.get('jspace.visitor'), body.visitor_id, 'the id is kept in the browser, not rebuilt');

  const again = visitors({subject: MEMBER, saved: body.visitor_id});
  again.enqueue(counted());
  again.emit('jwhite:profile-ready', 'window', {id: MEMBER});
  await tick();
  again.enqueue(counted({counted: false, reason: 'already_counted'}));
  await again.advance(5000);
  assert.equal(again.calls[1].body.visitor_id, body.visitor_id, 'the same browser reuses its id');
});

test('a counter that cannot load says so instead of showing a made up number', async () => {
  const view = visitors({subject: MEMBER});
  view.enqueue({error: 'Visitors are unavailable.'}, 500);
  view.emit('jwhite:profile-ready', 'window', {id: MEMBER});
  await tick();
  assert.equal(view.box.hidden, false);
  assert.equal(view.box.querySelector('[data-visitors-rows]').hidden, true);
  assert.match(view.box.querySelector('[data-visitors-note]').textContent, /taking a break/);
});

/* ------------------------------------------------------------- the chart page */

const chartMarkup = () => {
  const list = node('ol', {'data-chart-list': ''}, 'top25-chart'); list.hidden = true;
  const status = node('p', {}, 'top25-status');
  const retry = node('button', {}, 'top25-retry'); retry.hidden = true;
  const empty = node('section', {'data-chart-empty': ''}); empty.hidden = true;
  const week = node('p', {'data-chart-week': ''}); week.hidden = true;
  week.append(node('b', {'data-chart-week-start': ''}), node('span', {'data-chart-ranked': ''}), node('span', {'data-chart-updated': ''}));
  return [week, status, list, empty, retry];
};
const entry = (position, name, visitors, movement, last = null) => ({
  position, subject: `${position}`.padStart(8, '0') + '-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name,
  photo_url: position === 1 ? '/api/member-photo/one' : null,
  profile_url: `/profile.html?id=member-${position}`, visitors, movement, last_week_position: last,
});
const chart = responses => harness({markup: chartMarkup(), source: chartSource, responses});

test('the chart lists positions, movement and a link to each member page', async () => {
  const view = chart([[{
    week_start: '2026-09-07', updated_at: '2026-09-09T15:00:00Z', chart_size: 25, ranked: 3,
    entries: [
      entry(1, 'Music Friend', 40, {kind: 'up', places: 3, label: '▲3'}, 4),
      entry(2, 'Second Friend', 22, {kind: 'down', places: 2, label: '▼2'}, 1),
      entry(2, 'Tied Friend', 22, {kind: 'new', places: 0, label: 'NEW'}, null),
    ],
  }]]);
  await tick();
  assert.equal(view.calls[0].path, '/api/top25');
  const list = view.ids['top25-chart'];
  assert.equal(list.hidden, false);
  assert.equal(list.children.length, 3);
  const rows = list.children.map(item => item.children[0]);
  assert.deepEqual(rows.map(row => row.children[0].textContent), ['01', '02', '02'], 'a tie shares its place, printed to two digits');
  assert.deepEqual(rows.map(row => row.href), ['/profile.html?id=member-1', '/profile.html?id=member-2', '/profile.html?id=member-2']);
  assert.deepEqual(rows.map(row => row.querySelector('[data-move]').textContent), ['▲3', '▼2', 'NEW']);
  assert.deepEqual(rows.map(row => row.querySelector('[data-move]').attrs['data-move']), ['up', 'down', 'new']);
  assert.match(rows[0].text, /Music Friend/);
  assert.match(rows[0].text, /40 visitors this week/);
  assert.equal(rows[0].children[1].firstElementChild.tagName, 'img');
  assert.equal(rows[1].children[1].firstElementChild.textContent, 'S', 'a member with no picture gets an initial');
  assert.equal(view.ids['top25-status'].hidden, false);
  assert.match(view.ids['top25-status'].textContent, /top 3 most visited/);
});

test('a week with no tracked visits shows an empty chart, never invented entries', async () => {
  const view = chart([[{week_start: '2026-09-07', updated_at: '2026-09-07T05:00:00Z', chart_size: 25, ranked: 0, entries: []}]]);
  await tick();
  assert.equal(view.ids['top25-chart'].children.length, 0);
  assert.equal(view.ids['top25-chart'].hidden, true);
  assert.equal(view.page.querySelector('[data-chart-empty]').hidden, false);
});

test('a chart that cannot load offers another try and shows nothing else', async () => {
  const view = chart([[{error: 'The chart is unavailable.'}, 503]]);
  await tick();
  assert.equal(view.ids['top25-chart'].hidden, true);
  assert.equal(view.page.querySelector('[data-chart-empty]').hidden, true);
  assert.equal(view.ids['top25-retry'].hidden, false);
  view.enqueue({week_start: '2026-09-07', updated_at: '2026-09-09T15:00:00Z', chart_size: 25, ranked: 1, entries: [entry(1, 'Music Friend', 5, {kind: 'same', places: 0, label: 'SAME'}, 1)]});
  view.ids['top25-retry'].fire('click');
  await tick();
  assert.equal(view.ids['top25-chart'].children.length, 1);
  assert.equal(view.ids['top25-retry'].hidden, true);
});

/* ------------------------------------------- the feature and the private recap */

const weekMarkup = () => {
  const featured = node('section', {'data-featured-profile': ''}); featured.hidden = true;
  const body = node('div', {'data-featured-body': ''}); body.hidden = true;
  body.append(
    node('span', {'data-featured-photo': ''}), node('h3', {'data-featured-name': ''}),
    node('p', {'data-featured-week': ''}), node('p', {'data-featured-count': ''}),
    node('a', {'data-featured-link': ''}), node('a', {'data-featured-chart': ''}),
  );
  const blank = node('p', {'data-featured-empty': ''}); blank.hidden = true;
  featured.append(body, blank);
  const recap = node('section', {'data-visitor-recap': ''}); recap.hidden = true;
  const figures = node('p', {'data-recap-figures': ''}); figures.hidden = true;
  figures.append(node('b', {'data-recap-today': ''}), node('b', {'data-recap-week': ''}), node('b', {'data-recap-all': ''}));
  recap.append(node('p', {'data-recap-line': ''}), figures);
  return [featured, recap];
};
const weekly = responses => harness({markup: weekMarkup(), source: weekSource, responses});

test('last week’s number one is featured with a photo, a count and a View Profile button', async () => {
  const view = weekly([
    [{
      week_start: '2026-09-14', featured_week_start: '2026-09-07', chart_url: '/top25.html',
      featured: {position: 1, subject: MEMBER, name: 'Music Friend', photo_url: '/api/member-photo/one', profile_url: `/profile.html?id=${MEMBER}`, visitors: 40},
    }],
    [{error: 'Log in required.'}, 401],
  ]);
  await settle();
  const featured = view.page.querySelector('[data-featured-profile]');
  assert.equal(featured.hidden, false);
  assert.equal(featured.querySelector('[data-featured-body]').hidden, false);
  assert.equal(featured.querySelector('[data-featured-empty]').hidden, true);
  assert.equal(featured.querySelector('[data-featured-name]').textContent, 'Music Friend');
  assert.match(featured.querySelector('[data-featured-week]').textContent, /Had the top roster for the week of September 7/);
  assert.equal(featured.querySelector('[data-featured-count]').textContent, '40 visitors that week');
  const link = featured.querySelector('[data-featured-link]');
  assert.equal(link.href, `/profile.html?id=${MEMBER}`);
  assert.equal(link.textContent, 'View Their Page');
  assert.equal(featured.querySelector('[data-featured-photo]').firstElementChild.src, '/api/member-photo/one');
  assert.equal(view.calls[0].path, '/api/visitors/featured');
});

test('before a week has finished the feature says so instead of naming a winner', async () => {
  const view = weekly([
    [{week_start: '2026-09-07', featured_week_start: '2026-08-31', chart_url: '/top25.html', featured: null}],
    [{error: 'Log in required.'}, 401],
  ]);
  await settle();
  const featured = view.page.querySelector('[data-featured-profile]');
  assert.equal(featured.hidden, false);
  assert.equal(featured.querySelector('[data-featured-body]').hidden, true);
  assert.equal(featured.querySelector('[data-featured-empty]').hidden, false);
  assert.equal(featured.querySelector('[data-featured-name]').textContent, '');
});

test('the weekly recap only appears for the member reading it', async () => {
  const guest = weekly([
    [{week_start: '2026-09-14', featured_week_start: '2026-09-07', chart_url: '/top25.html', featured: null}],
    [{error: 'Log in required.'}, 401],
  ]);
  await settle();
  assert.equal(guest.page.querySelector('[data-visitor-recap]').hidden, true, 'a signed out visitor sees no one’s recap');

  const member = weekly([
    [{week_start: '2026-09-14', featured_week_start: '2026-09-07', chart_url: '/top25.html', featured: null}],
    [{
      week_start: '2026-09-07', visitors: 40, position: 1, made_chart: true, chart_size: 25, chart_url: '/top25.html',
      current: {today: 2, this_week: 9, all_time: 190}, profile_url: `/profile.html?id=${MEMBER}`, estimated: true,
    }],
  ]);
  await settle();
  const recap = member.page.querySelector('[data-visitor-recap]');
  assert.equal(recap.hidden, false);
  assert.match(recap.querySelector('[data-recap-line]').text, /counted 40 visitors/);
  assert.match(recap.querySelector('[data-recap-line]').text, /You finished #1 on the Top Rosters/);
  assert.equal(recap.querySelector('[data-recap-figures]').hidden, false);
  assert.equal(recap.querySelector('[data-recap-all]').textContent, '190');
  assert.equal(member.calls[1].path, '/api/visitors/recap');
});

test('a member who missed the chart still gets their own number', async () => {
  const view = weekly([
    [{week_start: '2026-09-14', featured_week_start: '2026-09-07', chart_url: '/top25.html', featured: null}],
    [{
      week_start: '2026-09-07', visitors: 1, position: null, made_chart: false, chart_size: 25, chart_url: '/top25.html',
      current: {today: 0, this_week: 0, all_time: 1}, profile_url: `/profile.html?id=${MEMBER}`, estimated: true,
    }],
  ]);
  await settle();
  const line = view.page.querySelector('[data-recap-line]').text;
  assert.match(line, /counted 1 visitor\./);
  assert.match(line, /did not make the top 25/);
});

/* --------------------------------------------- the pages carry the same hooks */

test('every real member profile carries the counter markup and a Top Rosters link', () => {
  for (const page of ['profile.html']) {
    const source = read(page);
    assert.match(source, /data-visitors-box/, `${page} shows a Visitors box`);
    for (const hook of ['data-visitors-today', 'data-visitors-week', 'data-visitors-all', 'data-visitors-rank', 'data-visitors-position', 'data-visitors-rows', 'data-visitors-note']) {
      assert.ok(source.includes(hook), `${page} is missing ${hook}`);
    }
    assert.match(source, /visitors\.js\?v=/, `${page} loads the counter`);
    assert.match(source, /visitors\.css\?v=/, `${page} loads the counter styles`);
  }
  for (const page of ['index.html', 'profile.html', 'members.html', 'people.html', 'top25.html']) {
    assert.match(read(page), /href="\/top25\.html"/, `${page} links to the chart`);
  }
  const portal = read('members.html');
  assert.match(portal, /data-featured-profile/);
  assert.match(portal, /data-visitor-recap/);
  assert.match(portal, /roster-week\.js\?v=/);
});

test('the site build ships the new files', () => {
  const source = read('build.mjs');
  for (const file of ['visitors.js', 'visitors.css', 'top25.html', 'top25.js', 'roster-week.js']) {
    assert.ok(source.includes(`'${file}'`), `build.mjs does not copy ${file}`);
  }
});
