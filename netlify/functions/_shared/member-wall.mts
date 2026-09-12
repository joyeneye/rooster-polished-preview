import { createHash } from 'node:crypto';
import { getStore, getDeployStore } from '@netlify/blobs';
import type { Context } from '@netlify/functions';
import { MEMBER_ID, MemberError, memberJSON, assertSameOrigin, type Member } from './member-auth.mts';
import { getPublicProfile, type ProfileMember, type ProfileStore } from './member-profiles.mts';
import { moderateComment, POLICY_VERSION, type ModerationDecision } from './comment-moderation.mts';
import type { CommunityReader } from './community-members.mts';
import { identityReader, type WallIdentity } from './wall-identity.mts';
import { resolveCommunityProfileMember } from "./roster-access.mts";

export interface MemberWallStore {
  get(key: string, options: { type: 'json' }): Promise<any>;
  setJSON(key: string, value: unknown, options?: { onlyIfNew?: boolean }): Promise<{ modified: boolean }>;
  delete(key: string): Promise<void>;
  list(options: { prefix: string; paginate: true }): AsyncIterable<{ blobs: { key: string }[] }>;
}
export type WallDependencies = {
  profiles: ProfileStore; directory?: CommunityReader; friends?: CommunityReader;
  resolveMember?: () => Promise<ProfileMember>;
  moderate?: (input: { name: string; message: string }) => Promise<ModerationDecision>;
};
export function memberWallStore(context: Context): MemberWallStore {
  const options = { name: 'member-profile-walls', consistency: 'strong' as const };
  return context.deploy.context === 'production' ? getStore(options) : getDeployStore({ ...options, deployID: context.deploy.id });
}
export function wallFailure(error: unknown): Response {
  return error instanceof MemberError ? memberJSON({ error: error.message }, error.status)
    : memberJSON({ error: 'This wall could not connect. Please try again.' }, 503);
}
function targetId(req: Request): string {
  const values = new URL(req.url).searchParams.getAll('member');
  if (values.length !== 1 || !MEMBER_ID.test(values[0])) throw new MemberError(400, 'Open a member page to use their wall.');
  return values[0].toLowerCase();
}
async function person(req: Request, id: string, dependencies: WallDependencies) {
  const url = new URL('/api/profile', req.url); url.searchParams.set('id', id);
  const response = await getPublicProfile(new Request(url), dependencies.profiles, dependencies);
  if (!response.ok) throw new MemberError(response.status, response.status === 404 ? 'This member page is unavailable.' : 'The member profile could not load. Please try again.');
  const { profile } = await response.json();
  if (!profile || typeof profile.name !== 'string') throw new Error('Invalid profile');
  return profile;
}
async function wallOwner(req: Request, id: string, dependencies: WallDependencies) {
  const profile = await person(req, id, dependencies);
  if (profile.verified_owner === true) throw new MemberError(400, "Use JWhite's main Comment Wall for this profile.");
  return profile;
}
async function session(dependencies: WallDependencies, required = false): Promise<ProfileMember | null> {
  try {
    const member = await (dependencies.resolveMember ?? resolveCommunityProfileMember)();
    if (!member || !MEMBER_ID.test(member.id)) throw new MemberError(401, 'Log in to write on this wall.');
    return { ...member, id: member.id.toLowerCase() };
  } catch (error) {
    if (!required && error instanceof MemberError && [401, 403].includes(error.status)) return null;
    throw error;
  }
}
async function body(req: Request): Promise<Record<string, unknown>> {
  if ((req.headers.get('content-type') || '').split(';')[0].trim() !== 'application/json') throw new MemberError(415, 'Use the comment box on this page.');
  if (!req.body) throw new MemberError(400, 'Write a comment first.');
  if (Number(req.headers.get('content-length')) > 8192) throw new MemberError(413, 'Keep your comment to 1000 characters.');
  const reader = req.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      length += part.value.length;
      if (length > 8192) { await reader.cancel(); throw new MemberError(413, 'Keep your comment to 1000 characters.'); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const buffer = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
  try {
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch { throw new MemberError(400, 'Your comment could not be read.'); }
}
function record(value: any, target: string): any | null {
  if (!value || value.member_id !== target || !/^[a-f0-9]{64}$/.test(value.id) || !MEMBER_ID.test(value.author_id) ||
      typeof value.author_name !== 'string' || !value.author_name.trim() || value.author_name.length > 60 || /[@\u0000-\u001f\u007f]/.test(value.author_name) ||
      typeof value.message !== 'string' || value.message.length < 2 || value.message.length > 1000 ||
      typeof value.created_at !== 'string' || !Number.isFinite(Date.parse(value.created_at)) ||
      !['approved','pending','rejected'].includes(value.moderation?.status) || value.moderation?.policy_version !== POLICY_VERSION) return null;
  return value;
}
/** The badge and the owner link come from the stored record so they cannot be
 * spoofed. The name and picture come from the author's profile as it is right
 * now, so changing either updates every comment they have ever written. */
function projected(value: any, viewer: ProfileMember | null, identity: WallIdentity | null = null) {
  const isOwner = value.author_is_owner === true;
  const live = identity && identity.id === value.author_id ? identity : null;
  const name = live && live.name.trim().length >= 2 ? live.name.trim() : value.author_name;
  return {
    id: value.id, member_id: value.member_id, author_id: value.author_id,
    name, message: value.message, created_at: value.created_at,
    status: value.moderation.status, verified_owner: isOwner,
    verified: isOwner || live?.verified === true,
    profile_url: isOwner ? '/#home' : `/profile.html?id=${value.author_id}`,
    photo_url: live?.photo_url ?? null,
    can_delete: !!viewer && (viewer.isOwner || viewer.id === value.member_id || viewer.id === value.author_id),
  };
}
/** Server-only owner welcome for a confirmed member. The author is bound by
 * the protected owner profile and the deterministic record can be retried
 * without duplicating or resurrecting a post the member removed. */
export async function deliverOwnerWallWelcome(member:Member,owner:Member,store:MemberWallStore):Promise<{status:'created'|'already_sent'|'removed'|'owner';comment_id?:string}> {
  if(!MEMBER_ID.test(member.id)||!MEMBER_ID.test(owner.id)||typeof member.name!=='string'||!member.name.trim())throw new Error('Invalid wall welcome participants');
  const target=member.id.toLowerCase(),author=owner.id.toLowerCase();
  if(target===author)return {status:'owner'};
  const id=createHash('sha256').update(`jspace:owner-wall-welcome:v1:${target}`).digest('hex');
  const key=`walls/${target}/${id}`,marker=`removed/${target}/${id}`;
  const message='You’re connected. Let’s get it.';
  const digest=createHash('sha256').update(message).digest('hex');
  // Members who joined before the Connector wording still hold the original
  // welcome. Their record has to stay valid, so the earlier message is accepted
  // here rather than reposting to somebody who already removed theirs.
  const legacy='LET’S WORK!';
  const legacyDigest=createHash('sha256').update(legacy).digest('hex');
  const removed=async()=>{
    const value=await store.get(marker,{type:'json'});
    if(value===null)return false;
    if(!value||value.author_id!==author||typeof value.removed_at!=='string'||!Number.isFinite(Date.parse(value.removed_at)))throw new Error('Invalid wall welcome removal marker');
    return true;
  };
  const cleanupRemoved=async()=>{try{await store.delete(key);}catch{/* The valid tombstone still keeps the post private. */}};
  if(await removed()){await cleanupRemoved();return {status:'removed',comment_id:id};}
  const createdAt=new Date().toISOString();
  const candidate={
    id,member_id:target,author_id:author,author_name:'J.White Did It',author_is_owner:true,message,created_at:createdAt,
    input_digest:digest,welcome_version:'owner-wall-welcome-v1',
    moderation:{status:'approved',reason:'owner_welcome',policy_version:POLICY_VERSION,checked_at:createdAt},
  };
  const welcomeRecord=(value:any)=>{
    const saved=record(value,target);
    return saved&&saved.id===id&&saved.author_id===author&&saved.author_name===candidate.author_name&&saved.author_is_owner===true&&
      ((saved.message===message&&saved.input_digest===digest)||(saved.message===legacy&&saved.input_digest===legacyDigest))&&
      saved.welcome_version===candidate.welcome_version&&
      saved.moderation.status==='approved'&&typeof saved.moderation.checked_at==='string'&&Number.isFinite(Date.parse(saved.moderation.checked_at))?saved:null;
  };
  const existingRaw=await store.get(key,{type:'json'});
  const existing=welcomeRecord(existingRaw);
  if(existingRaw&&!existing)throw new Error('Invalid saved wall welcome');
  if(existing){if(await removed()){await cleanupRemoved();return {status:'removed',comment_id:id};}return {status:'already_sent',comment_id:id};}
  const written=await store.setJSON(key,candidate,{onlyIfNew:true});
  const saved=welcomeRecord(await store.get(key,{type:'json'}));
  if(!saved)throw new Error('Wall welcome was not saved');
  if(await removed()){await cleanupRemoved();return {status:'removed',comment_id:id};}
  return {status:written.modified?'created':'already_sent',comment_id:id};
}
export async function getMemberWall(req: Request, store: MemberWallStore, dependencies: WallDependencies): Promise<Response> {
  if (req.method !== 'GET') return memberJSON({ error: 'Method not allowed.' }, 405);
  try {
    const target = targetId(req); await wallOwner(req, target, dependencies);
    const viewer = await session(dependencies);
    const params = new URL(req.url).searchParams;
    if (params.getAll('before').length > 1) throw new MemberError(400, 'Use Show More Comments on the wall.');
    const before = params.get('before');
    if (before && !/^\d{4}-\d{2}-\d{2}T[0-9:.]+Z\|[a-f0-9]{64}$/.test(before)) throw new MemberError(400, 'Use Show More Comments on the wall.');
    const keys: string[] = []; let pages = 0;
    for await (const page of store.list({ prefix: `walls/${target}/`, paginate: true })) {
      if (++pages > 200) throw new Error('Wall too large to load safely');
      for (const blob of page.blobs) if (new RegExp(`^walls/${target}/[a-f0-9]{64}$`).test(blob.key)) keys.push(blob.key);
      if (keys.length > 5000) throw new Error('Wall too large to load safely');
    }
    const visible: any[] = []; let total = 0;
    for (let offset = 0; offset < keys.length; offset += 12) {
      const values = await Promise.all(keys.slice(offset, offset + 12).map(async key => {
        const value = record(await store.get(key, { type: 'json' }), target);
        if (!value || await store.get(`removed/${target}/${value.id}`, { type: 'json' })) return null;
        return value;
      }));
      for (const value of values) {
        if (!value) continue;
        if (value.moderation.status === 'approved') { total++; visible.push(value); }
        else if (value.moderation.status === 'pending' && value.author_id === viewer?.id) visible.push(value);
      }
    }
    const order = (value: any) => `${value.created_at}|${value.id}`;
    const sorted = visible.sort((a,b) => order(b).localeCompare(order(a))).filter(value => !before || order(value) < before);
    const page = sorted.slice(0, 20); const lookup = identityReader(req, dependencies);
    const comments = await Promise.all(page.map(async value => projected(value, viewer, await lookup(value.author_id))));
    return memberJSON({ member_id: target, comments, total, next: sorted.length > 20 ? order(page[page.length-1]) : null, can_post: !!viewer, viewer_id: viewer?.id ?? null });
  } catch (error) { return wallFailure(error); }
}
export async function postMemberWall(req: Request, store: MemberWallStore, dependencies: WallDependencies): Promise<Response> {
  if (req.method !== 'POST') return memberJSON({ error: 'Method not allowed.' }, 405);
  try {
    assertSameOrigin(req); const target = targetId(req);
    const author = (await session(dependencies, true))!;
    await wallOwner(req, target, dependencies);
    const input = await body(req);
    if (typeof input.request_id !== 'string' || !MEMBER_ID.test(input.request_id)) throw new MemberError(400, 'Refresh the page and try your comment again.');
    if (typeof input.message !== 'string') throw new MemberError(400, 'Write a comment first.');
    const message = input.message.trim().replace(/\r\n?/g, '\n');
    if (message.length < 2 || message.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(message)) throw new MemberError(400, 'Your comment needs 2 to 1000 characters.');
    const id = createHash('sha256').update(`${target}/${author.id}/${input.request_id.toLowerCase()}`).digest('hex');
    const key = `walls/${target}/${id}`; const digest = createHash('sha256').update(message).digest('hex');
    if (await store.get(`removed/${target}/${id}`, { type: 'json' })) throw new MemberError(409, 'That comment was removed. Write a new comment to post again.');
    const lookup = identityReader(req, dependencies);
    const identity = await lookup(author.id);
    const reply = (value: any) => {
      if (value.input_digest !== digest || value.author_id !== author.id || value.member_id !== target) throw new MemberError(409, 'This comment attempt was already used. Refresh before posting a different comment.');
      const approved = value.moderation.status === 'approved';
      return memberJSON({ status: value.moderation.status, comment: projected(value, author, identity), notice: approved ? 'Your comment is on their wall.' : 'Your comment is saved for review. It is not public yet.' }, approved ? 201 : 202);
    };
    const existing = record(await store.get(key, { type: 'json' }), target);
    if (existing) return reply(existing);
    // Author details are resolved server side, never supplied by the browser.
    const publicAuthor = await person(req, author.id, dependencies);
    const authorName = author.isOwner ? 'J.White Did It' : publicAuthor.name;
    let decision: ModerationDecision;
    try { decision = await (dependencies.moderate ?? moderateComment)({ name: authorName, message }); }
    catch { decision = { status:'pending', reason:'moderation_unavailable', policy_version:POLICY_VERSION, checked_at:new Date().toISOString() }; }
    if (!decision || decision.policy_version !== POLICY_VERSION || !['approved','pending','rejected'].includes(decision.status) || !Number.isFinite(Date.parse(decision.checked_at)))
      decision = { status:'pending', reason:'moderation_unavailable', policy_version:POLICY_VERSION, checked_at:new Date().toISOString() };
    if (decision.status === 'rejected') return memberJSON({ status:'rejected', error:'Keep comments positive and respectful. This comment was not published.' }, 422);
    const candidate = { id, member_id:target, author_id:author.id, author_name:authorName, author_is_owner:author.isOwner === true, message, created_at:new Date().toISOString(), input_digest:digest, moderation:decision };
    await store.setJSON(key, candidate, { onlyIfNew:true });
    const saved = record(await store.get(key, { type:'json' }), target);
    if (!saved) throw new Error('Comment was not saved');
    if (await store.get(`removed/${target}/${id}`, { type:'json' })) throw new MemberError(409, 'That comment was removed.');
    return reply(saved);
  } catch (error) { return wallFailure(error); }
}
export async function deleteMemberWallComment(req: Request, store: MemberWallStore, dependencies: WallDependencies): Promise<Response> {
  if (req.method !== 'POST') return memberJSON({ error:'Method not allowed.' }, 405);
  try {
    assertSameOrigin(req); const target = targetId(req); const viewer = (await session(dependencies, true))!;
    await wallOwner(req, target, dependencies);
    const input = await body(req);
    if (typeof input.comment_id !== 'string' || !/^[a-f0-9]{64}$/.test(input.comment_id)) throw new MemberError(400, 'Choose a comment on this wall.');
    const key = `walls/${target}/${input.comment_id}`; const marker = `removed/${target}/${input.comment_id}`;
    const value = record(await store.get(key, { type:'json' }), target);
    const previous = await store.get(marker, { type:'json' });
    const authorId = value?.author_id ?? previous?.author_id;
    if (!authorId) throw new MemberError(404, 'That comment is no longer available.');
    if (!viewer.isOwner && viewer.id !== target && viewer.id !== authorId) throw new MemberError(403, 'You can only remove your own comments or comments on your page.');
    await store.setJSON(marker, { author_id:authorId, removed_at:new Date().toISOString() }, { onlyIfNew:true });
    if (!await store.get(marker, { type:'json' })) throw new Error('Removal was not saved');
    await store.delete(key);
    return memberJSON({ removed:true });
  } catch (error) { return wallFailure(error); }
}
