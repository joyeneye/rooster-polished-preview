import type { Config, Context } from "@netlify/functions";
import { getTopTwentyFive } from "./_shared/profile-visitors.mts";
import { visitorContext } from "./_shared/visitor-stores.mts";
export default (req: Request, ctx: Context) => {
  const { visitors, profiles, lookup } = visitorContext(ctx);
  return getTopTwentyFive(req, visitors, profiles, lookup);
};
export const config: Config = { path: "/api/top25", method: "GET", rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ["ip", "domain"] } };
