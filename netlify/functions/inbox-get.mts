import type { Config, Context } from "@netlify/functions";
import { getMemberMessages, memberStores } from "./_shared/member-messages.mts";
import { welcomeMember } from "./_shared/member-welcome.mts";
import { assertSameOrigin, memberFailure } from "./_shared/member-auth.mts";
import { catchUpMembership } from "./_shared/membership-catchup.mts";
import { requireCommunityMember } from "./_shared/roster-access.mts";

export default async (req: Request, context: Context): Promise<Response> => {
  try {
    assertSameOrigin(req);
    const member = await requireCommunityMember();
    const stores = memberStores(context);
    await welcomeMember(member, context, stores);
    await catchUpMembership(member, context, stores);
    return await getMemberMessages(req, stores, async () => member);
  } catch (error) {
    return memberFailure(error);
  }
};

export const config: Config = {
  path: "/api/member-messages",
  method: "GET",
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
