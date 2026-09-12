import type { Config } from "@netlify/functions";
import { dashboard } from "./_shared/review-room.mts";
export default dashboard;
export const config: Config = { path: "/api/review-room/dashboard", method: "GET", rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] } };
