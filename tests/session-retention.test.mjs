import assert from 'node:assert/strict';
import {test} from 'node:test';
import vm from 'node:vm';
import {build} from 'esbuild';
import '../patch-identity.mjs';
import {createSessionFetch} from '../roster-session-core.mjs';

const bundle = (await build({stdin:{contents:"export * from '@netlify/identity';",resolveDir:new URL('..', import.meta.url).pathname},bundle:true,platform:'browser',format:'iife',globalName:'Identity',write:false})).outputFiles[0].text;
const tick = () => new Promise(resolve => setImmediate(resolve));
function environment({initialCookies = []} = {}) {
  let clock = Date.now();
  let tokenResponse = 200;
  let userResponse = 200;
  const storage = new Map(), cookies = new Map(initialCookies), writes = [], requests = [];
  const token = () => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({sub:'fixture-member',exp:Math.floor(clock/1000)+3600})).toString('base64url')}.fixture`;
  const user = {id:'fixture-member',email:'member@example.test',confirmed_at:'2026-09-11T00:00:00Z',user_metadata:{full_name:'Fixture'}};
  const document = {
    get cookie() { return [...cookies].map(([key,value])=>`${key}=${value}`).join('; '); },
    set cookie(value) { writes.push(value); const [pair] = value.split(';');const [key,...parts]=pair.split('=');if (/expires=Thu, 01 Jan 1970/.test(value)) cookies.delete(key);else cookies.set(key,parts.join('=')); },
  };
  const localStorage = {getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
  class Clock extends Date {static now(){return clock;}}
  const context = {document,localStorage,window:{location:{origin:'https://rooster.example.test'},addEventListener(){}},location:{origin:'https://rooster.example.test'},navigator:{},Date:Clock,console,URL,URLSearchParams,Headers,Request,Response,AbortController,atob,btoa,TextDecoder,Uint8Array,setTimeout:()=>1,clearTimeout(){},fetch:async(url,options)=>{
    const path = new URL(url).pathname;
    requests.push(path);
    if (path.endsWith('/token')) {
      if(tokenResponse && typeof tokenResponse.then === 'function')return tokenResponse;
      if(tokenResponse instanceof Error)throw tokenResponse;
      if(tokenResponse!==200)return Response.json({msg:'Fixture refresh failure'},{status:tokenResponse});
      return Response.json({access_token:token(),refresh_token:'fixture-refresh',expires_in:3600,token_type:'bearer'});
    }
    if(path.endsWith('/user')){
      if(userResponse && typeof userResponse.then === 'function')return userResponse;
      return Response.json(userResponse===200?user:{msg:'Fixture user failure'},{status:userResponse});
    }
    if(path.endsWith('/logout'))return new Response(null,{status:204});
    throw new Error('Unexpected fixture URL');
  }};
  vm.runInNewContext(bundle,context);
  return {sdk:context.Identity,cookies,writes,storage,requests,token,user,anotherBundle:()=>{vm.runInNewContext(bundle,context);return context.Identity;},advance:ms=>{clock+=ms;},tokenFailure:value=>{tokenResponse=value;},userFailure:value=>{userResponse=value;}};
}

test('sign-in cookies survive a browser restart without changing JWT expiration',async()=>{
  const e=environment();await e.sdk.login('member@example.test','fixture-password');
  assert.ok(e.writes.filter(value=>value.startsWith('nf_')).every(value=>value.includes('max-age=2592000')));
  assert.ok(e.writes.every(value=>value.includes('secure; samesite=lax')));
  assert.ok(e.cookies.has('nf_jwt'));assert.ok(e.cookies.has('nf_refresh'));
  const restored=environment({initialCookies:e.cookies});
  assert.equal((await restored.sdk.getUser()).id,'fixture-member','a new browser session hydrates from durable cookies');
  await e.sdk.logout();assert.equal(e.cookies.size,0);assert.equal(e.storage.size,0);
});

test('temporary hydration failure leaves cookies available for the next attempt',async()=>{
  const first=environment();await first.sdk.login('member@example.test','fixture-password');
  const restored=environment({initialCookies:first.cookies});restored.userFailure(503);
  await assert.rejects(restored.sdk.getUser());assert.equal(restored.cookies.size,2);
  restored.userFailure(200);assert.equal((await restored.sdk.getUser()).id,'fixture-member');
});

test('returning with expired cookies renews the API cookie before the first protected request',async()=>{
  const first=environment();await first.sdk.login('member@example.test','fixture-password');
  const restored=environment({initialCookies:first.cookies});restored.advance(3601_000);
  const previousCookie=restored.cookies.get('nf_jwt');
  let sentCookie;
  const session=createSessionFetch({origin:'https://rooster.example.test',fetch:async()=>{sentCookie=restored.cookies.get('nf_jwt');return new Response('ok');},renew:async()=>{if(await restored.sdk.getUser())await restored.sdk.refreshSession();}});
  await session.request('/api/profile/me');
  assert.notEqual(sentCookie,previousCookie,'a server request must not receive the expired cookie after successful renewal');
  assert.equal(sentCookie,JSON.parse(restored.storage.get('gotrue.user')).token.access_token);
  assert.equal(restored.requests.filter(path=>path.endsWith('/token')).length,1,'restoration only renews once');
});

test('a session left with stale cookies by an older build repairs through Identity',async()=>{
  const e=environment();await e.sdk.login('member@example.test','fixture-password');
  const staleCookies=[...e.cookies];e.advance(3601_000);await e.sdk.refreshSession();
  const freshToken=JSON.parse(e.storage.get('gotrue.user')).token.access_token;
  for(const [key,value] of staleCookies)e.cookies.set(key,value);
  const before=e.requests.filter(path=>path.endsWith('/token')).length;
  assert.ok(await e.sdk.refreshSession(),'mismatched cookies must be repaired even when the saved token is fresh');
  assert.equal(e.requests.filter(path=>path.endsWith('/token')).length,before+1,'Identity validates renewal instead of trusting a stale local user');
  assert.equal(e.cookies.get('nf_jwt'),freshToken);
});

test('a stale bundle cannot refresh after the shared sign-in cookie is gone',async()=>{
  const e=environment();await e.sdk.login('member@example.test','fixture-password');
  const staleBundle=e.sdk;e.anotherBundle();e.cookies.clear();e.storage.clear();e.advance(3601_000);
  const before=e.requests.length;
  assert.equal(await staleBundle.refreshSession(),null);
  assert.equal(e.requests.length,before);assert.equal(e.cookies.size,0);assert.equal(e.storage.size,0);
});

test('simultaneous account and session bundles share one complete restoration',async()=>{
  const first=environment();await first.sdk.login('member@example.test','fixture-password');
  const restored=environment({initialCookies:first.cookies});restored.advance(3601_000);
  let complete;restored.userFailure(new Promise(resolve=>{complete=resolve;}));
  const pending=restored.sdk.getUser();await tick();
  const second=restored.sdk.getUser(),pageBundle=restored.anotherBundle().hydrateSession();
  let returnedEarly=false;second.then(()=>{returnedEarly=true;});await tick();
  assert.equal(returnedEarly,false,'an incomplete in-memory user must not pass through while /user is loading');
  assert.equal(restored.requests.filter(path=>path.endsWith('/user')).length,1);
  complete(Response.json(restored.user));
  for(const user of await Promise.all([pending,second,pageBundle]))assert.equal(user.id,'fixture-member');
  assert.equal(restored.cookies.get('nf_jwt'),JSON.parse(restored.storage.get('gotrue.user')).token.access_token);
});

for(const status of [200,401]) test(`a delayed ${status} account restoration cannot undo explicit sign-out`,async()=>{
  const first=environment();await first.sdk.login('member@example.test','fixture-password');
  const restored=environment({initialCookies:first.cookies});
  let complete;restored.userFailure(new Promise(resolve=>{complete=resolve;}));
  const pending=restored.sdk.getUser();await tick();
  await restored.sdk.logout();
  complete(Response.json(status===200?restored.user:{msg:'Rejected old session'},{status}));
  await assert.rejects(pending,/Session changed/);
  assert.equal(restored.cookies.size,0);assert.equal(restored.storage.size,0);assert.equal(await restored.sdk.getUser(),null);
});

for(const status of [200,401]) test(`a delayed ${status} account restoration cannot replace or sign out a newer account`,async()=>{
  const first=environment();await first.sdk.login('member@example.test','fixture-password');
  const restored=environment({initialCookies:first.cookies});
  const originalUser={...restored.user};
  let complete;restored.userFailure(new Promise(resolve=>{complete=resolve;}));
  const pending=restored.sdk.getUser();await tick();
  restored.advance(1000);restored.user.id='second-fixture-member';restored.userFailure(200);
  await restored.anotherBundle().login('second@example.test','new-fixture-password');
  const savedCookies=[...restored.cookies],savedStorage=[...restored.storage];
  complete(Response.json(status===200?originalUser:{msg:'Rejected old session'},{status}));
  await assert.rejects(pending,/Session changed/);
  assert.deepEqual([...restored.cookies],savedCookies);assert.deepEqual([...restored.storage],savedStorage);
  assert.equal((await restored.sdk.getUser()).id,'second-fixture-member');
});

test('a delayed renewal cannot restore cookies after another tab signs out',async()=>{
  const e=environment();await e.sdk.login('member@example.test','fixture-password');e.advance(3601_000);
  let complete;e.tokenFailure(new Promise(resolve=>{complete=resolve;}));
  const renewing=e.sdk.refreshSession();await tick();
  e.cookies.clear();e.storage.clear();
  complete(Response.json({access_token:e.token(),refresh_token:'fixture-refresh',expires_in:3600,token_type:'bearer'}));
  await assert.rejects(renewing);assert.equal(e.cookies.size,0);assert.equal(e.storage.size,0);
});

for (const lateStatus of [200,401]) test(`a delayed ${lateStatus} renewal cannot replace or erase a newer login`,async()=>{
  const e=environment();await e.sdk.login('member@example.test','fixture-password');e.advance(3601_000);
  let complete;e.tokenFailure(new Promise(resolve=>{complete=resolve;}));
  const renewing=e.sdk.refreshSession();await tick();
  e.tokenFailure(200);await e.sdk.login('member@example.test','new-fixture-password');
  const savedCookies=[...e.cookies],savedStorage=[...e.storage];
  complete(lateStatus===200 ? Response.json({access_token:e.token(),refresh_token:'old-refresh',expires_in:3600,token_type:'bearer'}) : Response.json({msg:'Revoked old session'},{status:lateStatus}));
  await assert.rejects(renewing);
  assert.deepEqual([...e.cookies],savedCookies);assert.deepEqual([...e.storage],savedStorage);
  assert.equal((await e.sdk.getUser()).id,'fixture-member');
});

test('separately bundled page scripts recover the current saved session before renewing',async()=>{
  const e=environment();await e.sdk.login('member@example.test','fixture-password');e.advance(3601_000);
  const accountPage=e.anotherBundle();await accountPage.login('member@example.test','new-fixture-password');
  const savedCookies=[...e.cookies],savedStorage=[...e.storage],before=e.requests.length;
  assert.equal((await e.sdk.getUser()).id,'fixture-member');
  assert.equal(await e.sdk.refreshSession(),null,'newly logged-in token does not need renewal');
  assert.equal(e.requests.length,before,'the stale token was never sent to Identity');
  assert.deepEqual([...e.cookies],savedCookies);assert.deepEqual([...e.storage],savedStorage);
});

for (const failure of [new TypeError('Offline'),503,429]) test(`temporary refresh ${String(failure)} keeps credentials and resumes`,async()=>{
  const e=environment();await e.sdk.login('member@example.test','fixture-password');
  e.advance(3601_000);e.tokenFailure(failure);
  await assert.rejects(e.sdk.refreshSession());
  assert.ok(e.storage.size>0,'offline must not erase the persisted account');
  assert.ok(e.cookies.has('nf_refresh'));
  e.tokenFailure(200);assert.ok(await e.sdk.refreshSession());
  assert.equal((await e.sdk.getUser()).id,'fixture-member');
});

for (const status of [400,401,403]) test(`rejected refresh ${status} cannot retain an authenticated session`,async()=>{
  const e=environment();await e.sdk.login('member@example.test','fixture-password');
  e.advance(3601_000);e.tokenFailure(status);
  assert.equal(await e.sdk.refreshSession(),null);
  assert.equal(e.cookies.size,0);assert.equal(e.storage.size,0);assert.equal(await e.sdk.getUser(),null);
});

test('an API burst waits for one renewal, and the Identity endpoint cannot recurse',async()=>{
  let resolve, renewals=0;const calls=[];
  const renewing = new Promise(done=>{resolve=done;});
  const session=createSessionFetch({origin:'https://rooster.example.test',fetch:async(input)=>{calls.push(input);return new Response('ok');},renew:async()=>{renewals++;await session.request('/.netlify/identity/token');await renewing;}});
  const pending=Array.from({length:12},(_,i)=>session.request(`/api/feed?page=${i}`));
  await tick();assert.equal(renewals,1);assert.deepEqual(calls,['/.netlify/identity/token']);
  resolve();await Promise.all(pending);assert.equal(calls.length,13);
});

test('renewal failure rejects protected reads and writes without sending or replaying them',async()=>{
  const calls=[];let working=false;
  const session=createSessionFetch({origin:'https://rooster.example.test',fetch:async(input,options)=>{calls.push({input,options});return new Response('ok');},renew:async()=>{if(!working)throw new TypeError('Offline');}});
  await assert.rejects(session.request('/api/feed'));await assert.rejects(session.request('/api/feed',{method:'POST',body:'post once'}));
  assert.equal(calls.length,0);
  working=true;await session.request('/api/feed',{method:'POST',body:'post once'});assert.equal(calls.length,1);
});

test('foreign requests, public assets and explicit bearer requests never touch Identity',async()=>{
  let renewals=0;const calls=[];
  const session=createSessionFetch({origin:'https://rooster.example.test',fetch:async(input,options)=>{calls.push({input,options});return new Response('ok');},renew:async()=>{renewals++;}});
  await session.request('https://third-party.example.test/api/feed');
  await session.request('/assets/logo.svg');
  await session.request('/api/public',{credentials:'omit'});
  await session.request('/api/resource',{headers:{Authorization:'Bearer fixture-explicit'}});
  assert.equal(renewals,0);assert.equal(calls.length,4);assert.equal(calls[0].options,undefined);
});
