import { audioTransferStore } from "./_shared/audio-transfers.mts";
import type { Config, Context } from "@netlify/functions";
import { uploadMemberSong, songStores, songsFailure } from "./_shared/member-songs.mts";
import { resolveProfileMember } from "./_shared/member-profiles.mts";
import { assertSameOrigin } from "./_shared/member-auth.mts";

export default async (req: Request, context: Context): Promise<Response> => {
  try { assertSameOrigin(req); const member = await resolveProfileMember();
    return await uploadMemberSong(req, songStores(context), { resolveMember: async () => member, transfers: audioTransferStore(context) }); } catch (error) { return songsFailure(error); }
};
export const config: Config = { path: "/api/member-songs/upload", method: "POST", rateLimit: { windowLimit: 8, windowSize: 60, aggregateBy: ["ip", "domain"] } };
