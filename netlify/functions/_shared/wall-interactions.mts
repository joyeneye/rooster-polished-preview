import {createHash} from 'node:crypto';
import {getStore,getDeployStore} from '@netlify/blobs';
import type {Context} from '@netlify/functions';
import {MemberError,memberJSON,assertSameOrigin,MEMBER_ID} from './member-auth.mts';
import { type ProfileMember, type ProfileStore } from './member-profiles.mts';
import {identityReader} from './wall-identity.mts';
import type {CommunityReader} from './community-members.mts';
import {moderateComment,POLICY_VERSION} from './comment-moderation.mts';
import {originalComments} from './comment-wall.mts';
import {boundedBytes} from './video-transfers.mts';
import { resolveCommunityProfileMember } from "./roster-access.mts";
export function interactionStore(context:Context):any {const options={name:'wall-interactions',consistency:'strong' as const};return context.deploy.context==='production'?getStore(options):getDeployStore({...options,deployID:context.deploy.id});}
type Deps={main:any;walls:any;profiles?:ProfileStore;directory?:CommunityReader;friends?:CommunityReader;resolve?:()=>Promise<ProfileMember>;moderate?:typeof moderateComment};
const fail=(e:any)=>memberJSON({error:e instanceof MemberError?e.message:'Wall reactions and replies could not connect. Try again.'},e instanceof MemberError?e.status:503);
async function target(req:Request,d:Deps){const q=new URL(req.url).searchParams,wall=q.get('wall')||'',id=q.get('comment_id')||'';if(q.getAll('wall').length!==1||q.getAll('comment_id').length!==1||!(wall==='owner'||MEMBER_ID.test(wall))||! /^(?:[a-f0-9]{24}|[a-f0-9]{64})$/.test(id))throw new MemberError(400,'Choose a comment on this wall.');
 let value:any;if(wall==='owner'){value=originalComments().find(c=>c.id===id)||await d.main.get(`comments/${id}`,{type:'json'});if(!value||value.moderation&&value.moderation.status!=='approved')throw new MemberError(404,'This comment is unavailable.');}
 else{value=await d.walls.get(`walls/${wall}/${id}`,{type:'json'});if(!value||value.moderation?.status!=='approved'||await d.walls.get(`removed/${wall}/${id}`,{type:'json'}))throw new MemberError(404,'This comment is unavailable.');}
 return `${wall}/${id}`;}
async function viewer(d:Deps,required=false){try{return await(d.resolve||resolveCommunityProfileMember)();}catch(e){if(required)throw e;return null;}}
async function read(req:Request){if((req.headers.get('content-type')||'').split(';')[0].trim()!=='application/json')throw new MemberError(415,'Use the reaction and reply buttons.');try{return JSON.parse(new TextDecoder().decode(await boundedBytes(req,8192)));}catch(e){if(e instanceof MemberError)throw e;throw new MemberError(400,'Your reply could not be read.');}}
async function values(store:any,prefix:string){const all:any[]=[];for await(const page of store.list({prefix,paginate:true})){if(all.length+page.blobs.length>10000)throw new MemberError(503,'This conversation is busy. Try again.');for(let i=0;i<page.blobs.length;i+=12)all.push(...await Promise.all(page.blobs.slice(i,i+12).map((b:any)=>store.get(b.key,{type:'json'}))));}return all.filter(Boolean);}
export async function getInteractions(req:Request,store:any,d:Deps){try{const key=await target(req,d),user=await viewer(d);const reactions=await values(store,`reactions/${key}/`);const counts={apple:0,tomato:0};let own:string|null=null;for(const r of reactions){if(MEMBER_ID.test(r.member_id)&&['apple','tomato'].includes(r.reaction)){counts[r.reaction as 'apple'|'tomato']++;if(r.member_id===user?.id)own=r.reaction;}}
 const replies=(await values(store,`replies/${key}/`)).filter(r=>r.moderation?.policy_version===POLICY_VERSION&&(r.moderation.status==='approved'||(r.moderation.status==='pending'&&(r.author_id===user?.id||user?.isOwner)))).sort((a,b)=>a.created_at.localeCompare(b.created_at)).slice(-100);
 // A reply shows the author's picture and name as they are now. The badge and
 // the owner link come from the stored record, and a reply is joined to a
 // person by member ID only, never by matching a name.
 const identity=identityReader(req,d.profiles?{profiles:d.profiles,directory:d.directory,friends:d.friends}:undefined);
 const shown=await Promise.all(replies.map(async r=>{const live=await identity(r.author_id),name=live&&live.name.trim().length>=2?live.name.trim():r.name;
  return {id:r.id,author_id:MEMBER_ID.test(r.author_id||'')?r.author_id:null,name,message:r.message,created_at:r.created_at,status:r.moderation.status,
   photo_url:live?.photo_url??null,verified:r.is_owner===true||live?.verified===true,verified_owner:r.is_owner===true,
   profile_url:r.is_owner?'/#home':`/profile.html?id=${r.author_id}`};}));
 return memberJSON({counts,reaction:own,replies:shown,can_post:!!user});}catch(e){return fail(e);}}
export async function postInteraction(req:Request,store:any,d:Deps){try{if(req.method!=='POST')throw new MemberError(405,'Method not allowed.');assertSameOrigin(req);const user=await viewer(d,true),key=await target(req,d),body=await read(req);if(body?.action==='react'){if(body.reaction!==null&&!['apple','tomato'].includes(body.reaction))throw new MemberError(400,'Choose a green apple or tomato.');await store.setJSON(`reactions/${key}/${user!.id}`,{member_id:user!.id,reaction:body.reaction});return memberJSON({saved:true});}
 if(body?.action!=='reply'||!MEMBER_ID.test(body.request_id||'')||typeof body.message!=='string')throw new MemberError(400,'Write a reply first.');const message=body.message.trim();if(message.length<2||message.length>1000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(message))throw new MemberError(400,'Write a reply between 2 and 1000 characters.');
 const id=createHash('sha256').update(`${key}:${user!.id}:${body.request_id}`).digest('hex'),entry=`replies/${key}/${id}`;let record=await store.get(entry,{type:'json'});if(record&&record.message!==message)throw new MemberError(409,'This reply changed. Submit a new reply.');
 if(!record){const moderation=await(d.moderate||moderateComment)({name:user!.name,message});if(!moderation||moderation.policy_version!==POLICY_VERSION||!['approved','pending','rejected'].includes(moderation.status))throw new MemberError(503,'The reply check is unavailable. Your text is still here.');record={id,name:user!.name,author_id:user!.id,is_owner:user!.isOwner===true,message,created_at:new Date().toISOString(),moderation};await store.setJSON(entry,record,{onlyIfNew:true});record=await store.get(entry,{type:'json'});}
 if(record?.moderation.status==='rejected')throw new MemberError(422,'This reply could not be published under the community rules.');return memberJSON({saved:true,status:record.moderation.status},record.moderation.status==='pending'?202:200);
 }catch(e){return fail(e);}}
