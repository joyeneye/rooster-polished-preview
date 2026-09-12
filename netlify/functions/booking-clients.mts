import type { Config } from "@netlify/functions";
import { clientsAPI } from "./_shared/booking-api.mts";
export default clientsAPI;
export const config: Config = { path: "/api/booking/clients", method: "GET", rateLimit: { windowLimit: 180, windowSize: 60, aggregateBy: ["ip", "domain"] } };
