import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('legacy Slots and Mona routes resolve to the canonical in-page experiences', async () => {
  const [config, redirects, shippedRedirects, utility, build] = await Promise.all([read('netlify.toml'), read('_redirects'), read('public/_redirects'), read('roster-utility.js'), read('build.mjs')]);
  assert.match(config, /from = "\/slots"\s+to = "\/"\s+status = 301\s+force = true/);
  assert.match(config, /from = "\/slots\/\*"\s+to = "\/"\s+status = 301\s+force = true/);
  assert.match(config, /from = "\/mona"\s+to = "\/#mona"\s+status = 302\s+force = true/);
  assert.equal(shippedRedirects, redirects);
  assert.deepEqual(redirects.trim().split('\n').slice(0,2), ['/slots / 301!', '/slots/* / 301!']);
  assert.doesNotMatch(redirects, /slots.*profile|profile.*slots/i);
  const generated = await read('.netlify/netlify.toml');
  const configured = generated.match(/\[\[redirects\]\][\s\S]*?from = "\/slots"[\s\S]*?force = true[\s\S]*?\[\[redirects\]\][\s\S]*?from = "\/slots\/\*"[\s\S]*?force = true/);
  assert.ok(configured, 'generated redirect order must begin with exact Slots then wildcard Slots');
  assert.doesNotMatch(generated, /from = "\/slots(?:\/\*)?"[\s\S]{0,120}to = "\/profile/i);
  assert.match(build, /files\.push\('_redirects'\)/);
  assert.match(utility, /location\.hash==='#mona'/);
  assert.match(utility, /openExplicitMona\(\).*history\.replaceState\(history\.state,''/);
  assert.match(utility, /\[data-profile-message-open\]/);
  assert.match(utility, /stopImmediatePropagation/);
  assert.doesNotMatch(build, /files\.push\([^\n]*mona\.html/);
});

test('no configured or shipped route source maps Slots to the owner profile', async () => {
  const routeSources = await Promise.all(['netlify.toml','.netlify/netlify.toml','_redirects','public/_redirects'].map(read));
  for (const source of routeSources) {
    assert.doesNotMatch(source, /(?:from\s*=\s*"\/slots(?:\/\*)?"|\/slots(?:\/\*)?\s+)[\s\S]{0,160}(?:profile(?:\.html)?(?:\?id=owner|%3fid%3downer)|id=owner)/i);
  }
});

test('shared startup normalizes every high-traffic legacy shell', async () => {
  const startup = await read('roster-startup.js');
  for (const selector of [
    '.site-nav,.mobile-site-nav', '.community-rail > nav', '.mobile-community-nav',
    '.profile-desktop-nav > nav', '.profile-mobile-nav', '.booking-nav'
  ]) assert.ok(startup.includes(selector), `missing shell normalizer: ${selector}`);
  for (const pair of [
    "['WYD', '/#home'", "['People', '/people.html'", "['Rooms', '/live.html'", "['Me', '/my-profile.html'"
  ]) assert.ok(startup.includes(pair));
  assert.match(startup, /item\[2\]===currentChoice\(\)/);
  assert.match(startup, /button\.setAttribute\('aria-current','page'\)/);
  assert.match(startup, /new MutationObserver/);
  for (const secondary of ['Opportunities','Booking','Manager','Radio','Top 25','About','Settings']) {
    assert.match(startup, new RegExp(`\\['${secondary}'`));
  }
  assert.match(startup, /\.mobile-take-pic/);
  assert.match(startup, /\.profile-mobile-create/);
  assert.match(startup, /\.profile-account-button/);
  assert.match(startup, /\.community-header-actions \.header-discover/);
});

test('source and shipped global navigation assets are byte-identical', async () => {
  for (const asset of ['roster-startup.js','roster-utility.js','roster-theme.css']) {
    const [source, shipped] = await Promise.all([read(asset), read(`public/${asset}`)]);
    assert.equal(shipped, source, `${asset} was not copied to publish output`);
  }
});

test('route markup retains page-specific controls while shared startup owns global destinations', async () => {
  const [home, profile, members, booking] = await Promise.all([
    read('index.html'), read('profile.html'), read('members.html'), read('booking-marketplace.html')
  ]);
  assert.match(home, /data-open-composer/);
  assert.match(home, /class="feed-tabs"/);
  assert.match(profile, /class="profile-content-tabs"/);
  assert.match(profile, /data-profile-message-open/);
  assert.match(members, /roster-startup\.js/);
  assert.match(booking, /class="nav-links"/);
  for (const html of [home, profile, members, booking]) assert.match(html, /roster-startup\.js/);
});

test('canonical mobile layouts retain 44px targets and room for page tools', async () => {
  const css = await read('roster-theme.css');
  assert.match(css, /\[data-canonical-global-nav\] :is\(a,\.roster-more-trigger\)\{min-height:44px\}/);
  assert.match(css, /grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /\.nav-wyd[^\n]*display:flex!important/);
  assert.match(css, /\.nav-mine[^\n]*visibility:visible!important/);
});
