import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const user='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const source=readFileSync(new URL('../members.js',import.meta.url),'utf8');
async function run(search,{confirmed=true,status=200,returnedId=user}={}){
 const calls=[],assigned=[],reports=[];
 const context=vm.createContext({URLSearchParams,AbortController,setTimeout,clearTimeout,
  currentUser:{id:user,confirmedAt:confirmed?'2026-09-05T12:00:00Z':null},wallReturning:false,
  window:{location:{search,assign:url=>assigned.push(url)}},
  fetch:async(path)=>{calls.push(path);return {ok:status===200,json:async()=>({profile:{id:returnedId}})}},report:text=>reports.push(text),
 });
 vm.runInContext(source.slice(source.indexOf('async function returnToMemberWall()')),context);
 await context.returnToMemberWall();return {calls,assigned,reports};
}
test('confirmed wall login returns directly to the original member wall after a server session check',async()=>{const r=await run('?wall_member='+id.toUpperCase());assert.deepEqual(r.calls,['/api/profile/me']);assert.deepEqual(r.assigned,[`/profile.html?id=${id}#member-wall`]);});
test('external, malformed and duplicate wall return destinations cannot redirect',async()=>{for(const q of ['?wall_member=https://evil.example','?wall_member=//evil.example','?wall_member=bad-id',`?wall_member=${id}&wall_member=${user}`]){const r=await run(q);assert.equal(r.calls.length,0);assert.equal(r.assigned.length,0)}});
test('unconfirmed or changed sessions cannot return as a confirmed wall author',async()=>{for(const options of [{confirmed:false},{status:401},{returnedId:id}]){const r=await run('?wall_member='+id,options);assert.equal(r.assigned.length,0)}});
test('member layout has unique IDs and all new client scripts are in the production build',()=>{const html=readFileSync(new URL('../profile.html',import.meta.url),'utf8');const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);const build=readFileSync(new URL('../build.mjs',import.meta.url),'utf8');for(const name of ['profile-wall.js','profile-actions.js']){assert(html.includes(name));assert(build.includes(name));}assert(html.includes('href="#member-wall"'));assert(html.includes('id="member-wall-form"'));});
