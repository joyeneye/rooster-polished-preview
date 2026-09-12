import type { Config } from '@netlify/functions';
import { getOpportunity } from './_shared/opportunities.mts';
export default (req: Request) => getOpportunity(req);
export const config: Config = { path: '/api/opportunity', method: 'GET', rateLimit: { windowLimit: 240, windowSize: 60, aggregateBy: ['ip', 'domain'] } };
