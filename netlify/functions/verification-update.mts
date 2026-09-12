import type { Config, Context } from "@netlify/functions";
import { profileStore, profileFailure } from "./_shared/member-profiles.mts";
import { memberStores } from "./_shared/member-messages.mts";
import { updateVerification } from "./_shared/member-verification.mts";
import { resolveCommunityProfileMember } from "./_shared/roster-access.mts";
export default async (req: Request, context: Context) => { try { const member = await resolveCommunityProfileMember(); return await updateVerification(req, profileStore(context), memberStores(context).directory, { resolveMember: async () => member }); } catch (e) { return profileFailure(e); } };
export const config: Config = { path: "/api/verification/update", method: "POST", rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip", "domain"] } };
