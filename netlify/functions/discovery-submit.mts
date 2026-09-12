import type { Config, Context } from "@netlify/functions";
import { submitDiscovery } from "./_shared/discovery.mts";
export default (req: Request, context: Context) => submitDiscovery(req, context);
export const config: Config = { path: "/api/discovery/submit", method: "POST", rateLimit: { windowLimit: 3, windowSize: 60, aggregateBy: ["ip", "domain"] } };
