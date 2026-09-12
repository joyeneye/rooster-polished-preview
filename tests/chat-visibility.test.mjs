import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';

const read = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

test('desktop profile clearly exposes the live chat room', () => {
  const html = read('index.html');
  const css = read('style.css');
  const entry = html.match(/<a\b[^>]*class="nav-chat"[^>]*>([\s\S]*?)<\/a>/);
  assert.ok(entry, 'Chat Room has a main navigation entry');
  assert.match(entry[0], /href="\/?members\.html#member-chat"/);
  assert.match(entry[1].replace(/<[^>]+>/g, ''), /Chat Room/);
  assert.match(html, /id="live-chat" class="live-chat-callout"/);
  assert.match(html, />Enter Chat Room /);
  assert.match(css, /\.live-chat-callout\{display:grid/);
  assert.doesNotMatch(css, /\.nav-chat\s*\{[^}]*display\s*:\s*none/);
});

test('signed out members get a clear login path to the chat room', () => {
  const html = read('members.html');
  const script = read('members.js');
  assert.match(html, /Enter the live Chat Room/);
  assert.match(html, /Live chat in The Listening Room/);
  assert.match(script, /memberDestinationIntent = '#member-chat'/);
  assert.match(script, /show\('login'\)/);
  assert.match(script, /Log in to join The Listening Room\./);
});
