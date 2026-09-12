import type { Config, Context } from "@netlify/functions";
import { listDiscovery } from "./_shared/discovery.mts";
export default (req: Request, context: Context) => listDiscovery(req, context);
export const config: Config = { path: "/api/discovery", method: "GET", rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ["ip", "domain"] } };
