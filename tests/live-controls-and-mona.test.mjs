import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const html=await readFile(new URL('../live.html',import.meta.url),'utf8');
const client=await readFile(new URL('../roster-live.js',import.meta.url),'utf8');
const css=await readFile(new URL('../roster-live.css',import.meta.url),'utf8');
const server=await readFile(new URL('../netlify/functions/_shared/roster-live.mts',import.meta.url),'utf8');
const mona=await readFile(new URL('../netlify/functions/live-mona.mts',import.meta.url),'utf8');

test('host end and viewer leave remain distinct, safe-area visible, and failure honest',()=>{
 assert.match(html,/id="live-end"[^>]*>End live/);assert.match(html,/Back to Rooms/);
 assert.match(html,/End live for everyone/);assert.match(html,/Leave this screen/);
 assert.match(client,/Video stopped here; room is still closing/);assert.match(client,/stopPolling\(\); dropEveryPeer\(\); closeMedia\(\)/);
 assert.match(server,/room\.status !== "live"\) return \{ended:true\}/);
 assert.match(css,/#live-end:not\(\[hidden\]\)\{position:fixed/);assert.match(css,/safe-area-inset-bottom/);
});

test('on-stage comments are text-only, bounded, retryable, and collision-aware',()=>{
 assert.match(html,/id="live-comment-overlay"/);assert.match(html,/maxlength="400"/);assert.match(html,/Add a comment…/);
 assert.match(client,/text\.textContent = entry\.body/);assert.match(client,/Your comment is still here; try again/);
 assert.match(server,/Slow down for a moment/);assert.match(server,/Comments are \$\{MESSAGE_LIMIT\} characters or fewer/);
 assert.match(css,/max-height:min\(34dvh,230px\)/);assert.match(css,/prefers-reduced-motion/);
});

test('Mona cues and moderation remain private, suggestion-only, bounded and out of media composition',()=>{
 assert.match(mona,/Mona cues are private to the broadcaster/);assert.match(mona,/suggestion_only:true/);
 assert.match(mona,/max_output_tokens:350/);assert.match(mona,/windowLimit:12/);assert.match(mona,/fallback\(room\.title\)/);
 assert.doesNotMatch(client,/captureStream[\s\S]{0,500}live-mona/);
 assert.match(client,/displaySurface/);assert.match(html,/full screen, anything visible/);
});

test('room moderators are scoped, least-privilege, audited, and excluded from private cues',()=>{
 assert.match(server,/eq\(liveModerators\.roomId,room\.id\)/);assert.match(server,/\["remove_message","restore_message","remove_member"\]/);
 assert.match(server,/Only the host can end this broadcast/);assert.match(server,/liveModerationActions/);
 assert.match(server,/privileged\?\{moderation_queue/);assert.match(mona,/mode==='cues'&&!host/);
 assert.match(client,/assign_moderator/);assert.match(client,/win\.confirm/);assert.match(client,/restore_message/);
});
