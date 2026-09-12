import type {Config,Context} from '@netlify/functions';
import {enqueueMedia,mediaJobStore,dispatchMedia,mediaFailure} from './_shared/media-jobs.mts';
import { resolveCommunityProfileMember } from "./_shared/roster-access.mts";
export default async(req:Request,context:Context)=>{
  try{return await enqueueMedia(req,mediaJobStore(context),'song',{resolve:resolveCommunityProfileMember,dispatch:(id,token)=>dispatchMedia(req,id,token)});}catch(e){return mediaFailure(e);}
};
export const config:Config={path:'/api/member-songs/check',method:'POST',rateLimit:{windowLimit:6,windowSize:60,aggregateBy:['ip','domain']}};
