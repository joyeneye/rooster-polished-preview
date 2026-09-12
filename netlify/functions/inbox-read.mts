import type { Config, Context } from "@netlify/functions";
import { markMemberMessageRead, memberStores } from "./_shared/member-messages.mts";
import { assertSameOrigin, memberFailure } from "./_shared/member-auth.mts";
import { requireCommunityMember } from "./_shared/roster-access.mts";

export default async (req: Request, context: Context): Promise<Response> => {
  try {
    assertSameOrigin(req);
    const member = await requireCommunityMember();
    return await markMemberMessageRead(req, memberStores(context), async () => member);
  } catch (error) {
    return memberFailure(error);
  }
};

export const config: Config = {
  path: "/api/member-messages/read",
  method: "POST",
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
