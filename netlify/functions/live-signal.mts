import type { Config, Context } from "@netlify/functions";
import { assertSameOrigin, memberJSON } from "./_shared/member-auth.mts";
import { resolveCommunityProfileMember } from "./_shared/roster-access.mts";
import { liveFailure, readLiveBody, sendSignals } from "./_shared/roster-live.mts";

/** Passes connection setup between two people in the same room. This is the
 * only path audio needs from the server, and it carries no audio: it carries
 * the descriptions two browsers use to reach each other directly, and each
 * row is deleted the moment the other side collects it. */
export default async (req: Request, _context: Context): Promise<Response> => {
  try {
    assertSameOrigin(req);
    const member = await resolveCommunityProfileMember();
    const body = await readLiveBody(req);
    return memberJSON(await sendSignals(member, body.key, body.session, body.signals ?? body.signal));
  } catch (error) {
    return liveFailure(error);
  }
};

export const config: Config = {
  path: "/api/live/signal",
  method: "POST",
  rateLimit: { windowLimit: 300, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
