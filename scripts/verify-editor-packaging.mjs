import {access,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const ENTRY_FILES=['photo-filter-editor.js','roster-video-editor.js'];
const JAVASCRIPT=/\.(?:m?js)$/i;
const STATIC_IMPORT=/(?:^|\n)\s*(?:import|export)\s+(?:[^'"\n]+?\s+from\s+)?['"](\.\.?\/[^'"]+)['"]/g;

export async function verifyEditorPackaging(publicDirectory){
  const root=publicDirectory instanceof URL?publicDirectory:new URL(String(publicDirectory).replace(/\/?$/,'/'),'file://');
  const pending=[...ENTRY_FILES],visited=new Set();
  while(pending.length){
    const relative=pending.shift();
    if(visited.has(relative))continue;
    visited.add(relative);
    const asset=new URL(relative,root);
    await access(asset).catch(()=>{throw new Error(`Missing deployed editor asset: public/${relative}`);});
    if(!JAVASCRIPT.test(relative))continue;
    const source=await readFile(asset,'utf8');
    if(/<!doctype html>|<html[\s>]/i.test(source))throw new Error(`Editor asset is HTML instead of JavaScript: public/${relative}`);
    for(const match of source.matchAll(STATIC_IMPORT)){
      const dependency=new URL(match[1],asset);
      if(dependency.origin!==root.origin||!dependency.pathname.startsWith(root.pathname))throw new Error(`Editor import escapes public/: ${match[1]} from ${relative}`);
      pending.push(fileURLToPath(dependency).slice(fileURLToPath(root).length).replaceAll('\\','/'));
    }
  }
  return [...visited].sort();
}
