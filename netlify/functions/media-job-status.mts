import type {Config,Context} from '@netlify/functions';
import {getMediaJob,mediaJobStore,mediaFailure} from './_shared/media-jobs.mts';
import { resolveCommunityProfileMember } from "./_shared/roster-access.mts";
export default async(req:Request,context:Context)=>{try{return await getMediaJob(req,mediaJobStore(context),resolveCommunityProfileMember);}catch(e){return mediaFailure(e);}};
export const config:Config={path:'/api/media-jobs/:id',method:'GET',rateLimit:{windowLimit:90,windowSize:60,aggregateBy:['ip','domain']}};
