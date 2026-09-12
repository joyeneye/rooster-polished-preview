import type { Config, Context } from "@netlify/functions";
import { assertSameOrigin, memberJSON } from "./_shared/member-auth.mts";
import { resolveCommunityProfileMember } from "./_shared/roster-access.mts";
import { iceServers, listRooms, liveFailure, PRESENT_WINDOW_MS } from "./_shared/roster-live.mts";

/** Every ROOSTER LIVE room that is on right now. Behind the invite-only gate:
 * a visitor without an invitation and J.White's approval cannot see that a
 * room exists, never mind its name or who is in it. */
export default async (req: Request, _context: Context): Promise<Response> => {
  try {
    assertSameOrigin(req);
    const member = await resolveCommunityProfileMember();
    const { rooms } = await listRooms(member);
    return memberJSON({
      member_id: member.id, name: member.name,
      rooms, ice_servers: iceServers(),
      present_window_ms: PRESENT_WINDOW_MS,
    });
  } catch (error) {
    return liveFailure(error);
  }
};

export const config: Config = {
  path: "/api/live/rooms",
  method: "GET",
  rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
