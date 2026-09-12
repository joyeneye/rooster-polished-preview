import type { Config, Context } from "@netlify/functions";
import { profileStore, profileFailure } from "./_shared/member-profiles.mts";
import { memberStores } from "./_shared/member-messages.mts";
import { getVerification } from "./_shared/member-verification.mts";
import { resolveCommunityProfileMember } from "./_shared/roster-access.mts";
export default async (req: Request, context: Context) => { try { const member = await resolveCommunityProfileMember(); return await getVerification(req, profileStore(context), memberStores(context).directory, { resolveMember: async () => member }); } catch (e) { return profileFailure(e); } };
export const config: Config = { path: "/api/verification", method: "GET", rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ["ip", "domain"] } };
