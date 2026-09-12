import type { Config } from '@netlify/functions';
import { closeOpportunity } from './_shared/opportunities.mts';
export default (req: Request) => closeOpportunity(req);
export const config: Config = { path: '/api/opportunity/close', method: 'POST', rateLimit: { windowLimit: 20, windowSize: 300, aggregateBy: ['ip', 'domain'] } };
