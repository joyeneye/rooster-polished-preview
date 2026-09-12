import type { Config, Context } from "@netlify/functions";
import { postProfileVisit } from "./_shared/profile-visitors.mts";
import { visitorContext } from "./_shared/visitor-stores.mts";
export default (req: Request, ctx: Context) => {
  const { visitors, profiles, lookup } = visitorContext(ctx);
  return postProfileVisit(req, visitors, profiles, lookup);
};
export const config: Config = { path: "/api/visitors/visit", method: "POST", rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] } };
