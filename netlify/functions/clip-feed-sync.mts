import type {Config,Context} from '@netlify/functions';
import {clipsStore} from './_shared/member-clips.mts';
import {retryClipFeedSync} from './_shared/clip-feed.mts';

export default async (_req:Request,context:Context)=>{
  const processed=await retryClipFeedSync(clipsStore(context));
  return Response.json({processed});
};
export const config:Config={schedule:'*/5 * * * *'};
