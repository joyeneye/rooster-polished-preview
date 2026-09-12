import type { Config, Context } from "@netlify/functions";
import { getMusicPlays, playStore, playsUnavailable } from "./_shared/music-plays.mts";
export default async (req: Request, context: Context): Promise<Response> => {
  try { return await getMusicPlays(req, playStore(context)); }
  catch (error) { return playsUnavailable(error); }
};
export const config: Config = {
  path: "/api/music-plays", method: "GET",
  rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
