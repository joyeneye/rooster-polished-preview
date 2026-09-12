import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';

const source = readFileSync(new URL('../profile-owner.js', import.meta.url), 'utf8');
const DEFAULT_HTML = '<p><strong>J.White Did It.</strong> For the love of music.</p>';
const tick = () => new Promise(resolve => setImmediate(resolve));
const escapeHTML = value => value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');

class Element {
  constructor(html = '') { this.html = html; this.writes = []; this.listeners = {}; this.attributes = new Map(); this.style = {}; }
  get innerHTML() { return this.html; }
  set innerHTML(value) { this.writes.push({kind:'html',value}); this.html = String(value); delete this.text; }
  get textContent() { return this.text ?? this.html.replace(/<[^>]*>/g,''); }
  set textContent(value) { this.writes.push({kind:'text',value}); this.text = String(value); this.html = escapeHTML(String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  set src(value) { this.attributes.set('src',value); }
  get src() { return this.getAttribute('src'); }
  addEventListener(type,listener) { this.listeners[type] = listener; }
}

async function environment({about = 'The music never stops.', status = true, photo = false, failure = null, details = false} = {}) {
  const bio = new Element(DEFAULT_HTML);
  const tagline = status ? new Element('MORE!') : null;
  const portrait = photo ? new Element() : null;
  const facts = details ? {
    '#owner-title-lines':new Element('Producer.<br>Music executive.'),
    '#owner-credentials':new Element('Grammy winner<br>2X Diamond<br>HitMob founder'),
    '#owner-location':new Element('Leavenworth, Kansas<br>United States'),
  } : {};
  if (portrait) portrait.src = '/original.jpg';
  const calls = [], events = {}, docEvents = {};
  let time = 10_000;
  let data = {profile:{id:'owner-id',status:'MORE HITS',about_me:about,photo_url:'/profile.jpg'}};
  let error = failure;
  let ok = true;
  const document = {
    hidden:false,
    querySelector:selector => selector === '[data-owner-about]' ? bio : selector === '.profile-tagline' ? tagline : facts[selector] ?? null,
    querySelectorAll:selector => selector === '[data-owner-photo]' ? (portrait ? [portrait] : []) : selector === '[data-owner-about]' ? [bio] : [],
    addEventListener:(type,listener) => { docEvents[type] = listener; },
  };
  vm.runInNewContext(source, {
    document,
    window:{addEventListener:(type,listener) => { events[type] = listener; }},
    AbortController,
    Date:class extends Date { static now() { return time; } },
    setTimeout:() => 1,
    clearTimeout:() => {},
    fetch:async (url,options) => {
      calls.push({url,options});
      if (error) throw error;
      return {ok,json:async () => data};
    },
  });
  await tick();
  return {
    bio,tagline,portrait,facts,calls,events,docEvents,document,
    setProfile(profile) { data = {profile:{id:'owner-id',status:'MORE HITS',photo_url:'/profile.jpg',...profile}}; },
    fail(value = new Error('Network unavailable')) { error = value; },
    status(value) { ok = value; },
    async focus() { time += 6000; events.focus(); await tick(); },
    async visibility(hidden) { time += 6000; document.hidden = hidden; docEvents.visibilitychange(); await tick(); },
  };
}

test('custom owner bio is rendered as literal text, including hostile HTML', async () => {
  const hostile = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
  const state = await environment({about:hostile});
  assert.equal(state.bio.textContent,hostile);
  assert.equal(state.bio.innerHTML,escapeHTML(hostile));
  assert.ok(state.bio.writes.some(write => write.kind === 'text' && write.value === hostile));
  assert.ok(state.bio.writes.every(write => write.kind !== 'html' || write.value === DEFAULT_HTML));
  assert.equal(state.calls[0].url,'/api/profile?id=owner');
  assert.equal(state.calls[0].options.cache,'no-store');
});

test('blank and missing custom bio restore the exact original public HTML', async () => {
  for (const about_me of ['', ' \n\t ', undefined, null]) {
    const state = await environment({about:'A custom profile story.'});
    assert.equal(state.bio.textContent,'A custom profile story.');
    state.setProfile({about_me});
    await state.focus();
    assert.equal(state.bio.innerHTML,DEFAULT_HTML);
  }
});

test('valid 600-character bios display and longer values cannot replace the public bio', async () => {
  const allowed = 'a'.repeat(600);
  const state = await environment({about:allowed});
  assert.equal(state.bio.textContent,allowed);
  state.setProfile({about_me:'b'.repeat(601)});
  await state.focus();
  assert.equal(state.bio.textContent,allowed);
  const firstResponseInvalid = await environment({about:'c'.repeat(601)});
  assert.equal(firstResponseInvalid.bio.innerHTML,DEFAULT_HTML);
});

test('initial and later network failures preserve the visible profile', async () => {
  const initialFailure = await environment({failure:new Error('Offline')});
  assert.equal(initialFailure.bio.innerHTML,DEFAULT_HTML);
  assert.equal(initialFailure.tagline.textContent,'MORE!');
  const state = await environment({about:'Keep this custom story.'});
  const html = state.bio.innerHTML;
  state.fail();
  await state.focus();
  assert.equal(state.bio.innerHTML,html);
  assert.equal(state.tagline.textContent,'MORE HITS');
  state.fail(null); state.status(false);
  state.setProfile({about_me:'An unsuccessful response must not replace it.'});
  await state.focus();
  assert.equal(state.bio.innerHTML,html);
});

test('focus and returning to a visible page refresh bios while hidden pages remain unchanged', async () => {
  const state = await environment({about:'First story.'});
  state.setProfile({about_me:'Changed while away.'});
  await state.visibility(true);
  assert.equal(state.calls.length,1);
  await state.focus();
  assert.equal(state.calls.length,1);
  assert.equal(state.bio.textContent,'First story.');
  await state.visibility(false);
  assert.equal(state.calls.length,2);
  assert.equal(state.bio.textContent,'Changed while away.');
  state.setProfile({about_me:'Changed again.'});
  await state.focus();
  assert.equal(state.bio.textContent,'Changed again.');
});

test('a bio-only page still refreshes without needing status or portrait elements', async () => {
  const state = await environment({status:false,photo:false,about:'About the producer.'});
  assert.equal(state.calls.length,1);
  assert.equal(state.bio.textContent,'About the producer.');
});

test('status and approved portrait refresh behavior remains intact', async () => {
  const state = await environment({photo:true});
  assert.equal(state.tagline.textContent,'MORE HITS');
  assert.equal(state.portrait.src,'/profile.jpg');
  const approved = `/api/profile-photo/${'a'.repeat(64)}`;
  state.setProfile({status:'Making MORE!',about_me:'A new story.',photo_url:approved});
  await state.focus();
  assert.equal(state.tagline.textContent,'Making MORE!');
  assert.equal(state.portrait.src,approved);
  state.setProfile({status:'Still making music.',about_me:'The same owner.',photo_url:'https://untrusted.example/photo.jpg'});
  await state.focus();
  assert.equal(state.portrait.src,approved);
  assert.equal(state.tagline.textContent,'Still making music.');
});

test('owner title, credits and location render safe text, enforce bounds and restore original defaults',async()=>{
  const state=await environment({details:true});
  const title=state.facts['#owner-title-lines'], credits=state.facts['#owner-credentials'], location=state.facts['#owner-location'];
  state.setProfile({title_lines:'Producer.\nExecutive <img src=x onerror=alert(1)>',credentials:'New records\nNew milestones',location:'Kansas\nUnited States'});
  await state.focus();
  assert.equal(title.textContent,'Producer.\nExecutive <img src=x onerror=alert(1)>');assert.match(title.innerHTML,/&lt;img/);assert.equal(title.style.whiteSpace,'pre-line');
  assert.equal(credits.textContent,'New records\nNew milestones');assert.equal(location.textContent,'Kansas\nUnited States');
  state.setProfile({title_lines:'x'.repeat(181),credentials:'x'.repeat(241),location:'x'.repeat(141)});await state.focus();
  assert.match(title.textContent,/Executive/);assert.equal(credits.textContent,'New records\nNew milestones');assert.equal(location.textContent,'Kansas\nUnited States');
  state.setProfile({title_lines:'',credentials:null});await state.focus();
  assert.equal(title.innerHTML,'Producer.<br>Music executive.');assert.equal(credits.innerHTML,'Grammy winner<br>2X Diamond<br>HitMob founder');assert.equal(location.innerHTML,'Leavenworth, Kansas<br>United States');
});
