import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve, extname} from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const pages = readdirSync(root).filter(name => name.endsWith('.html') && name !== 'music-player-fragment.html');
const html = new Map(pages.map(name => [name, readFileSync(resolve(root, name), 'utf8')]));
const ids = source => [...source.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);

test('page navigation and referenced local assets resolve to real files and sections', () => {
  for (const [name, source] of html) {
    for (const match of source.matchAll(/<(?:a|img|script|link)\b[^>]*\b(?:href|src)="([^"]+)"/g)) {
      const url = new URL(match[1].replaceAll('&amp;', '&'), `https://site.test/${name}`);
      if (url.origin !== 'https://site.test' || url.pathname.startsWith('/api/')) continue;
      let path = decodeURIComponent(url.pathname).slice(1) || 'index.html';
      if (!extname(path)) path += '.html';
      assert.ok(existsSync(resolve(root, path)), `${name}: missing ${path}`);
      if (!url.hash || !html.has(path)) continue;
      // Signup is an explicit router intent handled by the Identity portal.
      if (path === 'members.html' && url.hash === '#signup') continue;
      assert.ok(ids(html.get(path)).includes(decodeURIComponent(url.hash.slice(1))), `${name}: missing section ${path}${url.hash}`);
    }
  }
});

test('page controls have unique IDs and each page declares its mobile viewport', () => {
  for (const [name, source] of html) {
    const values = ids(source);
    assert.equal(new Set(values).size, values.length, `${name}: duplicate IDs`);
    assert.match(source, /name="viewport"[^>]+width=device-width/, `${name}: missing responsive viewport`);
  }
});
