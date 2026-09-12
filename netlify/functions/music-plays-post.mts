import type { Config, Context } from "@netlify/functions";
import { postMusicPlay, playStore, playsUnavailable } from "./_shared/music-plays.mts";
export default async (req: Request, context: Context): Promise<Response> => {
  try { return await postMusicPlay(req, playStore(context)); }
  catch (error) { return playsUnavailable(error); }
};
export const config: Config = {
  path: "/api/music-plays/post", method: "POST",
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
