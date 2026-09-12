import type { Config, Context } from "@netlify/functions";
import { updateProfile, profileStore, profileFailure } from "./_shared/member-profiles.mts";
import { welcomeMember } from "./_shared/member-welcome.mts";
import { resolveCommunityProfileMember } from "./_shared/roster-access.mts";
export default async (req: Request, context: Context) => { try { const member = await resolveCommunityProfileMember(); const response = await updateProfile(req, profileStore(context), { resolveMember: async () => member }); if (response.ok) await welcomeMember(member, context); return response; } catch (e) { return profileFailure(e); } };
export const config: Config = { path: "/api/profile/update", method: "POST", rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ["ip", "domain"] } };
