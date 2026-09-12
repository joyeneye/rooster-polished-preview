import { createHash } from 'node:crypto';
import { getStore, getDeployStore } from '@netlify/blobs';
import type { Context } from '@netlify/functions';
import { assertSameOrigin, MemberError, memberJSON, MEMBER_ID, type MemberResolver } from './member-auth.mts';
import { requireCommunityMember } from "./roster-access.mts";

// Public clips are uploaded in bounded pieces, then validated and moderated before publication.
export const VIDEO_UPLOAD_LIMIT = 100 * 1024 * 1024;
export const VIDEO_PART_BYTES = 2 * 1024 * 1024;
const TTL = 60 * 60 * 1000;
export interface VideoTransferStore {
  get(key: string, options: {type: 'json' | 'arrayBuffer'}): Promise<any>;
  set(key: string, value: ArrayBuffer, options: {onlyIfNew: true}): Promise<{modified: boolean}>;
  setJSON(key: string, value: unknown, options: {onlyIfNew: true}): Promise<{modified: boolean}>;
  list(options: {prefix: string; paginate: true}): AsyncIterable<{blobs: {key: string}[]}>;
  delete(key: string): Promise<void>;
}
type Manifest = {id: string; member_id: string; kind: 'clip'; size: number; name: string; mime: string; parts: number; expires_at: number};
export function videoTransferStore(context: Context): VideoTransferStore {
  const options = {name: 'member-video-transfers', consistency: 'strong' as const};
  return context.deploy.context === 'production' ? getStore(options) : getDeployStore({...options, deployID: context.deploy.id});
}
const base = (member: string, id: string) => `transfers/${member}/${id}`;
const digest = (bytes: ArrayBuffer) => createHash('sha256').update(new Uint8Array(bytes)).digest('hex');
export async function boundedBytes(req: Request, limit: number): Promise<Uint8Array> {
  if (!req.body) throw new MemberError(400, 'The upload was empty. Choose your video again.');
  if (Number(req.headers.get('content-length') || 0) > limit) throw new MemberError(413, 'This upload part is too large. Refresh the page and try again.');
  const reader = req.body.getReader(), parts: Uint8Array[] = []; let size = 0;
  try { for (;;) { const item = await reader.read(); if (item.done) break; size += item.value.byteLength;
    if (size > limit) { await reader.cancel(); throw new MemberError(413, 'This upload part is too large. Refresh the page and try again.'); }
    parts.push(item.value);
  } } finally { reader.releaseLock(); }
  const data = new Uint8Array(size); let offset = 0;
  for (const part of parts) { data.set(part, offset); offset += part.length; }
  return data;
}
export async function smallVideoJSON(req: Request): Promise<any> {
  if ((req.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') throw new MemberError(415, 'Refresh your video uploader and try again.');
  try { const value = JSON.parse(new TextDecoder().decode(await boundedBytes(req, 4096)));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value;
  } catch (error) { if (error instanceof MemberError) throw error; throw new MemberError(400, 'The upload details could not be read.'); }
}
async function manifest(store: VideoTransferStore, member: string, id: string): Promise<Manifest> {
  if (!MEMBER_ID.test(id)) throw new MemberError(400, 'Invalid video upload.');
  const value = await store.get(`${base(member, id)}/manifest`, {type:'json'});
  if (!value || value.id !== id || value.member_id !== member || !['clip'].includes(value.kind) ||
      !Number.isSafeInteger(value.size) || value.size < 1 || value.size > VIDEO_UPLOAD_LIMIT ||
      value.parts !== Math.ceil(value.size / VIDEO_PART_BYTES) || typeof value.name !== 'string' || typeof value.mime !== 'string') throw new MemberError(404, 'This video upload was not found. Choose the file again.');
  if (!Number.isFinite(value.expires_at) || value.expires_at <= Date.now()) throw new MemberError(410, 'This upload expired. Choose your video again.');
  return value;
}
function failure(error: unknown) { return error instanceof MemberError ? memberJSON({error:error.message}, error.status) : memberJSON({error:'Your video upload could not connect. Please try again.'},503); }
export async function startVideoUpload(req: Request, store: VideoTransferStore, resolve: MemberResolver = requireCommunityMember): Promise<Response> {
  if (req.method !== 'POST') return memberJSON({error:'Method not allowed.'},405);
  try {
    assertSameOrigin(req); const member = await resolve(); const input = await smallVideoJSON(req);
    if (!MEMBER_ID.test(input.request_id || '') || !['clip'].includes(input.kind)) throw new MemberError(400,'Refresh your video uploader and try again.');
    if (!Number.isSafeInteger(input.size) || input.size <= 0 || input.size > VIDEO_UPLOAD_LIMIT) throw new MemberError(413,'Choose a video up to 100 MB.');
    const name = typeof input.name === 'string' ? input.name.slice(0,120) : '';
    const ext = name.split('.').at(-1)?.toLowerCase();
    if (!['mp4','webm','mov','m4v'].includes(ext || '')) throw new MemberError(415, 'Choose an MP4, MOV or WebM video.');
    const id = input.request_id.toLowerCase(), key = `${base(member.id,id)}/manifest`;
    const candidate: Manifest = {id,member_id:member.id,kind:'clip',size:input.size,name,mime:ext==='webm'?'video/webm':ext==='mov'?'video/quicktime':'video/mp4',parts:Math.ceil(input.size/VIDEO_PART_BYTES),expires_at:Date.now()+TTL};
    const previous = await store.get(key,{type:'json'});
    if (!previous) {
      // Atomic quota tickets bound abandoned storage per authenticated member.
      const hour = Math.floor(Date.now()/TTL); let allowed = false;
      for(let ticket=0;ticket<12;ticket++) {
        if ((await store.setJSON(`quota/${hour}/${member.id}/${ticket}`,{expires_at:(hour+2)*TTL},{onlyIfNew:true})).modified) {allowed=true;break;}
      }
      if (!allowed) throw new MemberError(429,'You have started several uploads. Finish an existing upload or try again in an hour.');
      await store.setJSON(key,candidate,{onlyIfNew:true});
    }
    const saved = await manifest(store,member.id,id);
    if (saved.size !== candidate.size || saved.name !== candidate.name || saved.kind !== candidate.kind) throw new MemberError(409,'This upload belongs to a different file. Choose your video again.');
    return memberJSON({upload_id:id,part_bytes:VIDEO_PART_BYTES,parts:saved.parts,expires_at:saved.expires_at});
  } catch(error) { return failure(error); }
}
export async function putVideoPart(req: Request, store: VideoTransferStore, resolve: MemberResolver = requireCommunityMember): Promise<Response> {
  if (req.method !== 'POST') return memberJSON({error:'Method not allowed.'},405);
  try {
    assertSameOrigin(req); const member = await resolve(); const query = new URL(req.url).searchParams;
    if(query.getAll('upload_id').length!==1 || query.getAll('part').length!==1 || !/^\d{1,2}$/.test(query.get('part')||'')) throw new MemberError(400,'Invalid upload part.');
    const id = (query.get('upload_id')||'').toLowerCase(), part=Number(query.get('part'));
    const saved = await manifest(store,member.id,id);
    if (part < 0 || part >= saved.parts) throw new MemberError(400,'Invalid upload part.');
    if ((req.headers.get('content-type')||'').split(';')[0] !== 'application/octet-stream') throw new MemberError(415,'Invalid upload part format.');
    const expected = Math.min(VIDEO_PART_BYTES,saved.size-part*VIDEO_PART_BYTES);
    const bytes = await boundedBytes(req,VIDEO_PART_BYTES);
    if(bytes.byteLength!==expected) throw new MemberError(400,'This upload part is incomplete. Try again.');
    const key=`${base(member.id,id)}/part/${part}`;
    const written=await store.set(key,bytes.buffer as ArrayBuffer,{onlyIfNew:true});
    if(!written.modified) { const existing=await store.get(key,{type:'arrayBuffer'});
      if(!existing || digest(existing)!==digest(bytes.buffer as ArrayBuffer)) throw new MemberError(409,'This upload part changed. Choose your video again.'); }
    return memberJSON({upload_id:id,part,received:bytes.byteLength});
  } catch(error) { return failure(error); }
}
export async function readVideoUpload(store: VideoTransferStore | undefined, member: string, id: string, kind: 'clip'): Promise<File> {
  if(!store) throw new MemberError(503,'Large video uploads are not available yet. Refresh after the site update.');
  const saved=await manifest(store,member,String(id||'').toLowerCase());
  if(saved.kind!==kind) throw new MemberError(400,'This video was selected for a different upload form.');
  const data=new Uint8Array(saved.size);
  for(let part=0;part<saved.parts;part++) {
    const bytes=await store.get(`${base(member,saved.id)}/part/${part}`,{type:'arrayBuffer'});
    const expected=Math.min(VIDEO_PART_BYTES,saved.size-part*VIDEO_PART_BYTES);
    if(!(bytes instanceof ArrayBuffer) || bytes.byteLength!==expected) throw new MemberError(409,'Your video has not finished uploading. Tap the upload button to resume.');
    data.set(new Uint8Array(bytes),part*VIDEO_PART_BYTES);
  }
  // Keep the parts until expiry so an interrupted final save can be retried.
  return new File([data],saved.name,{type:saved.mime});
}
export async function cleanVideoTransfers(store: VideoTransferStore): Promise<number> {
  const now=Date.now(); let deleted=0;
  const outOfTime=()=>Date.now()-now>20000;
  for await(const page of store.list({prefix:'transfers/',paginate:true})) for(const item of page.blobs) {
    if(outOfTime())return deleted;
    if(!item.key.endsWith('/manifest')) continue;
    const record=await store.get(item.key,{type:'json'});
    if(!record || !Number.isFinite(record.expires_at) || record.expires_at>now) continue;
    // This prefix is derived from our own listed key, never from request input.
    const prefix=item.key.slice(0,-'manifest'.length);
    for await(const parts of store.list({prefix,paginate:true})) for(const part of parts.blobs) {await store.delete(part.key);deleted++;}
  }
  for await(const page of store.list({prefix:'quota/',paginate:true})) for(const item of page.blobs) {
    if(outOfTime())return deleted;
    const record=await store.get(item.key,{type:'json'});
    if(record?.expires_at<=now) {await store.delete(item.key);deleted++;}
  }
  return deleted;
}

/** Cheap authenticated preflight before enqueueing expensive conversion. */
export async function inspectVideoUpload(store: VideoTransferStore, member: string, id: string) {
  const saved=await manifest(store,member,id);
  if(saved.kind!=='clip')throw new MemberError(400,'This video belongs to another upload form.');
  return {size:saved.size,parts:saved.parts};
}
