import type {Context,Config} from '@netlify/functions';
import {presenceWrite,presenceStore} from './_shared/member-presence.mts';
export default (req:Request,ctx:Context)=>presenceWrite(req,presenceStore(ctx));
export const config:Config={path:'/api/member-presence',method:'POST',rateLimit:{windowLimit:120,windowSize:60,aggregateBy:['ip','domain']}};
