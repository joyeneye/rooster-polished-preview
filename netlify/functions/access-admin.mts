import type { Config } from "@netlify/functions";
import { assertSameOrigin, MemberError, memberJSON } from "./_shared/member-auth.mts";
import {
  accessFailure, accessOverview, approveRequest, createInvitation, declineRequest,
  readAccessBody, requireAccessAdmin, revokeInvitation, setMemberAccess,
} from "./_shared/roster-access.mts";

/** The invite-only admin panel, for J.White only: create and withdraw
 * invitations, approve or decline the people on the waiting list, and approve
 * or withdraw one account's access directly. */
export default async (req: Request): Promise<Response> => {
  try {
    assertSameOrigin(req);
    const founder = await requireAccessAdmin();
    const body = await readAccessBody(req, "invite-only action");
    const action = typeof body.action === "string" ? body.action : "overview";

    if (action === "overview") return memberJSON({ action, ...await accessOverview() });

    if (action === "create_invitation") {
      const invitation = await createInvitation(founder.id, body);
      return memberJSON({ action, invitation, ...await accessOverview() });
    }

    if (action === "revoke_invitation") {
      await revokeInvitation(founder.id, body.invitation_id);
      return memberJSON({ action, ...await accessOverview() });
    }

    if (action === "approve_request") {
      const approved = await approveRequest(founder.id, body.request_id);
      return memberJSON({ action, invitation: approved.invitation, request: approved.request, ...await accessOverview() });
    }

    if (action === "decline_request") {
      await declineRequest(founder.id, body.request_id);
      return memberJSON({ action, ...await accessOverview() });
    }

    if (action === "set_member_access") {
      await setMemberAccess(founder.id, body.member_id, body.status);
      return memberJSON({ action, ...await accessOverview() });
    }

    throw new MemberError(400, "That invite-only action is not available.");
  } catch (error) {
    return accessFailure(error);
  }
};

export const config: Config = {
  path: "/api/access/admin",
  method: "POST",
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
