import { and, eq, gt, inArray, isNull, or } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import { rosterAccess, socialBlocks, socialMutes, socialFollows, socialConnections } from '../../../db/schema.js';
import { friendRelationshipsFor, type FriendStore } from './friends.mts';
import type { ProfileStore } from './member-profiles.mts';

/** Suggestions respect either direction of a block and the viewer's active
 * mutes. All SQL reads are scoped to this viewer or a bounded set of IDs from
 * the existing directory, never a new scan of member/account storage. */
export async function directoryConnections(viewerId:string, profiles:ProfileStore, friends:FriendStore) {
  const [friendStates, blocks, mutes, follows, connections]=await Promise.all([
    friendRelationshipsFor(viewerId,friends,profiles),
    db.select({blocker:socialBlocks.blockerId,blocked:socialBlocks.blockedId}).from(socialBlocks).where(or(eq(socialBlocks.blockerId,viewerId),eq(socialBlocks.blockedId,viewerId))),
    db.select({id:socialMutes.mutedMemberId}).from(socialMutes).where(and(eq(socialMutes.memberId,viewerId),or(isNull(socialMutes.expiresAt),gt(socialMutes.expiresAt,new Date())))),
    db.select({id:socialFollows.followedId}).from(socialFollows).where(eq(socialFollows.followerId,viewerId)),
    db.select({requester:socialConnections.requesterId,addressee:socialConnections.addresseeId,status:socialConnections.status}).from(socialConnections).where(or(eq(socialConnections.requesterId,viewerId),eq(socialConnections.addresseeId,viewerId))),
  ]);
  return mergeDirectoryConnections(viewerId,{friendStates,blocks,mutes,follows,connections});
}
export function mergeDirectoryConnections(viewerId:string, data:{friendStates:Record<string,string>;blocks:{blocker:string;blocked:string}[];mutes:{id:string}[];follows:{id:string}[];connections:{requester:string;addressee:string;status:string}[]}) {
  const excludedIds=new Set([...data.blocks.map(row=>row.blocker===viewerId?row.blocked:row.blocker),...data.mutes.map(row=>row.id)]);
  const relationships={...data.friendStates};
  for(const row of data.connections) {
    const target=row.requester===viewerId?row.addressee:row.requester;
    if(!relationships[target]||relationships[target]==='none')relationships[target]=row.status==='accepted'?'accepted':row.status==='pending'?(row.requester===viewerId?'outgoing':'incoming'):'declined';
  }
  for(const row of data.follows)if(!relationships[row.id]||relationships[row.id]==='none')relationships[row.id]='following';
  relationships[viewerId]='self';
  return {viewerId,excludedIds,relationships};
}
export async function approvedDirectoryIds(ids:string[], ownerId:string|null):Promise<Set<string>> {
  const result=new Set<string>();
  for(let offset=0;offset<ids.length;offset+=100) {
    const rows=await db.select({id:rosterAccess.memberId}).from(rosterAccess).where(and(eq(rosterAccess.status,'approved'),inArray(rosterAccess.memberId,ids.slice(offset,offset+100))));
    for(const row of rows)result.add(row.id);
  }
  if(ownerId&&ids.includes(ownerId))result.add(ownerId);
  return result;
}
