import type { Config } from "@netlify/functions";
import { businessesAPI } from "./_shared/booking-api.mts";
export default businessesAPI;
export const config: Config = { path: "/api/booking/businesses", rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] } };
