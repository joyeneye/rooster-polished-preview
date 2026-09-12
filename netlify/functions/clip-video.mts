import type { Config, Context } from "@netlify/functions";
import { clipsStore, clipsFailure, getClipVideo } from "./_shared/member-clips.mts";
import { profileStore } from "./_shared/member-profiles.mts";
export default async (req: Request, context: Context): Promise<Response> => {
  try { return await getClipVideo(req, clipsStore(context), profileStore(context)); } catch (error) { return clipsFailure(error); }
};
export const config: Config = { path: "/api/clip-video/:id", method: "GET", rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] } };
