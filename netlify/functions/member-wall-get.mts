import type { Config, Context } from '@netlify/functions';
import { getMemberWall, memberWallStore, wallFailure } from './_shared/member-wall.mts';
import { profileStore } from './_shared/member-profiles.mts';
import { communityDirectory } from './_shared/community-members.mts';
import { friendStore } from './_shared/friends.mts';
export default async (req: Request, context: Context): Promise<Response> => {
  try { return await getMemberWall(req, memberWallStore(context), { profiles:profileStore(context), directory:communityDirectory(context), friends:friendStore(context) }); }
  catch (error) { return wallFailure(error); }
};
export const config: Config = { path:'/api/member-wall', method:'GET', rateLimit:{ windowLimit:120, windowSize:60, aggregateBy:['ip','domain'] } };
