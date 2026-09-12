import type { Config } from "@netlify/functions";
import { servicesAPI } from "./_shared/booking-api.mts";
export default servicesAPI;
export const config: Config = { path: "/api/booking/services", rateLimit: { windowLimit: 180, windowSize: 60, aggregateBy: ["ip", "domain"] } };
