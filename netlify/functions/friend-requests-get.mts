import type { Config, Context } from '@netlify/functions';
import { friendStore, getFriendRequests } from './_shared/friends.mts';
import { profileStore } from './_shared/member-profiles.mts';
export default async (req:Request,context:Context)=>getFriendRequests(req,friendStore(context),undefined,profileStore(context));
export const config:Config={path:'/api/friend-requests',method:'GET',rateLimit:{windowLimit:120,windowSize:60,aggregateBy:['ip','domain']}};
