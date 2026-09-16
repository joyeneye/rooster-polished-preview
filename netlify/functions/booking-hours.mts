import type { Config } from "@netlify/functions";
import { hoursAPI } from "./_shared/booking-api.mts";
export default hoursAPI;
export const config: Config = { path: "/api/booking/hours", rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] } };
