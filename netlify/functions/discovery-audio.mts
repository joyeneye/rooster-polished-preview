import type { Config, Context } from "@netlify/functions";
import { discoveryAudio } from "./_shared/discovery.mts";
export default (req: Request, context: Context) => {
  const id = new URL(req.url).pathname.split("/").filter(Boolean).at(-1) || "";
  return discoveryAudio(req, context, id);
};
export const config: Config = { path: "/api/discovery/audio/:id", method: "GET", rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] } };
