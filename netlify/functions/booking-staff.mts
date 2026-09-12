import type { Config } from "@netlify/functions";
import { staffAPI } from "./_shared/booking-api.mts";
export default staffAPI;
export const config: Config = { path: "/api/booking/staff", rateLimit: { windowLimit: 180, windowSize: 60, aggregateBy: ["ip", "domain"] } };
