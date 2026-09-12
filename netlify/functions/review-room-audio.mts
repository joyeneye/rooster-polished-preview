import type { Config } from "@netlify/functions";
import { audio } from "./_shared/review-room.mts";
export default audio;
export const config: Config = { path: "/api/review-room/audio", method: "GET", rateLimit: { windowLimit: 240, windowSize: 60, aggregateBy: ["ip", "domain"] } };
