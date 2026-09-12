import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {verifyEditorPackaging} from '../scripts/verify-editor-packaging.mjs';

const root=new URL('../',import.meta.url);

test('the real production build ships every editor module and resolves its relative imports',async()=>{
  execFileSync(process.execPath,['build.mjs'],{cwd:root,stdio:'pipe',timeout:120000});
  const assets=await verifyEditorPackaging(new URL('../public/',import.meta.url));
  assert.deepEqual(assets,['album-photo-helper.js','photo-effects.js','photo-filter-editor.js','roster-video-editor.js']);
  for(const name of assets){
    const source=await readFile(new URL(`../public/${name}`,import.meta.url),'utf8');
    assert.doesNotMatch(source,/<!doctype html>|<html[\s>]/i);
  }
});
