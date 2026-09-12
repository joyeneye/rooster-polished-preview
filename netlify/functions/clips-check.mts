import type { Config, Context } from "@netlify/functions";
import { clipsStore, clipsFailure, checkClip } from "./_shared/member-clips.mts";
export default async (req: Request, context: Context): Promise<Response> => {
  try { return await checkClip(req, clipsStore(context)); } catch (error) { return clipsFailure(error); }
};
export const config: Config = { path: "/api/clips/check", method: "POST", rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ["ip", "domain"] } };
