import type { Config, Context } from "@netlify/functions";
import { assertSameOrigin, memberJSON } from "./_shared/member-auth.mts";
import { profileStore } from "./_shared/member-profiles.mts";
import {
  announcementAccess, announcementFailure, readAnnouncementDraft,
  readAnnouncementRequest, requireAnnouncer, sendAnnouncement,
} from "./_shared/founder-announcements.mts";
import { resolveCommunityProfileMember } from "./_shared/roster-access.mts";

/** Send the announcement. Authority is re-read from storage here rather than
 * carried over from the preview, and the announcement key makes a repeated
 * send land no second copy in anybody's messages. */
export default async (req: Request, context: Context): Promise<Response> => {
  try {
    assertSameOrigin(req);
    const member = await resolveCommunityProfileMember();
    const access = await announcementAccess(member, profileStore(context));
    const founderId = requireAnnouncer(access);
    const draft = readAnnouncementDraft(await readAnnouncementRequest(req));
    const result = await sendAnnouncement(draft, founderId);
    return memberJSON(result, result.status === "sent" ? 201 : 200);
  } catch (error) {
    return announcementFailure(error);
  }
};

export const config: Config = {
  path: "/api/founder/announcements/send",
  method: "POST",
  rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
