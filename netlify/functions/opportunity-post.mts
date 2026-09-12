import type { Config } from '@netlify/functions';
import { postOpportunity } from './_shared/opportunities.mts';
export default (req: Request) => postOpportunity(req);
export const config: Config = { path: '/api/opportunity/post', method: 'POST', rateLimit: { windowLimit: 10, windowSize: 300, aggregateBy: ['ip', 'domain'] } };
