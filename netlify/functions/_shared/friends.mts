import { createHash } from 'node:crypto';
import { getStore, getDeployStore } from '@netlify/blobs';
import type { Context } from '@netlify/functions';
import { assertSameOrigin, MEMBER_ID, MemberError, memberJSON, type Member, type MemberResolver } from './member-auth.mts';
import { findRegisteredMember, type CommunityReader } from './community-members.mts';
import { requireCommunityMember } from "./roster-access.mts";

type Profiles = CommunityReader;
type FriendRequest = {
  id: string; sender_id: string; recipient_id: string; sender_name: string; recipient_name: string;
  created_at: string; legacy?: boolean; automatic_owner?: boolean;
};
type Decision = { request_id: string; recipient_id: string; action: 'accepted'|'declined'; decided_at: string };
type AutomaticOwnerFriend = {
  version: 'automatic-owner-v1'; kind: 'owner_onboarding_v1'; id: string;
  owner_id: string; member_id: string; member_name: string; created_at: string;
};
export interface FriendStore {
  list(options: { prefix: string; paginate: true }): AsyncIterable<{ blobs: { key: string }[] }>;
  get(key: string, options: { type: 'json' }): Promise<any>;
  setJSON(key: string, value: unknown, options: { onlyIfNew: true }): Promise<{ modified: boolean }>;
}
export function friendStore(context: Context): FriendStore {
  const options = { name: 'member-friends', consistency: 'strong' as const };
  return context.deploy.context === 'production' ? getStore(options) : getDeployStore({ ...options, deployID: context.deploy.id });
}
const validId = (value: unknown): value is string => typeof value === 'string' && (value === 'owner' || MEMBER_ID.test(value));
const safeName = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && value.length <= 60 && !/[@\u0000-\u001f\u007f]/.test(value);
const pair = (a: string,b: string) => [a,b].sort().join('/');
const requestID = (a: string,b: string) => createHash('sha256').update(`friend-consent-v1:${pair(a,b)}`).digest('hex');
const automaticID = (member: string) => createHash('sha256').update(`jspace:automatic-owner-friend:v1:${member}`).digest('hex');
const automaticKey = (owner: string,member: string) => `automatic-owner-v1/${owner}/${member}`;
const canonical = (id: string, owner: string|null) => id === 'owner' || id.toLowerCase() === owner ? 'owner' : id.toLowerCase();
const profileURL = (id: string) => id === 'owner' ? '/#home' : `/profile.html?id=${encodeURIComponent(id)}`;
async function ownerID(profiles?: Profiles): Promise<string|null> {
  if (!profiles) return null;
  const value = await profiles.get('owner-binding', {type:'json'});
  if (value === null) return null;
  if (!value || !MEMBER_ID.test(value.id || '')) throw new Error('Invalid owner binding');
  return value.id.toLowerCase();
}
function targetFrom(req: Request, owner: string|null): string {
  const values = new URL(req.url).searchParams.getAll('target_id');
  if (values.length !== 1 || !validId(values[0].toLowerCase())) throw new MemberError(400, 'Choose a valid profile.');
  return canonical(values[0],owner);
}
function fail(error: unknown): Response {
  return error instanceof MemberError ? memberJSON({error:error.message},error.status)
    : memberJSON({error:'Friends could not connect. Please try again.'},503);
}
async function verified(resolve: MemberResolver) {
  const user = await resolve();
  if (!user || !MEMBER_ID.test(user.id) || !safeName(user.name)) throw new MemberError(401,'Log in to use roster requests.');
  return {...user,id:user.id.toLowerCase()};
}
async function records(store: FriendStore,prefix: string) {
  const result: {key:string;value:any}[] = []; let pages=0;
  for await (const page of store.list({prefix,paginate:true})) {
    if (++pages>100 || result.length+page.blobs.length>10000) throw new MemberError(503,'The roster is busy. Please try again.');
    const keys = page.blobs.map(blob=>blob.key).filter(key=>typeof key==='string' && key.startsWith(prefix));
    for(let i=0;i<keys.length;i+=12) result.push(...await Promise.all(keys.slice(i,i+12).map(async key=>({key,value:await store.get(key,{type:'json'})}))));
  }
  return result;
}
function automaticRecord(value:any,key:string,owner:string):AutomaticOwnerFriend|null {
  if(!value || value.version!=='automatic-owner-v1' || value.kind!=='owner_onboarding_v1' ||
    typeof value.owner_id!=='string' || value.owner_id!==owner || !MEMBER_ID.test(value.owner_id) ||
    typeof value.member_id!=='string' || !MEMBER_ID.test(value.member_id) || value.member_id!==value.member_id.toLowerCase() ||
    value.member_id===owner || value.id!==automaticID(value.member_id) || key!==automaticKey(owner,value.member_id) ||
    !safeName(value.member_name) || value.member_name!==value.member_name.trim() || !Number.isFinite(Date.parse(value.created_at))) return null;
  return value;
}
async function automaticOwnerFriends(store:FriendStore,owner:string|null):Promise<AutomaticOwnerFriend[]> {
  if(!owner)return [];
  const result:AutomaticOwnerFriend[]=[];
  for(const {key,value} of await records(store,`automatic-owner-v1/${owner}/`)) {
    const saved=automaticRecord(value,key,owner);
    if(!saved)throw new Error('Invalid automatic owner friend record');
    result.push(saved);
  }
  return result;
}
async function automaticOwnerFriend(store:FriendStore,owner:string|null,member:string):Promise<AutomaticOwnerFriend|null> {
  if(!owner||!MEMBER_ID.test(member))return null;
  const key=automaticKey(owner,member.toLowerCase());
  const value=await store.get(key,{type:'json'});
  if(value===null)return null;
  const saved=automaticRecord(value,key,owner);
  if(!saved)throw new Error('Invalid automatic owner friend record');
  return saved;
}
/** Server-only J.White connection. The protected owner binding and confirmed
 * member are resolved before this helper is called. Ordinary member pairs
 * continue to use requests and explicit acceptance. */
export async function ensureAutomaticOwnerFriend(member:Member,owner:Member,store:FriendStore):Promise<{status:'created'|'already_friend'|'owner'}> {
  if(!MEMBER_ID.test(member.id)||!safeName(member.name)||!MEMBER_ID.test(owner.id)||!safeName(owner.name))throw new Error('Invalid automatic friend participants');
  const memberId=member.id.toLowerCase(),ownerId=owner.id.toLowerCase();
  if(memberId===ownerId)return {status:'owner'};
  const key=automaticKey(ownerId,memberId);
  const existing=await store.get(key,{type:'json'});
  if(existing!==null) {
    if(!automaticRecord(existing,key,ownerId))throw new Error('Invalid automatic friend record');
    return {status:'already_friend'};
  }
  const candidate:AutomaticOwnerFriend={
    version:'automatic-owner-v1',kind:'owner_onboarding_v1',id:automaticID(memberId),
    owner_id:ownerId,member_id:memberId,member_name:member.name.trim(),created_at:new Date().toISOString(),
  };
  const written=await store.setJSON(key,candidate,{onlyIfNew:true});
  const saved=automaticRecord(await store.get(key,{type:'json'}),key,ownerId);
  if(!saved)throw new Error('Automatic friend was not saved');
  return {status:written.modified?'created':'already_friend'};
}
/** The one server-authored owner onboarding edge is handled separately.
 * Every ordinary and legacy relationship remains consent based: legacy
 * one-way adds are pending requests, and native decisions are immutable. */
async function allRequests(store: FriendStore, owner: string|null): Promise<FriendRequest[]> {
  const found = new Map<string,FriendRequest>();
  for(const {key,value} of await records(store,'target/')) {
    const parts = key.split('/');
    if(parts.length!==3 || !validId(parts[1]) || !MEMBER_ID.test(parts[2]) || !value || typeof value.member_id!=='string' || value.member_id.toLowerCase()!==parts[2].toLowerCase() || !safeName(value.member_name)) continue;
    const sender=canonical(parts[2],owner),recipient=canonical(parts[1],owner);
    if(sender===recipient) continue;
    const created = Number.isFinite(Date.parse(value.created_at)) ? value.created_at : '1970-01-01T00:00:00.000Z';
    const entry:FriendRequest={id:requestID(sender,recipient),sender_id:sender,recipient_id:recipient,sender_name:sender==='owner'?'JWhite':value.member_name,recipient_name:recipient==='owner'?'JWhite':'Member',created_at:created,legacy:true};
    const old=found.get(entry.id);
    if(!old || entry.created_at<old.created_at || entry.created_at===old.created_at && sender<old.sender_id) found.set(entry.id,entry);
  }
  for(const {key,value:r} of await records(store,'requests/')) {
    if(!r || !validId(r.sender_id) || !validId(r.recipient_id) || r.sender_id!==canonical(r.sender_id,owner) || r.recipient_id!==canonical(r.recipient_id,owner) || r.sender_id===r.recipient_id || !safeName(r.sender_name) || !safeName(r.recipient_name) || !Number.isFinite(Date.parse(r.created_at)) || r.id!==requestID(r.sender_id,r.recipient_id) || key!==`requests/${pair(r.sender_id,r.recipient_id)}`) continue;
    found.set(r.id,{id:r.id,sender_id:r.sender_id,recipient_id:r.recipient_id,sender_name:r.sender_name,recipient_name:r.recipient_name,created_at:r.created_at});
  }
  return [...found.values()];
}
async function decisionFor(store: FriendStore,r: FriendRequest): Promise<Decision|null> {
  const value = await store.get(`decisions/${r.id}`,{type:'json'});
  if(value===null) return null;
  if(!value || value.request_id!==r.id || value.recipient_id!==r.recipient_id || !['accepted','declined'].includes(value.action) || !Number.isFinite(Date.parse(value.decided_at))) throw new Error('Invalid friend decision');
  return value;
}
async function entriesFor(store:FriendStore,owner:string|null,id:string) {
  const automatic=(await automaticOwnerFriends(store,owner)).filter(edge=>id==='owner'||edge.member_id===id).map(edge=>{
    const request:FriendRequest={id:edge.id,sender_id:'owner',recipient_id:edge.member_id,sender_name:'JWhite',recipient_name:edge.member_name,created_at:edge.created_at,automatic_owner:true};
    const decision:Decision={request_id:request.id,recipient_id:edge.member_id,action:'accepted',decided_at:edge.created_at};
    return {request,decision};
  });
  const automaticMembers=new Set(automatic.map(entry=>entry.request.recipient_id));
  const requests=(await allRequests(store,owner)).filter(r=>(r.sender_id===id || r.recipient_id===id) &&
    !((r.sender_id==='owner'&&automaticMembers.has(r.recipient_id))||(r.recipient_id==='owner'&&automaticMembers.has(r.sender_id))));
  const result: {request:FriendRequest;decision:Decision|null}[]=[];
  for(let i=0;i<requests.length;i+=12) result.push(...await Promise.all(requests.slice(i,i+12).map(async request=>({request,decision:await decisionFor(store,request)}))));
  return [...automatic,...result];
}
/** Resolve consent states once for directory suggestions. Only the current
 * viewer's relationships leave the helper; owner aliases are normalized. */
export async function friendRelationshipsFor(viewerId:string,store:FriendStore,profiles:Profiles):Promise<Record<string,string>> {
  const owner=await ownerID(profiles),viewer=canonical(viewerId,owner);
  const entries=await entriesFor(store,owner,viewer);
  const result:Record<string,string>={};
  for(const {request,decision} of entries) {
    const incoming=request.recipient_id===viewer;
    const target=incoming?request.sender_id:request.recipient_id;
    const id=target==='owner'?owner:target;
    if(id)result[id]=decision?.action||(incoming?'incoming':'outgoing');
  }
  result[viewerId.toLowerCase()]='self';
  return result;
}
export async function acceptedFriendsFor(target:string,store:FriendStore,profiles?:Profiles) {
  const owner=await ownerID(profiles),id=canonical(target,owner),entries=await entriesFor(store,owner,id);
  return entries.filter(entry=>entry.decision?.action==='accepted').map(({request,decision})=>{
    const incoming=request.recipient_id===id,memberId=incoming?request.sender_id:request.recipient_id;
    return {member_id:memberId,member_name:incoming?request.sender_name:request.recipient_name,profile_url:profileURL(memberId),created_at:decision!.decided_at,...(request.automatic_owner?{automatic_owner:true}:{})};
  }).sort((a,b)=>id!=='owner'&&a.member_id==='owner'&&b.member_id!=='owner'?-1:id!=='owner'&&b.member_id==='owner'&&a.member_id!=='owner'?1:b.created_at.localeCompare(a.created_at)||a.member_id.localeCompare(b.member_id));
}
export async function getFriendCount(req:Request,store:FriendStore,profiles?:Profiles,_directory?:CommunityReader,resolveMember:MemberResolver=requireCommunityMember):Promise<Response> {
  if(req.method!=='GET') return memberJSON({error:'Method not allowed.'},405);
  try {
    const owner=await ownerID(profiles),target=targetFrom(req,owner);
    const entries=await entriesFor(store,owner,target);
    const friends=entries.filter(e=>e.decision?.action==='accepted').map(({request:r,decision:d})=>{
      const incoming=r.recipient_id===target,id=incoming?r.sender_id:r.recipient_id;
      return {member_id:id,member_name:incoming?r.sender_name:r.recipient_name,profile_url:profileURL(id),created_at:d!.decided_at,...(r.automatic_owner?{automatic_owner:true}:{})};
    }).sort((a,b)=>target!=='owner'&&a.member_id==='owner'&&b.member_id!=='owner'?-1:target!=='owner'&&b.member_id==='owner'&&a.member_id!=='owner'?1:b.created_at.localeCompare(a.created_at)||a.member_id.localeCompare(b.member_id));
    let relationship:any=undefined;
    try {
      const viewer=canonical((await verified(resolveMember)).id,owner);
      if(viewer===target)relationship={target_id:target,state:'self'};
      else {
        const entry=entries.find(({request:r})=>r.sender_id===viewer||r.recipient_id===viewer);
        relationship={target_id:target,state:entry?.decision?.action||(entry?(entry.request.recipient_id===viewer?'incoming':'outgoing'):'none'),request_id:entry?.request.id,...(entry?.request.automatic_owner?{automatic_owner:true}:{})};
      }
    } catch {}
    return memberJSON({target_id:target,count:friends.length,friends,approval_required:true,...(relationship?{relationship}:{})});
  } catch(error){return fail(error);}
}
export async function addFriend(req:Request,store:FriendStore,resolveMember:MemberResolver=requireCommunityMember,profiles?:Profiles,directory?:CommunityReader):Promise<Response> {
  if(req.method!=='POST') return memberJSON({error:'Method not allowed.'},405);
  try {
    assertSameOrigin(req);const member=await verified(resolveMember),owner=await ownerID(profiles);
    const sender=canonical(member.id,owner),target=targetFrom(req,owner);
    if(sender===target) throw new MemberError(400,'You cannot send yourself a roster request.');
    if(target==='owner' && !owner) throw new MemberError(503,"JWhite's roster requests are not ready yet. Please try again.");
    const automaticMember=sender==='owner'?target:target==='owner'?sender:null;
    if(automaticMember&&await automaticOwnerFriend(store,owner,automaticMember)) {
      const countResponse=await getFriendCount(new Request(req.url),store,profiles,directory,resolveMember);
      if(!countResponse.ok)throw new Error('Count unavailable');
      const {count}=await countResponse.json();
      return memberJSON({target_id:target,count,added:false,request_created:false,request_id:automaticID(automaticMember),state:'accepted',automatic_owner:true,message:'JWhite is already the first name on your roster and Your Connector',approval_required:false});
    }
    const recipient=target==='owner'?{id:'owner',name:'JWhite'}:await findRegisteredMember(target,profiles,directory,store,owner);
    if(!recipient) throw new MemberError(404,'This page on the roster is unavailable.');
    let r=(await allRequests(store,owner)).find(r=>r.id===requestID(sender,target));
    let created=false;
    if(!r) {
      const candidate:FriendRequest={id:requestID(sender,target),sender_id:sender,recipient_id:target,sender_name:sender==='owner'?'JWhite':member.name,recipient_name:recipient.name,created_at:new Date().toISOString()};
      const key=`requests/${pair(sender,target)}`;
      const written=await store.setJSON(key,candidate,{onlyIfNew:true});created=written.modified;
      r=(await allRequests(store,owner)).find(r=>r.id===candidate.id);
      if(!r) throw new Error('Request not saved');
    }
    const decision=await decisionFor(store,r),state=decision?.action || (r.sender_id===sender?'outgoing':'incoming');
    // Repeated sends, including a reciprocal send, NEVER accept a request.
    const message=state==='accepted'?'You are already friends.':state==='declined'?'This friend request was declined.':state==='incoming'?'This person sent you a request. Choose Accept or Decline in Friend Requests.':'Friend request sent. Waiting for acceptance.';
    const countResponse=await getFriendCount(new Request(req.url),store,profiles,directory);
    if(!countResponse.ok) throw new Error('Count unavailable');
    const {count}=await countResponse.json();
    return memberJSON({target_id:target,count,added:false,request_created:created,request_id:r.id,state,message,approval_required:true});
  } catch(error){return fail(error);}
}
export async function getFriendRequests(req:Request,store:FriendStore,resolveMember:MemberResolver=requireCommunityMember,profiles?:Profiles):Promise<Response> {
  if(req.method!=='GET') return memberJSON({error:'Method not allowed.'},405);
  try {
    const user=await verified(resolveMember),owner=await ownerID(profiles),viewer=canonical(user.id,owner);
    const entries=await entriesFor(store,owner,viewer);
    const present=(r:FriendRequest)=>{const incoming=r.recipient_id===viewer;return {id:r.id,member_id:incoming?r.sender_id:r.recipient_id,name:incoming?r.sender_name:r.recipient_name,profile_url:profileURL(incoming?r.sender_id:r.recipient_id),created_at:r.created_at,legacy:r.legacy===true};};
    const incoming=entries.filter(e=>!e.decision && e.request.recipient_id===viewer).map(e=>present(e.request));
    const outgoing=entries.filter(e=>!e.decision && e.request.sender_id===viewer).map(e=>present(e.request));
    const targetParam=new URL(req.url).searchParams.get('target_id');let relationship:any=undefined;
    if(targetParam!==null){const target=targetFrom(req,owner),entry=entries.find(e=>[e.request.sender_id,e.request.recipient_id].includes(target));relationship={target_id:target,state:target===viewer?'self':entry?.decision?.action || (entry?(entry.request.recipient_id===viewer?'incoming':'outgoing'):'none'),request_id:entry?.request.id,...(entry?.request.automatic_owner?{automatic_owner:true}:{})};}
    return memberJSON({incoming,outgoing,pending_count:incoming.length,relationship});
  }catch(error){return fail(error);}
}
async function smallBody(req:Request) {
  if((req.headers.get('content-type')||'').split(';')[0].trim()!=='application/json') throw new MemberError(415,'Use the Accept or Decline buttons.');
  const reader=req.body?.getReader();if(!reader) throw new MemberError(400,'Choose a roster request.');
  let length=0;const chunks:Uint8Array[]=[];
  try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>2048){await reader.cancel();throw new MemberError(413,'Request is too large.');}chunks.push(value);}}finally{reader.releaseLock();}
  const all=new Uint8Array(length);let pos=0;for(const chunk of chunks){all.set(chunk,pos);pos+=chunk.length;}
  try{const parsed=JSON.parse(new TextDecoder().decode(all));if(!parsed || typeof parsed!=='object' || Array.isArray(parsed))throw new Error();return parsed;}catch{throw new MemberError(400,'Choose a valid roster request.');}
}
export async function respondToFriendRequest(req:Request,store:FriendStore,resolveMember:MemberResolver=requireCommunityMember,profiles?:Profiles):Promise<Response> {
  if(req.method!=='POST') return memberJSON({error:'Method not allowed.'},405);
  try {
    assertSameOrigin(req);const member=await verified(resolveMember),owner=await ownerID(profiles),viewer=canonical(member.id,owner),body=await smallBody(req);
    if(typeof body.request_id!=='string' || !/^[a-f0-9]{64}$/.test(body.request_id) || !['accept','decline'].includes(body.action)) throw new MemberError(400,'Choose Accept or Decline for a valid request.');
    const r=(await allRequests(store,owner)).find(r=>r.id===body.request_id);
    if(!r || r.recipient_id!==viewer) throw new MemberError(404,'This roster request is not addressed to you.');
    const automaticMember=r.sender_id==='owner'?r.recipient_id:r.recipient_id==='owner'?r.sender_id:null;
    if(automaticMember&&await automaticOwnerFriend(store,owner,automaticMember))return memberJSON({request_id:automaticID(automaticMember),state:'accepted',automatic_owner:true,message:'JWhite is already the first name on your roster and Your Connector'});
    const action=body.action==='accept'?'accepted':'declined';
    await store.setJSON(`decisions/${r.id}`,{request_id:r.id,recipient_id:viewer,action,decided_at:new Date().toISOString()},{onlyIfNew:true});
    const saved=await decisionFor(store,r);
    if(!saved)throw new Error('Decision not saved');
    if(saved.action!==action)throw new MemberError(409,'This request has already been answered. Refresh Roster Requests.');
    return memberJSON({request_id:r.id,state:saved.action,message:action==='accepted'?'Roster request accepted. They are on your roster.':'Roster request declined.'});
  }catch(error){return fail(error);}
}
