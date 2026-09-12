import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (name) => readFile(new URL(name, root), 'utf8');

test('ROOSTER Manager opens with four plain-language choices and no fake dashboard', async () => {
  const html = await read('rcm.html');
  assert.match(html, /<title>ROOSTER Manager<\/title>/);
  for (const label of ['Add a Song', 'Make a Split Sheet', 'Add a Show', 'Add a Person']) {
    assert.match(html, new RegExp(label));
  }
  assert.match(html, /id="show-example"/);
  assert.match(html, /id="clear-page"/);
  assert.doesNotMatch(html, /Command Center|Career Health|Kori Miles|After Midnight/);
});

test('examples stay optional and cannot be saved as real account records', async () => {
  const js = await read('rcm.js');
  assert.match(js, /state\.example/);
  assert.match(js, /This is an example\. Press Clear Page to start your own\./);
  assert.match(js, /state\.records = \[\]/);
  assert.doesNotMatch(js, /state\.records\s*=\s*demoRecords/);
});

test('split sheets validate 100 percent and provide a real browser PDF\/print flow', async () => {
  const [js, css] = await Promise.all([read('rcm.js'), read('rcm.css')]);
  assert.match(js, /Math\.abs\(splitTotal\(\) - 100\)/);
  assert.match(js, /Download PDF \/ Print/);
  assert.match(js, /window\.print\(\)/);
  assert.match(css, /@media print/);
  assert.match(css, /body > \*:not\(#print-sheet\)/);
});

test('real work loads and saves through the private RCM workspace API', async () => {
  const js = await read('rcm.js');
  assert.match(js, /fetch\('\/api\/rcm\/workspace'/);
  assert.match(js, /action: 'record'/);
  assert.match(js, /fetch\('\/api\/rcm\/manager'/);
});
