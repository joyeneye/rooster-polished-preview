import type {Config,Context} from '@netlify/functions';
import {resolveCommunityProfileMember} from './_shared/roster-access.mts';
import {memberFailure,memberJSON} from './_shared/member-auth.mts';
import {monaStore} from './_shared/mona-workspace.mts';

export default async(req:Request,context:Context):Promise<Response>=>{try{if(req.method!=='GET')return memberJSON({error:'Method not allowed.'},405);const user=await resolveCommunityProfileMember();const stored=await monaStore(context).get(`workspaces/${user.id.toLowerCase()}`,{type:'json'}).catch(()=>null);return memberJSON({user:{id:user.id,name:user.name},updatedAt:new Date().toISOString(),preferences:stored?.memberId===user.id.toLowerCase()?stored.preferences:null,leadCount:stored?.memberId===user.id.toLowerCase()&&Array.isArray(stored.leads)?stored.leads.length:0})}catch(error){return memberFailure(error)}};
export const config:Config={path:'/api/mona/context',method:'GET',rateLimit:{windowLimit:90,windowSize:60,aggregateBy:['ip','domain']}};
