import type { Config } from '@netlify/functions';
import { listApplications } from './_shared/opportunities.mts';
export default (req: Request) => listApplications(req);
export const config: Config = { path: '/api/opportunity/applications', method: 'GET', rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ['ip', 'domain'] } };
