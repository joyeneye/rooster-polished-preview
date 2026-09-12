import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {syncClipFeed,queueClipFeedSync,retryClipFeedSync,clipFeedPostAvailable} from '../netlify/functions/_shared/clip-feed.mts';
import {submitClip,reviewClip,checkClip,removeClip,restoreClip,getClipVideo} from '../netlify/functions/_shared/member-clips.mts';
import {VIDEO_MODERATION_POLICY_VERSION} from '../netlify/functions/_shared/video-moderation.mts';

const origin='https://jwhitedidit.net';
const alice={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',name:'Alice',isOwner:false};
const bob={id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',name:'Bob',isOwner:false};
const owner={id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',name:'J.White Did It',isOwner:true};
const bytes=await readFile(new URL('./fixtures/short-clip.mp4',import.meta.url));
const auth=member=>({resolveMember:async()=>member});
const post=(path,body)=>new Request(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
function memory(){
  const records=new Map(),tags=new Map(),prefixes=[];let version=0;
  const write=(key,value,options={})=>{
    if(options.onlyIfNew&&records.has(key)||options.onlyIfMatch!==undefined&&options.onlyIfMatch!==tags.get(key))return {modified:false};
    records.set(key,structuredClone(value));tags.set(key,String(++version));return {modified:true};
  };
  return {records,prefixes,async get(key){return structuredClone(records.get(key)??null);},
    async getWithMetadata(key){return records.has(key)?{data:structuredClone(records.get(key)),etag:tags.get(key)}:null;},
    async setJSON(key,value,options){return write(key,value,options);},async set(key,value,options){return write(key,value,options);},
    async delete(key){records.delete(key);tags.delete(key);},
    async *list({prefix}){prefixes.push(prefix);yield {blobs:[...records.keys()].filter(key=>key.startsWith(prefix)).sort().map(key=>({key}))};}
  };
}
function writer(){
  const posts=new Map();let next=0,tail=Promise.resolve();
  const result={posts,fail:false,afterPublish:null,transaction(id,work){
    const run=tail.then(async()=>{
      if(result.fail)throw new Error('Database temporarily unavailable');
      return work({
        async find(){return structuredClone(posts.get(id)??null);},
        async publish(clip,existing){
          const row={...existing,id:existing?.id??++next,authorId:clip.member_id,body:clip.caption,status:'published',sourceClipId:id,media:'/api/clip-video/'+clip.id};
          posts.set(id,row);await result.afterPublish?.(clip);return row.id;
        },
        async withdraw(){const row=posts.get(id);if(row&&row.status!=='deleted')row.status='clip_unavailable';}
      });
    });
    tail=run.catch(()=>{});return run;
  }};return result;
}
function setup(){const store=memory(),profiles=memory(),feed=writer();profiles.records.set('owner-binding',{id:owner.id});store.syncFeed=id=>queueClipFeedSync(store,id,feed);return {store,profiles,feed};}
async function upload(store){
  const form=new FormData();form.set('request_id',randomUUID());form.set('caption','Fresh curls and studio moments');form.set('video',new Blob([bytes],{type:'video/mp4'}),'clip.mp4');
  const response=await submitClip(new Request(origin+'/api/clips',{method:'POST',headers:{Origin:origin},body:form}),store,auth(alice));
  assert.equal(response.status,202,await response.clone().text());return (await response.json()).id;
}
async function approve(s,id){const response=await reviewClip(post('/api/clips/review',{id,action:'approve'}),s.store,s.profiles,auth(owner));assert.equal(response.status,200,await response.clone().text());}
const queueKeys=store=>[...store.records.keys()].filter(key=>key.startsWith('feed-sync-pending/'));

test('a pending upload stays private; trusted approval publishes the same video with creator credit once',async()=>{
  const s=setup(),id=await upload(s.store);
  await syncClipFeed(s.store,id,s.feed);
  assert.equal(s.feed.posts.size,0);
  assert.equal(await clipFeedPostAvailable({sourceClipId:id,authorId:alice.id},s.store),false);
  await approve(s,id);
  await Promise.all(Array.from({length:5},()=>queueClipFeedSync(s.store,id,s.feed)));
  assert.equal(s.feed.posts.size,1);
  const row=s.feed.posts.get(id);
  assert.equal(row.authorId,alice.id);assert.equal(row.body,'Fresh curls and studio moments');assert.equal(row.media,'/api/clip-video/'+id);
  assert.equal([...s.store.records.keys()].filter(key=>key.startsWith('videos/')).length,1,'publication never copies the media');
  assert.equal(queueKeys(s.store).length,0);
  assert.equal(await clipFeedPostAvailable(row,s.store),true);
  assert.equal(await clipFeedPostAvailable({...row,authorId:bob.id},s.store),false);
});

test('automatic moderation publishes the actual winning approval, while rejection never reaches WYD',async()=>{
  const s=setup(),id=await upload(s.store);
  const response=await checkClip(post('/api/clips/check',{id}),s.store,{...auth(alice),moderateVideo:async()=>({status:'approved',policy_version:VIDEO_MODERATION_POLICY_VERSION,reason:'safe_content'})});
  assert.equal(response.status,200);assert.equal(s.feed.posts.get(id).status,'published');
  const rejected=await upload(s.store);
  await checkClip(post('/api/clips/check',{id:rejected}),s.store,{...auth(alice),moderateVideo:async()=>({status:'rejected',policy_version:VIDEO_MODERATION_POLICY_VERSION,reason:'not_suitable'})});
  assert.equal(s.feed.posts.has(rejected),false);
});

test('deleting a clip immediately hides its feed item and media; Undo restores the same post',async()=>{
  const s=setup(),id=await upload(s.store);await approve(s,id);
  const original=s.feed.posts.get(id).id,clip=s.store.records.get('clips/'+id);
  await removeClip(s.store,clip,alice.id);
  assert.equal(s.feed.posts.get(id).status,'clip_unavailable');
  assert.equal(await clipFeedPostAvailable(s.feed.posts.get(id),s.store),false);
  assert.equal((await getClipVideo(new Request(origin+'/api/clip-video/'+id),s.store,s.profiles,auth(bob))).status,404);
  await restoreClip(s.store,id);
  assert.equal(s.feed.posts.get(id).id,original);assert.equal(s.feed.posts.get(id).status,'published');assert.equal(s.feed.posts.size,1);
});

test('owner rejection withdraws publication and a delayed approval cannot bring it back',async()=>{
  const s=setup(),id=await upload(s.store);await approve(s,id);
  assert.equal((await reviewClip(post('/api/clips/review',{id,action:'reject'}),s.store,s.profiles,auth(owner))).status,200);
  await queueClipFeedSync(s.store,id,s.feed);
  assert.equal(s.feed.posts.get(id).status,'clip_unavailable');
  assert.equal(await clipFeedPostAvailable(s.feed.posts.get(id),s.store),false);
  assert.equal((await reviewClip(post('/api/clips/review',{id,action:'approve'}),s.store,s.profiles,auth(owner))).status,409);
});

test('a deliberate WYD tombstone survives retries and a forged source author is refused',async()=>{
  const s=setup(),id=await upload(s.store);await approve(s,id);
  s.feed.posts.get(id).status='deleted';s.feed.posts.get(id).media=null;
  await syncClipFeed(s.store,id,s.feed);
  assert.equal(s.feed.posts.get(id).status,'deleted');assert.equal(s.feed.posts.get(id).media,null);
  s.feed.posts.set(id,{...s.feed.posts.get(id),status:'published',authorId:bob.id});
  await assert.rejects(syncClipFeed(s.store,id,s.feed),/author changed/);
});

test('revocation during publication wins the final source check',async()=>{
  const s=setup(),id=await upload(s.store);
  s.feed.afterPublish=async()=>{for(const key of [...s.store.records.keys()])if(key.startsWith('published/'))await s.store.delete(key);};
  await approve(s,id);
  assert.equal(s.feed.posts.get(id).status,'clip_unavailable');
  assert.equal(await clipFeedPostAvailable(s.feed.posts.get(id),s.store),false);
});

test('database outages retain durable work and a bounded retry publishes without scanning members',async()=>{
  const s=setup(),id=await upload(s.store);s.feed.fail=true;await approve(s,id);
  assert.equal(s.feed.posts.size,0);assert.equal(queueKeys(s.store).length,1);
  s.feed.fail=false;
  assert.equal(await retryClipFeedSync(s.store,s.feed),1);
  assert.equal(s.feed.posts.get(id).status,'published');assert.equal(queueKeys(s.store).length,0);
  assert.deepEqual(s.store.prefixes,['feed-sync-pending/']);
  s.feed.fail=true;await removeClip(s.store,s.store.records.get('clips/'+id),alice.id);
  assert.equal(await clipFeedPostAvailable(s.feed.posts.get(id),s.store),false,'read-time validation closes an outage gap');
  s.feed.fail=false;await retryClipFeedSync(s.store,s.feed);assert.equal(s.feed.posts.get(id).status,'clip_unavailable');
});

test('failed events rotate so newer publications are not starved by the retry limit',async()=>{
  const s=setup(),id=await upload(s.store);await approve(s,id);
  const poison='f'.repeat(64);
  s.store.records.set('feed-sync-pending/0000000000000-poison',{id:poison});
  s.store.records.set('feed-sync-pending/0000000000001-valid',{id});
  const base=s.feed.transaction.bind(s.feed);s.feed.transaction=(source,work)=>source===poison?Promise.reject(new Error('broken source')):base(source,work);
  assert.equal(await retryClipFeedSync(s.store,s.feed,1),1);
  assert.equal(s.store.records.has('feed-sync-pending/0000000000000-poison'),false);
  assert.equal(await retryClipFeedSync(s.store,s.feed,1),1);
  assert.equal(s.store.records.has('feed-sync-pending/0000000000001-valid'),false);
  assert.equal(queueKeys(s.store).length,1);
});

test('incomplete commits, wrong digest, unsafe source ids and storage failures stay hidden',async()=>{
  const s=setup(),id=await upload(s.store);await approve(s,id);const row=s.feed.posts.get(id);
  const key=[...s.store.records.keys()].find(key=>key.startsWith('published/'));
  s.store.records.set(key,{id,digest:'0'.repeat(64)});
  assert.equal(await clipFeedPostAvailable(row,s.store),false);
  await syncClipFeed(s.store,id,s.feed);assert.equal(s.feed.posts.get(id).status,'clip_unavailable');
  assert.equal(await clipFeedPostAvailable({sourceClipId:'../../private',authorId:alice.id},s.store),false);
  assert.equal(await clipFeedPostAvailable(row,{...s.store,get:async()=>{throw new Error('offline');}}),false);
  assert.equal(await clipFeedPostAvailable({sourceClipId:null,authorId:alice.id}),true);
  await assert.rejects(queueClipFeedSync(s.store,'../../private',s.feed),/Invalid clip source/);
});

test('database linkage and deletion share a lock and keep a permanent unique source tombstone',async()=>{
  const source=await readFile(new URL('../netlify/functions/_shared/clip-feed.mts',import.meta.url),'utf8');
  const feed=await readFile(new URL('../netlify/functions/_shared/social-feed.mts',import.meta.url),'utf8');
  const migration=await readFile(new URL('../netlify/database/migrations/20260911193000_link_clips_to_wyd/migration.sql',import.meta.url),'utf8');
  assert.match(source,/pg_advisory_xact_lock\(hashtextextended\(\$\{id\},0\)\)/);
  assert.match(source,/if\(!updated.length\)return postId/);
  assert.match(feed,/pg_advisory_xact_lock\(hashtextextended\(\$\{post.sourceClipId\},0\)\)/);
  assert.match(feed,/post.authorId !== member.id\) throw new MemberError\(403/);
  assert.match(migration,/ADD COLUMN IF NOT EXISTS "source_clip_id" text/);
  assert.match(migration,/CREATE UNIQUE INDEX IF NOT EXISTS "social_posts_source_clip_id_unique"/);
});
