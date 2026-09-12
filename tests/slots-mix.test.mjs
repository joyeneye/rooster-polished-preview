import test from 'node:test';
import assert from 'node:assert/strict';
import { mixSlots } from '../slots-mix.mjs';

const posts = count => Array.from({ length: count }, (_, i) => ({ id: `member-${i}`, text: `Member post ${i}` }));
const stories = count => Array.from({ length: count }, (_, i) => ({
  id: `story-${i}`,
  category: i % 2 ? 'sports' : 'music',
  published_at: new Date(Date.now() - 60_000).toISOString(),
  url: `https://publisher.example/story/${i}`,
  title: `Story ${i}`,
}));
const promos = ['radio', 'create', 'book', 'manager'].map(id => ({ id }));
const ofType = (result, type) => result.filter(item => item.type === type);

test('an empty first page gets balanced recent news and restrained original promos', () => {
  const result = mixSlots([], stories(12), promos);
  assert.deepEqual(result.map(item => item.type), ['promo', 'news', 'news', 'promo', 'news', 'news', 'promo', 'news', 'news', 'promo', 'news', 'news']);
  assert.deepEqual(ofType(result, 'news').map(item => item.value.category), ['music', 'sports', 'music', 'sports', 'music', 'sports', 'music', 'sports']);
  assert.equal(ofType(result, 'post').length, 0);
});

test('a sparse page leads with motion and preserves all member identities in order', () => {
  const members = posts(2);
  const result = mixSlots(members, stories(8), promos);
  assert.equal(result[0].type, 'promo');
  assert.deepEqual(ofType(result, 'post').map(item => item.value), members);
  assert.ok(ofType(result, 'post').every((item, i) => item.value === members[i]));
  assert.equal(ofType(result, 'news').length, 8);
  assert.equal(ofType(result, 'promo').length, 4);
});

test('an active ten-member page adds music, a promo, and sports at three-post intervals', () => {
  const members = posts(10);
  const result = mixSlots(members, stories(16), promos);
  assert.deepEqual(result.map(item => item.type), ['post', 'post', 'post', 'news', 'post', 'post', 'post', 'promo', 'post', 'post', 'post', 'news', 'post']);
  assert.deepEqual(ofType(result, 'post').map(item => item.value), members);
  assert.deepEqual(ofType(result, 'news').map(item => item.value.category), ['music', 'sports']);
  assert.equal(result.at(-1).value, members.at(-1));
});

test('a member-rich feed keeps moving promos useful without crowding member posts', () => {
  for (const count of [4, 6, 9, 10, 19, 20, 30, 60]) {
    const result = mixSlots(posts(count), stories(80), promos);
    assert.ok(ofType(result, 'promo').length <= Math.floor(count / 6), `promotion limit for ${count}`);
    assert.equal(ofType(result, 'post').length, count);
  }
});

test('Following and append results contain exactly member content with no discovery', () => {
  const members = posts(2);
  for (const options of [{ view: 'following' }, { append: true }]) {
    const result = mixSlots(members, stories(8), promos, options);
    assert.deepEqual(result.map(item => item.value), members);
    assert.ok(result.every(item => item.type === 'post'));
  }
});

test('duplicate keys and already-used keys are omitted without mutating inputs', () => {
  const members = posts(2);
  const news = stories(6);
  const duplicateMembers = [members[0], members[0], members[1]];
  const duplicateNews = [news[0], news[0], ...news.slice(1)];
  const duplicatePromos = [promos[0], promos[0], ...promos.slice(1)];
  const usedIds = new Set(['news-story-1', 'promo-create']);
  const before = JSON.stringify([duplicateMembers, duplicateNews, duplicatePromos]);
  const result = mixSlots(duplicateMembers, duplicateNews, duplicatePromos, { usedIds });
  assert.equal(new Set(result.map(item => item.key)).size, result.length);
  assert.ok(result.every(item => !usedIds.has(item.key)));
  assert.deepEqual(ofType(result, 'post').map(item => item.value), members);
  assert.deepEqual([...usedIds], ['news-story-1', 'promo-create']);
  assert.equal(JSON.stringify([duplicateMembers, duplicateNews, duplicatePromos]), before);
});

test('music and sports alternate even when the input arrives grouped by publisher', () => {
  const news = stories(6);
  const grouped = [...news.filter(item => item.category === 'music'), ...news.filter(item => item.category === 'sports')];
  const result = mixSlots([], grouped, []);
  assert.deepEqual(result.map(item => item.value.category), ['music', 'sports', 'music', 'sports', 'music', 'sports']);
});

test('unsafe, stale, future, and unrelated stories cannot enter Slots', () => {
  const original = stories(1)[0];
  const news = [
    original,
    { ...original, id: 'unsafe', url: 'javascript:alert(1)' },
    { ...original, id: 'http', url: 'http://publisher.example/story' },
    { ...original, id: 'stale', published_at: new Date(Date.now() - 8 * 86400000).toISOString() },
    { ...original, id: 'future', published_at: new Date(Date.now() + 10 * 60000).toISOString() },
    { ...original, id: 'bad-date', published_at: 'not a date' },
    { ...original, id: 'unrelated', category: 'politics' },
    { ...original, id: 'credentials', url: 'https://username:password@publisher.example/story' },
  ];
  const result = mixSlots([], news, promos);
  assert.deepEqual(ofType(result, 'news').map(item => item.value), [original]);
  assert.equal(ofType(result, 'promo').length, 4);
});

test('without usable news a sparse feed retains members and fills with up to five original promos', () => {
  const members = posts(2);
  const result = mixSlots(members, [], promos);
  assert.deepEqual(ofType(result, 'post').map(item => item.value), members);
  assert.equal(result[0].type, 'promo');
  assert.deepEqual(ofType(result, 'promo').map(item => item.value), promos.slice(0, 5));
  assert.deepEqual(mixSlots([], [], promos).map(item => item.value), promos.slice(0, 5));
  assert.deepEqual(mixSlots([], [], []), []);
});

test('stale news falls back to promos, but Following and append stay member-only', () => {
  const stale = stories(2).map(story => ({ ...story, published_at: new Date(Date.now() - 8 * 86400000).toISOString() }));
  assert.deepEqual(mixSlots([], stale, promos).map(item => item.value), promos.slice(0, 5));
  const members = posts(2);
  for (const options of [{ view: 'following' }, { append: true }]) {
    assert.deepEqual(mixSlots(members, [], promos, options).map(item => item.value), members);
    assert.deepEqual(mixSlots([], stale, promos, options), []);
  }
});

test('a dense feed without news retains the motion-promotion cap and every member post', () => {
  const members = posts(10);
  const result = mixSlots(members, [], promos);
  assert.deepEqual(ofType(result, 'post').map(item => item.value), members);
  assert.equal(ofType(result, 'promo').length, 1);
  assert.equal(result[6].type, 'promo');
  assert.equal(ofType(mixSlots(posts(9), [], promos), 'promo').length, 1);
});

test('record namespaces avoid collisions, and legacy post keys remain stable', () => {
  const member = { id: 'shared' };
  const news = [{ ...stories(1)[0], id: 'shared' }, ...stories(1)];
  const promotion = { id: 'shared' };
  const result = mixSlots([member], news, [promotion]);
  assert.ok(result.some(item => item.key === 'post-shared'));
  assert.ok(result.some(item => item.key === 'news-shared'));
  assert.ok(result.some(item => item.key === 'promo-shared'));
  const legacy = [{ text: 'Earlier member post', created_at: '2026-09-01' }];
  assert.equal(mixSlots(legacy, [], [])[0].key, mixSlots(legacy.map(item => ({ ...item })), [], [])[0].key);
});

 test('eight video ads are discoverable in a quiet feed, with no ninth promo or ninth headline', () => {
  const ads=Array.from({length:9},(_,i)=>({id:'ad-'+i}));
  const result=mixSlots([],stories(12),ads);
  assert.equal(result[0].type,'promo');
  assert.equal(ofType(result,'promo').length,8);
  assert.equal(ofType(result,'news').length,8);
  assert.equal(new Set(result.map(x=>x.key)).size,result.length);
 });
