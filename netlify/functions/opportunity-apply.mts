import type { Config } from '@netlify/functions';
import { applyToOpportunity } from './_shared/opportunities.mts';
export default (req: Request) => applyToOpportunity(req);
// Applying needs no account and no invite code, so the rate limit is the only gate.
export const config: Config = { path: '/api/opportunity/apply', method: 'POST', rateLimit: { windowLimit: 6, windowSize: 300, aggregateBy: ['ip', 'domain'] } };
