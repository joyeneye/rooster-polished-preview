import type {Context,Config} from '@netlify/functions';
import {presenceRead,presenceStore} from './_shared/member-presence.mts';
import {profileStore} from './_shared/member-profiles.mts';
export default (req:Request,ctx:Context)=>presenceRead(req,presenceStore(ctx),profileStore(ctx));
export const config:Config={path:'/api/member-presence',method:'GET',rateLimit:{windowLimit:180,windowSize:60,aggregateBy:['ip','domain']}};
