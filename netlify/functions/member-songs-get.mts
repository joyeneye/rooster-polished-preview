import type { Config, Context } from "@netlify/functions";
import { getMemberSongs, songStores, songsFailure } from "./_shared/member-songs.mts";

export default async (req: Request, context: Context): Promise<Response> => {
  try { return await getMemberSongs(req, songStores(context)); } catch (error) { return songsFailure(error); }
};
export const config: Config = { path: "/api/member-songs", method: "GET", rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] } };
