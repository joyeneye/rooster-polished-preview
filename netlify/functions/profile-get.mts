import type { Config, Context } from "@netlify/functions";
import { getPublicProfile, profileStore, profileFailure } from "./_shared/member-profiles.mts";
import { communityDirectory } from "./_shared/community-members.mts";
import { friendStore } from "./_shared/friends.mts";
import { accessFailure, requireCommunityMember } from "./_shared/roster-access.mts";
import { handleProfileGet } from "./_shared/profile-endpoint-handlers.mts";

/** Member profiles are inside the community. J.White's own profile stays public
 * because it is the front door of the site; every other profile needs an
 * invitation and approval, so a direct link to somebody's page shows nothing to
 * a visitor who has not been let in. */
export default async (req: Request, context: Context) => handleProfileGet(req, {
  authorizeMember: requireCommunityMember,
  readProfile: request => getPublicProfile(request, profileStore(context), {
    directory: communityDirectory(context),
    friends: friendStore(context),
  }),
  accessFailure,
  profileFailure,
});
export const config: Config = { path: "/api/profile", method: "GET", rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] } };
