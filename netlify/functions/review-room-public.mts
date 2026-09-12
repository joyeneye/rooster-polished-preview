import type { Config } from "@netlify/functions";
import { publicRoom } from "./_shared/review-room.mts";
export default publicRoom;
export const config: Config = { path: "/api/review-room/public", method: "GET", rateLimit: { windowLimit: 240, windowSize: 60, aggregateBy: ["ip", "domain"] } };
