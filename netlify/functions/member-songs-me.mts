import type { Config, Context } from "@netlify/functions";
import { getOwnSongs, songStores, songsFailure } from "./_shared/member-songs.mts";

import { assertSameOrigin } from "./_shared/member-auth.mts";
import { resolveCommunityProfileMember } from "./_shared/roster-access.mts";

export default async (req: Request, context: Context): Promise<Response> => {
  try { assertSameOrigin(req); const member = await resolveCommunityProfileMember();
    return await getOwnSongs(req, songStores(context), { resolveMember: async () => member }); } catch (error) { return songsFailure(error); }
};
export const config: Config = { path: "/api/member-songs/me", method: "GET", rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] } };
