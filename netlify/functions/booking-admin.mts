import type { Config } from "@netlify/functions";
import { adminAPI } from "./_shared/booking-api.mts";
export default adminAPI;
export const config: Config = { path: "/api/booking/admin", rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] } };
