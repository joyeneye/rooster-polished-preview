import type { Config } from "@netlify/functions";
import { getUser } from "@netlify/identity";
import { assertSameOrigin, MEMBER_ID } from "./_shared/member-auth.mts";
import { accessFailure, readAccessBody, requestInvite } from "./_shared/roster-access.mts";

/** Request an invite. This writes one waiting-list row and nothing else: no
 * account is created, no membership is granted and no part of ROOSTER opens up.
 * The person is in only once J.White approves them. */
export default async (req: Request): Promise<Response> => {
  try {
    assertSameOrigin(req);
    const body = await readAccessBody(req, "invite request");
    // If they happen to already have an account, note it so approving them
    // lets that same account in without a second step.
    let memberId: string | null = null;
    try {
      const user = await getUser();
      if (user && MEMBER_ID.test(user.id)) memberId = user.id.toLowerCase();
    } catch { memberId = null; }
    const result = await requestInvite(body, memberId);
    return new Response(JSON.stringify({
      waiting: result.status === "waiting",
      status: result.status,
      already_waiting: result.already_waiting,
      message: result.status === "declined"
        ? "ROOSTER is invite only and this request was not approved."
        : result.status === "approved"
          ? "You have already been approved. Check your email for your invite code."
          : "You are on the ROOSTER waiting list. J.White reviews every request, and you will get an invite code if you are approved. Being on the waiting list does not make you a member.",
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return accessFailure(error);
  }
};

export const config: Config = {
  path: "/api/access/request",
  method: "POST",
  rateLimit: { windowLimit: 6, windowSize: 300, aggregateBy: ["ip", "domain"] },
};
