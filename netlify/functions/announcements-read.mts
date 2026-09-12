import type { Config } from "@netlify/functions";
import { assertSameOrigin, memberJSON } from "./_shared/member-auth.mts";
import { announcementFailure, markAnnouncementRead, readAnnouncementRequest } from "./_shared/founder-announcements.mts";
import { requireCommunityMember } from "./_shared/roster-access.mts";

/** A member opens their copy of an announcement. Only their own delivery row
 * is touched, so nobody can mark somebody else's announcement read. */
export default async (req: Request): Promise<Response> => {
  try {
    assertSameOrigin(req);
    const member = await requireCommunityMember();
    const input = await readAnnouncementRequest(req);
    const result = await markAnnouncementRead(member, input.announcement_id);
    return memberJSON(result);
  } catch (error) {
    return announcementFailure(error);
  }
};

export const config: Config = {
  path: "/api/announcements/read",
  method: "POST",
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
