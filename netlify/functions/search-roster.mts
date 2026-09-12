import type { Context, Config } from '@netlify/functions';
import { getRosterSearch } from './_shared/morespace-search.mts';
import { songStores } from './_shared/member-songs.mts';
import { accessFailure, requireCommunityMember } from './_shared/roster-access.mts';
/** Searching ROOSTER means searching the people inside it, so it is gated too. */
export default async (req: Request, ctx: Context) => {
  try {
    await requireCommunityMember();
    return await getRosterSearch(req, songStores(ctx));
  } catch (error) { return accessFailure(error); }
};
export const config: Config = { path: '/api/morespace/roster', method: 'GET', rateLimit: { windowLimit: 90, windowSize: 60, aggregateBy: ['ip', 'domain'] } };
