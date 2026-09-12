import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {scoutInput, scoutPrompt} from '../netlify/functions/_shared/mona-lead-scout.mts';

const html = await readFile(new URL('../mona.html', import.meta.url), 'utf8');
const client = await readFile(new URL('../mona.js', import.meta.url), 'utf8');
const base = {profession:'Barber',location:'Dallas, Texas',offering:'Haircuts and grooming',goal:'clients'};

test('location remains gesture-driven with manual and radius fallbacks', () => {
  assert.match(html, /id="mona-use-location"/); assert.match(html, /City or ZIP/);
  for (const value of ['10','25','50','100','remote']) assert.match(html, new RegExp(`value="${value}"`));
  assert.doesNotMatch(client.slice(0, client.indexOf("listen(byId('mona-use-location')")), /getCurrentPosition/);
  assert.match(client, /preciseLocation = null/); assert.doesNotMatch(client, /localStorage.*latitude|sessionStorage.*latitude/);
});

test('server validates radius and precise coordinates', () => {
  assert.equal(scoutInput({...base,radius:25}).radius,25);
  assert.equal(scoutInput({...base,radius:'remote'}).radius,'remote');
  assert.throws(()=>scoutInput({...base,radius:500}));
  assert.throws(()=>scoutInput({...base,latitude:200,longitude:20}));
  const prompt=scoutPrompt(scoutInput({...base,radius:10,latitude:32.7,longitude:-96.8}),new Date('2026-09-11T00:00:00Z'));
  assert.match(prompt,/10-mile radius/); assert.match(prompt,/never repeat coordinates in output/);
});
