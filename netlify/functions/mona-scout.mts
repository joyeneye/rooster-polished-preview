import type { Config, Context } from '@netlify/functions';
import { getStore, getDeployStore } from '@netlify/blobs';
import { resolveCommunityProfileMember } from './_shared/roster-access.mts';
import { memberJSON } from './_shared/member-auth.mts';
import { scoutLeads } from './_shared/mona-lead-scout.mts';

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method === 'GET') {
    const member = await resolveCommunityProfileMember();
    if (!member) return memberJSON({error:'Log in to use MONA location.'},401);
    const geo = context.geo;
    return memberJSON({memberId:member.id.toLowerCase(),area:{city:geo.city || '',subdivision:geo.subdivision?.name || '',country:geo.country?.name || '',postalCode:geo.postalCode || ''}});
  }
  return scoutLeads(req, {
  resolveMember: resolveCommunityProfileMember,
  saveResults: async (memberId, results) => {
    const options = { name: 'mona-workspace', consistency: 'strong' as const };
    const store = context.deploy.context === 'production' ? getStore(options) : getDeployStore({ ...options, deployID: context.deploy.id });
    await store.setJSON(`scouts/${memberId}`, results);
  },
  });
};

export const config: Config = { path: '/api/mona/scout', method: ['GET','POST'],
  rateLimit: { windowLimit: 6, windowSize: 3600, aggregateBy: ['ip', 'domain'] } };
