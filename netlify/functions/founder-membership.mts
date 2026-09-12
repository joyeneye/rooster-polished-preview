import type { Config, Context } from "@netlify/functions";
import { assertSameOrigin, MEMBER_ID, MemberError, memberJSON } from "./_shared/member-auth.mts";
import { profileStore } from "./_shared/member-profiles.mts";
import { communityDirectory } from "./_shared/community-members.mts";
import {
  isMembershipLevel, membershipCounts, membershipRoster, membershipRows,
  recordMembershipLaunch, setMembershipLevel,
} from "./_shared/roster-membership.mts";
import { announcementAccess, announcementFailure, readAnnouncementRequest, requireAnnouncer } from "./_shared/founder-announcements.mts";
import { resolveCommunityProfileMember } from "./_shared/roster-access.mts";

/** Founder controls behind the announcement feature: turn the new membership
 * system on (which is what marks every existing account an Early Member),
 * change one member's level, and authorize or withdraw an administrator's
 * ability to announce. */
export default async (req: Request, context: Context): Promise<Response> => {
  try {
    assertSameOrigin(req);
    const member = await resolveCommunityProfileMember();
    const profiles = profileStore(context);
    const access = await announcementAccess(member, profiles);
    const founderId = requireAnnouncer(access);
    const input = await readAnnouncementRequest(req);
    const action = typeof input.action === "string" ? input.action : "";

    if (action === "launch_membership") {
      const roster = await membershipRoster(profiles, communityDirectory(context));
      const launch = await recordMembershipLaunch(founderId, roster);
      return memberJSON({ action, launch, counts: await membershipCounts() });
    }

    if (action === "set_level") {
      const level = input.level;
      if (typeof input.member_id !== "string" || !isMembershipLevel(level)) {
        throw new MemberError(400, "Choose a valid member and membership level.");
      }
      const updated = await setMembershipLevel(input.member_id, level, founderId);
      return memberJSON({ action, member: updated, counts: await membershipCounts(), members: await membershipRows() });
    }

    // Only J.White himself decides who else may announce.
    if (action === "set_announcer") {
      if (!access.canManageTeam) throw new MemberError(403, "Only J.White can authorize another administrator.");
      if (typeof input.member_id !== "string" || !MEMBER_ID.test(input.member_id)) throw new MemberError(400, "Choose a valid member.");
      const id = input.member_id.toLowerCase();
      if (id === founderId) throw new MemberError(400, "You already have this ability.");
      const canAnnounce = input.can_announce === true;
      await profiles.setJSON(`announcement-team/${id}`, {
        id, can_announce: canAnnounce, granted_by: founderId, updated_at: new Date().toISOString(),
      });
      return memberJSON({ action, member_id: id, can_announce: canAnnounce });
    }

    throw new MemberError(400, "That membership action is not available.");
  } catch (error) {
    return announcementFailure(error);
  }
};

export const config: Config = {
  path: "/api/founder/membership",
  method: "POST",
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
