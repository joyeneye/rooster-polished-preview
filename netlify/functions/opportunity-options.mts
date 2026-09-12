import type { Config } from '@netlify/functions';
import { opportunityVocabulary } from './_shared/opportunities.mts';
export default () => opportunityVocabulary();
export const config: Config = { path: '/api/opportunities/options', method: 'GET', rateLimit: { windowLimit: 240, windowSize: 60, aggregateBy: ['ip', 'domain'] } };
