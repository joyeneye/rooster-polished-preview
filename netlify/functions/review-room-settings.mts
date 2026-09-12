import type { Config } from "@netlify/functions";
import { saveRoom } from "./_shared/review-room.mts";
export default saveRoom;
export const config: Config = { path: "/api/review-room/settings", method: "POST", rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] } };
