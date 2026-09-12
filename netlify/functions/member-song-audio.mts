import type { Config, Context } from "@netlify/functions";
import { getMemberSongAudio, songStores, songsFailure } from "./_shared/member-songs.mts";

export default async (req: Request, context: Context): Promise<Response> => {
  try { return await getMemberSongAudio(req, songStores(context)); } catch (error) { return songsFailure(error); }
};
export const config: Config = { path: "/api/member-song-audio/:id/:slot/:hash", method: "GET", rateLimit: { windowLimit: 180, windowSize: 60, aggregateBy: ["ip", "domain"] } };
