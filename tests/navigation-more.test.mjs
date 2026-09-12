import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../roster-startup.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../roster-theme.css', import.meta.url), 'utf8');

test('shared More enhancement exposes a controlled button and complete close behavior', () => {
  assert.match(source, /aria-controls/); assert.match(source, /aria-expanded/);
  assert.match(source, /event\.key === 'Escape'/); assert.match(source, /pointerdown/);
  assert.match(source, /hashchange/); assert.match(source, /popstate/);
  assert.match(source, /link\.addEventListener\('click'/); assert.match(source, /focus\(\{preventScroll: true\}\)/);
  assert.match(source, /\['ArrowDown','ArrowUp','Home','End'\]/);
});

test('shared More enhancement replaces details with one neutral button wrapper', () => {
  assert.match(source, /var wrapper = document\.createElement\('div'\)/);
  assert.match(source, /wrapper\.appendChild\(button\)/);
  assert.match(source, /host\.replaceWith\(wrapper\)/);
  assert.match(source, /var menu = \{host:wrapper, button:button, panel:panel\}/);
  assert.doesNotMatch(source, /summary\.replaceWith\(button\)/,
    'a button must never replace summary while leaving a summary-less details host');
  assert.doesNotMatch(source, /host\.open\s*=\s*false/,
    'the enhanced control must not retain native details state');
});

test('body-level desktop popover and safe-area mobile sheet cannot inherit shell clipping', () => {
  assert.match(source, /document\.body\.appendChild\(panel\)/);
  assert.match(css, /body>\.roster-more-popover\{position:fixed/);
  assert.match(css, /width:280px/); assert.match(css, /overflow-x:hidden/);
  assert.match(css, /env\(safe-area-inset-bottom\)/); assert.match(css, /z-index:10020/);
  assert.match(css, /min-height:44px/); assert.match(css, /aria-current="page"/);
});
