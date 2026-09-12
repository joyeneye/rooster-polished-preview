#!/usr/bin/env node
// Local source-only patcher. Never creates a site or calls the network.
import {readFile,writeFile,copyFile,mkdir,lstat,rename,unlink,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const packageRoot=path.dirname(fileURLToPath(import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=message=>{throw new Error(message);};
async function regularFile(filename){
  const stat=await lstat(filename);
  if(!stat.isFile()||stat.isSymbolicLink())fail(`Refusing a nonregular file: ${filename}`);
}
async function main(){
  const args=process.argv.slice(2);
  const check=args.includes('--check');
  const positional=args.filter(arg=>arg!=='--check');
  if(positional.length!==1||positional.some(arg=>arg.startsWith('--')))fail('Usage: node apply.mjs /absolute/path/to/current/ROOSTER/source [--check]');
  const root=await realpath(path.resolve(positional[0]));
  if(root===packageRoot)fail('Choose the existing website source directory, not this patch folder.');
  const manifest=JSON.parse(await readFile(path.join(packageRoot,'manifest.json'),'utf8'));
  const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
  if(pkg.name!=='jwhite-did-it-site')fail('This is not the expected ROOSTER source project. No files changed.');
  const build=await readFile(path.join(root,'build.mjs'),'utf8');
  if(!build.includes('profile-songs.js'))fail('The build does not include the expected player entry point. No files changed.');
  try{
    const state=JSON.parse(await readFile(path.join(root,'.netlify','state.json'),'utf8'));
    if(state.siteId && state.siteId!==manifest.site_id)fail('This project is linked to a different Netlify site. No files changed.');
  }catch(error){if(error.code!=='ENOENT')throw error;}
  const pending=[];
  // Finish every check before making any changes.
  for(const entry of manifest.files){
    if(!['profile-songs.js','tests/profile-songs-client.test.mjs'].includes(entry.path))fail('Unexpected manifest path. No files changed.');
    const target=path.join(root,entry.path),payload=path.join(packageRoot,'payload',entry.path);
    await regularFile(target);await regularFile(payload);
    if(!(await realpath(target)).startsWith(root+path.sep))fail('Refusing a target outside the project.');
    const replacement=await readFile(payload),before=await readFile(target);
    if(hash(replacement)!==entry.after_sha256)fail(`Package integrity check failed for ${entry.path}. No files changed.`);
    const current=hash(before);
    if(current===entry.after_sha256)continue;
    if(current!==entry.before_sha256)fail(`${entry.path} has newer or different edits. No files changed. Review music-player.diff; do not overwrite the newer file.`);
    pending.push({entry,target,replacement,before});
  }
  if(!pending.length){console.log('This source patch is already applied. No files changed. Deployment status is unknown; this tool does not deploy.');return;}
  if(check){console.log(`CHECK PASSED: ${pending.length} matching files can be patched. No files changed. No deployment performed.`);return;}
  const stamp=new Date().toISOString().replace(/[:.]/g,'');
  const backup=path.join(path.dirname(root),`${path.basename(root)}.music-backup-${stamp}`);
  await mkdir(backup,{recursive:false});
  for(const item of pending){const dest=path.join(backup,item.entry.path);await mkdir(path.dirname(dest),{recursive:true});await copyFile(item.target,dest);}
  const written=[];
  try{
    for(const item of pending){
      const temp=item.target+`.roster-new-${process.pid}`;
      await writeFile(temp,item.replacement,{flag:'wx'});
      try{await rename(temp,item.target);}catch(error){await unlink(temp).catch(()=>{});throw error;}
      written.push(item);
    }
  }catch(error){
    for(const item of written)await writeFile(item.target,item.before);
    fail(`Could not finish. Previously replaced files were restored. Backup: ${backup}. ${error.message}`);
  }
  console.log(`SOURCE PATCH APPLIED: ${written.length} files. Backup: ${backup}`);
  console.log('All other files and all member data are unchanged. Run the tests and full build before publishing to the existing Netlify site. Nothing has been deployed by this tool.');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
