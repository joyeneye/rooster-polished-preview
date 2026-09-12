import {randomUUID} from 'node:crypto';
import {and,eq,ne,sql} from 'drizzle-orm';
import {db} from '../../../db/index.js';
import {socialPosts,socialPostMedia} from '../../../db/schema.js';
import {findClipRecord,isClipPublished,type Clip,type ClipsStore} from './member-clips.mts';

const HASH=/^[a-f0-9]{64}$/;
const pendingKey=()=>`feed-sync-pending/${Date.now()}-${randomUUID()}`;
type SourcePost={id:number;status:string;authorId:string};
export type ClipFeedTransaction={
  find:()=>Promise<SourcePost|null>;
  publish:(clip:Clip,existing:SourcePost|null)=>Promise<number>;
  withdraw:()=>Promise<void>;
};
export type ClipFeedWriter={transaction:<T>(id:string,work:(tx:ClipFeedTransaction)=>Promise<T>)=>Promise<T>};

export function databaseClipFeedWriter():ClipFeedWriter {
  return {transaction:(id,work)=>db.transaction(async tx=>{
    // Serialize every publish/revoke for one clip. The unique source column is
    // an additional database guard against duplicate entries across retries.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${id},0))`);
    return work({
      async find(){const [post]=await tx.select({id:socialPosts.id,status:socialPosts.status,authorId:socialPosts.authorId}).from(socialPosts).where(eq(socialPosts.sourceClipId,id)).limit(1);return post||null;},
      async publish(clip,existing){
        const values={authorId:clip.member_id,authorName:clip.name,authorKind:'creator',contentType:'video_post',
          body:clip.caption,visibility:'public',status:'published',metadata:{clip_source:{id:clip.id},origin:'profile_clip'},updatedAt:new Date()};
        let postId=existing?.id;
        if(postId) {
          const updated=await tx.update(socialPosts).set(values).where(and(eq(socialPosts.id,postId),ne(socialPosts.status,'deleted'))).returning({id:socialPosts.id});
          if(!updated.length)return postId;
        }
        else {const [created]=await tx.insert(socialPosts).values({...values,sourceClipId:id,publishedAt:new Date(clip.created_at)}).returning({id:socialPosts.id});postId=created.id;}
        await tx.delete(socialPostMedia).where(eq(socialPostMedia.postId,postId));
        await tx.insert(socialPostMedia).values({postId,mediaType:'video',url:`/api/clip-video/${clip.id}`,altText:clip.caption,
          durationMs:Math.round(clip.duration*1000),width:clip.width,height:clip.height,sortOrder:0,metadata:{source_clip_id:clip.id}});
        return postId;
      },
      async withdraw(){await tx.update(socialPosts).set({status:'clip_unavailable',visibility:'private',updatedAt:new Date()}).where(and(eq(socialPosts.sourceClipId,id),ne(socialPosts.status,'deleted')));},
    });
  })};
}

export async function syncClipFeed(store:ClipsStore,id:string,writer:ClipFeedWriter=databaseClipFeedWriter()):Promise<void> {
  if(!HASH.test(id))throw new Error('Invalid clip source');
  await writer.transaction(id,async tx=>{
    const clip=await findClipRecord(store,id);
    if(!clip||!await isClipPublished(store,id)){await tx.withdraw();return;}
    const existing=await tx.find();
    if(existing?.status==='deleted')return; // A member's deliberate WYD deletion stays deleted.
    if(existing&&existing.authorId!==clip.member_id)throw new Error('Clip author changed');
    await tx.publish(clip,existing);
    // A revoke that happened while the post was being written wins as well.
    if(!await isClipPublished(store,id))await tx.withdraw();
  });
}

export async function queueClipFeedSync(store:ClipsStore,id:string,writer?:ClipFeedWriter):Promise<boolean> {
  // Each event has its own key, so completing an older event cannot delete a
  // newer publication/removal retry. Only this queue is scanned by the worker.
  if(!HASH.test(id))throw new Error('Invalid clip source');
  const key=pendingKey();
  try {
    await store.setJSON(key,{id},{onlyIfNew:true});
    await syncClipFeed(store,id,writer);
    await store.delete(key);return true;
  }catch{console.warn('clip_feed_sync_pending',{clip_id:id});return false;}
}

export async function retryClipFeedSync(store:ClipsStore,writer?:ClipFeedWriter,limit=20):Promise<number> {
  limit=Number.isFinite(limit)?Math.min(100,Math.max(1,Math.floor(limit))):20;
  let processed=0;
  for await(const page of store.list({prefix:'feed-sync-pending/',paginate:true})){
    for(const entry of page.blobs){
      if(processed>=limit)return processed;
      processed++;
      const event=await store.get(entry.key,{type:'json'}).catch(()=>null);
      try {
        if(event===null)throw new Error('Clip feed event could not be read');
        if(HASH.test(event?.id||''))await syncClipFeed(store,event.id,writer);
        await store.delete(entry.key);
      }
      catch{
        // Move a failed event behind newer work. Write its replacement first,
        // so a crash or outage can at worst leave an idempotent duplicate.
        if(event!==null)try{
          const moved=await store.setJSON(pendingKey(),event,{onlyIfNew:true});
          if(moved.modified)await store.delete(entry.key);
        }catch{/* Keep the original event until storage returns. */}
        console.warn('clip_feed_retry_pending');
      }
    }
  }
  return processed;
}

export async function clipFeedPostAvailable(post:{sourceClipId?:string|null;authorId:string},store?:ClipsStore):Promise<boolean> {
  if(!post.sourceClipId)return true;
  if(!store||!HASH.test(post.sourceClipId))return false;
  try{const clip=await findClipRecord(store,post.sourceClipId);return !!clip&&clip.member_id===post.authorId&&await isClipPublished(store,post.sourceClipId);}
  catch{return false;}
}
