import type { Config, Context } from "@netlify/functions";
import { getMemberMessageVideo, memberStores, protectPrivateMessageMedia } from "./_shared/member-messages.mts";
import { assertSameOrigin, MemberError, memberJSON, memberFailure } from "./_shared/member-auth.mts";
import { requireCommunityMember } from "./_shared/roster-access.mts";

export default async (req: Request, context: Context): Promise<Response> => {
  try {
    assertSameOrigin(req);
    const member = await requireCommunityMember();
    return await getMemberMessageVideo(req, memberStores(context), async () => member);
  } catch (error) {
    const response = error instanceof MemberError && (error.status === 401 || error.status === 403)
      ? memberJSON({ error: "Video not found." }, 404)
      : memberFailure(error);
    return protectPrivateMessageMedia(response);
  }
};

export const config: Config = {
  path: "/api/member-message-video/:id",
  method: "GET",
  rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
