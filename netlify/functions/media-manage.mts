import type { Config, Context } from "@netlify/functions";
import { manageMedia, mediaFailure, mediaStores } from "./_shared/media-removals.mts";
export default async (req: Request, context: Context): Promise<Response> => {
  try { return await manageMedia(req, mediaStores(context)); } catch (error) { return mediaFailure(error); }
};
export const config: Config = { path: "/api/media/manage", method: "GET", rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ["ip", "domain"] } };
