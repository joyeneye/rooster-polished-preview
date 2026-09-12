import type { Config } from "@netlify/functions";
import { queueAction } from "./_shared/review-room.mts";
export default queueAction;
export const config: Config = { path: "/api/review-room/action", method: "POST", rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ["ip", "domain"] } };
