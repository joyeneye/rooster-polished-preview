import type { Config, Context } from "@netlify/functions";
import { discoveryStatus } from "./_shared/discovery.mts";
export default (req: Request, context: Context) => discoveryStatus(req, context);
export const config: Config = { path: "/api/discovery/status", method: "GET", rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ["ip", "domain"] } };
