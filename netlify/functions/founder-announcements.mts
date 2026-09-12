import type { Config, Context } from "@netlify/functions";
import { assertSameOrigin, memberJSON } from "./_shared/member-auth.mts";
import { profileStore } from "./_shared/member-profiles.mts";
import { MEMBERSHIP_LEVELS, membershipCounts, membershipLaunchRecord, membershipRows } from "./_shared/roster-membership.mts";
import {
  AUDIENCE_KINDS, announcementAccess, announcementFailure, announcementHistory,
  FOUNDER_NAME, FOUNDER_TITLE, LAUNCH_ANNOUNCEMENT,
} from "./_shared/founder-announcements.mts";
import { resolveCommunityProfileMember } from "./_shared/roster-access.mts";

/** Everything the Founder Announcement dashboard needs. A member without send
 * access gets a plain 403 and no membership roster. */
export default async (req: Request, context: Context): Promise<Response> => {
  try {
    assertSameOrigin(req);
    const member = await resolveCommunityProfileMember();
    const profiles = profileStore(context);
    const access = await announcementAccess(member, profiles);
    if (!access.canSend) return memberJSON({ error: "Only J.White and an administrator he authorizes can send a ROOSTER announcement." }, 403);
    const [launch, counts, members, history] = await Promise.all([
      membershipLaunchRecord(), membershipCounts(), membershipRows(), announcementHistory(),
    ]);
    return memberJSON({
      can_send: true,
      can_manage_team: access.canManageTeam,
      author: { name: FOUNDER_NAME, title: FOUNDER_TITLE },
      membership_live: Boolean(launch),
      launch,
      audiences: AUDIENCE_KINDS,
      levels: MEMBERSHIP_LEVELS,
      counts,
      members,
      history,
      launch_announcement: LAUNCH_ANNOUNCEMENT,
    });
  } catch (error) {
    return announcementFailure(error);
  }
};

export const config: Config = {
  path: "/api/founder/announcements",
  method: "GET",
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
