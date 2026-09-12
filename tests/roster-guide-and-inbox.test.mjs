import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

const read = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');

test('the global ROOSTER guide has working quick lessons and real AI help', async () => {
  const [startup, guide, fn, build] = await Promise.all([
    read('roster-startup.js'), read('roster-guide.js'), read('netlify/functions/roster-guide.mts'), read('build.mjs'),
  ]);
  assert.match(startup, /ensureGuideAssets\(\)/);
  for (const lesson of ['post', 'picture', 'message', 'profile', 'slots', 'rooms', 'booking']) assert.match(guide, new RegExp(`${lesson}:`));
  assert.match(guide, /fetch\('\/api\/roster-guide'/);
  assert.match(fn, /path: "\/api\/roster-guide"/);
  assert.match(fn, /assertSameOrigin\(req\)/);
  assert.match(fn, /rateLimit:/);
  assert.match(build, /'roster-guide\.css', 'roster-guide\.js'/);
});

test('messages are personal, private and easy to scan', async () => {
  const [html, inbox, css] = await Promise.all([read('members.html'), read('member-inbox.js'), read('members.css')]);
  assert.match(html, /PRIVATE • JUST YOU TWO/);
  assert.match(html, />Conversations <span id="mail-inbox-count">/);
  assert.match(html, /Send Privately/);
  assert.match(html, /class="mail-subject-option"/);
  assert.match(inbox, /mail-row-preview/);
  assert.match(inbox, /mail-row-preview/);
  assert.match(css, /Messages read like a warm, private conversation/);
});

test('a sparse FYP receives labeled real video promos with packaged posters', async () => {
  const [home, build, mix] = await Promise.all([read('community-home.js'), read('build.mjs'), read('slots-mix.mjs')]);
  const {SLOTS_PROMOS}=await import('../slots-promos.mjs');
  assert.match(home, /const starterPromos = nextPromoOrder\(\)/);
  assert.match(home, /ROOSTER PROMO/);
  assert.match(home, /data-silent-promo/);
  assert.match(mix, /members.length < 4/);
  assert.ok(build.includes('./assets/slots-ads/'));
  for (const ad of SLOTS_PROMOS) {
    assert.ok((await stat(new URL(`..${ad.video}`, import.meta.url))).size > 20_000);
    assert.ok((await stat(new URL(`..${ad.poster}`, import.meta.url))).size > 1_000);
  }
});
