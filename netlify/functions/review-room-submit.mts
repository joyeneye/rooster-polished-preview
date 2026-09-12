import type { Config } from "@netlify/functions";
import { submitTrack } from "./_shared/review-room.mts";
export default submitTrack;
export const config: Config = { path: "/api/review-room/submit", method: "POST", rateLimit: { windowLimit: 12, windowSize: 60, aggregateBy: ["ip", "domain"] } };
