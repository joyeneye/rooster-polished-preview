import type { Config } from "@netlify/functions";
import { appointmentsAPI } from "./_shared/booking-api.mts";
export default appointmentsAPI;
export const config: Config = { path: "/api/booking/appointments", rateLimit: { windowLimit: 180, windowSize: 60, aggregateBy: ["ip", "domain"] } };
