import type { Config, Context } from '@netlify/functions';
import { requireCommunityMember } from './_shared/roster-access.mts';
import { manageMonaWorkspace, monaStore, monaWorkspaceFailure } from './_shared/mona-workspace.mts';

export default async (req: Request, context: Context): Promise<Response> => {
  try { return await manageMonaWorkspace(req, monaStore(context), {resolveMember: requireCommunityMember}); }
  catch (error) { return monaWorkspaceFailure(error); }
};
export const config: Config = {path: '/api/mona/workspace', method: ['GET', 'POST'], rateLimit: {windowLimit: 60, windowSize: 60, aggregateBy: ['ip', 'domain']}};
