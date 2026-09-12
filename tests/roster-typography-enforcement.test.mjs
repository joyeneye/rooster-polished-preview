import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=name=>readFile(new URL(`../${name}`,import.meta.url),'utf8');
const finalSheet='roster-type-enforcement.css';

function stylesheetNames(html){return [...html.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi)].map(match=>match[1].split(/[?#]/)[0].split('/').pop());}

test('the typography authority loads after legacy CSS on every redesigned experience',async()=>{
  for(const page of ['index.html','profile.html','members.html','edit-profile.html']){
    const styles=stylesheetNames(await read(page));
    assert.equal(styles.at(-1),finalSheet,`${page} must load ${finalSheet} last`);
  }
  assert.match(await read('build.mjs'),/['"]roster-type-enforcement\.css['"]/);
});

test('named profile, SLOTS, Top 8, player and editor controls force Chakra Petch',async()=>{
  const css=await read(finalSheet);
  const surfaces=['.profile-menu-button','.profile-hero-actions','.profile-content-tabs','.profile-composer','.profile-context','.feed-tabs','.rail-create','.slots-compose','.slots-quick-compose','.community-dialog','.fyp-retry','.feed-retry','.community-context','.slots-top-eight','.top-eight-editor','.roster-global-player','.roster-media-editor'];
  for(const surface of surfaces)assert.ok(css.includes(surface),`missing typography guard for ${surface}`);
  assert.match(css,/font-family:"Chakra Petch",system-ui,sans-serif!important/g);
  assert.doesNotMatch(css,/Space Grotesk|Sora|Arial Narrow|Roboto Condensed/i);
});

test('Space Mono and Orbitron remain limited to their approved hierarchy',async()=>{
  const css=await read(finalSheet);
  assert.match(css,/\.roster-media-eyebrow/);
  assert.match(css,/\.global-player-count/);
  assert.match(css,/font-family:"Space Mono",ui-monospace,monospace!important/);
  assert.match(css,/body\.public-profile-page #public-profile-name[\s\S]*font-family:"Orbitron","Chakra Petch",system-ui,sans-serif!important/);
  assert.equal((css.match(/font-family:"Orbitron"/g)||[]).length,1);
});

test('reported profile, Top 8, moments and live-room micro labels use Space Mono explicitly',async()=>{
  const css=await read(finalSheet);
  const labels=['.profile-role','.profile-top-eight header span','.slots-top-eight header span','.clips-heading span','.slots-room-post small','.room-card small','.profile-room-card > div > p','.profile-room-card [data-profile-room-meta]','.roster-media-eyebrow','.roster-media-status'];
  const monoBlock=css.slice(css.indexOf('/* Space Mono'),css.indexOf('/* Orbitron'));
  for(const label of labels)assert.ok(monoBlock.includes(label),`missing Space Mono micro-label guard for ${label}`);
  const chakraControlBlock=css.slice(css.indexOf('/* Named QA surfaces'));
  for(const control of ['.profile-hero-actions a','.profile-content-tabs button','.feed-tabs button','.slots-top-eight :is(a,button,input,select)','.roster-media-editor :is(a,button,input,select,textarea,label)'])assert.ok(chakraControlBlock.includes(control),`action control must remain Chakra Petch: ${control}`);
});

test('scoped form controls receive direct font declarations instead of fragile inheritance',async()=>{
  const css=await read(finalSheet);
  for(const scope of ['body#home.roster-app','body.public-profile-page','.roster-media-editor','.top-eight-editor','.roster-global-player'])assert.match(css,new RegExp(scope.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'[\\s\\S]{0,220}:is\\(button,input,select,textarea\\)'));
});
