import type { Config, Context } from "@netlify/functions";
import { getOwnProfile, profileStore, profileFailure } from "./_shared/member-profiles.mts";
import { welcomeMember } from "./_shared/member-welcome.mts";
import { communityDirectory } from "./_shared/community-members.mts";
import { catchUpMembership } from "./_shared/membership-catchup.mts";
import { resolveCommunityProfileMember } from "./_shared/roster-access.mts";
import { handleProfileMe } from "./_shared/profile-endpoint-handlers.mts";

export default async (req: Request, context: Context) => handleProfileMe(req, context, {
  resolveMember: resolveCommunityProfileMember,
  readProfile: (request, member) => getOwnProfile(request, profileStore(context), {
    resolveMember: async () => member,
    directory: communityDirectory(context),
  }),
  aftercare: [
    member => welcomeMember(member, context),
    member => catchUpMembership(member, context),
  ],
  failure: profileFailure,
});
export const config: Config = { path: "/api/profile/me", method: "GET", rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] } };
