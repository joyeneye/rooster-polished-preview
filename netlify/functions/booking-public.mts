import type { Config } from "@netlify/functions";
import { publicAPI } from "./_shared/booking-api.mts";
export default publicAPI;
export const config: Config = { path: "/api/booking/public", method: "GET", rateLimit: { windowLimit: 300, windowSize: 60, aggregateBy: ["ip", "domain"] } };
