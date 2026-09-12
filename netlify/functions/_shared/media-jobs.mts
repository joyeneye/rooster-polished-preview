/** Authenticated, retry-safe media work. Raw uploads stay in their private stores. */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { getStore, getDeployStore } from '@netlify/blobs';
import type { Context } from '@netlify/functions';
import { assertSameOrigin, MemberError, memberJSON, MEMBER_ID } from './member-auth.mts';
import type { ProfileMember } from './member-profiles.mts';
import { boundedBytes } from './audio-transfers.mts';
export type MediaKind = 'video' | 'song';
export interface JobStore {
  get(key: string, options: {type:'json'}): Promise<any>;
  getWithMetadata(key: string, options: {type:'json'}): Promise<{data:any;etag:string}|null>;
  setJSON(key: string, value: unknown, options?: {onlyIfNew?:boolean;onlyIfMatch?:string}): Promise<{modified:boolean}>;
}
type Job = {id:string;kind:MediaKind;member:ProfileMember;input:any;fingerprint:string;state:'queued'|'running'|'done'|'failed';token_hash:string;attempts:number;updated_at:number;expires_at:number;result?:any;error?:string};
const hash = (s:string) => createHash('sha256').update(s).digest('hex');
const key = (id:string) => `jobs/${id}`;
const ID = /^[a-f0-9]{64}$/;
export function mediaJobStore(context:Context): JobStore {
  const options={name:'member-media-processing',consistency:'strong' as const};
  return context.deploy.context==='production'?getStore(options):getDeployStore({...options,deployID:context.deploy.id});
}
export async function mediaJSON(req:Request):Promise<any> {
  if((req.headers.get('content-type')||'').split(';')[0].trim().toLowerCase()!=='application/json')throw new MemberError(415,'Refresh this page to use the updated uploader.');
  try { const v=JSON.parse(new TextDecoder().decode(await boundedBytes(req,4096)));if(!v||typeof v!=='object'||Array.isArray(v))throw new Error();return v; }
  catch(e){if(e instanceof MemberError)throw e;throw new MemberError(400,'The upload details could not be read.');}
}
export function mediaInput(kind:MediaKind,input:any) {
  if(kind==='song') {
    const slot=Number(input.slot);
    if(!Number.isInteger(slot)||slot<1||slot>3||!MEMBER_ID.test(input.revision||''))throw new MemberError(400,'Refresh your songs before checking this upload.');
    return {slot,revision:input.revision.toLowerCase()};
  }
  if(!MEMBER_ID.test(input.request_id||'')||!MEMBER_ID.test(input.upload_id||'')||typeof input.caption!=='string'||input.caption.length>300||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(input.caption))throw new MemberError(400,'Choose a video and a caption up to 300 characters.');
  return {request_id:input.request_id.toLowerCase(),upload_id:input.upload_id.toLowerCase(),caption:input.caption.trim().replace(/\r\n?/g,'\n')};
}
function valid(job:any,id:string):job is Job {
  return !!job&&job.id===id&&ID.test(id)&&['song','video'].includes(job.kind)&&MEMBER_ID.test(job.member?.id||'')&&typeof job.member.name==='string'&&typeof job.fingerprint==='string'&&ID.test(job.token_hash||'')&&['queued','running','done','failed'].includes(job.state)&&Number.isFinite(job.expires_at)&&Number.isFinite(job.updated_at);
}
function answer(job:Job):Response {
  if(job.state==='done')return memberJSON(job.result,job.kind==='song'&&job.result?.status==='rejected'?422:200);
  if(job.state==='failed')return memberJSON({error:job.error||'The file could not be processed. Try again.',job_id:job.id,processing:false},422);
  if(job.expires_at<Date.now()||Date.now()-job.updated_at>8*60*1000)return memberJSON({error:'Processing was interrupted. Tap the upload button again to retry.',job_id:job.id,processing:false},409);
  return memberJSON({processing:true,job_id:job.id,stage:job.state==='queued'?'Waiting to process':'Preparing and checking your file'},202);
}
export async function enqueueMedia(req:Request,store:JobStore,kind:MediaKind,options:{resolve:()=>Promise<ProfileMember>;validate?:(input:any,member:ProfileMember)=>Promise<void>;dispatch:(jobId:string,token:string)=>Promise<void>}):Promise<Response> {
  assertSameOrigin(req);
  const member=await options.resolve();
  const input=mediaInput(kind,await mediaJSON(req));
  await options.validate?.(input,member);
  const id=hash(`${kind}:${member.id}:${kind==='video'?input.request_id:input.revision}`);
  const fingerprint=hash(JSON.stringify(input));
  for(let retry=0;retry<3;retry++){
    const previous=await store.getWithMetadata(key(id),{type:'json'});
    if(previous&&!valid(previous.data,id))throw new Error('Invalid media job');
    const job=previous?.data as Job|undefined;
    if(job&&job.fingerprint!==fingerprint)throw new MemberError(409,'This upload was already used for another file or caption. Select it again.');
    if(job?.state==='done'&&(job.result?.status!=='pending'||Date.now()-job.updated_at<30000))return answer(job);
    if(job&&['queued','running'].includes(job.state)&&Date.now()-job.updated_at<(job.state==='queued'?60000:8*60*1000))return answer(job);
    if(job&&job.state==='failed'&&job.attempts>=3&&job.expires_at>Date.now())throw new MemberError(422,'This file could not be processed after three attempts. Choose the original file again or contact the site owner.');
    const token=randomBytes(32).toString('hex');
    const candidate:Job={id,kind,member:{id:member.id,name:member.name,isOwner:member.isOwner},input,fingerprint,state:'queued',token_hash:hash(token),attempts:(job?.attempts||0)+1,updated_at:Date.now(),expires_at:Date.now()+60*60*1000};
    const written=await store.setJSON(key(id),candidate,previous?{onlyIfMatch:previous.etag}:{onlyIfNew:true});
    if(!written.modified)continue;
    try {await options.dispatch(id,token);}
    catch {
      const saved=await store.getWithMetadata(key(id),{type:'json'});
      if(saved?.data.token_hash===candidate.token_hash&&saved.data.state==='queued')await store.setJSON(key(id),{...candidate,state:'failed',error:'The processing service could not start. Try again shortly.'},{onlyIfMatch:saved.etag});
      throw new MemberError(503,'Your file uploaded, but processing could not start. Try the same button again.');
    }
    return answer(candidate);
  }
  throw new MemberError(409,'Another request is handling this upload. Try again shortly.');
}
export async function getMediaJob(req:Request,store:JobStore,resolveMember:()=>Promise<ProfileMember>):Promise<Response> {
  assertSameOrigin(req); const member=await resolveMember();
  const id=new URL(req.url).pathname.split('/').at(-1)||'';
  if(!ID.test(id))throw new MemberError(404,'Upload not found.');
  const job=await store.get(key(id),{type:'json'});
  if(!valid(job,id)||job.member.id!==member.id)throw new MemberError(404,'Upload not found.');
  return answer(job);
}
export async function runMediaJob(req:Request,store:JobStore,process:(job:Job)=>Promise<Response>):Promise<void> {
  const input=await mediaJSON(req);
  if(!ID.test(input.job_id||'')||!ID.test(input.token||''))return;
  const previous=await store.getWithMetadata(key(input.job_id),{type:'json'});
  if(!previous||!valid(previous.data,input.job_id))return;
  const job=previous.data as Job;
  if(job.expires_at<Date.now()||job.state!=='queued'||!timingSafeEqual(Buffer.from(job.token_hash,'hex'),Buffer.from(hash(input.token),'hex')))return;
  if(!(await store.setJSON(key(job.id),{...job,state:'running',updated_at:Date.now()},{onlyIfMatch:previous.etag})).modified)return;
  const claimed=await store.getWithMetadata(key(job.id),{type:'json'});
  if(!claimed||claimed.data.token_hash!==job.token_hash||claimed.data.state!=='running')return;
  let result:any,error:string|undefined;
  try{
    const response=await process(job); result=await response.json();
    if(!response.ok&&!(response.status===422&&result.status==='rejected'))throw new MemberError(response.status,result.error||'This file could not be prepared.');
  }catch(e){error=e instanceof MemberError||e instanceof Error&&e.name==='MediaPreparationError'?e.message:'The media converter could not finish. Your file has not been published.';}
  await store.setJSON(key(job.id),{...job,state:error?'failed':'done',updated_at:Date.now(),...(error?{error}:{result})},{onlyIfMatch:claimed.etag});
}
export async function dispatchMedia(req:Request,jobId:string,token:string):Promise<void> {
  const response=await fetch(new URL('/api/media-processing/run',req.url),{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({job_id:jobId,token}),signal:AbortSignal.timeout(8000)});
  if(response.status!==202)throw new Error('Background processing did not start');
}
export function mediaFailure(error:unknown):Response{return memberJSON({error:error instanceof MemberError?error.message:'Media processing could not connect. Try again.'},error instanceof MemberError?error.status:503);}
