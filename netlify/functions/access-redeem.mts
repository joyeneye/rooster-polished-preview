import type { Config } from "@netlify/functions";
import { assertSameOrigin } from "./_shared/member-auth.mts";
import { accessFailure, readAccessBody, readAccessMember, redeemInvite } from "./_shared/roster-access.mts";

/** Enter an invite code. This is the only way an account approves itself, and
 * it only works with a code J.White created that has not been used up,
 * withdrawn or expired. */
export default async (req: Request): Promise<Response> => {
  try {
    assertSameOrigin(req);
    const member = await readAccessMember();
    const body = await readAccessBody(req, "invite code");
    const access = await redeemInvite(member, body.code);
    return new Response(JSON.stringify({
      approved: access.approved,
      status: access.status,
      message: "Your invitation was accepted. Welcome to ROOSTER.",
      access,
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
  path: "/api/access/redeem",
  method: "POST",
  // Deliberately tight: an invite code is a secret, so guessing has to be slow.
  rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
