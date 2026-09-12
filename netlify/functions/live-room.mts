import type { Config, Context } from "@netlify/functions";
import { assertSameOrigin, memberJSON } from "./_shared/member-auth.mts";
import { profileStore } from "./_shared/member-profiles.mts";
import { resolveCommunityProfileMember } from "./_shared/roster-access.mts";
import {
  createRoom, hostAction, iceServers, joinRoom, leaveRoom, liveFailure,
  raiseHand, readLiveBody, sayInRoom, setMuted, syncRoom,
} from "./_shared/roster-live.mts";

/** One door for everything a member does inside a room: open it, come in,
 * check in, leave, raise a hand, mute or unmute themselves, and — if they are
 * the host of that room — run it.
 *
 * Every branch takes its member from the invite-only gate first, so a room
 * link, a copied room key or a hand-made request gets a member nowhere
 * without an invitation and J.White's approval. */
export default async (req: Request, context: Context): Promise<Response> => {
  try {
    assertSameOrigin(req);
    const member = await resolveCommunityProfileMember();
    const body = await readLiveBody(req);
    const action = typeof body.action === "string" ? body.action : "";
    const profiles = profileStore(context);
    switch (action) {
      case "create": {
        const created = await createRoom(member, body.title, profiles, {
          medium: body.medium, description: body.description,
        });
        return memberJSON({ ...created, member_id: member.id, ice_servers: iceServers() });
      }
      case "join": {
        const state = await joinRoom(member, body.key, body.session, profiles);
        return memberJSON({ ...state, member_id: member.id, ice_servers: iceServers() });
      }
      case "sync":
        return memberJSON({ ...await syncRoom(member, body.key, body.session), member_id: member.id });
      case "leave":
        return memberJSON({ ...await leaveRoom(member, body.key, body.session), member_id: member.id });
      case "hand":
        return memberJSON({ ...await raiseHand(member, body.key, body.raised), member_id: member.id });
      case "mute":
        return memberJSON({ ...await setMuted(member, body.key, body.muted), member_id: member.id });
      case "say":
        return memberJSON({ ...await sayInRoom(member, body.key, body.body, profiles), member_id: member.id });
      case "host":
        return memberJSON({
          ...await hostAction(member, body.key, body.host_action, body.member_id, body.message_id),
          member_id: member.id,
        });
      default:
        return memberJSON({ error: "That ROOSTER LIVE action is not available." }, 400);
    }
  } catch (error) {
    return liveFailure(error);
  }
};

export const config: Config = {
  path: "/api/live/room",
  method: "POST",
  // The heartbeat runs every few seconds for everybody in a room, so the
  // window is wide enough for a busy room and still bounded.
  rateLimit: { windowLimit: 240, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
