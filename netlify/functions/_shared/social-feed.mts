import { and, desc, eq, gt, inArray, lt, notInArray, or, sql } from "drizzle-orm";
import { db } from "../../../db/index.js";
import {
  bookingBusinesses,
  liveParticipants,
  liveRooms,
  socialBlocks,
  socialBookmarks,
  socialComments,
  socialConnections,
  socialFeedPreferences,
  socialFollows,
  socialLikes,
  socialMutes,
  socialNotifications,
  socialPostMedia,
  socialPosts,
  socialReposts,
} from "../../../db/schema.js";
import { MemberError, memberJSON, type Member } from "./member-auth.mts";
import { hydrateFeedAuthors } from "./feed-authors.mts";
import type { IdentityDependencies } from "./wall-identity.mts";
import {clipFeedPostAvailable} from './clip-feed.mts';
import type {ClipsStore} from './member-clips.mts';

const TYPES = ["text_post", "photo_post", "video_post", "voice_post", "poll_post", "room_post", "event_post", "shared_link", "repost", "quote_post", "announcement"] as const;
const PRIMARY = ["for_you", "following", "trending", "latest", "rooms"] as const;
const CONNECTIONS = ["everyone", "following", "connections", "favorites", "communities", "topics", "businesses", "creators", "friends"] as const;
const VISIBILITY = ["public", "followers", "connections", "private"] as const;
const ACTIONS = ["like", "bookmark", "repost", "comment", "view"] as const;
const UNSAFE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]/;

type PrimaryFilter = typeof PRIMARY[number];
type ConnectionFilter = typeof CONNECTIONS[number];
type CommunityMember = Member & { isOwner?: boolean };

function integer(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new MemberError(400, `${label} is invalid.`);
  return parsed;
}

function text(value: unknown, max: number, label: string, required = false): string {
  const cleaned = String(value ?? "").trim().replace(/\r\n?/g, "\n");
  if ((required && !cleaned) || cleaned.length > max || UNSAFE.test(cleaned)) throw new MemberError(400, `${label} is invalid.`);
  return cleaned;
}

function interestTokens(post: typeof socialPosts.$inferSelect): string[] {
  const metadata = post.metadata && typeof post.metadata === "object" ? post.metadata as Record<string, unknown> : {};
  const topic = typeof metadata.category === "string" ? metadata.category : typeof metadata.topic === "string" ? metadata.topic : "";
  return [`type:${post.contentType}`, `kind:${post.authorKind}`, ...(topic ? [`topic:${topic.slice(0, 40).toLowerCase()}`] : [])];
}

async function learnInterest(memberId: string, post: typeof socialPosts.$inferSelect, strength = 1) {
  const [saved] = await db.select().from(socialFeedPreferences).where(eq(socialFeedPreferences.memberId, memberId)).limit(1);
  const current = Array.isArray(saved?.contentFilters) ? saved.contentFilters.filter(value => typeof value === "string") : [];
  const learned = Array.from({ length: Math.max(1, Math.min(3, strength)) }, () => interestTokens(post)).flat();
  const contentFilters = [...current, ...learned].slice(-48);
  await db.insert(socialFeedPreferences).values({ memberId, primaryFilter: saved?.primaryFilter || "for_you", connectionFilters: saved?.connectionFilters || ["everyone"], contentFilters })
    .onConflictDoUpdate({ target: socialFeedPreferences.memberId, set: { contentFilters, updatedAt: new Date() } });
}

export function personalizeFeedRows<T extends typeof socialPosts.$inferSelect>(rows: T[], signals: string[], following: string[]): T[] {
  if (!signals.length || rows.length < 2) return rows;
  const weights = new Map<string, number>();
  signals.forEach((token, index) => weights.set(token, (weights.get(token) || 0) + 1 + index / Math.max(1, signals.length)));
  const scored = rows.map((post, position) => {
    const affinity = interestTokens(post).reduce((sum, token) => sum + (weights.get(token) || 0), 0);
    const relationship = following.includes(post.authorId) ? 5 : 0;
    const quality = Math.log1p(post.likeCount * 2 + post.commentCount * 3 + post.repostCount * 4 + post.bookmarkCount * 2 + post.viewCount * .1);
    const freshness = Math.max(0, 4 - (Date.now() - post.publishedAt.getTime()) / 86_400_000);
    return { post, position, affinity: affinity + relationship, score: affinity * 3 + relationship + quality + freshness };
  }).sort((a, b) => b.score - a.score || a.position - b.position);
  // One discovery post after every four strong matches keeps new people and
  // subjects visible instead of trapping a member in a narrow loop.
  const matched = scored.filter(item => item.affinity > 0);
  const discovery = scored.filter(item => item.affinity <= 0);
  const result: typeof scored = [];
  while (matched.length || discovery.length) {
    if (result.length > 0 && result.length % 5 === 4 && discovery.length) result.push(discovery.shift()!);
    else result.push((matched.length ? matched : discovery).shift()!);
  }
  return result.map(item => item.post);
}

async function relationshipIds(memberId: string) {
  const [followingRows, connectionRows, blockedRows, mutedRows] = await Promise.all([
    db.select({ id: socialFollows.followedId, favorite: socialFollows.favorite }).from(socialFollows).where(eq(socialFollows.followerId, memberId)),
    db.select({ requester: socialConnections.requesterId, addressee: socialConnections.addresseeId }).from(socialConnections)
      .where(and(eq(socialConnections.status, "accepted"), or(eq(socialConnections.requesterId, memberId), eq(socialConnections.addresseeId, memberId)))),
    db.select({ blocker: socialBlocks.blockerId, blocked: socialBlocks.blockedId }).from(socialBlocks)
      .where(or(eq(socialBlocks.blockerId, memberId), eq(socialBlocks.blockedId, memberId))),
    db.select({ id: socialMutes.mutedMemberId }).from(socialMutes)
      .where(and(eq(socialMutes.memberId, memberId), or(sql`${socialMutes.expiresAt} is null`, gt(socialMutes.expiresAt, new Date())))),
  ]);
  const connections = connectionRows.map(row => row.requester === memberId ? row.addressee : row.requester);
  const blocked = blockedRows.map(row => row.blocker === memberId ? row.blocked : row.blocker);
  return {
    following: followingRows.map(row => row.id),
    favorites: followingRows.filter(row => row.favorite).map(row => row.id),
    connections,
    blocked: [...new Set([...blocked, ...mutedRows.map(row => row.id)])],
  };
}

function encodeCursor(post: { id: number; publishedAt: Date }): string {
  return Buffer.from(`${post.publishedAt.toISOString()}|${post.id}`).toString("base64url");
}

function decodeCursor(value: string | null): { date: Date; id: number } | null {
  if (!value) return null;
  try {
    const [rawDate, rawId] = Buffer.from(value, "base64url").toString("utf8").split("|");
    const date = new Date(rawDate); const id = Number(rawId);
    return Number.isFinite(date.getTime()) && Number.isSafeInteger(id) && id > 0 ? { date, id } : null;
  } catch { return null; }
}

function postView(row: typeof socialPosts.$inferSelect, media: typeof socialPostMedia.$inferSelect[], state: { liked: boolean; bookmarked: boolean; reposted: boolean }, canDelete = false) {
  return {
    id: row.id,
    author: { id: row.authorId, name: row.authorName, photo_url: row.authorPhotoUrl || null, kind: row.authorKind },
    content_type: row.contentType,
    body: row.body,
    visibility: row.visibility,
    original_post_id: row.originalPostId,
    room_id: row.roomId,
    booking: row.bookingBusinessId ? { business_id: row.bookingBusinessId, service_id: row.bookingServiceId, label: row.bookingLabel || "Book now" } : null,
    metadata: row.metadata,
    media: media.map(item => ({ id: item.id, type: item.mediaType, url: item.url, thumbnail_url: item.thumbnailUrl || null, alt: item.altText, duration_ms: item.durationMs, width: item.width, height: item.height })),
    counts: { likes: row.likeCount, comments: row.commentCount, reposts: row.repostCount, bookmarks: row.bookmarkCount, views: row.viewCount },
    viewer: { ...state, can_delete: canDelete },
    featured: row.featured,
    published_at: row.publishedAt.toISOString(),
  };
}

export async function getSocialFeed(req: Request, member: CommunityMember, identities?: IdentityDependencies, clips?:ClipsStore): Promise<Response> {
  const url = new URL(req.url);
  const requestedPrimary = url.searchParams.get("filter") || "for_you";
  const primary = PRIMARY.includes(requestedPrimary as PrimaryFilter) ? requestedPrimary as PrimaryFilter : "for_you";
  const requestedConnection = url.searchParams.get("connection") || "everyone";
  const connection = CONNECTIONS.includes(requestedConnection as ConnectionFilter) ? requestedConnection as ConnectionFilter : "everyone";
  const limit = Math.min(20, Math.max(5, Number(url.searchParams.get("limit") || 10)));
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  const relationships = await relationshipIds(member.id);
  const allowed = or(
    eq(socialPosts.authorId, member.id),
    eq(socialPosts.visibility, "public"),
    and(eq(socialPosts.visibility, "followers"), relationships.following.length ? inArray(socialPosts.authorId, relationships.following) : sql`false`),
    and(eq(socialPosts.visibility, "connections"), relationships.connections.length ? inArray(socialPosts.authorId, relationships.connections) : sql`false`),
  );
  const conditions: any[] = [eq(socialPosts.status, "published"), allowed];
  if (relationships.blocked.length) conditions.push(notInArray(socialPosts.authorId, relationships.blocked));
  if (cursor) conditions.push(or(lt(socialPosts.publishedAt, cursor.date), and(eq(socialPosts.publishedAt, cursor.date), lt(socialPosts.id, cursor.id))));
  const strictFollowing = primary === "following" || connection === "following";
  if (strictFollowing) conditions.push(inArray(socialPosts.authorId, [...new Set([member.id, ...relationships.following])]));
  if (connection === "connections" || connection === "friends") conditions.push(inArray(socialPosts.authorId, [...new Set([member.id, ...relationships.connections])]));
  if (connection === "favorites") conditions.push(inArray(socialPosts.authorId, [...new Set([member.id, ...relationships.favorites])]));
  if (connection === "businesses") conditions.push(eq(socialPosts.authorKind, "business"));
  if (connection === "creators") conditions.push(eq(socialPosts.authorKind, "creator"));
  if (primary === "rooms") conditions.push(eq(socialPosts.contentType, "room_post"));

  const order = primary === "trending"
    ? [desc(sql`${socialPosts.featured}::int * 100000 + ${socialPosts.likeCount} * 3 + ${socialPosts.commentCount} * 5 + ${socialPosts.repostCount} * 7 + ${socialPosts.viewCount}`), desc(socialPosts.publishedAt)]
    : primary === "for_you"
      ? [desc(sql`${socialPosts.featured}::int * 100000 + ${socialPosts.likeCount} * 2 + ${socialPosts.commentCount} * 3 + ${socialPosts.repostCount} * 4 + greatest(0, 168 - extract(epoch from (now() - ${socialPosts.publishedAt})) / 3600)`), desc(socialPosts.publishedAt)]
      : [desc(socialPosts.publishedAt), desc(socialPosts.id)];

  const preference = await db.select().from(socialFeedPreferences).where(eq(socialFeedPreferences.memberId, member.id)).limit(1);
  const candidateLimit = primary === "for_you" ? Math.max(limit * 4, 24) : limit + 1;
  const candidates = await db.select().from(socialPosts).where(and(...conditions)).orderBy(...order).limit(candidateLimit);
  const availability=await Promise.all(candidates.map(row=>clipFeedPostAvailable(row,clips)));
  const availableCandidates=candidates.filter((_row,index)=>availability[index]);
  const rows = primary === "for_you" ? personalizeFeedRows(availableCandidates, preference[0]?.contentFilters || [], relationships.following) : availableCandidates;
  const visibleRows = rows.slice(0, limit);
  const ids = visibleRows.map(row => row.id);
  const [mediaRows, likes, bookmarks, reposts] = ids.length ? await Promise.all([
    db.select().from(socialPostMedia).where(inArray(socialPostMedia.postId, ids)).orderBy(socialPostMedia.sortOrder),
    db.select({ postId: socialLikes.postId }).from(socialLikes).where(and(eq(socialLikes.memberId, member.id), inArray(socialLikes.postId, ids))),
    db.select({ postId: socialBookmarks.postId }).from(socialBookmarks).where(and(eq(socialBookmarks.memberId, member.id), inArray(socialBookmarks.postId, ids))),
    db.select({ postId: socialReposts.postId }).from(socialReposts).where(and(eq(socialReposts.memberId, member.id), inArray(socialReposts.postId, ids))),
  ]) : [[], [], [], []];
  const liked = new Set(likes.map(row => row.postId)); const bookmarked = new Set(bookmarks.map(row => row.postId)); const reposted = new Set(reposts.map(row => row.postId));
  const mediaByPost = new Map<number, typeof socialPostMedia.$inferSelect[]>();
  for (const item of mediaRows) mediaByPost.set(item.postId, [...(mediaByPost.get(item.postId) || []), item]);

  const posts = await hydrateFeedAuthors(req, visibleRows.map(row => postView(row, mediaByPost.get(row.id) || [], { liked: liked.has(row.id), bookmarked: bookmarked.has(row.id), reposted: reposted.has(row.id) }, row.authorId === member.id)), identities);
  const roomRows = await db.select({ id: liveRooms.id, key: liveRooms.roomKey, title: liveRooms.title, host_name: liveRooms.hostName, created_at: liveRooms.createdAt, listeners: sql<number>`count(*) filter (where ${liveParticipants.present} = true)`.mapWith(Number) })
    .from(liveRooms).leftJoin(liveParticipants, eq(liveParticipants.roomId, liveRooms.id)).where(eq(liveRooms.status, "live"))
    .groupBy(liveRooms.id).orderBy(desc(sql`count(*) filter (where ${liveParticipants.present} = true)`), desc(liveRooms.createdAt)).limit(8);
  const businesses = await db.select({ id: bookingBusinesses.id, name: bookingBusinesses.name, slug: bookingBusinesses.slug, logo_url: bookingBusinesses.logoUrl, city: bookingBusinesses.city, region: bookingBusinesses.region })
    .from(bookingBusinesses).where(and(eq(bookingBusinesses.published, true), eq(bookingBusinesses.status, "active"))).orderBy(desc(bookingBusinesses.featured), desc(bookingBusinesses.reviewCount)).limit(4);
  return memberJSON({
    member: { id: member.id, name: member.name },
    posts,
    next_cursor: (rows.length > limit || candidates.length >= candidateLimit) && candidates.length ? encodeCursor(visibleRows.at(-1) || candidates[candidates.length-1]) : null,
    rooms: roomRows.map(room => ({ ...room, created_at: room.created_at.toISOString() })),
    businesses,
    preference: preference[0] ? { primary_filter: preference[0].primaryFilter, connection_filters: preference[0].connectionFilters, content_filters: preference[0].contentFilters } : null,
  });
}

type AlbumPhoto={id:string;url:string;width:number;height:number;caption:string};
export async function createSocialPost(req: Request, member: CommunityMember, photoUrl = "", resolveAlbumPhoto?: (memberId:string,photoId:string)=>Promise<AlbumPhoto|null>): Promise<Response> {
  let input: Record<string, unknown>;
  try { input = await req.json(); } catch { throw new MemberError(400, "Send a valid post."); }
  const contentType = String(input.content_type || "text_post");
  if (!TYPES.includes(contentType as typeof TYPES[number])) throw new MemberError(400, "Choose a supported post type.");
  const body = text(input.body, 5000, "Post", !["room_post","photo_post"].includes(contentType));
  const visibility = VISIBILITY.includes(String(input.visibility) as typeof VISIBILITY[number]) ? String(input.visibility) : "public";
  const bookingBusinessId = input.booking_business_id ? integer(input.booking_business_id, "Business") : null;
  let bookingServiceId = input.booking_service_id ? integer(input.booking_service_id, "Service") : null;
  if (bookingBusinessId) {
    const [business] = await db.select({ id: bookingBusinesses.id }).from(bookingBusinesses).where(and(eq(bookingBusinesses.id, bookingBusinessId), eq(bookingBusinesses.published, true), eq(bookingBusinesses.status, "active"))).limit(1);
    if (!business) throw new MemberError(404, "That booking page is unavailable.");
  } else bookingServiceId = null;
  const metadata = input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata) ? {...input.metadata as Record<string, unknown>} : {};
  delete metadata.clip_source; delete metadata.source_clip_id;
  if(metadata.origin==='profile_clip')delete metadata.origin;
  const location=text(metadata.location||"",100,"Location");
  if(/^[-+]?\d{1,2}(?:\.\d+)?\s*[,/]\s*[-+]?\d{1,3}(?:\.\d+)?$/.test(location))throw new MemberError(400,"Use a city or place name instead of coordinates.");
  if(location)metadata.location=location;else delete metadata.location;
  let albumPhoto:AlbumPhoto|null=null;
  if(contentType==="photo_post"){
    for(const key of Object.keys(metadata))if(!["location","album_photo","photo_request_id"].includes(key))delete metadata[key];
    const reference=metadata.album_photo&&typeof metadata.album_photo==="object"&&!Array.isArray(metadata.album_photo)?metadata.album_photo as Record<string,unknown>:{};
    const photoId=text(reference.id||"",64,"Photo",true);
    if(!/^[a-f0-9]{64}$/.test(photoId)||!resolveAlbumPhoto)throw new MemberError(400,"Choose a photo from your album.");
    albumPhoto=await resolveAlbumPhoto(member.id,photoId);
    if(!albumPhoto)throw new MemberError(404,"That photo is not in your album.");
    metadata.album_photo={id:photoId};
    const requestId=text(metadata.photo_request_id||"",64,"Photo request",true);
    if(!/^[0-9a-f-]{36}$/i.test(requestId))throw new MemberError(400,"That photo request is invalid.");
    metadata.photo_request_id=requestId.toLowerCase();
    const [existing]=await db.select().from(socialPosts).where(and(eq(socialPosts.authorId,member.id),eq(socialPosts.contentType,"photo_post"),sql`${socialPosts.metadata}->>'photo_request_id' = ${metadata.photo_request_id}`)).limit(1);
    if(existing){const media=await db.select().from(socialPostMedia).where(eq(socialPostMedia.postId,existing.id)).orderBy(socialPostMedia.sortOrder);return memberJSON({post:postView(existing,media,{liked:false,bookmarked:false,reposted:false},true),duplicate:true});}
  } else {delete metadata.album_photo;delete metadata.photo_request_id;}
  const created=await db.transaction(async tx=>{
    const [post] = await tx.insert(socialPosts).values({
      authorId: member.id, authorName: member.name, authorPhotoUrl: photoUrl, authorKind: bookingBusinessId ? "business" : "member",
      contentType, body, visibility, bookingBusinessId, bookingServiceId, bookingLabel: text(input.booking_label || "", 40, "Booking label"), metadata,
    }).returning();
    const media=albumPhoto?(await tx.insert(socialPostMedia).values({postId:post.id,mediaType:"image",url:albumPhoto.url,altText:body.slice(0,300),width:albumPhoto.width,height:albumPhoto.height,sortOrder:0,metadata:{source_album_photo_id:albumPhoto.id}}).returning()):[];
    return {post,media};
  });
  return memberJSON({ post: postView(created.post, created.media, { liked: false, bookmarked: false, reposted: false }, true) }, 201);
}

/** Removes a WYD post from every feed. Members can only remove their own
 * posts. The post row is kept
 * as an empty tombstone so quotes and historical database references never
 * break, while its body, media, replies and reactions are removed. */
export async function deleteSocialPost(req: Request, member: CommunityMember): Promise<Response> {
  let input: Record<string, unknown>;
  try { input = await req.json(); } catch { throw new MemberError(400, "Choose a valid WYD post to delete."); }
  const postId = integer(input.post_id, "Post");
  const [post] = await db.select().from(socialPosts).where(eq(socialPosts.id, postId)).limit(1);
  if (!post) throw new MemberError(404, "That WYD post is already gone.");
  if (post.authorId !== member.id) throw new MemberError(403, "You can only delete your own WYD posts.");
  if (post.status === "deleted") return memberJSON({ deleted: true, post_id: postId });

  await db.transaction(async tx => {
    // The source publisher takes this same lock. A queued retry cannot put
    // media back while the author is deliberately deleting their WYD post.
    if (post.sourceClipId) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${post.sourceClipId},0))`);
    await tx.delete(socialNotifications).where(eq(socialNotifications.postId, postId));
    await tx.delete(socialBookmarks).where(eq(socialBookmarks.postId, postId));
    await tx.delete(socialReposts).where(or(eq(socialReposts.postId, postId), eq(socialReposts.quotePostId, postId)));
    await tx.delete(socialLikes).where(eq(socialLikes.postId, postId));
    await tx.delete(socialComments).where(eq(socialComments.postId, postId));
    await tx.delete(socialPostMedia).where(eq(socialPostMedia.postId, postId));
    await tx.update(socialPosts).set({
      status: "deleted", visibility: "private", body: "", metadata: {}, featured: false,
      originalPostId: null, roomId: null, bookingBusinessId: null, bookingServiceId: null, bookingLabel: "",
      likeCount: 0, commentCount: 0, repostCount: 0, bookmarkCount: 0, viewCount: 0, watchTimeMs: 0,
      updatedAt: new Date(),
    }).where(eq(socialPosts.id, postId));
  });
  return memberJSON({ deleted: true, post_id: postId });
}

export async function updateSocialPost(req: Request, member: Member, clips?:ClipsStore): Promise<Response> {
  let input: Record<string, unknown>;
  try { input = await req.json(); } catch { throw new MemberError(400, "Send a valid action."); }
  const postId = integer(input.post_id, "Post");
  const action = String(input.action || "");
  if (!ACTIONS.includes(action as typeof ACTIONS[number])) throw new MemberError(400, "Choose a supported action.");
  const [post] = await db.select().from(socialPosts).where(and(eq(socialPosts.id, postId), eq(socialPosts.status, "published"))).limit(1);
  if (!post || !await clipFeedPostAvailable(post,clips)) throw new MemberError(404, "That post is unavailable.");
  const relationships = await relationshipIds(member.id);
  if (relationships.blocked.includes(post.authorId)) throw new MemberError(404, "That post is unavailable.");
  const authorized = post.authorId === member.id || post.visibility === "public" || (post.visibility === "followers" && relationships.following.includes(post.authorId)) || (post.visibility === "connections" && relationships.connections.includes(post.authorId));
  if (!authorized) throw new MemberError(403, "You cannot interact with that post.");

  if (action === "view") {
    const watchMs = Math.max(1000, Math.min(60_000, Number(input.watch_ms) || 2500));
    await Promise.all([
      db.update(socialPosts).set({ viewCount: sql`${socialPosts.viewCount} + 1`, watchTimeMs: sql`${socialPosts.watchTimeMs} + ${watchMs}` }).where(eq(socialPosts.id, postId)),
      learnInterest(member.id, post, watchMs >= 8000 ? 2 : 1),
    ]);
    return memberJSON({ learned: true });
  }

  if (action === "comment") {
    const body = text(input.body, 1200, "Comment", true);
    const [comment] = await db.transaction(async tx => {
      const inserted = await tx.insert(socialComments).values({ postId, authorId: member.id, authorName: member.name, body }).returning();
      await tx.update(socialPosts).set({ commentCount: sql`${socialPosts.commentCount} + 1`, updatedAt: new Date() }).where(eq(socialPosts.id, postId));
      if (post.authorId !== member.id) await tx.insert(socialNotifications).values({ memberId: post.authorId, actorId: member.id, type: "comment", postId, data: { excerpt: body.slice(0, 120) } });
      return inserted;
    });
    await learnInterest(member.id, post, 3);
    return memberJSON({ active: true, count: post.commentCount + 1, comment: { id: comment.id, author_id: comment.authorId, author_name: comment.authorName, body: comment.body, created_at: comment.createdAt.toISOString() } });
  }

  let active = false;
  if (action === "like") {
    const [existing] = await db.select({ id: socialLikes.id }).from(socialLikes).where(and(eq(socialLikes.memberId, member.id), eq(socialLikes.postId, postId))).limit(1);
    active = !existing;
    await db.transaction(async tx => {
      if (active) await tx.insert(socialLikes).values({ postId, memberId: member.id });
      else await tx.delete(socialLikes).where(eq(socialLikes.id, existing.id));
      await tx.update(socialPosts).set({ likeCount: active ? sql`${socialPosts.likeCount} + 1` : sql`greatest(0, ${socialPosts.likeCount} - 1)`, updatedAt: new Date() }).where(eq(socialPosts.id, postId));
      if (active && post.authorId !== member.id) await tx.insert(socialNotifications).values({ memberId: post.authorId, actorId: member.id, type: action, postId });
    });
  } else if (action === "bookmark") {
    const [existing] = await db.select({ id: socialBookmarks.id }).from(socialBookmarks).where(and(eq(socialBookmarks.memberId, member.id), eq(socialBookmarks.postId, postId))).limit(1);
    active = !existing;
    await db.transaction(async tx => {
      if (active) await tx.insert(socialBookmarks).values({ postId, memberId: member.id });
      else await tx.delete(socialBookmarks).where(eq(socialBookmarks.id, existing.id));
      await tx.update(socialPosts).set({ bookmarkCount: active ? sql`${socialPosts.bookmarkCount} + 1` : sql`greatest(0, ${socialPosts.bookmarkCount} - 1)`, updatedAt: new Date() }).where(eq(socialPosts.id, postId));
    });
  } else {
    const [existing] = await db.select({ id: socialReposts.id }).from(socialReposts).where(and(eq(socialReposts.memberId, member.id), eq(socialReposts.postId, postId))).limit(1);
    active = !existing;
    await db.transaction(async tx => {
      if (active) await tx.insert(socialReposts).values({ postId, memberId: member.id });
      else await tx.delete(socialReposts).where(eq(socialReposts.id, existing.id));
      await tx.update(socialPosts).set({ repostCount: active ? sql`${socialPosts.repostCount} + 1` : sql`greatest(0, ${socialPosts.repostCount} - 1)`, updatedAt: new Date() }).where(eq(socialPosts.id, postId));
      if (active && post.authorId !== member.id) await tx.insert(socialNotifications).values({ memberId: post.authorId, actorId: member.id, type: action, postId });
    });
  }
  const count = Math.max(0, Number((post as any)[action === "like" ? "likeCount" : action === "bookmark" ? "bookmarkCount" : "repostCount"]) + (active ? 1 : -1));
  if (active) await learnInterest(member.id, post, action === "bookmark" || action === "repost" ? 3 : 2);
  return memberJSON({ active, count });
}

export async function saveFeedPreference(req: Request, member: Member): Promise<Response> {
  let input: Record<string, unknown>;
  try { input = await req.json(); } catch { throw new MemberError(400, "Send valid feed settings."); }
  const primary = PRIMARY.includes(String(input.primary_filter) as PrimaryFilter) ? String(input.primary_filter) : "for_you";
  const connections = Array.isArray(input.connection_filters) ? [...new Set(input.connection_filters.map(String).filter(value => CONNECTIONS.includes(value as ConnectionFilter)))].slice(0, 4) : ["everyone"];
  const [row] = await db.insert(socialFeedPreferences).values({ memberId: member.id, primaryFilter: primary, connectionFilters: connections.length ? connections : ["everyone"], contentFilters: [] })
    .onConflictDoUpdate({ target: socialFeedPreferences.memberId, set: { primaryFilter: primary, connectionFilters: connections.length ? connections : ["everyone"], updatedAt: new Date() } }).returning();
  return memberJSON({ preference: { primary_filter: row.primaryFilter, connection_filters: row.connectionFilters } });
}
