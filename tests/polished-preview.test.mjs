import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import handler from '../api/preview.js';
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.code=n;return this},json(v){this.body=v},end(v){this.body=v}}}
test('preview refuses every mutation method without making a network call',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('unexpected upstream request')};
 try {for(const method of ['POST','PUT','PATCH','DELETE','OPTIONS']){const res=response();await handler({method,url:'/api/profile',headers:{}},res);assert.equal(res.code,405);assert.equal(res.headers.Allow,'GET, HEAD')}assert.equal(calls,0)}finally{globalThis.fetch=original}
});
test('public reads forward no account credentials, cookies, or upstream cookies',async()=>{
 const original=globalThis.fetch;let outgoing;
 globalThis.fetch=async(url,options)=>{outgoing={url:String(url),options};return new Response('{"entries":[]}',{headers:{'content-type':'application/json','set-cookie':'private=secret'}})};
 try{const res=response();await handler({method:'GET',url:'/api/top25?week=current',headers:{accept:'application/json',cookie:'session=private',authorization:'Bearer private'}},res);assert.equal(res.code,200);assert.equal(outgoing.url,'https://jwhitedidit.net/api/top25?week=current');assert.deepEqual(Object.keys(outgoing.options.headers).sort(),['accept','user-agent']);assert.equal(outgoing.options.redirect,'error');assert.ok(outgoing.options.signal);assert.equal(res.headers['set-cookie'],undefined);assert.equal(res.headers['Cache-Control'],'no-store')}finally{globalThis.fetch=original}
});
test('non API paths cannot become proxy destinations',async()=>{const res=response();await handler({method:'GET',url:'//other.example/action',headers:{}},res);assert.equal(res.code,404)});
test('HEAD never returns the upstream body',async()=>{const original=globalThis.fetch;globalThis.fetch=async()=>new Response('private body');try{const res=response();await handler({method:'HEAD',url:'/api/top25',headers:{}},res);assert.equal(res.code,200);assert.equal(res.body,undefined)}finally{globalThis.fetch=original}});
test('upstream failure is a bounded error instead of a broken HTML response',async()=>{const original=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('network')};try{const res=response();await handler({method:'GET',url:'/api/top25',headers:{}},res);assert.equal(res.code,502);assert.equal(res.body.error,'Public ROOSTER data is temporarily unavailable.')}finally{globalThis.fetch=original}});
test('all primary generated experiences receive the shared presentation layer once',async()=>{for(const file of ['index','people','live','radio','profile','my-profile','member-photos','members','top25','opportunities','booking-marketplace','booking-provider','booking-dashboard','booking-admin','booking-manage','rcm','reviews','review-room','apply','about','morespace','photos','edit-profile','comment-received']){const html=await readFile(new URL(`../public/${file}.html`,import.meta.url),'utf8');assert.equal((html.match(/src="\/rooster-polish.js/g)||[]).length,1,file);assert.equal((html.match(/href="\/rooster-polish.css/g)||[]).length,1,file)}});

test('protected upstream responses have a readable preview message',async()=>{const original=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify({error:{message:'Unauthorized'}}),{status:401,headers:{'content-type':'application/json'}});try{const res=response();await handler({method:'GET',url:'/api/live/rooms',headers:{}},res);assert.equal(res.code,401);assert.equal(typeof res.body.error,'string');assert.match(res.body.error,/Approved-account/);}finally{globalThis.fetch=original}});

test('nested Vercel routes reach the original API without internal routing parameters',async()=>{const original=globalThis.fetch;let target;globalThis.fetch=async url=>{target=String(url);return new Response('{"rooms":[]}')};try{const res=response();await handler({method:'GET',url:'/api/preview?__rooster_path=live%2Frooms&medium=audio',headers:{}},res);assert.equal(target,'https://jwhitedidit.net/api/live/rooms?medium=audio');assert.equal(res.code,200)}finally{globalThis.fetch=original}});
test('rewritten paths cannot traverse outside the API',async()=>{for(const path of ['../other','//other','https://other','a/../b']){const res=response();await handler({method:'GET',url:'/api/preview?__rooster_path='+encodeURIComponent(path),headers:{}},res);assert.equal(res.code,404)}});
