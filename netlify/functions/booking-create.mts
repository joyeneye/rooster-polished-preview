import type { Config } from "@netlify/functions";
import { createBooking } from "./_shared/booking-api.mts";
export default createBooking;
export const config: Config = { path: "/api/booking/create", method: "POST", rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] } };
