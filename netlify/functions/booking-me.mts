import type { Config } from "@netlify/functions";
import { bookingMe } from "./_shared/booking-api.mts";
export default bookingMe;
export const config: Config = { path: "/api/booking/me", method: "GET", rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] } };
