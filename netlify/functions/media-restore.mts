import type { Config, Context } from "@netlify/functions";
import { mediaFailure, mediaStores, restoreMedia } from "./_shared/media-removals.mts";
export default async (req: Request, context: Context): Promise<Response> => {
  try { return await restoreMedia(req, mediaStores(context)); } catch (error) { return mediaFailure(error); }
};
export const config: Config = { path: "/api/media/restore", method: "POST", rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ["ip", "domain"] } };
