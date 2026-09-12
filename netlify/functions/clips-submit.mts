import type { Config, Context } from "@netlify/functions";
import { videoTransferStore, inspectVideoUpload } from "./_shared/video-transfers.mts";
import { clipsStore, clipsFailure, submitClip } from "./_shared/member-clips.mts";
import {enqueueMedia,mediaJobStore,dispatchMedia} from "./_shared/media-jobs.mts";
import { resolveCommunityProfileMember } from "./_shared/roster-access.mts";
export default async (req: Request, context: Context): Promise<Response> => {
  try {
    if ((req.headers.get('content-type')||'').split(';')[0].trim()==='application/json') return await enqueueMedia(req,mediaJobStore(context),'video',{resolve:resolveCommunityProfileMember,validate:async(input,member)=>{await inspectVideoUpload(videoTransferStore(context),member.id,input.upload_id);},dispatch:(id,token)=>dispatchMedia(req,id,token)});
    return await submitClip(req, clipsStore(context), { transfers: videoTransferStore(context) }); } catch (error) { return clipsFailure(error); }
};
export const config: Config = { path: "/api/clips", method: "POST", rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ["ip", "domain"] } };
