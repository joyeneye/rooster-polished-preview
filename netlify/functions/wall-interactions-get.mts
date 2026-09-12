import type {Config,Context} from '@netlify/functions';
import {interactionStore,getInteractions} from './_shared/wall-interactions.mts';
import {commentStore} from './_shared/comment-wall.mts';
import {memberWallStore} from './_shared/member-wall.mts';
import {profileStore} from './_shared/member-profiles.mts';
import {communityDirectory} from './_shared/community-members.mts';
import {friendStore} from './_shared/friends.mts';
export default async(req:Request,context:Context)=>getInteractions(req,interactionStore(context),{main:commentStore(context),walls:memberWallStore(context),profiles:profileStore(context),directory:communityDirectory(context),friends:friendStore(context)});
export const config:Config={path:'/api/wall-interactions',method:'GET',rateLimit:{windowLimit:180,windowSize:60,aggregateBy:['ip','domain']}};
