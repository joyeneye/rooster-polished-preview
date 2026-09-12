import type { Config, Context } from '@netlify/functions';
import { getStore, getDeployStore } from '@netlify/blobs';
import { getDiscover, type DiscoverCache } from './_shared/slots-discover.mts';

export default (req: Request, context: Context) => {
  let cache: DiscoverCache | undefined;
  try {
    const options = { name: 'roster-slots-discover', consistency: 'strong' as const };
    cache = context.deploy.context === 'production' ? getStore(options)
      : getDeployStore({ ...options, deployID: context.deploy.id });
  } catch { /* Publisher headlines can still load if the optional cache is down. */ }
  return getDiscover(req, { cache });
};

export const config: Config = {
  path: '/api/slots/discover', method: 'GET',
  rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
