import type { Config, Context } from "@netlify/functions";
import { mediaFailure, mediaStores, purgeRemovedMedia } from "./_shared/media-removals.mts";
export default async (req: Request, context: Context): Promise<Response> => {
  try { return await purgeRemovedMedia(req, mediaStores(context)); } catch (error) { return mediaFailure(error); }
};
export const config: Config = { path: "/api/media/purge", method: "POST", rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ["ip", "domain"] } };
