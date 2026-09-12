import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');

test('Manager uses one canonical global shell and preserves Manager tools',async()=>{
  const [html,shipped]=await Promise.all([read('rcm.html'),read('public/rcm.html')]);
  for(const page of [html,shipped]){
    assert.match(page,/roster-startup\.js\?v=20260912-shell-links-v3/);
    assert.equal((page.match(/class="site-nav shell-global-nav"/g)||[]).length,1);
    assert.equal((page.match(/>Back to ROOSTER<\/a>/g)||[]).length,0);
    assert.equal((page.match(/aria-label="Back to ROOSTER"/g)||[]).length,1);
    assert.doesNotMatch(page,/class="back-link"/);
    assert.match(page,/MONA · AI MANAGER/);
    assert.match(page,/class="manager-nav"/);
    assert.match(page,/data-manager-view="home"[^>]*>[\s\S]*?Overview<\/button>/);
    assert.match(page,/data-manager-view="help"[^>]*>[\s\S]*?AI Manager<\/button>/);
    assert.doesNotMatch(page,/data-manager-view="home"[^>]*>[\s\S]*?>Home<\/button>/);
    assert.doesNotMatch(page,/data-manager-view="help"[^>]*>[\s\S]*?>MONA<\/button>/);
  }
});

test('Review Room keeps review actions outside its canonical global nav',async()=>{
  const [html,shipped]=await Promise.all([read('review-room.html'),read('public/review-room.html')]);
  for(const page of [html,shipped]){
    assert.equal((page.match(/class="site-nav shell-global-nav"/g)||[]).length,1);
    assert.doesNotMatch(page,/class="rr-bar-links"/);
    assert.doesNotMatch(page,/class="rr-page-actions"/);
    assert.doesNotMatch(page,/>Member Space<|>Public reviews</);
    assert.match(page,/Invite code or log in/);
    assert.match(page,/See published reviews/);
  }
});

test('Public Reviews keeps Submit your music as a page action',async()=>{
  const [html,shipped]=await Promise.all([read('reviews.html'),read('public/reviews.html')]);
  for(const page of [html,shipped]){
    assert.equal((page.match(/class="site-nav shell-global-nav"/g)||[]).length,1);
    assert.match(page,/rr-public-hero[\s\S]*id="rr-public-submit" class="rr-page-action"/);
    assert.doesNotMatch(page,/rr-public-nav[^\n]*id="rr-public-submit"/);
  }
});

test('shared shell remains compact, accessible and backed by one utility dock',async()=>{
  const [startup,theme,utility]=await Promise.all([read('roster-startup.js'),read('roster-theme.css'),read('roster-utility.js')]);
  assert.match(startup,/path==='\/reviews'/);
  assert.match(theme,/\.site-nav\.shell-global-nav/);
  assert.match(theme,/min-height:44px/);
  assert.match(theme,/overflow-x:auto/);
  assert.match(utility,/const dock=create\('div','roster-utility-dock'/);
});
