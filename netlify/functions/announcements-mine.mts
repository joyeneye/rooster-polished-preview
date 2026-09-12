import type { Config, Context } from "@netlify/functions";
import { assertSameOrigin, memberJSON } from "./_shared/member-auth.mts";
import { memberStores } from "./_shared/member-messages.mts";
import { profileStore } from "./_shared/member-profiles.mts";
import { ensureMembership } from "./_shared/roster-membership.mts";
import { announcementFailure, deliverPendingAnnouncements, memberAnnouncements } from "./_shared/founder-announcements.mts";
import { requireCommunityMember } from "./_shared/roster-access.mts";

/** The member's own membership and any Founder announcement addressed to them.
 * Loading this is what places a pending announcement in their messages, so it
 * is waiting the next time they log in. */
export default async (req: Request, context: Context): Promise<Response> => {
  try {
    assertSameOrigin(req);
    const member = await requireCommunityMember();
    const membership = await ensureMembership(member, profileStore(context));
    await deliverPendingAnnouncements(member, memberStores(context));
    const announcements = await memberAnnouncements(member);
    return memberJSON({
      membership,
      announcements,
      unread_count: announcements.filter(entry => !entry.read).length,
    });
  } catch (error) {
    return announcementFailure(error);
  }
};

export const config: Config = {
  path: "/api/announcements/mine",
  method: "GET",
  rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
