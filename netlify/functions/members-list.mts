import type {Context,Config} from '@netlify/functions';
import {getMembers} from './_shared/member-directory.mts';
import {profileStore} from './_shared/member-profiles.mts';
import {communityDirectory} from './_shared/community-members.mts';
import {presenceStore} from './_shared/member-presence.mts';
import {accessFailure, requireCommunityMember} from './_shared/roster-access.mts';
import {MemberError, memberJSON} from './_shared/member-auth.mts';
import {friendStore} from './_shared/friends.mts';
import {directoryConnections,approvedDirectoryIds} from './_shared/directory-connections.mts';
/** The member directory is inside the community, so it needs an invitation and
 * approval like everything else. */
export default async (req:Request,ctx:Context)=>{
  try {
    const viewer=await requireCommunityMember();
    const profiles=profileStore(ctx);
    const binding=await profiles.get('owner-binding',{type:'json'});
    const connections=await directoryConnections(viewer.id,profiles,friendStore(ctx));
    return await getMembers(req,profiles,communityDirectory(ctx),presenceStore(ctx),{...connections,approvedIds:ids=>approvedDirectoryIds(ids,binding?.id||null)});
  } catch (error) {
    if (error instanceof MemberError && error.status === 401) return memberJSON({error:'Log in with an approved ROOSTER account to open member discovery.'},401);
    return accessFailure(error);
  }
};
export const config:Config={path:'/api/members',method:'GET',rateLimit:{windowLimit:60,windowSize:60,aggregateBy:['ip','domain']}};
