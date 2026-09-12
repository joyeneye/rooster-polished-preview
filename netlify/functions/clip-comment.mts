import type { Config, Context } from "@netlify/functions";
import { clipsStore } from "./_shared/member-clips.mts";
import { clipCommunityStore, clipCommunityFailure, postClipComment } from "./_shared/clip-community.mts";
export default async (req: Request, context: Context): Promise<Response> => {
  try { return await postClipComment(req, clipCommunityStore(context), clipsStore(context)); } catch (error) { return clipCommunityFailure(error); }
};
export const config: Config = { path: "/api/clip-comment", method: "POST", rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ["ip", "domain"] } };
