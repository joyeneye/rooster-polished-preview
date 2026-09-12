import type { Context, Config } from '@netlify/functions';
import { getNews, newsStore } from './_shared/roster-news.mts';
export default (req: Request, ctx: Context) => getNews(req, newsStore(ctx));
export const config: Config = { path: '/api/whats-happening', method: 'GET', rateLimit: { windowLimit: 300, windowSize: 60, aggregateBy: ['ip', 'domain'] } };
