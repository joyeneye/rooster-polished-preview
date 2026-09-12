import test from 'node:test';
import assert from 'node:assert/strict';
import {TIP_KEY,tipForRoute,tipForControl,createTipProgress} from '../roster-first-use.mjs';
import {SLOTS_PROMOS,rotatePromos} from '../slots-promos.mjs';
import {existsSync,readFileSync} from 'node:fs';
function storage(){const data=new Map();return {getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value)}}
test('tips are remembered across reloads and can be turned off or replayed',()=>{
 const store=storage(),p=createTipProgress(store);assert.equal(p.shouldShow('slots'),true);p.remember('slots');
 assert.equal(createTipProgress(store).shouldShow('slots'),false);assert.equal(p.shouldShow('radio'),true);
 p.disable();assert.equal(createTipProgress(store).shouldShow('radio'),false);p.reset();assert.equal(createTipProgress(store).shouldShow('slots'),true);
});
test('unavailable or corrupted storage still remembers tips during this page',()=>{
 const p=createTipProgress({getItem(){throw Error()},setItem(){throw Error()}});p.remember('rooms');assert.equal(p.shouldShow('rooms'),false);assert.equal(p.shouldShow('money'),true);
 const s=storage();s.setItem(TIP_KEY,'broken');assert.equal(createTipProgress(s).shouldShow('slots'),true);assert.equal(p.shouldShow('not-a-feature'),false);
});
test('profile Slots and personal music explain their separate purposes',()=>{
 assert.equal(tipForControl({profileTab:'posts'}),'profile_slots');assert.equal(tipForControl({profileTab:'songs'}),'profile_music');assert.equal(tipForRoute('/'),'slots');assert.equal(tipForRoute('/radio'),'radio');
});
test('navigation maps clean URLs, hashes and feed controls without tracking external links',()=>{
 for(const [url,key] of [['/people.html','people'],['/live','rooms'],['/members#member-mail','inbox'],['/?camera=1','picture'],['/?compose=post','post'],['/booking','booking'],['/rcm#income','money']])assert.equal(tipForRoute(url),key);
 assert.equal(tipForRoute('https://another.example/people'),null);assert.equal(tipForControl({feedView:'board',feedFilter:'rooms'}),'live_feed');assert.equal(tipForControl({managerView:'help'}),'ai');assert.equal(tipForControl({topEightEdit:''}),'top8');
});
test('every video ad is local, has a poster and retains its individual source license',()=>{
 const root=new URL('../',import.meta.url),manifest=JSON.parse(readFileSync(new URL('assets/slots-ads/SOURCES.json',root)));
 assert.equal(SLOTS_PROMOS.length,5);
 for(const ad of SLOTS_PROMOS){assert.ok(existsSync(new URL(ad.video.slice(1),root)));assert.ok(existsSync(new URL(ad.poster.slice(1),root)));assert.ok(manifest.items.find(x=>ad.video.endsWith(x.file)&&x.license==='Mixkit Stock Video Free License'));}
});
test('promo starting order varies without losing or duplicating videos',()=>{
 const before=JSON.stringify(SLOTS_PROMOS);
 for(let n=0;n<5;n++){const ordered=rotatePromos(SLOTS_PROMOS,n);assert.equal(ordered[0],SLOTS_PROMOS[n]);assert.equal(new Set(ordered.map(x=>x.id)).size,5)}
 assert.equal(JSON.stringify(SLOTS_PROMOS),before);assert.deepEqual(rotatePromos([],10),[]);
});
