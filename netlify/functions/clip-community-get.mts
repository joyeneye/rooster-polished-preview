import type { Config, Context } from "@netlify/functions";
import { clipsStore } from "./_shared/member-clips.mts";
import { clipCommunityStore, clipCommunityFailure, getClipCommunity } from "./_shared/clip-community.mts";
export default async (req: Request, context: Context): Promise<Response> => {
  try { return await getClipCommunity(req, clipCommunityStore(context), clipsStore(context)); } catch (error) { return clipCommunityFailure(error); }
};
export const config: Config = { path: "/api/clip-community", method: "GET", rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] } };
