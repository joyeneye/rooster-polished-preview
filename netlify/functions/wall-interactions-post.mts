import type {Config,Context} from '@netlify/functions';
import {interactionStore,postInteraction} from './_shared/wall-interactions.mts';
import {commentStore} from './_shared/comment-wall.mts';
import {memberWallStore} from './_shared/member-wall.mts';
export default async(req:Request,context:Context)=>postInteraction(req,interactionStore(context),{main:commentStore(context),walls:memberWallStore(context)});
export const config:Config={path:'/api/wall-interactions/post',method:'POST',rateLimit:{windowLimit:30,windowSize:60,aggregateBy:['ip','domain']}};
