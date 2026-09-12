import type { Config, Context } from "@netlify/functions";
import { clipsStore } from "./_shared/member-clips.mts";
import { clipCommunityStore, clipCommunityFailure, postClipReaction } from "./_shared/clip-community.mts";
export default async (req: Request, context: Context): Promise<Response> => {
  try { return await postClipReaction(req, clipCommunityStore(context), clipsStore(context)); } catch (error) { return clipCommunityFailure(error); }
};
export const config: Config = { path: "/api/clip-reaction", method: "POST", rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ["ip", "domain"] } };
