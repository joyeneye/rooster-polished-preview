import type { Config } from '@netlify/functions';
import { listOpportunities } from './_shared/opportunities.mts';
export default (req: Request) => listOpportunities(req);
export const config: Config = { path: '/api/opportunities', method: 'GET', rateLimit: { windowLimit: 240, windowSize: 60, aggregateBy: ['ip', 'domain'] } };
