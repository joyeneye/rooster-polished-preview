import {boundedBytes} from './audio-transfers.mts';
import {getStore,getDeployStore} from '@netlify/blobs';
import type {Context} from '@netlify/functions';
import { assertSameOrigin, MEMBER_ID, MemberError, memberJSON, type MemberResolver } from './member-auth.mts';
import { requireCommunityMember } from "./roster-access.mts";
export const PRESENCE_TTL=90_000;
export interface PresenceStore {get(key:string,options:{type:'json'}):Promise<any>;setJSON(key:string,value:unknown):Promise<any>;delete(key:string):Promise<any>;list(options:{prefix:string,paginate:true}):AsyncIterable<{blobs:{key:string}[]}>;}
export function presenceStore(context:Context):PresenceStore {const options={name:'member-presence',consistency:'strong' as const};return context.deploy.context==='production'?getStore(options):getDeployStore({...options,deployID:context.deploy.id});}
export async function onlineMembers(ids:string[],store:PresenceStore,now=Date.now()):Promise<Record<string,boolean>> {
 const entries=await Promise.all([...new Set(ids)].map(async id=>{
  if(!MEMBER_ID.test(id))return [id,false] as const;
  let seen=0;
  for await(const page of store.list({prefix:`sessions/${id.toLowerCase()}/`,paginate:true})) {
   if((seen+=page.blobs.length)>100)throw new MemberError(503,'Online status is temporarily unavailable.');
   const states=await Promise.all(page.blobs.map(b=>store.get(b.key,{type:'json'})));
   if(states.some(v=>v?.member_id===id.toLowerCase()&&Number.isFinite(v.seen_at)&&v.seen_at<=now+5_000&&v.seen_at>now-PRESENCE_TTL))return [id,true] as const;
  }
  return [id,false] as const;
 }));return Object.fromEntries(entries);
}
export async function presenceWrite(req:Request,store:PresenceStore,resolve:MemberResolver=requireCommunityMember,now=Date.now()):Promise<Response> {
 try {if(req.method!=='POST')return memberJSON({error:'Method not allowed.'},405);assertSameOrigin(req);const user=await resolve();
  if(!req.headers.get('content-type')?.startsWith('application/json'))throw new MemberError(415,'Invalid status update.');
  const text=new TextDecoder().decode(await boundedBytes(req,256));let data:any;try{data=JSON.parse(text);}catch{throw new MemberError(400,'Invalid status update.');}
  if(!MEMBER_ID.test(data?.session_id||'')||!['active','offline'].includes(data?.state))throw new MemberError(400,'Invalid status update.');
  const key=`sessions/${user.id}/${data.session_id.toLowerCase()}`;
  if(data.state==='offline')await store.delete(key);else await store.setJSON(key,{member_id:user.id,seen_at:now});
  return memberJSON({ok:true,expires_in_seconds:PRESENCE_TTL/1000});
 }catch(e){return memberJSON({error:e instanceof MemberError?e.message:'Online status could not update.'},e instanceof MemberError?e.status:503);}
}
export async function presenceRead(req:Request,store:PresenceStore,profiles:{get:(key:string,options:{type:'json'})=>Promise<any>}):Promise<Response> {
 try {if(req.method!=='GET')return memberJSON({error:'Method not allowed.'},405);
  const ids=(new URL(req.url).searchParams.get('ids')||'').split(',');if(ids.length>40||ids.some(id=>id!=='owner'&&!MEMBER_ID.test(id)))throw new MemberError(400,'Choose valid member pages.');
  const binding=ids.includes('owner')?await profiles.get('owner-binding',{type:'json'}):null;
  const mapped=ids.map(id=>id==='owner'?binding?.id:id.toLowerCase());const states=await onlineMembers(mapped.filter(id=>typeof id==='string'),store);
  return memberJSON({statuses:Object.fromEntries(ids.map((id,i)=>[id,states[mapped[i]]===true])),expires_in_seconds:90});
 }catch(e){return memberJSON({error:e instanceof MemberError?e.message:'Online status could not load.'},e instanceof MemberError?e.status:503);}
}
export async function cleanupPresence(store:PresenceStore,now=Date.now()) {let deleted=0;const begin=Date.now();for await(const page of store.list({prefix:'sessions/',paginate:true}))for(const item of page.blobs){if(Date.now()-begin>20_000)return deleted;const v=await store.get(item.key,{type:'json'});if(!Number.isFinite(v?.seen_at)||v.seen_at<now-24*60*60*1000){await store.delete(item.key);deleted++;}}return deleted;}
