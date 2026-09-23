import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import handler from '../api/preview.js';
function writeRequest(method,url,headers,body='{}'){return {method,url,headers,async *[Symbol.asyncIterator](){yield Buffer.from(body)}}}
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.code=n;return this},json(v){this.body=v},end(v){this.body=v}}}
test('preview refuses every mutation method without making a network call',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('unexpected upstream request')};
 try {
  // A path with no write allowed refuses every method, and says reads are what it takes.
  for(const method of ['POST','PATCH']){const res=response();await handler({method,url:'/api/profile',headers:{host:'app.test',origin:'https://app.test'}},res);assert.equal(res.code,405);assert.equal(res.headers.Allow,'GET, HEAD')}
  // A PUT or DELETE is refused on a path that does not name it.
  for(const method of ['PUT','DELETE']){const res=response();await handler(writeRequest(method,'/api/profile',{host:'app.test',origin:'https://app.test'}),res);assert.equal(res.code,405);assert.equal(res.headers.Allow,'GET, HEAD')}
  // Anything else never reaches the allowlist.
  for(const method of ['OPTIONS','TRACE']){const res=response();await handler({method,url:'/api/profile',headers:{}},res);assert.equal(res.code,405);assert.equal(res.headers.Allow,'GET, HEAD, POST, PATCH, PUT, DELETE')}
  assert.equal(calls,0)}finally{globalThis.fetch=original}
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

test('a member acting for themselves passes, and only by the method the site takes',async()=>{
 const original=globalThis.fetch;let target,method;
 globalThis.fetch=async(url,options)=>{target=String(url);method=options.method;return new Response('{"ok":true}',{headers:{'content-type':'application/json'}})};
 try{
  const allowed=[['/api/community/feed','POST'],['/api/community/feed','DELETE'],['/api/top-eight-roster?target_id=self','PUT'],['/api/member-songs/link','POST'],['/api/member-presence','POST'],['/api/mona/chat','POST'],['/api/friends/add?target_id=4b1d7c2e-1111-4a6b-9c3d-000000000001','POST'],['/api/friend-requests/respond','POST'],['/api/member-messages/send','POST'],['/api/member-messages/read','POST'],['/api/clip-reaction','POST'],['/api/clip-comment','POST'],['/api/member-wall/post?member=4b1d7c2e-1111-4a6b-9c3d-000000000001','POST'],['/api/community/feed','PATCH']];
  for(const [url,verb] of allowed){const res=response();await handler(writeRequest(verb,url,{host:'app.test',origin:'https://app.test','content-type':'application/json'}),res);assert.equal(res.code,200,url);assert.equal(method,verb,url);assert.equal(target,'https://jwhitedidit.net'+url,url)}
 }finally{globalThis.fetch=original}
});
test('the site buttons open by path and method, and nothing next to them does',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('unexpected upstream request')};
 try{
  // A song goes in as a link; the file upload beside it stays shut, as do other account paths.
  for(const url of ['/api/member-songs/upload','/api/member-songs/delete','/api/friends','/api/media/purge','/api/profile/delete']){const res=response();await handler(writeRequest('POST',url,{host:'app.test',origin:'https://app.test'}),res);assert.equal(res.code,405,url)}
  // Top 8 is a PUT; any other method on it is refused.
  {const res=response();await handler(writeRequest('POST','/api/top-eight-roster',{host:'app.test',origin:'https://app.test'}),res);assert.equal(res.code,405)}
  assert.equal(calls,0);
 }finally{globalThis.fetch=original}
});
test('a member write still has to come from the app itself',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('unexpected upstream request')};
 try{
  for(const headers of [{host:'app.test'},{host:'app.test',origin:'https://elsewhere.test'}]){const res=response();await handler(writeRequest('POST','/api/member-messages/send',headers),res);assert.equal(res.code,403)}
  assert.equal(calls,0);
 }finally{globalThis.fetch=original}
});

test('an upload gets room, and is told plainly when it does not',async()=>{
 const original=globalThis.fetch;let sent;
 globalThis.fetch=async(url,options)=>{sent=options.body?.length;return new Response('{"ok":true}',{headers:{'content-type':'application/json'}})};
 try{
  const big=Buffer.alloc(900*1024,'x').toString('binary');
  // A photo for a business page is far over the everyday limit and still goes.
  {const res=response();await handler(writeRequest('POST','/api/booking/media',{host:'app.test',origin:'https://app.test','content-type':'multipart/form-data; boundary=x'},big),res);assert.equal(res.code,200);assert.ok(sent>800*1024)}
  // The same size on an everyday path is refused, and says so rather than reading as an outage.
  {const res=response();await handler(writeRequest('POST','/api/member-messages/send',{host:'app.test',origin:'https://app.test'},big),res);assert.equal(res.code,413);assert.match(res.body.error,/too much to send/)}
  // A track over the ceiling names the ceiling, so the app can say it before trying.
  {const res=response();const huge=Buffer.alloc(5*1024*1024,'x').toString('binary');await handler(writeRequest('POST','/api/review-room/submit',{host:'app.test',origin:'https://app.test','content-type':'multipart/form-data; boundary=x'},huge),res);assert.equal(res.code,413);assert.match(res.body.error,/under 4 MB/)}
 }finally{globalThis.fetch=original}
});
