import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (name) => readFile(new URL(name, root), 'utf8');

test('video viewers can request to join and hosts can approve guests', async () => {
  const [html, js] = await Promise.all([read('live.html'), read('roster-live.js')]);
  assert.match(html, /id="live-invite"[^>]*>Invite Guest/);
  assert.match(js, /Request to Join Live/);
  assert.match(js, /Approve Guest/);
  assert.match(js, /'approve_speaker'/);
  assert.match(js, /api\.hostAction\(action, entry\.member_id\)/);
});

test('a host can share a direct room link that auto-joins the invited member', async () => {
  const js = await read('roster-live.js');
  assert.match(js, /url\.searchParams\.set\('room', session\.key\)/);
  assert.match(js, /nav\.share/);
  assert.match(js, /clipboard\.writeText/);
  assert.match(js, /invitedRoom/);
  assert.match(js, /live\.join\(invitedRoom\)/);
});

test('the live stage lays out several simultaneous guest cameras', async () => {
  const css = await read('roster-live.css');
  assert.match(css, /video:nth-child\(3\)/);
  assert.match(css, /repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /video:nth-child\(5\)/);
  assert.match(css, /repeat\(3, minmax\(0, 1fr\)\)/);
});
