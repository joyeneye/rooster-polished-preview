import type { Config, Context } from "@netlify/functions";
import { memberPlayStore, memberPlaysFailure, postMemberMusicPlay } from "./_shared/member-music-plays.mts";
import { songStores } from "./_shared/member-songs.mts";

export default async (req: Request, context: Context): Promise<Response> => {
  try { return await postMemberMusicPlay(req, memberPlayStore(context), songStores(context)); }
  catch (error) { return memberPlaysFailure(error); }
};
export const config: Config = {
  path: "/api/member-music-plays/post", method: "POST",
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
