import type { Config, Context } from "@netlify/functions";
import { getMemberUnreadMessages, memberStores } from "./_shared/member-messages.mts";
import { assertSameOrigin, memberFailure } from "./_shared/member-auth.mts";
import { requireCommunityMember } from "./_shared/roster-access.mts";

export default async (req: Request, context: Context): Promise<Response> => {
  try {
    assertSameOrigin(req);
    const member = await requireCommunityMember();
    return await getMemberUnreadMessages(req, memberStores(context), async () => member);
  } catch (error) {
    return memberFailure(error);
  }
};

export const config: Config = {
  path: "/api/member-messages/unread",
  method: "GET",
  rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
