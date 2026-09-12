import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { GIRL_GROUP_CAMPAIGN, SLOTS_PROMOS, nextPromoOrder } from '../slots-promos.mjs';
import { mixSlots } from '../slots-mix.mjs';

const posts = count => Array.from({length:count}, (_, index) => ({id:`member-${index}`}));
const campaigns = result => result.filter(item => item.type === 'promo' && item.value.campaign);

test('the casting campaign links directly to the existing open application type', async () => {
  const route = new URL(GIRL_GROUP_CAMPAIGN.href, 'https://jwhitedidit.net');
  const opportunities = await readFile(new URL('../netlify/functions/_shared/opportunities.mts', import.meta.url), 'utf8');
  const slug = /export const FEATURED_SLUG = "([^"]+)"/.exec(opportunities)?.[1];
  assert.equal(route.pathname, '/apply.html');
  assert.equal(route.searchParams.get('opportunity'), slug);
  assert.equal(GIRL_GROUP_CAMPAIGN.action, 'Apply for the group');
  assert.match(GIRL_GROUP_CAMPAIGN.copy, /3 female rappers \+ 1 female R&B singer/);
  assert.match(GIRL_GROUP_CAMPAIGN.copy, /18\+/);
  assert.equal(GIRL_GROUP_CAMPAIGN.sponsor, 'MORE HITS ON THE WAY');
  assert.ok((await stat(new URL(`..${GIRL_GROUP_CAMPAIGN.poster}`, import.meta.url))).size > 10_000);
});

test('return visits keep casting early while every other house ad rotates', () => {
  const values = new Map();
  const storage = {getItem:key => values.get(key), setItem:(key,value) => values.set(key,value)};
  const firstHouseAds = new Set();
  const snapshot = JSON.stringify(SLOTS_PROMOS);
  for (let visit=0;visit<SLOTS_PROMOS.length-1;visit++) {
    const ordered = nextPromoOrder(storage);
    assert.equal(ordered[0], GIRL_GROUP_CAMPAIGN);
    assert.equal(ordered.filter(promo => promo.campaign).length, 1);
    assert.equal(new Set(ordered.map(promo => promo.id)).size, ordered.length);
    firstHouseAds.add(ordered[1].id);
  }
  assert.equal(firstHouseAds.size, SLOTS_PROMOS.length-1);
  assert.equal(JSON.stringify(SLOTS_PROMOS), snapshot);
});

test('blocked browser storage still supplies one casting card', () => {
  const storage = {getItem() {throw new Error('Storage disabled');}};
  const ordered = nextPromoOrder(storage);
  assert.equal(ordered[0], GIRL_GROUP_CAMPAIGN);
  assert.equal(ordered.filter(promo => promo.campaign).length, 1);
});

test('a quiet WYD starts with casting and never repeats it on that page', () => {
  for (const count of [0,1,2,3]) {
    const members = posts(count);
    const mixed = mixSlots(members, [], [...SLOTS_PROMOS, GIRL_GROUP_CAMPAIGN]);
    assert.equal(mixed[0].value, GIRL_GROUP_CAMPAIGN);
    assert.equal(campaigns(mixed).length, 1);
    assert.ok(mixed.filter(item => item.type === 'promo').length <= 8);
    assert.deepEqual(mixed.filter(item => item.type === 'post').map(item => item.value), members);
  }
});

test('an active WYD shows casting after three members within the existing ad budget', () => {
  for (const count of [4,5,6,10,12,20,60]) {
    const members = posts(count);
    const mixed = mixSlots(members, [], SLOTS_PROMOS);
    assert.equal(mixed[3].value, GIRL_GROUP_CAMPAIGN);
    assert.equal(campaigns(mixed).length, 1);
    assert.ok(mixed.filter(item => item.type === 'promo').length <= Math.max(1,Math.floor(count/6)));
    assert.deepEqual(mixed.filter(item => item.type === 'post').map(item => item.value), members);
  }
});

test('Following, later pages, and a used casting key do not repeat the campaign', () => {
  for (const options of [{view:'following'}, {append:true}, {usedIds:new Set([`promo-${GIRL_GROUP_CAMPAIGN.id}`])}]) {
    const mixed = mixSlots(posts(6), [], SLOTS_PROMOS, options);
    assert.equal(campaigns(mixed).length, 0);
    assert.equal(mixed.filter(item => item.type === 'post').length, 6);
  }
});
