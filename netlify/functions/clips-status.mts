import type { Config, Context } from "@netlify/functions";
import { clipsStore, clipsFailure, getClipStatus } from "./_shared/member-clips.mts";
import { profileStore } from "./_shared/member-profiles.mts";
export default async (req: Request, context: Context): Promise<Response> => {
  try { return await getClipStatus(req, clipsStore(context), profileStore(context)); } catch (error) { return clipsFailure(error); }
};
export const config: Config = { path: "/api/clips/status/:id", method: "GET", rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ["ip", "domain"] } };
