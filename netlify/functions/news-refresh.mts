import type { Context, Config } from '@netlify/functions';
import { refreshNews, newsStore } from './_shared/roster-news.mts';

/** Runs hourly and lets the server decide when the America/Chicago Monday has
 * arrived, the same way the visitor chart rolls its week over. Story fetching
 * still happens every run so a mid-week publisher outage can recover. */
export default async (_req: Request, ctx: Context) => {
  const result = await refreshNews(newsStore(ctx));
  console.log(`whats-happening ${result.week}: ${result.stories} stories, ok=${result.sources_ok.length}, failed=${result.sources_failed.join('|') || 'none'}, featured_built=${result.featured_built}`);
};
export const config: Config = { schedule: '17 * * * *' };
