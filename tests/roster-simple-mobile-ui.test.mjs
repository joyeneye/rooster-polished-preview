import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {extname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = name => readFileSync(resolve(root, name), 'utf8');
// The pages that still run the legacy site shell: one .site-nav on desktop and
// one .mobile-site-nav on phones. The front page is not one of them any more —
// it runs the app shell (rail, five-item phone bar, All of ROOSTER sheet) and is
// covered by its own test below, because a second bottom bar there would sit
// straight on top of the WYD/LIVE/Create/Rooms/Inbox bar.
const mainPages = [
  'members.html',
  'opportunities.html',
  'apply.html',
  'people.html',
  'member-photos.html',
  'edit-profile.html',
  'photos.html',
];

// Seven destinations stay directly visible. Every room type now enters through
// one Rooms hub while the account has one short, consistent label everywhere.
const desktopDirect = [
  [/^Home$/, /^\/?#home$/],
  [/^OPPORTUNITIES$/, /^\/opportunities\.html$/],
  [/^ROOMS$/, /^\/live\.html$/],
  [/^My Profile$/, /^\/my-profile\.html$/, 'data-my-profile'],
  [/^RADIO$/, /^\/radio\.html$/],
  [/^Messages$/, /^\/members\.html#member-mail$/, 'data-message-inbox'],
  [/^Account$/, /^\/members\.html$/],
];
const requiredMore = [
  [/^TOP 25$/, /^\/top25\.html$/],
  [/^Profile Music$/, /^\/my-profile\.html\?view=songs$/],
  [/^Wall$/, /^\/#comments$/],
  [/^People$/, /^\/people\.html$/],
  [/^Requests$/, /^\/members\.html#friend-requests$/],
  [/^About$/, /^\/about\.html$/],
  [/^Booking$/, /^\/?#booking$/],
];
// Destinations that existed before the cleanup and must survive it.
const keptMore = [
  [/^My Photos$/, /^\/my-profile\.html\?view=photos$/, 'data-my-photos'],
];
const removedMoreLabels = /^(?:My Roster|The Roster|Search the Roster|Roster Requests|ROOSTER Search|Request an Invite)$/i;
const desktopPages = [
  'members.html', 'people.html',
  'member-photos.html', 'edit-profile.html', 'top25.html', 'about.html', 'morespace.html',
  'opportunities.html', 'apply.html',
];

function attribute(attributes, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = attributes.match(new RegExp(`(?:^|\\s)${escaped}(?:\\s*=\\s*(["'])(.*?)\\1)?(?=\\s|$)`, 'i'));
  return match ? (match[2] ?? true) : null;
}

function hasClass(attributes, token) {
  const value = attribute(attributes, 'class');
  return typeof value === 'string' && value.split(/\s+/).includes(token);
}

function navByClass(html, className, page) {
  for (const match of html.matchAll(/<nav\b([^>]*)>([\s\S]*?)<\/nav>/gi)) {
    if (hasClass(match[1], className)) return {attributes: match[1], body: match[2], html: match[0]};
  }
  assert.fail(`${page} is missing .${className}`);
}

function cleanText(markup) {
  return markup
    .replace(/<span\b[^>]*aria-hidden=["'][^"']*["'][^>]*>[\s\S]*?<\/span>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&rsquo;/gi, '’')
    .replace(/\s+/g, ' ')
    .trim();
}

function anchors(markup) {
  return [...markup.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map(match => ({
    attributes: match[1],
    href: attribute(match[1], 'href'),
    label: cleanText(match[2]),
    html: match[0],
  }));
}

function balancedAtRules(css, name = '@media') {
  const blocks = [];
  let cursor = 0;
  while ((cursor = css.indexOf(name, cursor)) !== -1) {
    const open = css.indexOf('{', cursor);
    if (open === -1) break;
    let depth = 1;
    let end = open + 1;
    while (end < css.length && depth) {
      if (css[end] === '{') depth += 1;
      else if (css[end] === '}') depth -= 1;
      end += 1;
    }
    assert.equal(depth, 0, `unclosed ${name} block in CSS`);
    blocks.push({start: cursor, end, heading: css.slice(cursor, open), body: css.slice(open + 1, end - 1)});
    cursor = end;
  }
  return blocks;
}

function withoutRanges(text, ranges) {
  let result = '';
  let cursor = 0;
  for (const range of ranges) {
    result += text.slice(cursor, range.start);
    cursor = range.end;
  }
  return result + text.slice(cursor);
}

function localDestination(page, href) {
  assert.equal(typeof href, 'string', `${page} has a mobile navigation item without an href`);
  const url = new URL(href, `https://roster.test/${page}`);
  assert.equal(url.origin, 'https://roster.test', `${page} mobile navigation must stay on ROOSTER`);
  let target = decodeURIComponent(url.pathname).slice(1) || 'index.html';
  if (!extname(target)) target += '.html';
  assert.ok(existsSync(resolve(root, target)), `${page} mobile navigation points to missing ${target}`);
  if (!url.hash) return;
  const targetHtml = read(target);
  const id = decodeURIComponent(url.hash.slice(1));
  assert.match(targetHtml, new RegExp(`\\bid=["']${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`), `${page} mobile navigation points to missing ${target}#${id}`);
}

function splitNav(page, className) {
  const nav = navByClass(read(page), className, page);
  const details = [...nav.body.matchAll(/<details\b[^>]*>[\s\S]*?<\/details>/gi)];
  assert.equal(details.length, 1, `${page} .${className} needs exactly one native More menu`);
  assert.equal(cleanText(details[0][0].match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/i)?.[1] || ''), 'More',
    `${page} .${className} needs More as its overflow menu`);
  return {nav, menu: details[0][0], direct: anchors(nav.body.replace(details[0][0], ''))};
}

function expectLinks(page, where, links, expected) {
  for (const [label, href, hook] of expected) {
    const link = links.find(candidate => label.test(candidate.label));
    assert.ok(link, `${page} ${where} is missing ${label}`);
    assert.match(link.href, href, `${page} ${where} ${link.label} points to the wrong place`);
    if (hook) assert.equal(attribute(link.attributes, hook), true, `${page} ${link.label} needs the ${hook} router hook`);
  }
}

test('the desktop navigation keeps one Rooms choice and hides the rest under More', () => {
  for (const page of desktopPages) {
    const {direct, menu} = splitNav(page, 'site-nav');
    assert.equal(direct.length, desktopDirect.length,
      `${page} desktop navigation must show exactly seven links beside More`);
    direct.forEach((link, index) => {
      const [label, href, hook] = desktopDirect[index];
      assert.match(link.label, label, `${page} desktop link ${index + 1} is in the wrong place`);
      assert.match(link.href, href, `${page} ${link.label} points to the wrong place`);
      if (hook) assert.equal(attribute(link.attributes, hook), true, `${page} ${link.label} needs the ${hook} hook`);
    });
    assert.ok(direct.some(link => attribute(link.attributes, 'data-message-inbox') === true),
      `${page} Messages needs data-message-inbox so the red unread badge still paints`);
    const moreLinks = anchors(menu);
    expectLinks(page, 'More', moreLinks, requiredMore);
    expectLinks(page, 'More', moreLinks, keptMore);
    assert.equal(moreLinks.length, requiredMore.length + keptMore.length,
      `${page} More must contain only the eight simple destinations`);
    assert.equal(moreLinks.filter(link => link.label === 'Requests').length, 1,
      `${page} More needs exactly one Requests choice`);
    assert.equal(moreLinks.some(link => removedMoreLabels.test(link.label)), false,
      `${page} More must not repeat old roster or invite destinations`);
    for (const link of [...direct, ...moreLinks]) localDestination(page, link.href);
  }
  assert.equal([...read('photos.html').matchAll(/<nav\b([^>]*)>/gi)].some(match => hasClass(match[1], 'site-nav')), false,
    'photos.html did not have a desktop navigation bar and should not gain one');
});

test('desktop navigation stays visible while the seven item mobile navigation is phone only', () => {
  const css = read('style.css');
  const media = balancedAtRules(css);
  const desktopCss = withoutRanges(css, media);
  const phone = media.find(block => /max-width\s*:\s*760px/i.test(block.heading));

  assert.ok(phone, 'style.css needs a max-width:760px mobile navigation block');
  assert.match(desktopCss, /(?:^|})\s*\.site-nav\s*\{[^}]*\bdisplay\s*:\s*flex/i,
    'the existing site navigation must remain visible on desktop');
  assert.match(desktopCss, /(?:^|})\s*\.mobile-site-nav\s*\{[^}]*\bdisplay\s*:\s*none/i,
    'the mobile navigation must be hidden by default on desktop');
  assert.doesNotMatch(desktopCss, /\.site-nav\s*\{[^}]*\bdisplay\s*:\s*none/i,
    'desktop CSS must not hide the existing site navigation');
  assert.match(phone.body, /(?:^|})\s*\.site-nav\s*\{[^}]*\bdisplay\s*:\s*none\s*!important/i,
    'the old navigation must be hidden only at the phone breakpoint, including on the members page');
  assert.match(phone.body, /(?:^|})\s*\.mobile-site-nav\s*\{[^}]*\bdisplay\s*:\s*(?:grid|flex)/i,
    'the separate mobile navigation must appear at the phone breakpoint');
});

test('member music keeps the owner player look, visible counters and phone-safe controls', () => {
  const profile = read('profile.html');
  const songs = read('songs.css');
  const player = read('profile-songs.js');
  // The version token moves with each release; what matters is that both sheets ship.
  assert.match(profile, /music\.css\?v=[\w.-]+/);
  assert.match(profile, /songs\.css\?v=[\w.-]+/);
  assert.match(player, /retro-player member-profile-player/);
  assert.match(player, /retro-track-plays/);
  assert.match(player, /Plays today:/);
  assert.match(player, /Total plays:/);
  assert.match(songs, /\.member-profile-player \.member-profile-track\{[^}]*grid-template-columns:[^}]*minmax\(0,1fr\)/);
  const phone = balancedAtRules(songs).find(block => /max-width\s*:\s*760px/i.test(block.heading) && /member-profile-player/.test(block.body));
  assert.ok(phone, 'member player needs a phone layout at 760px');
  assert.match(phone.body, /member-profile-track\{[^}]*min-height:58px/);
  assert.match(phone.body, /song-open-service\{[^}]*min-height:44px/);
  assert.match(phone.body, /retro-footer\{[^}]*align-items:center/);
});

test('every main page keeps the same simple mobile choices with Account always reachable', () => {
  const directExpected = [
    ['Home', /^\/?#home$/],
    ['OPPORTUNITIES', /^\/opportunities\.html$/],
    ['ROOMS', /^\/live\.html$/],
    ['My Profile', /^\/my-profile\.html$/],
    ['RADIO', /^\/radio\.html$/],
    ['Messages', /^\/members\.html#member-mail$/],
    ['Account', /^\/members\.html$/],
  ];
  const moreExpected = [
    [/^TOP 25$/i, '/top25.html'],
    [/^Profile Music$/i, '/my-profile.html?view=songs'],
    [/^Wall$/i, '/#comments'],
    [/^People$/i, '/people.html'],
    [/^Requests$/i, '/members.html#friend-requests'],
    [/^My Photos$/i, '/my-profile.html?view=photos', 'data-my-photos'],
    [/^About$/i, '/about.html'],
    [/^Booking$/i, '/#booking'],
  ];

  for (const page of mainPages) {
    const nav = navByClass(read(page), 'mobile-site-nav', page);
    assert.match(nav.attributes, /\baria-label=["'][^"']+["']/i, `${page} mobile navigation needs an accessible label`);
    const details = [...nav.body.matchAll(/<details\b[^>]*>[\s\S]*?<\/details>/gi)];
    assert.equal(details.length, 1, `${page} mobile navigation needs one native More menu`);
    const directMarkup = nav.body.replace(details[0][0], '');
    const direct = anchors(directMarkup);
    assert.equal(direct.length, directExpected.length,
      `${page} must keep exactly seven mobile destinations outside More`);
    direct.forEach((link, index) => {
      const [label, href] = directExpected[index];
      assert.equal(link.label, label, `${page} mobile link ${index + 1} is in the wrong place`);
      assert.match(link.href, href, `${page} mobile ${link.label} points to the wrong place`);
    });
    assert.equal(cleanText(details[0][0].match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/i)?.[1] || ''), 'More',
      `${page} needs More as its overflow menu`);

    assert.ok(direct.some(link => attribute(link.attributes, 'data-message-inbox') === true),
      `${page} mobile Messages needs data-message-inbox so the unread badge still paints`);
    assert.ok(direct.some(link => hasClass(link.attributes, 'mobile-nav-join')),
      `${page} Account needs its own full width mobile row`);

    const moreLinks = anchors(details[0][0]);
    assert.equal(moreLinks.length, moreExpected.length,
      `${page} More must contain only the eight simple destinations`);
    for (const [label, href, hook] of moreExpected) {
      const link = moreLinks.find(candidate => label.test(candidate.label));
      assert.ok(link, `${page} More is missing ${label}`);
      assert.match(link.href, new RegExp(`^/?${href.replace(/^\//, '').replace(/[.?]/g, character => `\\${character}`)}$`),
        `${page} ${label} points to the wrong place`);
      if (hook) assert.equal(attribute(link.attributes, hook), true, `${page} ${link.label} needs the existing ${hook} router hook`);
    }
    assert.equal(moreLinks.filter(link => link.label === 'Requests').length, 1,
      `${page} More needs exactly one Requests choice`);
    assert.equal(moreLinks.some(link => removedMoreLabels.test(link.label)), false,
      `${page} More must not repeat old roster or invite destinations`);

    for (const link of [...direct, ...moreLinks]) localDestination(page, link.href);
  }
});

test('the front page app shell keeps every required destination', () => {
  const home = read('index.html');
  const rail = home.match(/<aside class="community-rail[\s\S]*?<\/aside>/)?.[0] || '';
  const bar = navByClass(home, 'mobile-community-nav', 'index.html');
  const sheet = home.match(/<dialog id="mobile-more-sheet"[\s\S]*?<\/dialog>/)?.[0] || '';
  assert.ok(rail && sheet, 'the front page needs the desktop rail and the All of ROOSTER sheet');
  assert.equal([...home.matchAll(/<nav\b([^>]*)>/gi)].filter(match => hasClass(match[1], 'mobile-site-nav')).length, 0,
    'the front page must not carry a second bottom bar under the app bar');
  assert.match(bar.attributes, /\baria-label=["'][^"']+["']/i, 'the phone bar needs an accessible label');

  // Home, Discover, Take Pic, Rooms and Inbox, in that order and nothing else.
  const barLinks = [...bar.body.matchAll(/<(?:a|button)\b([^>]*)>([\s\S]*?)<\/(?:a|button)>/gi)]
    .map(match => ({attributes: match[1], label: cleanText(match[2])}));
  assert.deepEqual(barLinks.map(item => item.label), ['Home', 'Discover', 'Take Pic', 'Rooms', 'Inbox']);
  assert.ok(barLinks.some(item => attribute(item.attributes, 'data-message-inbox') === true),
    'the phone bar Inbox needs data-message-inbox so the unread badge still paints');
  assert.ok(barLinks.some(item => attribute(item.attributes, 'data-slots-camera') !== null),
    'the phone bar Take Pic needs the camera hook');

  // Every top-level destination remains one tap away. Individual room types
  // intentionally live together behind the one Rooms destination.
  const reachable = rail + sheet + bar.html;
  for (const destination of [
    '/live.html', '/radio.html', '/my-profile.html?view=songs',
    '/opportunities.html', '/top25.html', '/people.html',
    '/about.html', '/booking', '/my-profile.html',
    '/my-profile.html?view=photos', '/members.html',
    '/members.html#member-mail', '/members.html#friend-requests',
  ]) {
    assert.ok(reachable.includes(`href="${destination}"`), `the front page shell lost ${destination}`);
  }
  const sheetLinks = anchors(sheet);
  assert.equal(sheetLinks.filter(link => link.label === 'People').length, 1,
    'the front page sheet needs exactly one People choice');
  assert.equal(sheetLinks.filter(link => link.label === 'Requests').length, 1,
    'the front page sheet needs exactly one Requests choice');
  assert.equal(sheetLinks.some(link => removedMoreLabels.test(link.label)), false,
    'the front page sheet must not repeat old roster or invite destinations');
  const rooms = read('live.html');
  for (const destination of ['/live.html?medium=audio', '/review-room.html', '/members.html#member-chat']) {
    assert.ok(rooms.includes(`href="${destination}"`), `the Rooms hub lost ${destination}`);
  }
  assert.ok(!reachable.includes('href="/jwhite.html"'), 'the front page shell must not expose a J.White page navigation entry');
  for (const [attributeName, where] of [['data-my-profile', 'Your Profile'], ['data-my-photos', 'My Photos']]) {
    assert.match(reachable, new RegExp(`\\b${attributeName}\\b`), `the front page shell lost the ${where} router hook`);
  }
  // /booking is a netlify.toml redirect rather than a file, so it is checked
  // against the redirect table instead of the filesystem.
  assert.match(read('netlify.toml'), /from = "\/booking"[\s\S]{0,80}to = "\/booking-marketplace\.html"/);
  for (const link of anchors(reachable)) {
    if (link.href.startsWith('/booking')) continue;
    localDestination('index.html', link.href);
  }
});

test('WYD keeps Top 8 and the four creation tools above the FYP', () => {
  const home = read('index.html');
  const tabs = home.indexOf('class="feed-tabs"');
  const fyp = home.indexOf('id="fyp"');
  const topEight = home.indexOf('class="slots-top-eight"');
  const create = home.indexOf('class="slots-quick-compose"');
  assert.ok(topEight !== -1 && topEight < create, 'Top 8 must be the first community feature');
  assert.ok(create < tabs && tabs < fyp, 'creation tools and feed tabs must sit above the FYP');
  assert.match(home.slice(fyp), /class="fyp-vibe"[^>]*>[\s\S]*FYP[\s\S]*Scroll · tap sound · double-tap YEP/);
  assert.match(read('community-home.js'), /roster-action-label">YEP<\/span>/, 'the feed reaction must use the YEP name');
  assert.match(home.slice(create, tabs), />Post<[\s\S]*>Song<[\s\S]*>Take a Pic<[\s\S]*>Room</);
});

test('the FYP double-tap likes the real post and gives clear feedback', () => {
  const client = read('community-home.js');
  const styles = read('slots.css');
  assert.match(client, /stageColumn\?\.addEventListener\('pointerup'/);
  assert.match(client, /post\.viewer\.liked \|\| !likeButton/);
  assert.match(client, /burstStageHeart\(panel\);\s*likeButton\.click\(\)/);
  assert.match(styles, /\.fyp-heart-burst\{/);
  assert.match(styles, /touch-action:pan-y/);
});

test('WYD uses its own bottom reaction dock instead of a TikTok-style side rail', () => {
  const client = read('community-home.js');
  const styles = read('slots.css');
  assert.match(client, /roster-clip-rail-note[^>]*>\$\{item\.label\}/);
  assert.match(styles, /\.roster-clip-rail\{right:10px!important;bottom:var\(--slots-dock-bottom\)!important;left:10px!important/);
  assert.match(styles, /grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
});

test('the My Roster hook routes signed out visitors, members and J.White to the right roster', async () => {
  const source = read('community.js');
  const friendLink = {href: ''};
  let domReady;
  const document = {
    readyState: 'loading',
    visibilityState: 'visible',
    querySelector: () => null,
    querySelectorAll: selector => selector === '[data-my-friends]' ? [friendLink] : [],
    addEventListener(type, listener) { if (type === 'DOMContentLoaded') domReady = listener; },
    createElement: () => ({classList: {add() {}}, dataset: {}}),
  };
  const response = {ok: false, status: 401, json: async () => ({error: 'Log in'})};
  const context = {
    window: {addEventListener() {}}, document,
    location: {href: 'https://jwhitedidit.net/', pathname: '/', origin: 'https://jwhitedidit.net'},
    sessionStorage: {getItem: () => null, setItem() {}},
    crypto: {randomUUID: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},
    AbortController, URL, URLSearchParams, encodeURIComponent,
    fetch: async () => response,
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1,
  };
  const {runInNewContext} = await import('node:vm');
  runInNewContext(source, context);
  assert.equal(typeof domReady, 'function', 'community navigation did not wait for DOM readiness');
  domReady();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(friendLink.href, '/#jwhite-friend-space', 'signed out My Roster must safely fall back to J.White');
  context.window.JWhiteCommunity.setUser({id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', verified_owner: false});
  assert.equal(friendLink.href, '/profile.html?id=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb#friend-space',
    'a member must reach their own roster');
  context.window.JWhiteCommunity.setUser({id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', verified_owner: true});
  assert.equal(friendLink.href, '/#jwhite-friend-space', 'J.White must reach the owner roster');
});

test('every true Messages link can show the same accessible red unread count', async () => {
  for (const page of mainPages) {
    const nav = navByClass(read(page), 'mobile-site-nav', page);
    const messages = anchors(nav.body).find(link => link.label === 'Messages');
    assert.ok(messages, `${page} is missing Messages`);
    assert.equal(attribute(messages.attributes, 'data-message-inbox'), true, `${page} Messages needs the unread badge hook`);
  }
  assert.equal((read('index.html').match(/data-message-inbox/g) || []).length, 2, 'home needs the rail and the phone bar Messages badges');
  assert.equal((read('members.html').match(/data-message-inbox/g) || []).length, 3, 'member account needs desktop, mobile and account Messages badges');
  assert.doesNotMatch(read('profile.html').match(/id="public-profile-message"[^>]*>/)?.[0] || '', /data-message-inbox/,
    'Send Message on another profile must not show the signed-in member inbox count');

  const css = read('style.css');
  assert.match(css, /\.message-unread-badge\{[^}]*background:#e5092f[^}]*color:#fff/i);
  assert.match(css, /\.message-unread-badge\[hidden\]\{[^}]*display:none!important/i);
  assert.match(css, /prefers-reduced-motion:reduce[^}]*\.message-unread-badge\{animation:none/i);

  class Link {
    constructor() {this.children=[];this.attributes={};this.dataset={};}
    append(node) {this.children.push(node);}
    querySelector(selector) {return selector==='.message-unread-badge' ? this.children.find(node=>node.className==='message-unread-badge') || null : null;}
    setAttribute(name,value) {this.attributes[name]=value;}
    removeAttribute(name) {delete this.attributes[name];}
  }
  const links=[new Link(),new Link()];let ready;const listeners={};
  const document={
    readyState:'loading',visibilityState:'visible',querySelector:()=>null,
    querySelectorAll:selector=>selector==='[data-message-inbox]'?links:[],
    addEventListener(type,listener){if(type==='DOMContentLoaded')ready=listener;},
    createElement(){return {dataset:{},className:'',textContent:'',hidden:false,attributes:{},setAttribute(name,value){this.attributes[name]=value;}};},
  };
  const member={id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',verified_owner:false};
  const fetch=async(path)=>{
    const data=path==='/api/profile/me'?{profile:member}:path==='/api/member-messages/unread'?{user:{id:member.id},unread_count:7}:{};
    return {ok:true,status:200,json:async()=>data};
  };
  const context={
    window:{addEventListener(type,listener){(listeners[type]??=[]).push(listener);}},document,fetch,
    location:{href:'https://jwhitedidit.net/',pathname:'/',origin:'https://jwhitedidit.net'},
    sessionStorage:{getItem:()=>null,setItem(){}},crypto:{randomUUID:()=> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},
    AbortController,URL,URLSearchParams,encodeURIComponent,setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,
  };
  const {runInNewContext}=await import('node:vm');runInNewContext(read('community.js'),context);ready();
  await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));
  for(const link of links){assert.equal(link.children[0].textContent,'7');assert.equal(link.children[0].hidden,false);assert.equal(link.attributes['aria-label'],'Messages, 7 new messages');}
  listeners['jwhite:messages-changed'][0]({detail:{count:104}});
  for(const link of links){assert.equal(link.children[0].textContent,'99+');assert.equal(link.attributes['aria-label'],'Messages, 104 new messages');}
  context.window.JWhiteCommunity.setUser(null);
  for(const link of links){assert.equal(link.children[0].hidden,true);assert.equal(link.attributes['aria-label'],undefined);}
});

test('the ROOSTER header now says it is a place for people', () => {
  for (const page of ['index.html','people.html','profile.html']) assert.match(read(page), /a place for people\./i);
  assert.doesNotMatch(`${read('index.html')}\n${read('people.html')}\n${read('profile.html')}`, /a place for the music\./i);
});

test('ROOSTER remains the product brand while WYD names only the feed', () => {
  const home = read('index.html');
  assert.match(home, /<title>ROOSTER — Home<\/title>/, 'the page title must keep ROOSTER as the app name');
  for (const [name, value] of [
    ['application-name', 'ROOSTER'],
    ['apple-mobile-web-app-title', 'ROOSTER'],
  ]) {
    assert.match(home, new RegExp(`<meta\\s+name=["']${name}["']\\s+content=["']${value}["']`, 'i'), `${name} must remain ROOSTER`);
  }
  assert.match(home, /<meta\s+property=["']og:site_name["']\s+content=["']ROOSTER["']/i, 'og:site_name must remain ROOSTER');
  assert.match(home, /<span class="slots-kicker">WYD FEED<\/span><h1>What’s happening\?<\/h1>/, 'WYD must read as a feed inside ROOSTER, not the app name');
  assert.match(home, /aria-label=["']Feed filters["']/i, 'the feed needs a clear accessible label');

  const manifest = JSON.parse(read('site.webmanifest'));
  assert.equal(manifest.name, 'ROOSTER', 'the installed app name must remain ROOSTER');
  assert.equal(manifest.short_name, 'ROOSTER', 'the installed short name must remain ROOSTER');
  assert.doesNotMatch(JSON.stringify(manifest), /\bWYD\b/i, 'the install manifest must not rename the app to WYD');

  const startup = read('roster-startup.js');
  assert.match(startup, /src=["']\/assets\/roster-logo\.webp["']/, 'the splash must keep the approved ROOSTER logo');
  assert.doesNotMatch(startup.match(/function startup[\s\S]*$/)?.[0] || startup, /WYD (?:logo|app|platform|product)/i,
    'the splash must not present WYD as the product brand');

  for (const page of ['about.html', 'apply.html', 'edit-profile.html', 'members.html', 'morespace.html', 'opportunities.html', 'profile.html', 'radio.html', 'top25.html']) {
    const html = read(page);
    assert.doesNotMatch(html, /©\s*J\.White Did It/i, `${page} must not use the creator name as the app legal brand`);
    assert.match(html, /©\s*2026 ROOSTER/i, `${page} must carry the ROOSTER legal brand`);
  }
});

test('member profiles use the shared futuristic ROOSTER profile shell', () => {
  const html = read('profile.html');
  const mobile = navByClass(html, 'profile-mobile-nav', 'profile.html');
  assert.deepEqual(anchors(mobile.body).map(link => link.label), ['Home', 'Discover', 'Create', 'Rooms', 'Inbox']);
  assert.match(html, /class=["']profile-hero["']/, 'the profile needs the premium member hero');
  assert.match(html, /data-profile-owner-only/, 'the profile needs owner-only creation actions');
  assert.match(html, /data-top-eight-roster/, 'the profile must keep the persisted Top 8 client');
  assert.match(html, /data-profile-tab=["']posts["'][\s\S]*data-profile-tab=["']songs["'][^>]*>Profile Music[\s\S]*data-profile-tab=["']photos["'][\s\S]*data-profile-tab=["']about["']/, 'the profile needs a clearly personal music tab');
  assert.match(html, /id=["']profile-room-preview["']/, 'the profile needs a real live-room preview target');
  assert.doesNotMatch(html, /roster-player\.js/, 'the SLOTS player must never carry onto another member profile');
  assert.match(html, /profile-songs\.js/, 'each profile must keep its own member-scoped music player');
  assert.match(html, />ORBIT Radio</, 'radio must stay a separate destination from profile music');
  assert.doesNotMatch(html, />\s*J\.?White(?:’s|'s)? Page\s*</i, 'the profile shell must not expose a J.White navigation tab');

  const type = read('roster-type.css');
  for (const family of ['Chakra Petch', 'Space Mono', 'Orbitron']) assert.match(type, new RegExp(`font-family:\\"${family}\\"`), `${family} must be bundled`);
  assert.match(read('profile-experience.css'), /var\(--roster-display\)/, 'the hero name must use the square display face');
  assert.match(read('my-profile.js'), /\/profile\.html\?id=/, 'the signed-in owner route must use the shared profile experience');
});

test('personal music and ORBIT never share the floating SLOTS player', () => {
  const startup = read('roster-startup.js');
  const profile = read('profile.html');
  const radio = read('radio.html');
  assert.doesNotMatch(startup, /createElement\('script'\).*roster-player/s);
  assert.doesNotMatch(profile, /src=["']\/roster-player\.js/);
  assert.match(profile, /src=["']profile-songs\.js/);
  assert.doesNotMatch(radio, /src=["']\/roster-player\.js/);
  assert.doesNotMatch(radio, /id=["']music-library["']|src=["']\/music\.js/);
  assert.doesNotMatch(read('index.html'), /src=["']\/roster-player\.js/, 'WYD must not carry personal music around the app');
  assert.match(read('my-profile.js'), /view===['"]songs['"]/);
});

test('first login Start Here is inline, hidden by default and points to the four setup actions', () => {
  const html = read('members.html');
  const start = html.match(/<section\b([^>]*\bid=["']member-start-here["'][^>]*)>([\s\S]*?)<\/section>/i);
  assert.ok(start, 'members.html needs a semantic #member-start-here section');
  assert.equal(attribute(start[1], 'hidden'), true, 'Start Here must be hidden until a confirmed first login is known');
  const labelledBy = attribute(start[1], 'aria-labelledby');
  assert.equal(typeof labelledBy, 'string', 'Start Here needs aria-labelledby');
  assert.match(start[2], new RegExp(`\\bid=["']${labelledBy}["']`), 'Start Here heading must match aria-labelledby');
  assert.match(cleanText(start[2]), /\bStart Here\b/i, 'the setup panel needs a clear Start Here heading');
  assert.doesNotMatch(start[0], /<dialog\b|\baria-modal\s*=|<form\b/i, 'Start Here must stay inline and nonblocking');

  const setupLinks = anchors(start[2]);
  const expected = [
    [/Profile/i, '#member-profile-panel'],
    [/Music/i, '#member-songs-root'],
    [/Photos/i, '#member-photo-album'],
    [/Roster/i, '/people.html'],
  ];
  assert.equal(setupLinks.length, expected.length, 'Start Here should contain only the four essential setup steps');
  for (const [label, href] of expected) {
    const link = setupLinks.find(candidate => label.test(candidate.label));
    assert.ok(link, `Start Here is missing ${label}`);
    assert.equal(link.href, href, `Start Here ${link.label} points to the wrong tool`);
    localDestination('members.html', link.href);
  }

  const onboardingSource = `${read('members.js')}\n${read('member-profile.js')}`;
  assert.match(onboardingSource, /member-start-here/, 'the member client must control Start Here after profile loading');
  assert.match(onboardingSource, /updated_at\s*===?\s*null/, 'Start Here must be limited to the exact first-login profile state');
});

test('signup clearly discloses J.White as the first name on your roster and the public connected wall welcome', () => {
  const html = read('members.html');
  const start = html.indexOf('id="member-signup"');
  const end = html.indexOf('id="member-forgot"', start);
  assert.ok(start >= 0 && end > start, 'member signup region is missing');
  const signup = cleanText(html.slice(start, end));
  assert.match(signup, /J\.White.{0,120}first name on your roster/i, 'signup must disclose that J.White is added to your roster automatically');
  assert.match(signup, /You[’']re connected\. Let[’']s get it\./i, 'signup must disclose the exact automatic wall message');
  assert.match(signup, /\bwall\b/i, 'signup must explain that the welcome is a public wall post');
});

test('mobile account destinations keep one Requests tool and valid deep links after login', () => {
  const html = read('members.html');
  const script = read('members.js');
  for (const id of ['member-mail', 'member-chat', 'friend-requests', 'member-profile-panel', 'member-songs-root', 'member-photo-album', 'member-clips-root']) {
    assert.match(html, new RegExp(`\\bid=["']${id}["']`), `members.html is missing the #${id} account tool`);
  }
  assert.doesNotMatch(html, /\bid=["']invite-people["']|\bdata-account-go=["']invite["']/,
    'the signed-in account must not keep a second Invite to ROOSTER tool');

  const launcher = html.match(/<nav\b[^>]*\bid=["']member-account-launcher["'][^>]*>([\s\S]*?)<\/nav>/i)?.[1] || '';
  assert.ok(launcher, 'members.html needs the signed-in account launcher');
  assert.equal(anchors(launcher).filter(link => link.label === 'Requests').length, 1,
    'the signed-in account launcher needs exactly one Requests choice');

  const destinations = script.match(/let\s+memberDestinationIntent\s*=\s*\[([^\]]+)\]\.includes\(startingHash\)/)?.[1] || '';
  for (const hash of ['#member-mail', '#member-chat', '#friend-requests']) {
    assert.ok(destinations.includes(`'${hash}'`) || destinations.includes(`"${hash}"`), `${hash} must survive login as an account destination`);
  }
  assert.equal(destinations.includes('#invite-people'), false,
    '#invite-people must not survive as a signed-in account destination');
  assert.match(script, /byId\(memberDestinationIntent\.slice\(1\)\)\.scrollIntoView/, 'account deep links must scroll to the requested tool after login');
});

test('ROOSTER starts warm and light while keeping one simple light or dark appearance choice', () => {
  const startup = read('roster-startup.js');
  const theme = read('roster-theme.css');
  assert.match(startup, /localStorage\.setItem\(THEME_KEY, next\)/, 'the visitor theme choice must persist on this device');
  assert.match(startup, /data-roster-theme-toggle/, 'the shared app shell must provide one appearance button');
  assert.match(theme, /data-roster-theme="dark"/, 'the black theme stylesheet is missing');
  assert.match(startup, /return localStorage\.getItem\(THEME_KEY\) === 'dark' \? 'dark' : 'light'/, 'first-time visitors must start with the readable light background');
});

test('profiles reshape themselves around each member’s real work', () => {
  const profile = read('profile.js');
  const members = read('members.html');
  assert.match(profile, /ALYSA\.JORDANN HAIR/);
  assert.match(profile, /CRISPBYJMALONE BARBERING/);
  assert.match(profile, /REALLYFE STREETSTARS/);
  assert.match(profile, /PODCAST • INTERVIEWS • CULTURE/);
  assert.match(members, /Hair \/ Beauty Products/);
  assert.match(members, /Journalist \/ Media/);
  assert.match(members, /Podcaster \/ Host/);
});
