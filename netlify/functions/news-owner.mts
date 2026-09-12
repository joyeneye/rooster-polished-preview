import type { Context, Config } from '@netlify/functions';
import { postNewsOwnerAction, newsStore } from './_shared/roster-news.mts';
import { profileStore } from './_shared/member-profiles.mts';
export default (req: Request, ctx: Context) => postNewsOwnerAction(req, newsStore(ctx), profileStore(ctx));
export const config: Config = { path: '/api/whats-happening/owner', method: 'POST', rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ['ip', 'domain'] } };
