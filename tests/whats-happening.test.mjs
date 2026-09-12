import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {
  DEFAULT_PROMOTION, NEWS_DESCRIPTION, NEWS_FEEDS, NEWS_FILTERS, NEWS_FRONT_PAGE, NEWS_HEADING, NEWS_MORE_LABEL,
  briefSummary, getNews, newsView, parseFeed, postNewsOwnerAction, refreshNews, safeImageLink,
} from '../netlify/functions/_shared/roster-news.mts';
import {config as getConfig} from '../netlify/functions/news-get.mts';
import {config as ownerConfig} from '../netlify/functions/news-owner.mts';
import {config as refreshConfig} from '../netlify/functions/news-refresh.mts';

const origin = 'https://jwhitedidit.net';
const owner = {id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', name: 'J.White Did It', isOwner: true, email: 'owner@example.test'};
const member = {id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Alice Rivers', isOwner: false, email: 'alice@example.test'};
const read = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

function memory(seed = {}) {
  const records = new Map(Object.entries(seed));
  return {
    records,
    async get(key) { return records.has(key) ? JSON.parse(JSON.stringify(records.get(key))) : null; },
    async setJSON(key, value, options = {}) {
      if (options.onlyIfNew && records.has(key)) return {modified: false};
      records.set(key, JSON.parse(JSON.stringify(value)));
      return {modified: true};
    },
  };
}

const feedXml = (items) => `<?xml version="1.0"?><rss><channel>${items.map(item => `
  <item><title>${item.title}</title><link>${item.url}</link><pubDate>${item.date}</pubDate>
  <description>${item.summary || 'From the publisher.'}</description></item>`).join('')}</channel></rss>`;

const feedResponse = body => new Response(body, {status: 200, headers: {'content-type': 'application/rss+xml'}});

// One reachable feed, everything else down. Only the reachable source's own
// stories can ever appear.
function fetcher(bySource) {
  return async url => {
    const feed = NEWS_FEEDS.find(candidate => candidate.url === url);
    const body = feed && bySource[feed.source];
    if (!body) return new Response('', {status: 503});
    return feedResponse(body);
  };
}

const ownerRequest = body => new Request(`${origin}/api/whats-happening/owner`, {
  method: 'POST', headers: {origin, 'content-type': 'application/json'}, body: JSON.stringify(body),
});

test('the news area keeps its own name, description and the six exact filters', () => {
  assert.equal(NEWS_HEADING, 'ROOSTER NEWS');
  assert.equal(NEWS_DESCRIPTION, 'Music, culture, events and opportunities.');
  assert.deepEqual([...NEWS_FILTERS], ['All News', 'Music', 'Culture', 'Events', 'Opportunities', 'J.White']);
  assert.equal(getConfig.path, '/api/whats-happening');
  assert.equal(ownerConfig.path, '/api/whats-happening/owner');
  assert.equal(ownerConfig.method, 'POST');
  assert.ok(refreshConfig.schedule, 'the weekly refresh has to be scheduled on the server');
  // Every feed is a named publisher reached over https, never a generated source.
  for (const feed of NEWS_FEEDS) {
    assert.ok(feed.url.startsWith('https://'), `${feed.source} must be read over https`);
    assert.ok(feed.source && feed.home.startsWith('https://'));
  }
});

test('a story only survives with the publisher’s own headline, link, source and date', () => {
  const now = Date.parse('2026-09-07T12:00:00Z');
  const stories = parseFeed(NEWS_FEEDS[0], feedXml([
    {title: 'A real headline from the feed', url: 'https://www.billboard.com/one', date: 'Fri, 04 Sep 2026 10:00:00 GMT'},
    {title: 'No date at all', url: 'https://www.billboard.com/two', date: ''},
    {title: 'Dated in the future', url: 'https://www.billboard.com/three', date: 'Fri, 04 Sep 2027 10:00:00 GMT'},
    {title: 'Not a public link', url: 'javascript:alert(1)', date: 'Fri, 04 Sep 2026 10:00:00 GMT'},
  ]), now);
  assert.deepEqual(stories.map(story => story.title), ['A real headline from the feed']);
  assert.equal(stories[0].source, 'Billboard');
  assert.equal(stories[0].published_at, '2026-09-04T10:00:00.000Z');
  assert.equal(stories[0].url, 'https://www.billboard.com/one');
});

test('the featured selection is written once for the Chicago week and does not reshuffle', async () => {
  const store = memory();
  const monday = Date.parse('2026-09-07T12:00:00Z');
  const body = feedXml(Array.from({length: 6}, (_, index) => ({
    title: `Story number ${index + 1}`, url: `https://www.billboard.com/s${index}`,
    date: new Date(monday - (index + 1) * 3_600_000).toUTCString(),
  })));
  const first = await refreshNews(store, fetcher({Billboard: body}), monday);
  assert.equal(first.featured_built, true);
  assert.deepEqual(first.sources_ok, ['Billboard']);
  const week = store.records.get(`weeks/${first.week}`);
  const later = await refreshNews(store, fetcher({Billboard: body}), monday + 2 * 86_400_000);
  assert.equal(later.featured_built, false, 'mid-week runs must not rebuild the week');
  assert.deepEqual(store.records.get(`weeks/${first.week}`).featured, week.featured);

  // The next Chicago Monday gets its own selection, and last week's picks are
  // not offered again as new.
  const nextMonday = Date.parse('2026-09-14T12:00:00Z');
  const nextBody = feedXml([{title: 'Brand new story this week', url: 'https://www.billboard.com/new', date: new Date(nextMonday - 3_600_000).toUTCString()}]);
  const next = await refreshNews(store, fetcher({Billboard: nextBody}), nextMonday);
  assert.notEqual(next.week, first.week);
  assert.equal(next.featured_built, true);
  const repeated = store.records.get(`weeks/${next.week}`).featured.filter(id => week.featured.includes(id));
  assert.deepEqual(repeated, [], 'last week’s stories must not be re-featured as this week’s news');
});

test('when every feed fails the last successful stories stay under their real update date', async () => {
  const store = memory();
  const monday = Date.parse('2026-09-07T12:00:00Z');
  await refreshNews(store, fetcher({Billboard: feedXml([
    {title: 'The last story that really loaded', url: 'https://www.billboard.com/kept', date: new Date(monday - 3_600_000).toUTCString()},
  ])}), monday);
  const savedAt = store.records.get('latest').fetched_at;

  const outage = await refreshNews(store, async () => new Response('', {status: 503}), monday + 3_600_000);
  assert.deepEqual(outage.sources_ok, []);
  assert.equal(outage.fetched_at, savedAt, 'a failed update must not claim a new update time');
  const view = await newsView(store, monday + 3_600_000);
  assert.equal(view.last_updated_at, savedAt);
  assert.equal(view.update_state, 'ok');
  assert.deepEqual(view.stories.map(story => story.title), ['The last story that really loaded']);

  // Weeks later the same content is honestly labelled as not refreshed.
  const stale = await newsView(store, monday + 20 * 86_400_000);
  assert.equal(stale.update_state, 'stale');
  assert.equal(stale.last_updated_at, savedAt);
});

test('an empty store reports that nothing has been collected instead of inventing stories', async () => {
  const view = await newsView(memory(), Date.parse('2026-09-07T12:00:00Z'));
  assert.deepEqual(view.stories, []);
  assert.deepEqual(view.announcements, []);
  assert.equal(view.update_state, 'never');
  assert.equal(view.last_updated_at, null);
});

test('the pinned group announcement is live, is not a story and carries the selection notice', async () => {
  const view = await newsView(memory(), Date.parse('2026-09-07T12:00:00Z'));
  assert.equal(view.promotion.heading, 'I’m putting a group together.'.replace('’', "'"));
  assert.match(view.promotion.body, /3 female rappers\. 1 R&B singer\./);
  assert.deepEqual(view.promotion.badges, ['18+', 'J.White Did It', 'More Hits On The Way', '@morehitsontheway']);
  assert.equal(view.promotion.button_label, 'Make your ROOSTER page');
  assert.equal(view.promotion.note, 'Joining does not guarantee selection.');
  assert.equal(DEFAULT_PROMOTION.active, true);
  // It lives outside the story list, so a weekly refresh can never rotate it out.
  assert.equal(view.stories.some(story => story.title === view.promotion.heading), false);
});

test('only the bound owner account can post, pin or remove, and the controls stay private', async () => {
  const store = memory();
  const profiles = memory({'owner-binding': {id: owner.id}});

  const refused = await postNewsOwnerAction(ownerRequest({action: 'announcement_save', kind: 'release', title: 'Not mine', body: 'No.'}),
    store, profiles, {resolveMember: async () => member});
  assert.equal(refused.status, 403);
  assert.equal(store.records.size, 0, 'a member must not be able to write anything');

  const saved = await postNewsOwnerAction(ownerRequest({
    action: 'announcement_save', kind: 'opportunity', title: 'Studio session slots',
    body: 'Two slots open this month.', closes_at: '2026-09-10T00:00:00Z',
  }), store, profiles, {resolveMember: async () => owner, now: Date.parse('2026-09-07T12:00:00Z')});
  assert.equal(saved.status, 201);

  const open = await newsView(store, Date.parse('2026-09-08T12:00:00Z'));
  assert.equal(open.announcements[0].open, true);
  // An opportunity that has closed stops reading as open.
  const closed = await newsView(store, Date.parse('2026-09-20T12:00:00Z'));
  assert.equal(closed.announcements[0].open, false);

  const removedPin = await postNewsOwnerAction(ownerRequest({action: 'promotion_remove'}), store, profiles, {resolveMember: async () => owner});
  assert.equal(removedPin.status, 200);
  assert.equal((await newsView(store, Date.parse('2026-09-08T12:00:00Z'))).promotion, null);

  const id = (await saved.json()).announcement.id;
  await postNewsOwnerAction(ownerRequest({action: 'announcement_delete', id}), store, profiles, {resolveMember: async () => owner});
  assert.deepEqual((await newsView(store, Date.parse('2026-09-08T12:00:00Z'))).announcements, []);
});

test('a removed story disappears from the public view and can be restored', async () => {
  const store = memory();
  const profiles = memory({'owner-binding': {id: owner.id}});
  const monday = Date.parse('2026-09-07T12:00:00Z');
  await refreshNews(store, fetcher({Billboard: feedXml([
    {title: 'Story the owner keeps', url: 'https://www.billboard.com/keep', date: new Date(monday - 3_600_000).toUTCString()},
    {title: 'Story the owner drops', url: 'https://www.billboard.com/drop', date: new Date(monday - 7_200_000).toUTCString()},
  ])}), monday);
  const dropped = (await newsView(store, monday)).stories.find(story => story.title === 'Story the owner drops');

  await postNewsOwnerAction(ownerRequest({action: 'story_remove', id: dropped.id}), store, profiles, {resolveMember: async () => owner});
  assert.deepEqual((await newsView(store, monday)).stories.map(story => story.title), ['Story the owner keeps']);
  await postNewsOwnerAction(ownerRequest({action: 'story_restore', id: dropped.id}), store, profiles, {resolveMember: async () => owner});
  assert.equal((await newsView(store, monday)).stories.length, 2);
});

test('the public endpoint returns no member ids, emails or owner controls', async () => {
  const store = memory();
  const profiles = memory({'owner-binding': {id: owner.id}});
  await postNewsOwnerAction(ownerRequest({action: 'announcement_save', kind: 'career', title: 'Studio news', body: 'Working.'}),
    store, profiles, {resolveMember: async () => owner});
  const response = await getNews(new Request(`${origin}/api/whats-happening`), store, Date.parse('2026-09-07T12:00:00Z'));
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.equal(text.includes(owner.id), false);
  assert.equal(text.includes(owner.email), false);
  assert.equal(text.includes('owner-binding'), false);
});

/* ---------- the client ---------- */

class Node {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.classList = {
      names: new Set(),
      add: (...names) => names.forEach(name => this.classList.names.add(name)),
    };
    this.attributes = {};
    this.listeners = {};
    this.hidden = false;
    this.text = '';
    this.href = '';
    this.type = '';
  }
  get className() { return [...this.classList.names].join(' '); }
  set className(value) { this.classList.names = new Set(String(value).split(' ').filter(Boolean)); }
  get textContent() { return this.text + this.children.map(child => (child.textContent ?? child.data ?? '')).join(''); }
  set textContent(value) { this.text = String(value); this.children = []; }
  append(...nodes) { for (const node of nodes) this.children.push(node); }
  replaceChildren(...nodes) { this.children = [...nodes]; this.text = ''; }
  insertBefore(node) { this.children.unshift(node); return node; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  querySelector(selector) { return this.find(node => node.matches(selector)); }
  querySelectorAll(selector) { const out = []; this.walk(node => { if (node.matches(selector)) out.push(node); }); return out; }
  matches(selector) {
    if (selector.startsWith('[data-') ) {
      const key = selector.slice(6, -1).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      return Object.hasOwn(this.dataset, key);
    }
    if (selector.startsWith('.')) return this.classList.names.has(selector.slice(1));
    return this.tagName === selector.toUpperCase();
  }
  walk(visit) { for (const child of this.children) { if (child.walk) { visit(child); child.walk(visit); } } }
  find(match) { let found = null; this.walk(node => { if (!found && match(node)) found = node; }); return found; }
  get reset() { return () => {}; }
}

const label = node => node.textContent;

function client({news, session = {ok: true, body: {profile: {id: member.id}, can_edit_owner: false}}} = {}) {
  const newsRoot = new Node('section');
  newsRoot.dataset.whatsHappening = '';
  const promoRoot = new Node('section');
  promoRoot.dataset.groupAnnouncement = '';
  const page = new Node('body');
  page.append(newsRoot, promoRoot);
  const calls = [];
  const context = vm.createContext({
    AbortController, setTimeout, clearTimeout, Date, JSON, Number, Array, Object, String, Boolean, Math,
    document: {
      createElement: tag => new Node(tag),
      createTextNode: data => ({data, textContent: data}),
      querySelector: selector => page.querySelector(selector),
    },
    window: {},
    fetch: async (path) => {
      calls.push(path);
      if (path === '/api/profile/me') {
        return {ok: session.ok, status: session.ok ? 200 : 401, json: async () => session.body};
      }
      if (!news.ok) return {ok: false, status: news.status ?? 503, json: async () => news.body ?? null};
      return {ok: true, status: 200, json: async () => news.body};
    },
  });
  context.window = context;
  vm.runInContext(read('news.js'), context);
  return {newsRoot, promoRoot, calls, context};
}

const view = (over = {}) => ({
  heading: 'ROOSTER NEWS', description: 'Music, culture, events and opportunities.',
  filters: ['All News', 'Music', 'Culture', 'Events', 'Opportunities', 'J.White'],
  week_start: '2026-09-07', featured_built_at: '2026-09-07T05:00:00.000Z',
  last_updated_at: '2026-09-07T11:00:00.000Z', update_state: 'ok',
  sources: [{source: 'Billboard', home: 'https://www.billboard.com'}],
  promotion: {
    heading: "I'm putting a group together.",
    body: '3 female rappers. 1 R&B singer.\n\nIf you can rap or sing and move a little, let me hear you.',
    badges: ['18+', 'J.White Did It'], button_label: 'Make your ROOSTER page',
    signed_in_label: 'Add your music', note: 'Joining does not guarantee selection.',
    active: true, updated_at: null,
  },
  announcements: [], stories: [], ...over,
});

const story = (over = {}) => ({
  id: 'a'.repeat(40), url: 'https://www.billboard.com/one', title: 'A real headline',
  source: 'Billboard', category: 'music', published_at: '2026-09-04T10:00:00.000Z',
  summary: 'The publisher’s own words, shortened.', featured: true, ...over,
});

const tick = () => new Promise(resolve => setImmediate(resolve));

test('the news section shows every filter and each story’s real source, date and link', async () => {
  const {newsRoot} = client({news: {ok: true, body: view({stories: [story(), story({
    id: 'b'.repeat(40), url: 'https://pitchfork.com/two', title: 'Another headline', source: 'Pitchfork',
    category: 'culture', published_at: '2026-09-02T10:00:00.000Z', featured: false,
  })]})}});
  await tick(); await tick(); await tick();
  const filters = newsRoot.querySelectorAll('.news-filter').map(label);
  assert.deepEqual(filters, ['All News', 'Music', 'Culture', 'Events', 'Opportunities', 'J.White']);
  const cards = newsRoot.querySelectorAll('.news-story');
  assert.equal(cards.length, 2);
  assert.equal(cards[0].querySelector('.news-source').textContent, 'Billboard');
  assert.match(cards[0].querySelector('.news-date').textContent, /2026/);
  assert.equal(cards[0].querySelector('.news-story-title').querySelector('A').href, 'https://www.billboard.com/one');
  assert.equal(label(cards[0].querySelector('.news-featured')), 'Featured this week');
  assert.match(newsRoot.querySelector('.news-summary').textContent, /publisher/);
  assert.match(newsRoot.querySelector('.news-update').textContent, /Updated/);
  assert.equal(newsRoot.querySelectorAll('.news-owner-button').length, 0, 'a member must not see owner controls');
  assert.equal(newsRoot.querySelectorAll('.news-owner-tools').length, 0);
});

test('a filter narrows the list to that category and J.White shows only his announcements', async () => {
  const {newsRoot} = client({news: {ok: true, body: view({
    stories: [story({category: 'music'}), story({id: 'b'.repeat(40), url: 'https://pitchfork.com/x', category: 'culture', title: 'Culture piece', featured: false})],
    announcements: [{id: 'c'.repeat(40), kind: 'release', title: 'New record', body: 'Out now.', url: null, published_at: '2026-09-06T10:00:00.000Z', closes_at: null, open: null}],
  })}});
  await tick(); await tick(); await tick();
  newsRoot.querySelectorAll('.news-filter').find(button => label(button) === 'Culture').listeners.click();
  assert.deepEqual(newsRoot.querySelectorAll('.news-story-title').map(node => node.textContent), ['Culture piece']);
  newsRoot.querySelectorAll('.news-filter').find(button => label(button) === 'J.White').listeners.click();
  const own = newsRoot.querySelectorAll('.news-announcement');
  assert.equal(own.length, 1);
  assert.equal(own[0].querySelector('.news-story-title').textContent, 'New record');
  assert.equal(newsRoot.querySelectorAll('.news-story').length, 0, 'the J.White filter is not the whole news area');
  newsRoot.querySelectorAll('.news-filter').find(button => label(button) === 'All News').listeners.click();
  assert.equal(newsRoot.querySelectorAll('.news-jwhite').length, 1, 'his section sits inside the wider news, not instead of it');
  assert.equal(newsRoot.querySelectorAll('.news-story').length, 2);
});

test('a closed opportunity is labelled closed rather than still open', async () => {
  const {newsRoot} = client({news: {ok: true, body: view({announcements: [
    {id: 'c'.repeat(40), kind: 'opportunity', title: 'Session slots', body: 'Two open.', url: null, published_at: '2026-09-01T10:00:00.000Z', closes_at: '2026-09-03T00:00:00.000Z', open: false},
  ]})}});
  await tick(); await tick(); await tick();
  newsRoot.querySelectorAll('.news-filter').find(button => label(button) === 'J.White').listeners.click();
  assert.equal(newsRoot.querySelector('.news-closed').textContent, 'Closed');
  assert.equal(newsRoot.querySelectorAll('.news-open').length, 0);
});

test('a failed load says so and never fills the section with made-up stories', async () => {
  const {newsRoot} = client({news: {ok: false, status: 503}});
  await tick(); await tick(); await tick();
  assert.equal(newsRoot.querySelectorAll('.news-story').length, 0);
  assert.match(newsRoot.querySelector('.news-update').textContent, /could not load right now/);
  assert.match(newsRoot.querySelector('.news-update').textContent, /made up/);
});

test('the pinned announcement sends a visitor to signup and a member to their own music', async () => {
  const guest = client({news: {ok: true, body: view()}, session: {ok: false, body: {error: 'not signed in'}}});
  await tick(); await tick(); await tick();
  assert.equal(guest.promoRoot.hidden, false);
  assert.equal(guest.promoRoot.querySelector('.group-heading').textContent, "I'm putting a group together.");
  assert.deepEqual(guest.promoRoot.querySelectorAll('.group-badge').map(label), ['18+', 'J.White Did It']);
  const guestAction = guest.promoRoot.querySelector('.group-action');
  assert.equal(guestAction.textContent, 'Make your ROOSTER page');
  assert.equal(guestAction.href, '/members.html#member-signup');
  const notes = guest.promoRoot.querySelectorAll('.group-note').map(label);
  assert.ok(notes.includes('Joining does not guarantee selection.'));
  // Making a page is never described as an audition submission.
  assert.ok(notes.some(note => /not an audition submission/i.test(note)));
  assert.equal(notes.some(note => /you (?:have )?submitted|your audition (?:is|was) (?:in|received)/i.test(note)), false);

  const signedIn = client({news: {ok: true, body: view()}});
  await tick(); await tick(); await tick();
  const memberAction = signedIn.promoRoot.querySelector('.group-action');
  assert.equal(memberAction.textContent, 'Add your music');
  assert.equal(memberAction.href, '/members.html#member-songs-root');
});

test('the pinned announcement is hidden only when the owner turns it off', async () => {
  const {promoRoot} = client({news: {ok: true, body: view({promotion: null})}});
  await tick(); await tick(); await tick();
  assert.equal(promoRoot.hidden, true);
  assert.equal(promoRoot.querySelectorAll('.group-action').length, 0);
});

test('the owner account gets the private controls the news area needs', async () => {
  const {newsRoot} = client({
    news: {ok: true, body: view({stories: [story()], announcements: [
      {id: 'c'.repeat(40), kind: 'announcement', title: 'Heads up', body: 'Soon.', url: null, published_at: '2026-09-06T10:00:00.000Z', closes_at: null, open: null},
    ]})},
    session: {ok: true, body: {profile: {id: owner.id}, can_edit_owner: true}},
  });
  await tick(); await tick(); await tick();
  assert.equal(newsRoot.querySelectorAll('.news-owner-tools').length, 1);
  assert.ok(newsRoot.querySelectorAll('.news-owner-button').length >= 1, 'the owner can remove a story');
  assert.match(newsRoot.querySelector('.news-owner-pin').textContent, /pinned announcement/);
});

/* ---------- the front door and the music guide ---------- */

test('the signup page opens as a front door without pushing the form down on phones', () => {
  const html = read('members.html');
  const banner = html.slice(html.indexOf('class="roster-banner"'), html.indexOf('class="roster-banner-rotator"'));
  assert.match(banner, /<h1 id="roster-banner-heading">R<span class="roster-banner-o">O<\/span>STER<\/h1>/);
  assert.match(banner, /<span>EVERYBODY CAN’T BE<\/span> <span>ON THE ROOSTER\.<\/span>/);
  assert.match(banner, /Build your roster\. Find your people\. Make something happen\./);
  // ROOSTER is invite only, so the banner states it and offers the two real
  // doors instead of an open signup button.
  assert.match(banner, /<b>Invite only<\/b> <span>An invitation and approval are required to join ROOSTER\.<\/span>/);
  assert.match(banner, /data-member-go="invite">Enter Invite Code</);
  assert.match(banner, /data-member-go="request">Request an Invite</);
  assert.doesNotMatch(banner, /START MY ROOSTER/, "an open signup button must not be offered on the front door");
  assert.match(banner, /data-member-go="login">I already have an account</);
  assert.match(banner, /Music profiles\. My Roster\. Top Rosters\. Live Chat\./);

  // The community content sits after the form, and the phone layout still puts
  // the form first.
  const front = html.indexOf('class="roster-front-door"');
  assert.ok(front > html.indexOf('id="member-signup"'), 'the front door content must not come before the signup form');
  const css = read('members.css');
  assert.match(css, /\.members-page \.member-card\{order:0/);
  assert.equal(html.includes('src="/news.js'), false, 'the removed news client must not load on the signup page');
  assert.equal(read('build.mjs').includes("'news.js'"), true, 'news.js has to ship with the site');
});

/* ---------- the banner ---------- */

test('the banner leads with the community and carries no portrait of the founder', () => {
  const html = read('members.html');
  const banner = html.slice(html.indexOf('class="roster-banner"'), html.indexOf('class="roster-banner-rotator"'));
  // The front door is about the people who join, not about who built it.
  assert.equal(/<img\b/.test(banner), false, 'the banner must not carry a photograph');
  assert.doesNotMatch(banner, /J\.White/, 'the banner must not name the founder');
  assert.match(banner, /<h1 id="roster-banner-heading">R(?:<span class="roster-banner-o">O<\/span>|O)STER<\/h1>/);
  const css = read('roster-connect.css');
  assert.equal(css.includes('.roster-banner-photo'), false, 'the removed banner portrait must leave no rules behind');
  // His photograph still ships, for his own profile picture and nothing else.
  assert.equal(read('build.mjs').includes("'profile.jpg'"), true, 'his profile picture has to ship with the site');

  // Deep red turning to charcoal, gold light, one small red accent.
  const shell = css.slice(css.indexOf('.roster-banner{'), css.indexOf('.roster-banner-words{'));
  assert.match(shell, /#0c0809/);
  assert.match(shell, /border-bottom:3px solid #ffbf46/);
  assert.match(shell, /background:#ce0633/);
  // The invitation is gold and opens the signup section.
  assert.match(css, /\.roster-banner-join\{[^}]*background:linear-gradient\(#ffe07a,#e0ab21\)/);
  assert.match(css, /\.roster-banner-join\{[^}]*min-height:46px/);
  assert.match(css, /\.roster-banner h1\{[^}]*font-weight:900/);
  // The old red feature banner is gone, and so are its leftover rules.
  assert.equal(html.includes('member-feature-banner'), false);
  assert.equal(read('members.css').includes('member-feature'), false);
});

test('the announcement bar turns between three lines and stands still on request', () => {
  const html = read('members.html');
  const bar = html.slice(html.indexOf('class="roster-banner-rotator"'), html.indexOf('id="members-content"'));
  const lines = [...bar.matchAll(/<li>([^<]*(?:&amp;B[^<]*)?)<\/li>/g)].map(match => match[1]);
  assert.deepEqual(lines, [
    'TOP ROSTERS. Who got the top roster this week?',
    'J.White is looking for 3 female rappers and 1 R&amp;B singer.',
    'Enter the Listening Room and see who is inside.',
  ]);
  assert.match(bar, /aria-label="ROOSTER announcements"/);

  const css = read('roster-connect.css');
  assert.match(css, /animation:roster-banner-rotate 21s ease-in-out infinite/);
  assert.match(css, /\.roster-banner-rotator li:nth-child\(2\)\{animation-delay:7s\}/);
  assert.match(css, /\.roster-banner-rotator li:nth-child\(3\)\{animation-delay:14s\}/);
  assert.match(css, /\.roster-banner-rotator ul\{[^}]*height:30px/);
  // Reduced motion: no turning, no pulsing, all three announcements readable.
  const still = css.slice(css.indexOf('@media(prefers-reduced-motion:reduce){\n .roster-banner-dot'), css.indexOf('/* Phones: everything centred'));
  assert.match(still, /\.roster-banner-dot\{animation:none\}/);
  assert.match(still, /\.roster-banner-rotator li\{position:static;display:block;height:auto[^}]*animation:none\}/);
  assert.match(still, /\.roster-banner-rotator ul\{height:auto/);
});

test('the banner fits a desktop, a 430px phone and a 390px phone', () => {
  const css = read('roster-connect.css');
  assert.match(css, /\.roster-banner\{[^}]*grid-template-columns:minmax\(0,1fr\)/);
  // 430px and 390px screens both fall inside these two queries.
  const phone = css.slice(css.indexOf('@media(max-width:700px){'), css.indexOf('@media(max-width:400px){'));
  assert.match(phone, /\.roster-banner\{grid-template-columns:minmax\(0,1fr\)/);
  assert.match(phone, /\.roster-banner-join,\.roster-banner-login\{width:100%;max-width:330px\}/);
  assert.match(phone, /\.roster-banner-rotator li\{height:auto/, 'the announcement must wrap instead of being cut off');
  const small = css.slice(css.indexOf('@media(max-width:400px){'));
  assert.match(small, /\.roster-banner h1\{font-size:28px\}/);
  assert.match(small, /\.roster-banner-lines\{font-size:13px/);
  // Signed-in members do not need the invitation any more.
  assert.match(css, /\.members-page\[data-member-state="account"\] \.roster-banner,\n\.members-page\[data-member-state="account"\] \.roster-banner-rotator\{display:none\}/);
});

test('the front door carries the pinned announcement, the guide and the About excerpt without news', () => {
  const html = read('members.html');
  for (const marker of ['data-group-announcement', 'id="put-your-music-on-your-page"', 'class="about-excerpt"']) {
    assert.ok(html.includes(marker), `the front door is missing ${marker}`);
  }
  assert.match(html, /<a href="\/about\.html">See what ROOSTER is about/);
  assert.doesNotMatch(html, /data-whats-happening|href="#whats-happening"|>News<|src="\/news\.js/);
  const launcher = html.slice(html.indexOf('id="member-account-launcher"'), html.indexOf('</nav>', html.indexOf('id="member-account-launcher"')));
  assert.match(launcher, /href="\/?\?camera=1">Take a Pic/);
  assert.match(launcher, /href="\/morespace\.html"/);
});

test('the music guide describes the buttons the editor really has and never a Publish step', () => {
  const guide = read('music-guide.js');
  const editor = read('member-songs.js');
  assert.match(editor, /'Add song'/, 'the editor is expected to submit with Add song');
  assert.match(guide, /Press Add song/);
  assert.doesNotMatch(guide, /\bPublish\b/);
  assert.match(guide, /Replace song/);
  assert.match(guide, /Remove song/);
  assert.match(guide, /3 YouTube songs and 3 community favorites/);
  assert.match(guide, /optional for every profession/);
  assert.match(guide, /Add to my Profile Music/);
  assert.match(guide, /Music waits for Play/);
  assert.doesNotMatch(guide, /Apple Music, Spotify or YouTube link box/);
  assert.doesNotMatch(guide, /full (?:song|track) (?:will|always) play/i);
  // The editor has no file picker, so the guide must not describe one.
  assert.doesNotMatch(editor, /type\s*=\s*'file'|createElement\('input'\)[\s\S]{0,80}file/);

  const members = read('members.js');
  assert.match(members, /musicGuideElement\(\)/);
  assert.match(members, /put-your-music-on-your-page/);
  assert.match(members, /member-songs-root/);
});

/* ---------- the ROOSTER NEWS front page ---------- */

const many = (count) => Array.from({length: count}, (_, index) => story({
  id: String(index).padStart(40, 'e'), url: `https://www.billboard.com/story-${index}`,
  title: `Headline number ${index}`, featured: index === 0,
  published_at: new Date(Date.UTC(2026, 8, 6, 12) - index * 3600000).toISOString(),
  image: index === 0 ? 'https://www.billboard.com/photo/lead.jpg' : null,
}));

test('the front page holds six stories at most: one lead, two beside it and three underneath', async () => {
  assert.equal(NEWS_FRONT_PAGE, 6);
  const {newsRoot} = client({news: {ok: true, body: view({stories: many(11)})}});
  await tick(); await tick(); await tick();
  assert.equal(newsRoot.querySelectorAll('.news-story').length, 6, 'never more than six stories at once');
  assert.equal(newsRoot.querySelectorAll('.news-lead').length, 1);
  assert.equal(newsRoot.querySelector('.news-side').querySelectorAll('.news-story').length, 2);
  assert.equal(newsRoot.querySelector('.news-strip').querySelectorAll('.news-story').length, 3);
  // The lead story carries the picture the publisher attached to it.
  const picture = newsRoot.querySelector('.news-lead').querySelector('.news-story-picture');
  assert.equal(picture.querySelector('IMG').src, 'https://www.billboard.com/photo/lead.jpg');
  const more = newsRoot.querySelector('.news-more');
  assert.equal(label(more), NEWS_MORE_LABEL);
  assert.equal(NEWS_MORE_LABEL, 'MORE ROOSTER NEWS');
  more.listeners.click();
  assert.equal(newsRoot.querySelectorAll('.news-story').length, 11, 'the rest are still reachable behind the button');
});

test('the front page is a selection, not a feed: six or fewer means no More button', async () => {
  const {newsRoot} = client({news: {ok: true, body: view({stories: many(6)})}});
  await tick(); await tick(); await tick();
  assert.equal(newsRoot.querySelectorAll('.news-story').length, 6);
  assert.equal(newsRoot.querySelectorAll('.news-more').length, 0);
});

test('the trending bar shows real headlines, newest first, each opening its publisher', async () => {
  const {newsRoot} = client({news: {ok: true, body: view({stories: many(11)})}});
  await tick(); await tick(); await tick();
  const bar = newsRoot.querySelector('.news-ticker');
  assert.equal(label(bar.querySelector('.news-ticker-label')), 'TRENDING');
  const items = bar.querySelectorAll('.news-ticker-item');
  assert.ok(items.length > 0 && items.length <= 8, 'the bar stays thin');
  assert.equal(label(items[0]), 'Headline number 0');
  assert.ok(items.every(item => item.href.startsWith('https://') && item.getAttribute('rel') === null || item.rel === 'noopener noreferrer'));
  // Movement is decoration only, and it stops for anyone who asks for less motion.
  const css = read('roster-connect.css');
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)\{[\s\S]*?\.news-ticker-track\{animation:none/);
  assert.match(css, /\.news-heading\{[^}]*font-weight:900/);
  // Phones stack into one column with the lead story first.
  assert.match(css, /@media\(max-width:820px\)\{[\s\S]*?\.news-lead\{order:-1\}/);
});

test('a story keeps the publisher picture and never shows HTML or a long description', () => {
  const feed = NEWS_FEEDS[0];
  const xml = `<?xml version="1.0"?><rss xmlns:media="http://search.yahoo.com/mrss/"><channel><item>
    <title>Studio opens on the south side</title><link>https://www.billboard.com/one</link>
    <pubDate>Fri, 04 Sep 2026 10:00:00 GMT</pubDate>
    <media:content url="https://www.billboard.com/photo/one.jpg" medium="image" />
    <description><![CDATA[<p>A new room opened this week.</p><p><strong>It has</strong> a booth.</p>
      <p>${'Then a great deal more detail that nobody needs on a front page. '.repeat(8)}</p>]]></description>
  </item></channel></rss>`;
  const [parsed] = parseFeed(feed, xml, Date.parse('2026-09-07T00:00:00Z'));
  assert.equal(parsed.image, 'https://www.billboard.com/photo/one.jpg');
  assert.equal(parsed.summary, 'A new room opened this week. It has a booth.');
  assert.ok(parsed.summary.length <= 170, 'one or two short sentences only');
  assert.doesNotMatch(parsed.summary, /[<>]|&[a-z]+;/, 'no markup or raw entity reaches a story');
  assert.doesNotMatch(parsed.title, /[<>]/);
  // Only a real https image is accepted as a picture.
  for (const bad of ['http://www.billboard.com/photo/one.jpg', 'javascript:alert(1)', 'https://www.billboard.com/article', null]) {
    assert.equal(safeImageLink(bad), null);
  }
  assert.equal(briefSummary('<b>One.</b> Two. Three. Four.').includes('<'), false);
});

test('long summaries and markup stored before this update are shortened on the way out', async () => {
  const url = 'https://www.billboard.com/one';
  const stored = parseFeed(NEWS_FEEDS[0], feedXml([{title: 'Real headline', url, date: 'Fri, 04 Sep 2026 10:00:00 GMT'}]), Date.parse('2026-09-07T00:00:00Z'))[0];
  const store = memory({latest: {version: 1, fetched_at: '2026-09-06T12:00:00.000Z', stories: [{
    ...stored, summary: `<p>The first sentence is here.</p> ${'A much longer tail of description text. '.repeat(6)}`,
    image: 'http://insecure.example/photo.jpg',
  }]}});
  const result = await newsView(store, Date.parse('2026-09-07T00:00:00Z'));
  assert.equal(result.stories.length, 1);
  assert.equal(result.stories[0].summary, 'The first sentence is here. A much longer tail of description text.');
  assert.doesNotMatch(result.stories[0].summary, /[<>]/);
  assert.equal(result.stories[0].image, null, 'an insecure picture is dropped, not repaired');
});
