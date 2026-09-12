import type { Config } from '@netlify/functions';
import { getGoogleSearch } from './_shared/morespace-search.mts';
export default (req: Request) => getGoogleSearch(req);
export const config: Config = { path: '/api/morespace/google', method: 'GET', rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ['ip', 'domain'] } };
