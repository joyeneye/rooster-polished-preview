import type { Config, Context } from "@netlify/functions";
import { getProfileVisitors } from "./_shared/profile-visitors.mts";
import { visitorContext } from "./_shared/visitor-stores.mts";
export default (req: Request, ctx: Context) => {
  const { visitors, profiles, lookup } = visitorContext(ctx);
  return getProfileVisitors(req, visitors, profiles, lookup);
};
export const config: Config = { path: "/api/visitors", method: "GET", rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] } };
