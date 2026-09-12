import type { Config } from "@netlify/functions";
import { dashboardAPI } from "./_shared/booking-api.mts";
export default dashboardAPI;
export const config: Config = { path: "/api/booking/dashboard", method: "GET", rateLimit: { windowLimit: 180, windowSize: 60, aggregateBy: ["ip", "domain"] } };
