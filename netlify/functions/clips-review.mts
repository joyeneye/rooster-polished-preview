import type { Config, Context } from "@netlify/functions";
import { clipsStore, clipsFailure, getClipReview, reviewClip } from "./_shared/member-clips.mts";
import { profileStore } from "./_shared/member-profiles.mts";
export default async (req: Request, context: Context): Promise<Response> => {
  try {
    const store = clipsStore(context), profiles = profileStore(context);
    return req.method === "GET" ? await getClipReview(req, store, profiles) : await reviewClip(req, store, profiles);
  } catch (error) { return clipsFailure(error); }
};
export const config: Config = { path: "/api/clips/review", method: ["GET", "POST"], rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] } };
