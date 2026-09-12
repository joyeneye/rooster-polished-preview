import type {Config,Context} from '@netlify/functions';
import {mediaJobStore,runMediaJob} from './_shared/media-jobs.mts';
import {preparePhoneVideoOnServer} from './_shared/media-normalize.mts';
import {videoTransferStore} from './_shared/video-transfers.mts';
import {clipsStore,submitClip,checkClip} from './_shared/member-clips.mts';
import {songStores,checkMemberSong} from './_shared/member-songs.mts';
export default async(req:Request,context:Context)=>{
  const origin=new URL(req.url).origin;
  const post=(path:string,body:unknown)=>new Request(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
  await runMediaJob(req,mediaJobStore(context),async job=>{
    const resolveMember=async()=>job.member;
    if(job.kind==='song')return checkMemberSong(post('/api/member-songs/check',job.input),songStores(context),{resolveMember});
    const store=clipsStore(context);
    const submitted=await submitClip(post('/api/clips',job.input),store,{resolveMember,transfers:videoTransferStore(context),prepareVideo:preparePhoneVideoOnServer});
    if(!submitted.ok)return submitted;
    const result=await submitted.json();
    if(result.status!=='pending')return new Response(JSON.stringify(result),{headers:{'Content-Type':'application/json'}});
    return checkClip(post('/api/clips/check',{id:result.id}),store,{resolveMember});
  });
};
export const config:Config={path:'/api/media-processing/run',method:'POST'};
