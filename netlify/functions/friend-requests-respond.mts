import type { Config, Context } from '@netlify/functions';
import { friendStore, respondToFriendRequest } from './_shared/friends.mts';
import { profileStore } from './_shared/member-profiles.mts';
export default async (req:Request,context:Context)=>respondToFriendRequest(req,friendStore(context),undefined,profileStore(context));
export const config:Config={path:'/api/friend-requests/respond',method:'POST',rateLimit:{windowLimit:30,windowSize:60,aggregateBy:['ip','domain']}};
