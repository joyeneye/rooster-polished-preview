import type { Config, Context } from "@netlify/functions";
import { eq, inArray, or } from "drizzle-orm";
import { db } from "../../db/index.js";
import { rosterAccess, socialBlocks } from "../../db/schema.js";
import { resolveCommunityProfileMember } from "./_shared/roster-access.mts";
import { acceptedFriendsFor, friendStore } from "./_shared/friends.mts";
import { profileStore } from "./_shared/member-profiles.mts";
import { communityDirectory } from "./_shared/community-members.mts";
import { getTopEightRoster } from "./_shared/top-eight-roster.mts";

export default async (req: Request, context: Context): Promise<Response> => {
  const profiles = profileStore(context);
  return getTopEightRoster(req, {
    profiles,
    directory: communityDirectory(context),
    resolveMember: resolveCommunityProfileMember,
    friends: target => acceptedFriendsFor(target, friendStore(context), profiles),
    approvedIds: async () => {
      const rows = await db.select({ id: rosterAccess.memberId }).from(rosterAccess).where(eq(rosterAccess.status, "approved"));
      return rows.map(row => row.id);
    },
    blockedIds: async participants => {
      const rows = await db.select({ blocker: socialBlocks.blockerId, blocked: socialBlocks.blockedId }).from(socialBlocks)
        .where(or(inArray(socialBlocks.blockerId, participants), inArray(socialBlocks.blockedId, participants)));
      return [...new Set(rows.flatMap(row => [
        ...(participants.includes(row.blocker) ? [row.blocked] : []),
        ...(participants.includes(row.blocked) ? [row.blocker] : []),
      ]))];
    },
  });
};

export const config: Config = { path: "/api/top-eight-roster", method: ["GET", "PUT"], rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ["ip", "domain"] } };
